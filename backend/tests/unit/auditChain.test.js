// The audit hash chain without a database: what it detects and what it does not.
const crypto = require('crypto');
const { GENESIS_HASH, canonicalJson, computeHash, checkRow } = require('../../security/auditChain');

const KEY = crypto.randomBytes(32);

function buildChain(count) {
  const rows = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= count; i += 1) {
    const row = {
      id: i, user_id: 7, event_type: 'DATA', action: 'TRANSACTION_CREATED', resource_type: 'transaction', resource_id: String(100 + i),
      details: { type: 'EXPENSE', foreignCurrency: false }, ip_address: '203.0.113.9', request_id: `req-${i}`, created_at: `2026-11-17 10:00:0${i}.000`,
    };
    row.prev_hash = prev;
    row.curr_hash = computeHash(prev, row, KEY);
    prev = row.curr_hash;
    rows.push(row);
  }
  return rows;
}

// The same walk verifyChain() does, over an array.
function firstProblem(rows) {
  let prev = GENESIS_HASH;
  for (const row of rows) {
    const problem = checkRow(prev, row, KEY);
    if (problem) return { id: row.id, problem };
    prev = row.curr_hash;
  }
  return null;
}

test('canonical JSON ignores key order at every level', () => {
  expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
});

test('hashes are deterministic, keyed and depend on the previous hash', () => {
  const [row] = buildChain(1);
  expect(computeHash(GENESIS_HASH, row, KEY)).toBe(row.curr_hash);
  expect(computeHash(GENESIS_HASH, row, crypto.randomBytes(32))).not.toBe(row.curr_hash); // no key, no valid hash
  expect(computeHash('1'.repeat(64), row, KEY)).not.toBe(row.curr_hash);
  expect(row.curr_hash).toMatch(/^[0-9a-f]{64}$/);
});

test('an untouched chain checks out', () => {
  expect(firstProblem(buildChain(6))).toBeNull();
});

test.each([
  ['the action', (row) => { row.action = 'TRANSACTION_DELETED'; }],
  ['the user', (row) => { row.user_id = 8; }],
  ['the time', (row) => { row.created_at = '2026-11-17 09:00:00.000'; }],
  ['a detail', (row) => { row.details = { ...row.details, type: 'INCOME' }; }],
  ['the IP address', (row) => { row.ip_address = '198.51.100.1'; }],
])('changing %s of a row is detected at that row', (_label, change) => {
  const rows = buildChain(5);
  change(rows[2]);
  expect(firstProblem(rows)).toEqual({ id: 3, problem: expect.stringMatching(/contents do not match/) });
});

test('removing a row from the middle is detected at the next row', () => {
  const rows = buildChain(5);
  rows.splice(2, 1);
  expect(firstProblem(rows)).toEqual({ id: 4, problem: expect.stringMatching(/link to the previous row/) });
});

test('swapping two rows is detected', () => {
  const rows = buildChain(5);
  [rows[1], rows[2]] = [rows[2], rows[1]];
  expect(firstProblem(rows)).not.toBeNull();
});

test('re-hashing a changed row without fixing the rest is still detected further on', () => {
  const rows = buildChain(5);
  rows[1].action = 'FORGED';
  rows[1].curr_hash = computeHash(rows[1].prev_hash, rows[1], KEY); // attacker who has the key
  expect(firstProblem(rows)).toEqual({ id: 3, problem: expect.stringMatching(/link/) });
});

test('honest limit: removing the newest rows leaves a valid shorter chain', () => {
  // This is why the chain head is kept in audit_chain_head and exported as anchors.
  const rows = buildChain(5);
  expect(firstProblem(rows.slice(0, 3))).toBeNull();
});

test('a time written at exactly .000 milliseconds still verifies when read back without the fraction', () => {
  // Rows are hashed as written ("… 07:06:13.000"); the MySQL driver returns that time as "… 07:06:13".
  const written = { user_id: 1, event_type: 'AUTH', action: 'SIGNED_IN', created_at: '2026-11-19 07:06:13.000' };
  const hash = computeHash(GENESIS_HASH, written);
  const readBack = { ...written, created_at: '2026-11-19 07:06:13', prev_hash: GENESIS_HASH, curr_hash: hash };
  expect(checkRow(GENESIS_HASH, readBack)).toBeNull();
  // a different time is still caught
  expect(checkRow(GENESIS_HASH, { ...readBack, created_at: '2026-11-19 07:06:14' })).toMatch(/do not match/);
});
