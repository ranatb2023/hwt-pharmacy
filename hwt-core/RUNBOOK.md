# RUNBOOK — operating the pharmacy server

For whoever installs and looks after the machine. Everything here is Phase 00 work that
happens **on the server**, not in the code.

Site facts this assumes: **no internet, LAN only, load-shedding.**

---

## 0. Before you start

Paths below are written as `C:\hwt\backend`. **That is a placeholder** — substitute wherever
you actually deploy the backend folder, and quote it if it contains spaces.

Check what you have:

```powershell
(Get-Command node).Source        # expect C:\Program Files\nodejs\node.exe
node -v                          # expect v20 or later
```

Everything in §1–§4 needs an **elevated** PowerShell (right-click → Run as Administrator).
Check with:

```powershell
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)      # must print True
```

> **The pharmacy machine has no internet.** Anything that has to be downloaded must be
> downloaded somewhere else and carried in on the USB stick. Plan the install kit before you
> travel: `nssm.exe` (if you use Option A), the Node installer, the built application folder.

---

## 1. Make the server start itself

The server must come back with the power. Nobody should have to find a shortcut after an
outage. Two ways — **Option B needs nothing downloaded**, so prefer it unless you already
have nssm.

### Option A — NSSM

A single portable exe, ~350 KB, no installer. Get it once on a machine with internet and keep
it on the deployment USB:

```powershell
choco install nssm -y
# or: download nssm-2.24.zip from https://nssm.cc/download and copy win64\nssm.exe onto the PATH
```

If `nssm` reports `CommandNotFoundException`, it is not installed yet — do the above first.

```powershell
nssm install HWT-HMS "C:\Program Files\nodejs\node.exe" "src\server.js"
nssm set HWT-HMS AppDirectory "C:\hwt\backend"
nssm set HWT-HMS Start SERVICE_AUTO_START
nssm set HWT-HMS AppExit Default Restart
nssm set HWT-HMS AppRestartDelay 5000
nssm set HWT-HMS AppStdout "C:\hwt\logs\out.log"
nssm set HWT-HMS AppStderr "C:\hwt\logs\err.log"
nssm set HWT-HMS AppRotateFiles 1
nssm start HWT-HMS
```

Everyday commands: `nssm status|stop|start|restart HWT-HMS`.

### Option B — Task Scheduler (built into Windows, nothing to download)

```powershell
$dir = "C:\hwt\backend"                      # <- your actual path
$act = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" `
                               -Argument "src\server.js" -WorkingDirectory $dir
$trg = New-ScheduledTaskTrigger -AtStartup
$set = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
                                    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "HWT-HMS" -Action $act -Trigger $trg -Settings $set `
                       -User "SYSTEM" -RunLevel Highest
Start-ScheduledTask -TaskName "HWT-HMS"
```

`-AtStartup` under `SYSTEM` means it returns after load-shedding with nobody logged in.
`-RestartInterval 1 minute` gives the restart-on-failure behaviour nssm provides.

Everyday commands:

```powershell
Get-ScheduledTask HWT-HMS | Get-ScheduledTaskInfo    # last run, last result
Stop-ScheduledTask  -TaskName HWT-HMS                # before any restore
Start-ScheduledTask -TaskName HWT-HMS
```

Task Scheduler does not capture stdout. To keep logs, point the action at a one-line wrapper
`start.cmd` that redirects: `node src\server.js >> C:\hwt\logs\out.log 2>&1`.

> **`sc.exe create` will not work.** Node is not a service-aware binary; the Service Control
> Manager kills it with error 1053 for not responding to a start request. That is what nssm
> and Task Scheduler are working around.

### Either way, verify it survives a reboot

```powershell
Restart-Computer
# after it comes back, WITHOUT logging into anything:
Test-NetConnection localhost -Port 4000      # TcpTestSucceeded : True
```

