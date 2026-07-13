const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();
}

// Idempotent column additions for databases created before a column existed.
function migrate() {
  const hasColumn = (table, col) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  const add = (table, col, ddl) => {
    if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  add('bills', 'payment_method', "payment_method TEXT DEFAULT 'cash'");
}

// Atomic sequence generator for human-facing codes (Patient ID, Bill No, tokens).
const nextSeqStmt = db.transaction((name) => {
  db.prepare(
    `INSERT INTO counters(name, value) VALUES(?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1`
  ).run(name);
  return db.prepare('SELECT value FROM counters WHERE name = ?').get(name).value;
});

function nextSeq(name) {
  return nextSeqStmt(name);
}

module.exports = { db, init, nextSeq };
