-- 005: tamper-evident audit log
--
-- curr_hash = HMAC-SHA256(AUDIT_HMAC_KEY, prev_hash || canonical_json(row)), computed by the API.
-- The chain makes edits detectable, it does not prevent them. Prevention comes from:
--   1. the application account having only SELECT, INSERT on this table (see migrate.js grants)
--   2. the triggers below, which reject UPDATE and DELETE for every account
--   3. exporting the chain head outside the database, and independent backups
-- TRUNCATE and DROP bypass triggers; they need the DROP privilege, which the application
-- account does not have.

-- user_id deliberately has no foreign key: a referential action would have to modify audit rows.
CREATE TABLE audit_logs (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id        BIGINT UNSIGNED NULL,
    event_type     VARCHAR(40)     NOT NULL,
    action         VARCHAR(40)     NOT NULL,
    resource_type  VARCHAR(40)     NULL,
    resource_id    VARCHAR(64)     NULL,
    details        JSON            NULL,     -- changed field names, never amounts, notes or secrets
    ip_address     VARCHAR(45)     NULL,
    request_id     VARCHAR(36)     NULL,
    created_at     DATETIME(3)     NOT NULL,
    prev_hash      CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    curr_hash      CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_audit_curr_hash (curr_hash),
    KEY idx_audit_user (user_id, created_at),
    KEY idx_audit_event (event_type, created_at),
    KEY idx_audit_resource (resource_type, resource_id),
    CONSTRAINT chk_audit_prev_hash CHECK (prev_hash REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT chk_audit_curr_hash CHECK (curr_hash REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: UPDATE is not allowed';

CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: DELETE is not allowed';

-- Single row, locked FOR UPDATE to serialize appends so the chain cannot fork.
CREATE TABLE audit_chain_head (
    id          TINYINT UNSIGNED NOT NULL,
    last_id     BIGINT UNSIGNED  NOT NULL DEFAULT 0,
    last_hash   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    updated_at  DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    CONSTRAINT chk_chain_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO audit_chain_head (id, last_id, last_hash) VALUES (1, 0, REPEAT('0', 64));
