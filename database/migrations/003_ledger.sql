-- 003: ledger (categories, transactions, budgets, savings goals)

-- user_id NULL = system default category, visible to everyone.
-- owner_key exists because MySQL unique indexes treat NULLs as distinct.
CREATE TABLE categories (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id      BIGINT UNSIGNED NULL,
    owner_key    BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(user_id, 0)) STORED,
    name         VARCHAR(50)     NOT NULL,
    type         ENUM('INCOME','EXPENSE') NOT NULL,
    icon         VARCHAR(30)     NULL,
    color        CHAR(7)         NULL,
    is_archived  BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_category_owner_name (owner_key, name, type),
    KEY idx_category_user (user_id),
    CONSTRAINT fk_category_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT chk_category_name CHECK (CHAR_LENGTH(TRIM(name)) >= 1),
    CONSTRAINT chk_category_color CHECK (color IS NULL OR color REGEXP '^#[0-9A-Fa-f]{6}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- amount / currency_code are the original entry and are never rewritten by conversion.
-- base_* columns hold the converted value used for totals, with the rate snapshot that produced it.
CREATE TABLE transactions (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id           BIGINT UNSIGNED NOT NULL,
    category_id       BIGINT UNSIGNED NOT NULL,
    type              ENUM('INCOME','EXPENSE') NOT NULL,
    amount            DECIMAL(18,2)   NOT NULL,
    currency_code     CHAR(3)         NOT NULL,
    base_currency     CHAR(3)         NOT NULL,
    exchange_rate     DECIMAL(18,8)   NOT NULL DEFAULT 1,
    exchange_rate_id  BIGINT UNSIGNED NULL,
    base_amount       DECIMAL(18,2)   NOT NULL,
    description       VARCHAR(255)    NOT NULL,
    notes_enc         TEXT            NULL,                       -- AES-256-GCM ciphertext
    payment_method    ENUM('CASH','CARD','UPI','BANK_TRANSFER','WALLET','OTHER') NOT NULL DEFAULT 'OTHER',
    txn_date          DATE            NOT NULL,
    deleted_at        DATETIME(3)     NULL,                       -- soft delete
    created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_txn_user_date (user_id, txn_date, id),
    KEY idx_txn_user_type_date (user_id, type, txn_date),
    KEY idx_txn_user_category_date (user_id, category_id, txn_date),
    FULLTEXT KEY ft_txn_description (description),
    CONSTRAINT fk_txn_user      FOREIGN KEY (user_id)          REFERENCES users (id),
    CONSTRAINT fk_txn_category  FOREIGN KEY (category_id)      REFERENCES categories (id),
    CONSTRAINT fk_txn_currency  FOREIGN KEY (currency_code)    REFERENCES currencies (code),
    CONSTRAINT fk_txn_base_ccy  FOREIGN KEY (base_currency)    REFERENCES currencies (code),
    CONSTRAINT fk_txn_rate      FOREIGN KEY (exchange_rate_id) REFERENCES exchange_rates (id),
    CONSTRAINT chk_txn_amount CHECK (amount > 0),
    CONSTRAINT chk_txn_base_amount CHECK (base_amount >= 0),
    CONSTRAINT chk_txn_rate CHECK (exchange_rate > 0),
    CONSTRAINT chk_txn_same_ccy_rate CHECK (currency_code <> base_currency OR exchange_rate = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per month and scope, so earlier months are the budget history.
-- Spent amounts are computed from transactions, never stored here.
CREATE TABLE budgets (
    id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id              BIGINT UNSIGNED  NOT NULL,
    budget_type          ENUM('CATEGORY','OVERALL','SAVINGS_TARGET') NOT NULL,
    category_id          BIGINT UNSIGNED  NULL,
    category_key         BIGINT UNSIGNED  GENERATED ALWAYS AS (COALESCE(category_id, 0)) STORED,
    period_month         DATE             NOT NULL,              -- first day of the month
    amount               DECIMAL(18,2)    NOT NULL,              -- in the user's base currency
    alert_threshold_pct  TINYINT UNSIGNED NOT NULL DEFAULT 80,
    created_at           DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at           DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_budget_scope (user_id, period_month, budget_type, category_key),
    KEY idx_budget_category (category_id),
    CONSTRAINT fk_budget_user     FOREIGN KEY (user_id)     REFERENCES users (id),
    CONSTRAINT fk_budget_category FOREIGN KEY (category_id) REFERENCES categories (id),
    CONSTRAINT chk_budget_amount CHECK (amount > 0),
    CONSTRAINT chk_budget_month CHECK (DAYOFMONTH(period_month) = 1),
    CONSTRAINT chk_budget_threshold CHECK (alert_threshold_pct BETWEEN 1 AND 100),
    CONSTRAINT chk_budget_scope CHECK (
        (budget_type = 'CATEGORY' AND category_id IS NOT NULL)
        OR (budget_type <> 'CATEGORY' AND category_id IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE savings_goals (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id        BIGINT UNSIGNED NOT NULL,
    title          VARCHAR(100)    NOT NULL,
    target_amount  DECIMAL(18,2)   NOT NULL,
    saved_amount   DECIMAL(18,2)   NOT NULL DEFAULT 0,
    currency_code  CHAR(3)         NOT NULL,
    deadline       DATE            NULL,
    notes_enc      TEXT            NULL,                          -- AES-256-GCM ciphertext
    status         ENUM('IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'IN_PROGRESS',
    created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_goal_user_status (user_id, status),
    CONSTRAINT fk_goal_user     FOREIGN KEY (user_id)       REFERENCES users (id),
    CONSTRAINT fk_goal_currency FOREIGN KEY (currency_code) REFERENCES currencies (code),
    CONSTRAINT chk_goal_target CHECK (target_amount > 0),
    CONSTRAINT chk_goal_saved CHECK (saved_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Negative amount = withdrawal. saved_amount on the goal is updated in the same DB transaction.
CREATE TABLE goal_contributions (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    goal_id         BIGINT UNSIGNED NOT NULL,
    user_id         BIGINT UNSIGNED NOT NULL,
    amount          DECIMAL(18,2)   NOT NULL,
    contributed_on  DATE            NOT NULL,
    created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_contribution_goal (goal_id, contributed_on),
    KEY idx_contribution_user (user_id),
    CONSTRAINT fk_contribution_goal FOREIGN KEY (goal_id) REFERENCES savings_goals (id) ON DELETE CASCADE,
    CONSTRAINT fk_contribution_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT chk_contribution_amount CHECK (amount <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
