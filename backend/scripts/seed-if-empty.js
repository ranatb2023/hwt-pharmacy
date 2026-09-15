#!/usr/bin/env node
//
// First-boot seed for a hosted install (Render).
//
//   node scripts/seed-if-empty.js && node src/server.js
//
// Runs the ordinary seed ONLY when the database has no users yet — a brand-new
// disk. On every later start it does nothing, so passwords changed in Admin
// are never reset back to the defaults by a redeploy. Set SEED_DEMO=1 on the
// first boot to load the demo month as well (remove it afterwards).
const path = require('path');
const { spawnSync } = require('child_process');
const { db, init } = require(path.join(__dirname, '..', 'src', 'db'));

init();
const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (users > 0) {
  console.log(`seed-if-empty: ${users} user(s) already present — nothing to do.`);
  process.exit(0);
}
db.close();

console.log('seed-if-empty: empty database — seeding.');
const run = (script) => {
  const r = spawnSync(process.execPath, [script], { cwd: path.join(__dirname, '..'), stdio: 'inherit', env: process.env });
  if (r.status !== 0) { console.error(`seed-if-empty: ${script} failed`); process.exit(r.status || 1); }
};
run('src/seed.js');
if (process.env.SEED_DEMO === '1') {
  run('scripts/seed-demo.js');
  run('scripts/seed-employees.js');
}
console.log('seed-if-empty: done.');
