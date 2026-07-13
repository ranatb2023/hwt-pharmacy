const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const { init } = require('./db');

// Ensure schema exists before routes load their prepared statements.
init();

const app = express();
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
app.use('/api/returns', require('./routes/returns'));
app.use('/api/dialysis', require('./routes/dialysis'));
app.use('/api/cashflow', require('./routes/cashflow'));
app.use('/api/portal', require('./routes/portal'));
app.use('/api/sync', require('./routes/syncRoutes'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/users', require('./routes/users'));

// Serve built frontend if present (single-server LAN deployment).
const clientDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(clientDir));
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(clientDir, 'index.html'), (err) => (err ? next() : null));
});

// Central error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`HWT HMS API running on http://localhost:${PORT}`);
});
