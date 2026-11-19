# FinTrack database

MySQL 8.0. Design rationale: [docs/DATABASE_DESIGN.md](../docs/DATABASE_DESIGN.md).

| Folder | Contents |
|---|---|
| `migrations/` | Numbered `.sql` files, applied in order by `backend/scripts/migrate.js`. Never edit an applied file: add a new one. |
| `setup/` | `setup.local.sql`, generated per machine, creates the databases and MySQL accounts. Git-ignored because it contains passwords. `setup.production.template.sql` is the placeholder-only version for a managed MySQL server ([deployment guide](../docs/DEPLOYMENT.md)). |

## First-time setup

All commands run from `backend/`.

1. Generate secrets and the setup SQL (creates `backend/.env`, `ai-service/.env`, `database/setup/setup.local.sql`):
   ```bash
   npm run init:env
   ```
2. Create the databases and accounts, once, as MySQL root. Either open
   `database/setup/setup.local.sql` in MySQL Workbench and run it, or from `backend/`:
   ```bash
   mysql -u root -p -e "source ../database/setup/setup.local.sql"
   ```
3. Build the schema and apply runtime grants:
   ```bash
   npm run migrate
   ```
4. Optional fictional demo data (4 accounts, 6 months of history):
   ```bash
   npm run seed:demo
   ```
5. Verify constraints and privileges (uses the separate `fintrack_test` database):
   ```bash
   npm test
   ```

## Accounts

| Account | Used by | Privileges |
|---|---|---|
| `fintrack_migrator` | `npm run migrate` only | All on `fintrack` and `fintrack_test`, with grant option |
| `fintrack_app` | The API, the seed script | Per table, applied by the migration runner. Full DML on business tables; `SELECT, INSERT` on `audit_logs`, `security_events`, `exchange_rates`; `SELECT, UPDATE` on `audit_chain_head`; `SELECT` on `roles`, `currencies`, `schema_migrations`. No DDL. |
| `fintrack_backup` | `mysqldump` | Read-only |

`setup.local.sql` also runs `SET PERSIST log_bin_trust_function_creators = ON`, a server-wide
setting that lets the migrator create the audit-log triggers while binary logging is enabled.

## Useful commands

```bash
npm run migrate:status
```
```bash
npm run seed:demo -- --reset
```
