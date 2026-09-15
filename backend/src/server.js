const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const { init, db } = require('./db');

// Ensure schema exists before routes load their prepared statements.
init();
assertClockIsSane();

// The site has no internet, so there is no NTP and nothing corrects the system clock.
// When the CMOS battery on a machine that is power-cycled several times a day finally
// dies, it boots with its clock years in the past — and every business-day query, expiry
// check and day-end report silently files itself in the wrong period. By the time anyone
// notices, a week of reporting is wrong.
//
// A record dated after "now" is the symptom. Refuse to serve rather than corrupt data:
// an hour of downtime is cheaper than an evening of misfiled sales.
function assertClockIsSane() {
  const { newest } = db
    .prepare(
      `SELECT MAX(t) AS newest FROM (
         SELECT MAX(created_at) AS t FROM bills
         UNION ALL SELECT MAX(created_at) FROM audit_log
         UNION ALL SELECT MAX(created_at) FROM stock_movements
       )`
    )
    .get();
  const now = db.prepare("SELECT datetime('now') AS n").get().n;
  if (!newest || newest <= now) return;

  console.error(
    [
      '',
      '  *** SYSTEM CLOCK IS WRONG — REFUSING TO START ***',
      '',
      `  Newest record in the database : ${newest} (UTC)`,
      `  This machine currently thinks  : ${now} (UTC)`,
      '',
      '  The database contains records dated in the future, which means the system',
      '  clock has gone backwards. Starting now would file sales, day-end reports and',
      '  expiry checks under the wrong dates.',
      '',
      '  Fix: correct the date and time on this machine, and replace the CMOS battery',
      '  if the clock keeps resetting after a power cut. Then start the service again.',
      '',
    ].join('\n')
  );
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.set('trust proxy', true);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Uploaded lab report files (authenticated staff link to these).
app.use('/reports', express.static(path.join(__dirname, '..', 'data', 'reports')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/tokens', require('./routes/tokens'));
app.use('/api/consultations', require('./routes/consultations'));
app.use('/api/lab', require('./routes/lab'));
app.use('/api/inventory', require('./routes/inventory').router);
app.use('/api/pharmacy', require('./routes/pharmacy').router);
app.use('/api/billing', require('./routes/billing'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/cards', require('./routes/cards'));
app.use('/api/ledger', require('./routes/ledger'));
app.use('/api/handovers', require('./routes/handovers'));
app.use('/api/returns', require('./routes/returns'));
app.use('/api/dialysis', require('./routes/dialysis'));
app.use('/api/cashflow', require('./routes/cashflow'));
app.use('/api/portal', require('./routes/portal'));
app.use('/api/sync', require('./routes/syncRoutes'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/users', require('./routes/users'));

// S3-24: an unknown API route answers JSON, never Express's HTML page.
app.all(/^\/api\//, (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}`, code: 'NOT_FOUND' });
});

// Serve built frontend if present (single-server LAN deployment).
const clientDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(clientDir));
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(clientDir, 'index.html'), (err) => (err ? next() : null));
});

// Central error handler. The message and a code, never a stack or a
// framework name; the stack goes to the server log.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const body = { error: status >= 500 ? 'Internal server error' : (err.message || 'Request failed') };
  if (err.code && typeof err.code === 'string' && !/^SQLITE/.test(err.code)) body.code = err.code;
  for (const k of ['cap', 'mrp', 'product', 'retry_with', 'sold', 'already_returned', 'limit', 'balance', 'projected', 'card', 'retry_after', 'threshold', 'holder', 'units_per_strip'])
    if (err[k] !== undefined) body[k] = err[k];
  res.status(status).json(body);
});

app.listen(PORT, () => {
  console.log(`HWT HMS API running on http://localhost:${PORT}`);
});
