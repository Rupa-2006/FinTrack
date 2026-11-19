// The connection pool the API uses: parameter binding, transactions, exact decimals.
const database = require('../../config/database');

const email = `pool.test.${Date.now()}@example.test`;

afterAll(async () => {
  await database.query('DELETE FROM users WHERE email LIKE ?', ['pool.test.%@example.test']);
  await database.close();
});

describe('database pool', () => {
  test('connects as the application account, in UTC, to the test database', async () => {
    const [row] = await database.query('SELECT CURRENT_USER() AS account, DATABASE() AS db, @@session.time_zone AS tz');
    expect(row.account).toMatch(/^fintrack_app@/);
    expect(row.db).toBe('fintrack_test');
    expect(row.tz).toBe('+00:00');
  });

  test('bound parameters are data, never SQL', async () => {
    const attack = "x' OR '1'='1'; DROP TABLE users; --";
    const [echo] = await database.query('SELECT ? AS value', [attack]);
    expect(echo.value).toBe(attack);
    const rows = await database.query('SELECT id FROM users WHERE email = ?', [attack]);
    expect(rows).toEqual([]);
    const [{ n }] = await database.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', ['users']);
    expect(n).toBe(1);
  });

  test('a call cannot carry a second statement', async () => {
    await expect(database.query('SELECT 1; SELECT 2')).rejects.toMatchObject({ code: 'ER_PARSE_ERROR' });
  });

  test('DECIMAL and DATE values come back as exact strings', async () => {
    const [row] = await database.query("SELECT CAST('1234567890123.45' AS DECIMAL(18,2)) AS amount, DATE('2026-11-16') AS day");
    expect(row).toEqual({ amount: '1234567890123.45', day: '2026-11-16' });
  });

  test('withTransaction rolls everything back when the work throws', async () => {
    await expect(
      database.withTransaction(async (tx) => {
        await tx.query('INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)', ['Pool Test', email, 'x']);
        const [inside] = await tx.query('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email]);
        expect(inside.n).toBe(1);
        throw new Error('abort');
      })
    ).rejects.toThrow('abort');
    const [after] = await database.query('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email]);
    expect(after.n).toBe(0);
  });

  test('withTransaction commits and returns the result of the work', async () => {
    const id = await database.withTransaction(async (tx) => {
      const result = await tx.query('INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)', ['Pool Test', email, 'x']);
      return result.insertId;
    });
    const [row] = await database.query('SELECT email FROM users WHERE id = ?', [id]);
    expect(row.email).toBe(email);
  });
});
