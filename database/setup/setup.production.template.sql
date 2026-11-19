-- FinTrack production database setup: TEMPLATE, placeholders only.
--
-- 1. Copy to setup.production.local.sql (git-ignored by the *.local.sql rule).
-- 2. Replace every <...> with real values: database name, and three long random passwords
--    (node -e "console.log(require('crypto').randomBytes(24).toString('hex'))").
-- 3. Run it ONCE as the provider's admin user, over TLS, for example:
--      mysql --ssl-mode=VERIFY_IDENTITY --ssl-ca=ca.pem -h <host> -P <port> -u <admin> -p < setup.production.local.sql
-- 4. Delete the filled-in copy afterwards; keep the passwords only in Render and GitHub secrets.
--
-- '%' is used as the host because hosted APIs connect from changing addresses. Restrict the
-- network with the provider's IP allow-list instead, and require TLS for every account.

CREATE DATABASE IF NOT EXISTS <db_name> CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Migrator: owns the schema; used only by the "Migrate production database" workflow.
CREATE USER IF NOT EXISTS 'fintrack_migrator'@'%' IDENTIFIED BY '<migrator_password>' REQUIRE SSL;
GRANT ALL PRIVILEGES ON <db_name>.* TO 'fintrack_migrator'@'%' WITH GRANT OPTION;

-- Runtime account used by the API. No privileges here: the migration runner grants them
-- table by table (audit_logs and security_events: SELECT and INSERT only).
CREATE USER IF NOT EXISTS 'fintrack_app'@'%' IDENTIFIED BY '<app_password>' REQUIRE SSL;

-- Read-only account for backups (mysqldump).
CREATE USER IF NOT EXISTS 'fintrack_backup'@'%' IDENTIFIED BY '<backup_password>' REQUIRE SSL;
GRANT SELECT, LOCK TABLES, SHOW VIEW, TRIGGER ON <db_name>.* TO 'fintrack_backup'@'%';

-- The audit-log triggers are created by the migrator. With binary logging on (the norm on
-- managed MySQL), a non-SUPER account needs log_bin_trust_function_creators = ON. Most
-- providers expose it as a setting (Aiven: Service settings -> Advanced configuration).
-- If yours does not, run the migrations once as the admin user instead.
