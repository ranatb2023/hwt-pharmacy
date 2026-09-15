# SCOPE — what we are building, and what we are not

**Decided 2026-09-07. This file wins over every other document in the repo.**
If a phase file, the code, or somebody's memory disagrees with this page, this page is right
and the other thing needs fixing.

---

## The one-line description

> **A point-of-sale system for the pharmacy, plus a full dialysis management system.**
> Every other department is an outside requester that sends a prescription in and gets an
> invoice back.

That is the whole product. Nothing else is being built right now.

---

## The modules

Names match `MODULES_AND_FEATURES.md`.

### ✅ In scope — being built

| Module | What it means here |
|---|---|
| **Pharmacy Management** | The POS. Counter sales, dispensing against prescriptions, receipts, returns, the till |
| **Inventory & Stock Management** | Product master, batches, FEFO, expiry, valuation, movement ledger, **and recording deliveries** |
| **Customer Management** | One customer record for walk-ins, regulars, card holders, dialysis patients and departments. Purchase history, account |
| **Dialysis Management** | **Full module** — own registration, patient history, scheduling, sessions, the demand form, its own ledger |
| **Reporting & Analytics** | Day-end, margin, receivables, consumption, subsidy, hospital expense |
| **Donor Portal (Online)** | Phase 08 — see the connectivity problem below |
| **Patient Portal (Online)** | Phase 08 — see the connectivity problem below |
| **Offline Operation & Sync** | Offline operation is Phase 00. Sync is Phase 08 |

### ⏸️ On hold — not being built, code stays behind the mode gate

| Module | Why it is on hold | What replaces it |
|---|---|---|
| **Patient Management & Reception** | No reception desk in this product | Customer Management. Dialysis registers its own patients |
| **Token & Queue Management** | No OPD queue | Nothing — the pharmacy counter has no token system |
| **Doctor Consultation (EMR)** | No doctors in this product | Prescriptions arrive **from outside**, typed or scanned at the counter |
| **Laboratory Management** | Lab is a department, not a module | The lab sends a demand to the pharmacy and receives an invoice |

The code for all four already exists and **is not being deleted**. It stays behind the
existing `deployment_mode` gate, exactly as decided on 2026-08-24: one codebase, no fork. If
the trust turns them on later, they turn on.

### 🔧 Structural — not named by the client, but the product cannot run without them

The client's list did not mention these. They are not new modules; they are parts of the ones
above, and they are already built. **Recorded here so nobody thinks they were dropped.**

| Module | Where it now lives | Reduced how |
|---|---|---|
| **Vendor / Supplier Management** | Inside Inventory & Stock | Reduced to *record the delivery* + payables. No purchase orders — the order taker comes in person |
| **Billing, Discounts, Staff Cap** | Inside Pharmacy Management | Scoped to pharmacy sales, department invoices and dialysis. No consultation or lab pricing |
| **Refunds, Returns, Reclaims** | Inside Customer Management | Unchanged — Customer Management explicitly includes returns |
| **Cash Flow & Cash Float** | Inside Pharmacy Management | Unchanged — a POS needs a till |
| **Roles & Permissions** | Infrastructure | Unchanged |

---

## How the departments connect

**They don't integrate. They send paper in and get an invoice back.**

```
  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
  │ Laboratory  │   │  Emergency  │   │    Ward     │   │   OT etc.   │
  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
         │                 │                 │                 │
         └────────┬────────┴────────┬────────┴─────────────────┘
                  │                 │
           prescription /     (paper or typed at
             demand slip       the counter — no
                  │            system integration)
                  ▼
         ┌────────────────────────────────────┐
         │        PHARMACY  (the POS)         │
         │  dispense → FEFO → invoice         │
         └───────────────┬────────────────────┘
                         │
                invoice to the department
                         │
                         ▼
              ┌────────────────────────┐
              │  Department ledger     │
              │  = HOSPITAL EXPENSE    │
              └────────────────────────┘
```

Rules that follow from this:

1. **A department is a customer.** It has a customer record, a ledger account and a statement,
   exactly like a person who buys on credit.
2. **The pharmacy invoices it.** Not an internal "issue at cost" with no paperwork — a real
   invoice the department can be shown.
3. **Those invoices are the hospital's expense**, and the expense report is by department.
4. **There is no software link to the Lab or Emergency systems**, because those modules are on
   hold. The prescription arrives on paper and is typed at the counter, naming the department
   and the patient.
5. Stock still records `cost_centre` so the movement ledger can answer *where did it go* —
   but the money mechanism is an invoice, not a silent transfer.

### Dialysis is the exception

Dialysis is **not** just a department that sends slips. It is a full module inside this
product:

- It **registers its own patients** (Patient Management is on hold, so it cannot rely on it)
- It **keeps dialysis history** for future sessions
- It **orders medicine from the pharmacy** using its own demand form
- It has its own ledger, kept separate from a patient's personal credit account

---

## The identity model

Because Patient Management is on hold, **`customers` is the single person/party record**.

| Customer type | Example | Gets |
|---|---|---|
| `walk-in` | Someone buying Panadol | Nothing stored unless they ask |
| `registered` | A regular with an account | History, credit account, card |
| `dialysis` | A dialysis patient | All of the above **plus** a dialysis profile and session history |
| `department` | Laboratory, Emergency, Ward | Invoices and a department ledger |
| `staff` | An employee on subsidy | Subsidy allowance and a recovery account |

**Implementation note:** the existing `patients` table already carries code, name, contact,
CNIC, category and QR token. It becomes the customer table — add `customer_type`, relabel to
"Customer" in the UI. **Do not migrate to a new table.** Renaming a live table that thirty
routes reference, on a system the client uses daily, buys nothing.

---

## The connectivity problem with the two portals

The client has put **Donor Portal (Online)** and **Patient Portal (Online)** in scope. The
site has **no internet**.

Both facts are true, so the design has to absorb the contradiction rather than ignore it. The
honest design — and it is the one the module already describes, *"provide manual export/import
fallback when needed"*:

- The pharmacy stays the source of truth and never needs a connection.
- An **encrypted, de-identified export** is written to a USB stick from the Reports screen.
- Somebody carries it to a machine that does have internet.
- That machine hosts the two portals and imports the package.
- Sync is **one way** — hospital → online — which matches the module's own rule that conflicts
  resolve in favour of hospital data.

This needs an answer before Phase 08 starts: **is there any internet-connected machine, and
who carries the stick?** See [OPEN-QUESTIONS](OPEN-QUESTIONS.md) Q11.

Until that is answered, the portals are planned but not started. Phase 08 is last for that
reason, not because it is unimportant.

---

## What changed on 2026-09-07, and why the earlier plan is superseded

| Was | Now | Consequence |
|---|---|---|
| A hospital system with a pharmacy inside it | A pharmacy POS with a dialysis system beside it | Four modules on hold |
| Departments consume stock via an internal issue at cost | Departments are invoiced customers | Phase 02 rewritten |
| Cards and entitlements wait for hospital mode | Customer Management is in scope now | Phase 03 moves to pharmacy mode |
| Dialysis = the demand form | Dialysis = a full module with its own registration and history | Phase 05 grows from 2 to 3 weeks |
| Portals and sync switched off | Portals and sync in scope, via USB export | Phase 08 added |
| 8 phases, ~15–16 weeks | 9 phases, ~19 weeks | See [STATUS.md](STATUS.md) |

---

## The test for anything new

Before adding work, ask: **does the pharmacy counter or the dialysis unit need it to get
through a day?**

If no, it belongs in a later conversation, not this build. Record it in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) rather than starting it.