**The server refuses to start if the system clock has gone backwards.** That is deliberate —
see §6. If it will not start, read the log (`C:\hwt\logs\err.log`, or the task's Last Result)
before doing anything else.

---

## 2. Network

- **Static IP on the server**, reserved in the router (e.g. `192.168.1.10`).
- Counter machines: bookmark `http://192.168.1.10:4000` and set it as the browser home page.
- Counter machines are **wired**. Wi-Fi is for roaming tablets only.
- Do not rely on Windows machine-name discovery. It fails intermittently and the failure
  looks like a broken application.

Check the whole path is up:

```powershell
Test-NetConnection 192.168.1.10 -Port 4000
```

---

## 3. Backups

Already wired into the app:

```powershell
cd C:\hwt\backend
npm run backup                                # -> backend\data\backups\
npm run backup -- D:\hwt-backups              # a different disk
npm run backup -- D:\hwt-backups --keep 48    # prune to the newest 48
```

Safe to run while customers are being served — `VACUUM INTO` takes a read transaction and
writes a consistent, compacted snapshot.

> **Never back up by copying `hms.db` in Explorer or with xcopy.** In WAL mode the newest
> commits live in `hms.db-wal`. A copy of the main file alone is a database missing its most
> recent sales, and you will not find out until you need it.

### Schedule

| When | Where | Retention |
|---|---|---|
| Hourly | second internal disk `D:\hwt-backups` | `--keep 48` |
| Nightly | `D:\hwt-backups\nightly` | `--keep 30` |
| Weekly | USB stick, **two in rotation, one always off-site** | never pruned by a job |

```powershell
schtasks /create /tn "HWT hourly backup" /sc hourly ^
  /tr "cmd /c cd /d C:\hwt\backend && npm run backup -- D:\hwt-backups --keep 48" ^
  /ru SYSTEM
```

The second disk covers a mistake. The off-site USB covers a fire or a theft. You need both.

---

## 4. Restore

**Stop the server first.** The script refuses to run while the database is in use.

```powershell
nssm stop HWT-HMS                       # Option A
Stop-ScheduledTask -TaskName HWT-HMS    # Option B

cd C:\hwt\backend
node scripts\restore.js D:\hwt-backups\hms-2026-09-07T18-00-00.db          # dry run
node scripts\restore.js D:\hwt-backups\hms-2026-09-07T18-00-00.db --yes    # do it

nssm start HWT-HMS                      # Option A
Start-ScheduledTask -TaskName HWT-HMS   # Option B
```

The dry run verifies the backup's integrity and prints how many bills it contains and the
date of its newest one — **read those numbers before restoring.** A backup that says "0
bills" is not the one you want.

The current database is never deleted. It is moved aside to
`hms.db.pre-restore-<timestamp>`, so restoring the wrong file is itself undoable.

### Prove it before you rely on it

A backup nobody has restored is a rumour. Once, on a spare machine:

1. Copy last night's backup to it.
2. Restore, start the server, log in.
3. Check the day-end report for that date matches the printed one.
4. Time the whole thing and write the number on the card in §7.

---

## 5. Power

One **1000 VA UPS** carrying the **server, the network switch and the receipt printer**.

Leaving the printer off it produces a half-printed receipt at the moment of a cut, which is a
support call every time.

Fifteen minutes of runtime is enough to close the cash session cleanly and shut down.

### The plug-pull test

Before going live, and after any change to the database layer. **Use a copy of the database,
not the live one.**

1. Start a sale, add lines, complete it.
2. Pull the server's power at a random moment. Twenty times.
3. Each time: power on, wait for the service, log in, check the last bill.

Pass = the database opens every time, there are **no half-written bills** (a bill with no
stock movements, or movements with no bill), and the last committed sale is intact.

This works because `synchronous = FULL` is pinned in `backend/src/db.js` and every write route
runs inside a single `db.transaction()`. If either changes, run this test again.

---

## 6. The clock

There is no internet, so there is no NTP and nothing corrects the system clock.

When the CMOS battery on a machine that is power-cycled several times a day finally dies, it
boots with its clock years in the past. Every business-day query, expiry check and day-end
report then silently files itself in the wrong period, and nobody notices for a week.

**The server refuses to start when it finds records dated after "now".** If you see:

```
*** SYSTEM CLOCK IS WRONG — REFUSING TO START ***
```

1. Set the correct date and time on the server.
2. If the clock keeps resetting after a power cut, **replace the CMOS battery** (CR2032).
   That is the actual fault; correcting the time only hides it until the next outage.
3. Start the service.

Do not work around this by editing the database.

---

## 7. Card to tape inside the counter

Print this and stick it where the pharmacist can see it.

```
  PHARMACY SERVER — QUICK CARD

  Server address        http://192.168.1.10:4000
  Server machine        <where it physically is>

  "Cannot reach server" on screen
     1. Is the server machine switched on?
     2. Is the network cable in, at both ends?
     3. Still nothing after 2 minutes -> call <name, number>
     NOTE: nothing can be saved while this shows. Do not keep serving
           customers on paper and enter it later without telling the admin.

  Server will not start / says CLOCK IS WRONG
     Fix the date and time on the server, then call <name, number>.
     Do not ignore it — sales will be filed under the wrong date.

  Restore last night's backup        (admin only, server stopped first)
     STOP the server:   ______________________________   <- write your exact command
     cd C:\hwt\backend
     node scripts\restore.js <backup file>          <- READ the numbers it prints
     node scripts\restore.js <backup file> --yes
     START the server:  ______________________________   <- write your exact command
     Takes about ____ minutes.      <- fill in from your restore drill

  Weekly USB backup           every <day>, swap the two sticks,
                              take the older one off-site.
```

---

## 8. Checklist before going live

- [ ] Install kit assembled on the USB (Node installer, app folder, `nssm.exe` if Option A)
- [ ] Server starts itself — nssm or Task Scheduler — and **survives a reboot unattended, nobody logged in**
- [ ] Static IP set and reserved; every counter bookmarked
- [ ] Hourly + nightly backups scheduled and verified to be producing files
- [ ] USB rotation started, two sticks, one off-site
- [ ] **Restore drill done on a spare machine, and timed**
- [ ] UPS installed across server + switch + printer, runtime measured
- [ ] Plug-pull test passed twenty times on a copy
- [ ] Clock guard tested — set the clock back, confirm the server refuses to start
- [ ] Quick card printed, filled in with real names and numbers, taped up
