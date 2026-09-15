#!/usr/bin/env node
//
// Restore the database from a backup file.
//
//   node scripts/restore.js D:/hwt-backups/hms-2026-09-07T18-00-00.db          (dry run)
//   node scripts/restore.js D:/hwt-backups/hms-2026-09-07T18-00-00.db --yes    (do it)
//
// STOP THE SERVER FIRST:
//     nssm stop HWT-HMS                       ...restore...  nssm start HWT-HMS
//     Stop-ScheduledTask -TaskName HWT-HMS    ...restore...  Start-ScheduledTask -TaskName HWT-HMS
//
// This script never deletes the current database. It moves it aside to a
// .pre-restore-<timestamp> copy, so a restore of the wrong file is itself undoable.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('../src/config');

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const confirmed = args.includes('--yes');

if (!src) {
  console.error('Usage: node scripts/restore.js <backup-file> [--yes]');
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`Backup not found: ${src}`);
  process.exit(1);
}

// 1. Verify the backup before touching anything. Restoring a corrupt file over a
//    working database turns a recoverable problem into an unrecoverable one.
let summary;
try {
  const probe = new Database(src, { readonly: true, fileMustExist: true });
  const integrity = probe.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`integrity_check said: ${integrity}`);
  summary = {
    bills: count(probe, 'bills'),
    movements: count(probe, 'stock_movements'),
    products: count(probe, 'products'),
    newest: probe.prepare('SELECT MAX(created_at) AS t FROM bills').get().t,
  };
  probe.close();
} catch (err) {
  console.error(`Backup is not usable: ${err.message}`);
  process.exit(1);
}

function count(conn, table) {
  try {
    return conn.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } catch {
    return '(missing)';
  }
}

console.log(`Backup  : ${src}`);
console.log(`          ${summary.bills} bills, ${summary.movements} stock movements, ${summary.products} products`);
console.log(`          newest bill dated ${summary.newest || '(none)'} UTC`);
console.log(`Target  : ${DB_PATH}`);

// 2. Refuse if the server still holds the database. An exclusive lock is the only
//    reliable way to ask "is anything else using this?" on Windows.
if (fs.existsSync(DB_PATH)) {
  try {
    const held = new Database(DB_PATH);
    held.pragma('locking_mode = EXCLUSIVE');
    held.prepare('BEGIN EXCLUSIVE').run();
    held.prepare('ROLLBACK').run();
    held.close();
  } catch {
    console.error('\nThe database is in use. Stop the server first:');
    console.error('  nssm stop HWT-HMS                       (nssm service)');
    console.error('  Stop-ScheduledTask -TaskName HWT-HMS    (Task Scheduler)');
    process.exit(1);
  }
}

if (!confirmed) {
  console.log('\nDry run. Nothing changed. Re-run with --yes to restore.');
  process.exit(0);
}

// 3. Move the current database aside rather than deleting it, WAL and SHM included.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
for (const suffix of ['', '-wal', '-shm']) {
  const f = DB_PATH + suffix;
  if (fs.existsSync(f)) {
    const aside = `${DB_PATH}.pre-restore-${stamp}${suffix}`;
    fs.renameSync(f, aside);
    console.log(`Kept    : ${aside}`);
  }
}

// 4. Put the backup in place. It came from VACUUM INTO, so it is a single complete
//    file with no WAL of its own — which is why the stale -wal above had to go.
fs.copyFileSync(src, DB_PATH);

console.log(`\nRestored ${src}\n      -> ${DB_PATH}`);
console.log('Start the server again and check the day-end report for the restored date.');
