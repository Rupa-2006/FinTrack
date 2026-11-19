-- 004: notifications and security events

-- dedupe_key stops the same alert (e.g. "food budget 80% in 2026-11") being created twice.
CREATE TABLE notifications (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NOT NULL,
    type        ENUM('BUDGET_THRESHOLD','UNUSUAL_SPENDING','TRANSACTION','SECURITY','MONTHLY_SUMMARY','SYSTEM') NOT NULL,
    severity    ENUM('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'INFO',
    title       VARCHAR(120)    NOT NULL,
    message     VARCHAR(500)    NOT NULL,
    dedupe_key  VARCHAR(100)    NULL,
    read_at     DATETIME(3)     NULL,
    created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_notification_dedupe (user_id, dedupe_key),
    KEY idx_notification_inbox (user_id, read_at, created_at),
    CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Append-only for the application account (SELECT, INSERT only).
-- user_id is NULL for events with no known account, e.g. a login attempt for an unknown email.
-- metadata must never contain passwords, tokens or keys.
CREATE TABLE security_events (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NULL,
    event_type  VARCHAR(40)     NOT NULL,
    severity    ENUM('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'INFO',
    ip_address  VARCHAR(45)     NULL,
    user_agent  VARCHAR(255)    NULL,
    metadata    JSON            NULL,
    created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_secevent_user (user_id, created_at),
    KEY idx_secevent_type (event_type, created_at),
    KEY idx_secevent_ip (ip_address, created_at),
    CONSTRAINT fk_secevent_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
