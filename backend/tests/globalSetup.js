// Runs once before the whole Jest run: rebuilds <DB_NAME>_test cleanly to the current schema.
const { migrate } = require('../scripts/migrate');

module.exports = async () => {
  await migrate({ test: true, fresh: true, log: () => {} });
};
