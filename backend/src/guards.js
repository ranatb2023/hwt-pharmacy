// The rules every money-moving route has to check first (QA 2026-09-14).
//
// S1-04: nothing posts to a business day whose Z-report has been filed. The
// check is one read on `day_closes`; the routes that move stock or cash call
// it before they write anything, and the FEFO consumer calls it too so every
// dispense path — counter, department, dialysis — is covered without each
// caller remembering.
const { db } = require('./db');
const { businessDate } = require('./businessDay');

function dayCloseFor(date) {
  return db.prepare('SELECT * FROM day_closes WHERE business_date = ?').get(date);
}

function assertDayOpen(date) {
  const day = date || businessDate();
  const dc = dayCloseFor(day);
  if (dc && dc.status === 'closed') {
    const e = new Error(
      `Business day ${day} is closed and its day-end sheet is filed. An administrator must reopen the day before anything else is posted to it.`
    );
    e.status = 409;
    e.code = 'DAY_CLOSED';
    throw e;
  }
  return day;
}

function httpError(status, code, message, extra) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

module.exports = { assertDayOpen, dayCloseFor, httpError };
