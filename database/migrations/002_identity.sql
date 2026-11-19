-- 002: identity and access (users, roles mapping, sessions, tokens)

-- Users are deactivated (status), never deleted, so the ledger and audit trail stay consistent.
CREATE TABLE users (
    id                   BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    full_name            VARCHAR(100)      NOT NULL,
    email                VARCHAR(254)      NOT NULL,              -- unique, case-insensitive collation
    password_hash        VARCHAR(100)      NOT NULL,              -- bcrypt
    phone_enc            VARCHAR(255)      NULL,                  -- AES-256-GCM ciphertext
    base_currency        CHAR(3)           NOT NULL DEFAULT 'INR',
    status               ENUM('ACTIVE','DEACTIVATED','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    failed_login_count   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    locked_until         DATETIME(3)       NULL,
    password_changed_at  DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_login_at        DATETIME(3)       NULL,
    created_at           DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at           DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_email (email),
    KEY idx_user_status (status),
    CONSTRAINT fk_user_currency FOREIGN KEY (base_currency) REFERENCES currencies (code),
    CONSTRAINT chk_user_name CHECK (CHAR_LENGTH(TRIM(full_name)) >= 2),
    CONSTRAINT chk_user_email CHECK (email LIKE '_%@_%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_roles (
    user_id     BIGINT UNSIGNED   NOT NULL,
    role_id     SMALLINT UNSIGNED NOT NULL,
    granted_by  BIGINT UNSIGNED   NULL,
    granted_at  DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, role_id),
    KEY idx_user_roles_role (role_id),
    CONSTRAINT fk_user_roles_user    FOREIGN KEY (user_id)    REFERENCES users (id),
    CONSTRAINT fk_user_roles_role    FOREIGN KEY (role_id)    REFERENCES roles (id),
    CONSTRAINT fk_user_roles_granter FOREIGN KEY (granted_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per login. The access token carries this id, so revoking the row ends the session.
CREATE TABLE user_sessions (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id        BIGINT UNSIGNED NOT NULL,
    ip_address     VARCHAR(45)     NULL,
    user_agent     VARCHAR(255)    NULL,
    created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_used_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at     DATETIME(3)     NOT NULL,
    revoked_at     DATETIME(3)     NULL,
    revoke_reason  VARCHAR(40)     NULL,
    PRIMARY KEY (id),
    KEY idx_session_user (user_id, revoked_at),
    KEY idx_session_expiry (expires_at),
    CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Only the SHA-256 hash of a refresh token is stored. used_at + replaced_by give rotation
-- and reuse detection.
CREATE TABLE refresh_tokens (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    session_id   BIGINT UNSIGNED NOT NULL,
    token_hash   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    issued_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at   DATETIME(3)     NOT NULL,
    used_at      DATETIME(3)     NULL,
    replaced_by  BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_refresh_hash (token_hash),
    KEY idx_refresh_session (session_id),
    KEY idx_refresh_expiry (expires_at),
    CONSTRAINT fk_refresh_session  FOREIGN KEY (session_id)  REFERENCES user_sessions (id) ON DELETE CASCADE,
    CONSTRAINT fk_refresh_replaced FOREIGN KEY (replaced_by) REFERENCES refresh_tokens (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE password_reset_tokens (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id       BIGINT UNSIGNED NOT NULL,
    token_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expires_at    DATETIME(3)     NOT NULL,
    used_at       DATETIME(3)     NULL,
    requested_ip  VARCHAR(45)     NULL,
    created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_reset_hash (token_hash),
    KEY idx_reset_user (user_id),
    CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
