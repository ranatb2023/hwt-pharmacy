const { nanoid } = require('nanoid');
const { nextSeq } = require('./db');

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function newPatientCode() {
  return `HWT-${pad(nextSeq('patient'), 6)}`;
}

function newBillNo() {
  const d = new Date();
  const ym = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}`;
  return `INV-${ym}-${pad(nextSeq('bill'), 5)}`;
}

function newQrToken() {
  return nanoid(16);
}

// Async handler wrapper so thrown errors reach the error middleware.
function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { newPatientCode, newBillNo, newQrToken, wrap, pad };
