-- 001: reference tables (currencies, exchange-rate snapshots, roles)

CREATE TABLE currencies (
    code            CHAR(3)          NOT NULL,
    name            VARCHAR(50)      NOT NULL,
    symbol          VARCHAR(5)       NOT NULL,
    decimal_places  TINYINT UNSIGNED NOT NULL DEFAULT 2,
    is_active       BOOLEAN          NOT NULL DEFAULT TRUE,
    created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (code),
    CONSTRAINT chk_currency_code CHECK (code REGEXP '^[A-Z]{3}$'),
    CONSTRAINT chk_currency_decimals CHECK (decimal_places <= 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per (pair, date). Rows are never updated: a new date is a new snapshot.
-- Meaning: 1 unit of base_currency = rate units of quote_currency.
CREATE TABLE exchange_rates (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    base_currency   CHAR(3)          NOT NULL,
    quote_currency  CHAR(3)          NOT NULL,
    rate            DECIMAL(18,8)    NOT NULL,
    rate_date       DATE             NOT NULL,
    source          VARCHAR(50)      NOT NULL,
    fetched_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_rate_pair_date (base_currency, quote_currency, rate_date),
    KEY idx_rate_lookup (base_currency, quote_currency, rate_date DESC),
    CONSTRAINT fk_rate_base  FOREIGN KEY (base_currency)  REFERENCES currencies (code),
    CONSTRAINT fk_rate_quote FOREIGN KEY (quote_currency) REFERENCES currencies (code),
    CONSTRAINT chk_rate_positive CHECK (rate > 0),
    CONSTRAINT chk_rate_pair CHECK (base_currency <> quote_currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE roles (
    id           SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name         VARCHAR(30)       NOT NULL,
    description  VARCHAR(255)      NOT NULL,
    created_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_role_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
