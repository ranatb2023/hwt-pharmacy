const path = require('path');

module.exports = {
  PORT: process.env.PORT || 4000,
  JWT_SECRET: process.env.JWT_SECRET || 'hwt-hms-dev-secret-change-in-production',
  JWT_EXPIRES: '12h',
  DB_PATH: process.env.HMS_DB_PATH || path.join(__dirname, '..', 'data', 'hms.db'),
};
