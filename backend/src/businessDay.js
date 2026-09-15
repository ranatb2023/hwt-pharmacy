// The hospital's operating day.
//
// Timestamps are stored in UTC (SQLite's datetime('now')), but the hospital
// runs on Pakistan Standard Time (UTC+5). Reporting or dating anything on the
// raw UTC date silently moves everything that happens between 00:00 and 05:00
// local — the tail of a night shift — into the previous day. Tokens issued then
// would never appear in that morning's queue, and the takings would land in
// yesterday's closing.
//
// Every day-scoped query should therefore go through this module rather than
// calling date('now') or new Date().toISOString() directly.
const { db } = require('./db');

// The offset is read straight from the settings table rather than through
// settings.js, because this module is loaded by db.js's own consumers and the
// SQL helpers below run once per row — a getSettings() call per row would read
// the whole table thousands of times in one report.
// PKT. Only a default: `prime()` replaces it with the stored setting as soon as
// the settings table is readable.
let cached = 5;

// Read on demand is NOT an option here. `offsetHours()` is called from inside
// the SQL helpers below, and better-sqlite3 refuses a query on a connection that
// is already executing one — "This database connection is busy executing a
// query". So the value is primed outside any query and only ever read from
// memory afterwards.
function offsetHours() {
  return cached;
}

function prime() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'tz_offset_hours'").get();
    const v = row ? Number(row.value) : 5;
    cached = Number.isFinite(v) ? v : 5;
  } catch {
    // Settings table not there yet (first start-up, mid-migration). The default
    // stands until something primes it again.
  }
  return cached;
}

// Called when the setting changes, so a timezone correction takes effect
// without a restart.
function invalidate() {
  return prime();
}

// SQLite date modifier that converts a stored UTC timestamp to local time,
// e.g. date(created_at, '+5 hours'). Bindable as a query parameter.
function tzModifier(settings) {
  const h = settings ? Number(settings.tz_offset_hours || 0) : prime();
  return `${h >= 0 ? '+' : '-'}${Math.abs(h)} hours`;
}

// Today's date at the hospital, as YYYY-MM-DD.
function businessDate(settings) {
  const h = settings ? Number(settings.tz_offset_hours || 0) : prime();
  return new Date(Date.now() + h * 3600 * 1000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

// `bizdate(created_at)` — the business day a stored UTC timestamp belongs to.
//
// Registered as a SQLite function rather than written inline as
// `date(created_at, ?)` because the inline form needs an extra bound parameter
// in every query, and reports.js has eighteen of them using positional `?`.
// Threading one more parameter through each call site is exactly the kind of
// mechanical edit that silently shifts an argument and reports the wrong month.
//
// `bizmonth` and `bizyear` exist for the same reason: `strftime('%Y', ts)` on a
// raw UTC timestamp puts a 2 a.m. sale on 1 January into the previous year.
function registerSqlHelpers(database) {
  prime();
  const conv = (ts) => {
    if (ts == null) return null;
    // Stored timestamps are 'YYYY-MM-DD HH:MM:SS' in UTC. Treat a bare date as
    // already local — some columns (entry_date, demand_date) hold business dates
    // rather than instants, and shifting those would move them a day.
    const s = String(ts);
    if (s.length <= 10) return s;
    const d = new Date(`${s.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return s.slice(0, 10);
    return new Date(d.getTime() + offsetHours() * 3600 * 1000).toISOString();
  };

  database.function('bizdate', { deterministic: false }, (ts) => {
    const v = conv(ts);
    return v ? v.slice(0, 10) : null;
  });
  database.function('bizmonth', { deterministic: false }, (ts) => {
    const v = conv(ts);
    return v ? v.slice(0, 7) : null;
  });
  database.function('bizyear', { deterministic: false }, (ts) => {
    const v = conv(ts);
    return v ? v.slice(0, 4) : null;
  });
}

// ---------------------------------------------------------------------------
// The fiscal year
// ---------------------------------------------------------------------------

// Pakistan's financial year runs 1 July – 30 June, and the trust's audited
// accounts follow it. A calendar-year "annual" total is the wrong year for the
// people who will be audited on it, so every annual report can be asked for
// either basis and the start month is a setting rather than a constant.
function fiscalStartMonth() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'fiscal_year_start_month'").get();
  const m = row ? Number(row.value) : 7;
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : 7;
}

// The fiscal year a business date falls in, labelled by the year it STARTS in:
// 2026-08-01 with a July start is FY 2026-27.
function fiscalYearOf(dateStr, startMonth) {
  const m = startMonth || fiscalStartMonth();
  const [y, mo] = String(dateStr).split('-').map(Number);
  return mo >= m ? y : y - 1;
}

// The [from, to] business dates covering one fiscal year.
function fiscalRange(fyStart, startMonth) {
  const m = startMonth || fiscalStartMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${fyStart}-${pad(m)}-01`;
  const endYear = m === 1 ? fyStart : fyStart + 1;
  const endMonth = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return { from, to: `${endYear}-${pad(endMonth)}-${pad(lastDay)}` };
}

// The label a Pakistani accountant would write: "2026-27", or just "2026" when
// the trust reports on the calendar year after all.
function fiscalLabel(fyStart, startMonth) {
  const m = startMonth || fiscalStartMonth();
  if (m === 1) return String(fyStart);
  return `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
}

module.exports = {
  tzModifier, businessDate, invalidate, registerSqlHelpers,
  fiscalStartMonth, fiscalYearOf, fiscalRange, fiscalLabel,
};
