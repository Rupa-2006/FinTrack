// Migration runner.
//
//   npm run migrate            apply pending migrations to DB_NAME, then apply grants
//   npm run migrate:status     list applied / pending migrations
//   npm run migrate:test       same as migrate, against <DB_NAME>_test
//   node scripts/migrate.js --test --fresh   drop every table in the TEST database first
//
// Runs as the migrator account. MySQL commits DDL implicitly, so a migration that fails
// half-way is not rolled back: the runner stops, reports the file, and records nothing for it.
// Applied files are checksummed; editing one afterwards is refused. Add a new file instead.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { connect, databaseName, requireEnv } = require('./lib/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'database', 'migrations');

// Runtime privileges of the application account, per table. Anything not listed gets full DML.
const RESTRICTED_GRANTS = {
  audit_logs: 'SELECT, INSERT',
  security_events: 'SELECT, INSERT',
  exchange_rates: 'SELECT, INSERT',
  audit_chain_head: 'SELECT, UPDATE',
  roles: 'SELECT',
  currencies: 'SELECT',
  schema_migrations: 'SELECT',
};
const DEFAULT_GRANT = 'SELECT, INSERT, UPDATE, DELETE';

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
}

function readMigration(file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/\r\n/g, '\n');
  return { sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
}

async function ensureMigrationsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     CHAR(3)      NOT NULL,
      name        VARCHAR(100) NOT NULL,
      checksum    CHAR(64)     NOT NULL,
      applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
}

async function dropAllTables(db) {
  const [tables] = await db.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
  );
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const { name } of tables) await db.query(`DROP TABLE \`${name}\``);
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
}

// Least privilege for the runtime account. Idempotent: re-applied on every run.
async function applyGrants(db, database, log) {
  const appUser = requireEnv('DB_USER');
  if (appUser === requireEnv('DB_MIGRATOR_USER')) {
    log('  grants skipped: application and migrator are the same account (single-user hosting)');
    return;
  }
  const hosts = (process.env.DB_APP_HOSTS || 'localhost')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  for (const part of [appUser, ...hosts]) {
    if (!/^[A-Za-z0-9_.:%-]+$/.test(part)) throw new Error(`Unsafe account name or host: ${part}`);
  }
  const [tables] = await db.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
  );
  for (const host of hosts) {
    const account = `'${appUser}'@'${host}'`;
    for (const { name } of tables) {
      const target = `\`${database}\`.\`${name}\``;
      try {
        await db.query(`REVOKE ALL PRIVILEGES ON ${target} FROM ${account}`);
      } catch (err) {
        if (err.code !== 'ER_NONEXISTING_TABLE_GRANT') throw err; // nothing to revoke yet
      }
      await db.query(`GRANT ${RESTRICTED_GRANTS[name] || DEFAULT_GRANT} ON ${target} TO ${account}`);
    }
    log(`  grants applied for ${account} on ${tables.length} tables`);
  }
}

async function migrate({ test = false, fresh = false, statusOnly = false, log = console.log } = {}) {
  if (fresh && !test) throw new Error('--fresh is only allowed together with --test');
  const database = databaseName({ test });
  const db = await connect('migrator', { test, multipleStatements: true });
  try {
    if (fresh) {
      await dropAllTables(db);
      log(`Dropped all tables in ${database}`);
    }
    await ensureMigrationsTable(db);
    const [appliedRows] = await db.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(appliedRows.map((row) => [row.version, row.checksum]));
    const files = listMigrationFiles();
    let appliedNow = 0;

    log(`Database: ${database}`);
    for (const file of files) {
      const version = file.slice(0, 3);
      const { sql, checksum } = readMigration(file);
      if (applied.has(version)) {
        if (applied.get(version) !== checksum) {
          throw new Error(`${file} was changed after it was applied. Revert it and add a new migration.`);
        }
        if (statusOnly) log(`  applied  ${file}`);
        continue;
      }
      if (statusOnly) {
        log(`  PENDING  ${file}`);
        continue;
      }
      try {
        await db.query(sql);
      } catch (err) {
        throw new Error(`${file} failed: ${err.message}`, { cause: err });
      }
      await db.query('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)', [
        version,
        file.slice(4, -4),
        checksum,
      ]);
      appliedNow += 1;
      log(`  applied  ${file}`);
    }
    if (!statusOnly) {
      if (appliedNow === 0) log('  schema already up to date');
      await applyGrants(db, database, log);
    }
    return { database, appliedNow, total: files.length };
  } finally {
    await db.end();
  }
}

module.exports = { migrate, RESTRICTED_GRANTS };

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  migrate({ test: args.has('--test'), fresh: args.has('--fresh'), statusOnly: args.has('--status') }).catch(
    (err) => {
      console.error(`Migration error: ${err.message}`);
      process.exit(1);
    }
  );
}
