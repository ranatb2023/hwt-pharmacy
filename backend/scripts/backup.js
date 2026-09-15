#!/usr/bin/env node
//
// Hot backup of the live database.
//
//   npm run backup                     -> backend/data/backups/hms-<timestamp>.db
//   npm run backup -- D:/hwt-backups   -> that directory instead
//   npm run backup -- D:/hwt-backups --keep 48
//
// Safe to run while the server is serving customers: VACUUM INTO takes a read
// transaction and writes a consistent, compacted snapshot.
//
// Do NOT back this database up by copying hms.db with the file explorer or xcopy.
// In WAL mode the most recent commits live in hms.db-wal, so a plain copy of the
// main file alone is a database missing its newest sales.

const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');

const args = process.argv.slice(2);
const keepIdx = args.indexOf('--keep');
const keep = keepIdx === -1 ? 0 : Number(args[keepIdx + 1]) || 0;
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--keep')
  || path.join(__dirname, '..', 'data', 'backups');

fs.mkdirSync(dir, { recursive: true });

// VACUUM INTO refuses to overwrite, so the timestamp is doing real work here.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.join(dir, `hms-${stamp}.db`);

const started = Date.now();
db.prepare('VACUUM INTO ?').run(out);
const bytes = fs.statSync(out).size;

console.log(`Backed up to ${out}`);
console.log(`${(bytes / 1024 / 1024).toFixed(2)} MB in ${Date.now() - started} ms`);

// A backup that fills the disk stops being a backup. Prune oldest-first, but only
// when asked — the weekly USB copies must never be pruned by a scheduled job.
if (keep > 0) {
  const olds = fs
    .readdirSync(dir)
    .filter((f) => /^hms-.*\.db$/.test(f))
    .sort()
    .slice(0, -keep);
  for (const f of olds) fs.unlinkSync(path.join(dir, f));
  if (olds.length) console.log(`Pruned ${olds.length} older backup(s), kept ${keep}`);
}

if (bytes === 0) {
  console.error('Backup file is empty — investigate before relying on it.');
  process.exit(1);
}
