-- 008: recurring transactions (rent, salary, subscriptions...)

-- A rule creates one transaction per occurrence. Occurrence n falls on start_date plus n
-- weeks, months or years; a monthly rule that starts on the 31st falls on the last day of
-- shorter months. next_date and next_index point at the next occurrence still to create.
CREATE TABLE recurring_rules (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED NOT NULL,
    category_id     BIGINT UNSIGNED NOT NULL,
    type            ENUM('INCOME','EXPENSE') NOT NULL,
    amount          DECIMAL(18,2)   NOT NULL,
    currency_code   CHAR(3)         NOT NULL,
    description     VARCHAR(255)    NOT NULL,
    payment_method  ENUM('CASH','CARD','UPI','BANK_TRANSFER','WALLET','OTHER') NOT NULL DEFAULT 'OTHER',
    frequency       ENUM('WEEKLY','MONTHLY','YEARLY') NOT NULL,
    start_date      DATE            NOT NULL,
    end_date        DATE            NULL,
    next_index      INT UNSIGNED    NOT NULL DEFAULT 0,
    next_date       DATE            NOT NULL,
    paused          TINYINT(1)      NOT NULL DEFAULT 0,
    last_run_at     DATETIME(3)     NULL,
    created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_recurring_due (user_id, paused, next_date),
    CONSTRAINT fk_recurring_user     FOREIGN KEY (user_id)       REFERENCES users (id),
    CONSTRAINT fk_recurring_category FOREIGN KEY (category_id)   REFERENCES categories (id),
    CONSTRAINT fk_recurring_currency FOREIGN KEY (currency_code) REFERENCES currencies (code),
    CONSTRAINT chk_recurring_amount CHECK (amount > 0),
    CONSTRAINT chk_recurring_dates CHECK (end_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Each generated transaction remembers its rule. The unique key makes generation safe to run
-- from two requests at once (an occurrence can only be created once), and a generated
-- transaction the user deleted (soft delete) keeps its slot, so it is not created again.
ALTER TABLE transactions
    ADD COLUMN recurring_rule_id BIGINT UNSIGNED NULL AFTER payment_method,
    ADD UNIQUE KEY uq_txn_recurring_occurrence (recurring_rule_id, txn_date),
    ADD CONSTRAINT fk_txn_recurring FOREIGN KEY (recurring_rule_id) REFERENCES recurring_rules (id) ON DELETE SET NULL;
