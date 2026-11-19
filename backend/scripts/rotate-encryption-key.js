// Re-encrypts every encrypted field with the active key version (run from backend/).
//
//   1. add a new key:  ENCRYPTION_KEYS=1:<old hex>,2:<new hex>   ENCRYPTION_ACTIVE_KEY_VERSION=2
//   2. restart the API (new writes use key 2, old values stay readable with key 1)
//   3. npm run keys:rotate -- --dry-run     see how many values would change
//   4. npm run keys:rotate                  re-encrypt them
//   5. once it reports 0 remaining, key 1 can be removed from ENCRYPTION_KEYS
//
// Values are decrypted and re-encrypted in this process; plaintext is never logged or
// written anywhere else. Each table is processed in batches, one database transaction per
// batch, and the run is recorded in the audit trail.
const database = require('../config/database');
const { config } = require('../config/env');
const { encryptField, decryptField } = require('../security/fieldCrypto');
const audit = require('../services/audit.service');

// table, encrypted column, how the encryption context is built from the row
const FIELDS = [
  { table: 'users', column: 'phone_enc', owner: 'id' },
  { table: 'transactions', column: 'notes_enc', owner: 'user_id' },
  { table: 'savings_goals', column: 'notes_enc', owner: 'user_id' },
  { table: 'user_mfa', column: 'secret_enc', owner: 'user_id' },
];
const BATCH = 200;

async function rotate({ dryRun = false } = {}) {
  const prefix = `v${config.encryption.activeVersion}.`;
  const report = [];
  for (const { table, column, owner } of FIELDS) {
    let lastId = 0;
    let rewritten = 0;
    let failed = 0;
    for (;;) {
      // Table and column names come from the fixed list above, never from input.
      const rows = await database.query(
        `SELECT id, ${owner} AS owner_id, ${column} AS value FROM ${table}
          WHERE id > ? AND ${column} IS NOT NULL AND ${column} NOT LIKE ? ORDER BY id LIMIT ${BATCH}`,
        [lastId, `${prefix}%`]
      );
      if (!rows.length) break;
      lastId = rows[rows.length - 1].id;
      if (dryRun) {
        rewritten += rows.length;
        continue;
      }
      await database.withTransaction(async (tx) => {
        for (const row of rows) {
          const context = `${table}:${column}:${row.owner_id}`;
          try {
            await tx.query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [encryptField(decryptField(row.value, context), context), row.id]);
            rewritten += 1;
          } catch {
            failed += 1; // left as it is; reported below, never printed
          }
        }
      });
    }
    report.push({ table, column, rewritten, failed });
  }
  if (!dryRun) {
    await audit.record({
      eventType: audit.EVENT_TYPES.ADMIN, action: 'ENCRYPTION_KEY_ROTATED', resourceType: 'encryption_key',
      resourceId: config.encryption.activeVersion, details: { fields: report }, ctx: { requestId: 'command-line' },
    });
  }
  return { activeVersion: config.encryption.activeVersion, dryRun, fields: report };
}

if (require.main === module) {
  rotate({ dryRun: process.argv.includes('--dry-run') })
    .then((result) => {
      console.log(`Active key version: ${result.activeVersion}${result.dryRun ? ' (dry run, nothing changed)' : ''}`);
      for (const field of result.fields) {
        console.log(`  ${field.table}.${field.column}: ${field.rewritten} ${result.dryRun ? 'would be re-encrypted' : 're-encrypted'}${field.failed ? `, ${field.failed} could not be decrypted` : ''}`);
      }
      if (result.fields.some((field) => field.failed)) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(`Rotation failed: ${err.message}`);
      process.exitCode = 2;
    })
    .finally(() => database.close());
}

module.exports = { rotate };
