-- 007: two-step sign-in (TOTP authenticator codes and recovery codes)

-- One row per user who has started or finished setting up two-step sign-in.
-- secret_enc is the TOTP secret, AES-256-GCM encrypted like other sensitive fields
-- (context "user_mfa:secret_enc:<user_id>"). enabled_at stays NULL until the user has proved,
-- with a first code, that the authenticator app works.
CREATE TABLE user_mfa (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED NOT NULL,
    secret_enc      VARCHAR(255)    NOT NULL,
    enabled_at      DATETIME(3)     NULL,
    last_used_step  BIGINT UNSIGNED NULL,               -- TOTP time step last accepted: a code works once
    created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_mfa_user (user_id),
    CONSTRAINT fk_mfa_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Single-use recovery codes, stored only as SHA-256 hashes.
CREATE TABLE mfa_recovery_codes (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NOT NULL,
    code_hash   CHAR(64)        NOT NULL,
    used_at     DATETIME(3)     NULL,
    created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_recovery_code (user_id, code_hash),
    CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The step between a correct password and a correct code. The browser holds an opaque token;
-- only its hash is stored. Valid for 5 minutes, at most 5 attempts, used once.
CREATE TABLE mfa_challenges (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED  NOT NULL,
    token_hash  CHAR(64)         NOT NULL,
    attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
    expires_at  DATETIME(3)      NOT NULL,
    used_at     DATETIME(3)      NULL,
    created_at  DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_challenge_token (token_hash),
    KEY idx_challenge_user (user_id, created_at),
    CONSTRAINT fk_challenge_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
