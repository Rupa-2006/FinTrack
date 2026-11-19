-- 006: reference data the application cannot run without

INSERT INTO roles (name, description) VALUES
    ('USER',  'Standard account: manages only its own financial data'),
    ('ADMIN', 'Manages accounts, roles and security monitoring; no access to private transaction data');

INSERT INTO currencies (code, name, symbol, decimal_places) VALUES
    ('INR', 'Indian Rupee',   '₹', 2),
    ('USD', 'US Dollar',      '$', 2),
    ('EUR', 'Euro',           '€', 2),
    ('GBP', 'Pound Sterling', '£', 2),
    ('JPY', 'Japanese Yen',   '¥', 0);

-- System default categories (user_id NULL)
INSERT INTO categories (user_id, name, type, icon, color) VALUES
    (NULL, 'Salary',            'INCOME',  'briefcase',    '#16A34A'),
    (NULL, 'Freelance',         'INCOME',  'laptop',       '#0D9488'),
    (NULL, 'Investments',       'INCOME',  'trending-up',  '#2563EB'),
    (NULL, 'Gifts',             'INCOME',  'gift',         '#DB2777'),
    (NULL, 'Other Income',      'INCOME',  'plus-circle',  '#64748B'),
    (NULL, 'Food & Dining',     'EXPENSE', 'utensils',     '#EA580C'),
    (NULL, 'Groceries',         'EXPENSE', 'shopping-cart','#65A30D'),
    (NULL, 'Rent & Housing',    'EXPENSE', 'home',         '#1E3A8A'),
    (NULL, 'Transport',         'EXPENSE', 'car',          '#0891B2'),
    (NULL, 'Shopping',          'EXPENSE', 'shopping-bag', '#9333EA'),
    (NULL, 'Utilities & Bills', 'EXPENSE', 'receipt',      '#CA8A04'),
    (NULL, 'Entertainment',     'EXPENSE', 'film',         '#E11D48'),
    (NULL, 'Health',            'EXPENSE', 'heart-pulse',  '#DC2626'),
    (NULL, 'Education',         'EXPENSE', 'book-open',    '#4F46E5'),
    (NULL, 'Travel',            'EXPENSE', 'plane',        '#0284C7'),
    (NULL, 'Subscriptions',     'EXPENSE', 'repeat',       '#7C3AED'),
    (NULL, 'Other Expenses',    'EXPENSE', 'circle',       '#64748B');
