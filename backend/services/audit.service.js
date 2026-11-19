// The audit trail: who did what to which record, when and from where.
//
// append() runs inside the same database transaction as the change it describes, so a change
// is never committed without its audit row and an audit row never describes a change that
// was rolled back. The single-row audit_chain_head is locked FOR UPDATE first, which
// serialises appends: two requests cannot both build on the same previous hash.
//
// Details hold field names, ids and categories of action, never amounts, notes, passwords or
// tokens. The application account can only INSERT and SELECT audit rows.
const database = require('../config/database');
const { GENESIS_HASH, checkRow, computeHash } = require('../security/auditChain');
const { toIso } = require('../utils/dates');

const EVENT_TYPES = Object.freeze({ AUTH: 'AUTH', ACCOUNT: 'ACCOUNT', DATA: 'DATA', ADMIN: 'ADMIN' });

// "2026-11-17 09:30:12.345", the exact text MySQL returns for DATETIME(3), so the value that
// is hashed now is the value that is read back and re-hashed later.
const mysqlNow = () => new Date().toISOString().replace('T', ' ').replace('Z', '');

// `details` exactly as MySQL will store and return it: a JSON round trip drops undefined
// values. The hash must be computed over this stored form, or verification would later report
// an untouched row as changed.
function storedDetails(details) {
  if (!details) return null;
  const stored = JSON.parse(JSON.stringify(details));
  return Object.keys(stored).length ? stored : null;
}

async function append(tx, { userId = null, eventType, action, resourceType = null, resourceId = null, details = null, ctx = {} }) {
  const [head] = await tx.query('SELECT last_id, last_hash FROM audit_chain_head WHERE id = 1 FOR UPDATE');
  const row = {
    user_id: userId,
    event_type: eventType,
    action,
    resource_type: resourceType,
    resource_id: resourceId === null || resourceId === undefined ? null : String(resourceId),
    details: storedDetails(details),
    ip_address: ctx.ip ?? null,
    request_id: ctx.requestId ?? null,
    created_at: mysqlNow(),
  };
  const currHash = computeHash(head.last_hash, row);
  const result = await tx.query(
    `INSERT INTO audit_logs (user_id, event_type, action, resource_type, resource_id, details, ip_address, request_id, created_at, prev_hash, curr_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.user_id, row.event_type, row.action, row.resource_type, row.resource_id, row.details ? JSON.stringify(row.details) : null,
      row.ip_address, row.request_id, row.created_at, head.last_hash, currHash]
  );
  await tx.query('UPDATE audit_chain_head SET last_id = ?, last_hash = ? WHERE id = 1', [result.insertId, currHash]);
  return result.insertId;
}

// For actions that have no other database write to share a transaction with.
function record(entry) {
  return database.withTransaction((tx) => append(tx, entry));
}

const ROW_COLUMNS = 'id, user_id, event_type, action, resource_type, resource_id, details, ip_address, request_id, created_at, prev_hash, curr_hash';

// Recomputes the whole chain in batches and compares the end with audit_chain_head.
// Reports the first broken row, if any.
// The head is read first and the chain is checked up to it. Rows appended while the check
// runs belong to a later head and are left for the next check; reading the head last would
// report a busy, untouched log as broken. (An append writes its row and moves the head in one
// transaction, so every row up to the head that was read is committed.)
async function verifyChain({ batchSize = 1000 } = {}, db = database) {
  const [head] = await db.query('SELECT last_id, last_hash FROM audit_chain_head WHERE id = 1');
  const headId = Number(head.last_id);
  let expectedPrev = GENESIS_HASH;
  let lastId = 0;
  let checkedRows = 0;
  for (;;) {
    const rows = await db.query(
      `SELECT ${ROW_COLUMNS} FROM audit_logs WHERE id > ? AND id <= ? ORDER BY id LIMIT ${Number.parseInt(batchSize, 10)}`,
      [lastId, headId]
    );
    for (const row of rows) {
      const problem = checkRow(expectedPrev, row);
      if (problem) return { valid: false, checkedRows, brokenAtId: row.id, reason: `Row ${row.id}: ${problem}.` };
      expectedPrev = row.curr_hash;
      lastId = row.id;
      checkedRows += 1;
    }
    if (rows.length < batchSize) break;
  }
  if (headId !== lastId || head.last_hash !== expectedPrev) {
    return {
      valid: false, checkedRows, brokenAtId: null,
      reason: 'The chain head does not match the last row: rows are missing from the end, or the head was changed.',
    };
  }
  return { valid: true, checkedRows, lastId, lastHash: expectedPrev, verifiedAt: new Date().toISOString() };
}

// Confirms that an anchor exported earlier is still part of the chain. A rewritten or
// truncated tail fails this check even if the remaining rows are self-consistent.
async function checkAnchor({ lastId, lastHash }, db = database) {
  if (Number(lastId) === 0) return lastHash === GENESIS_HASH;
  const rows = await db.query('SELECT curr_hash FROM audit_logs WHERE id = ?', [lastId]);
  return rows.length === 1 && rows[0].curr_hash === lastHash;
}

async function head(db = database) {
  const [row] = await db.query('SELECT last_id, last_hash, updated_at FROM audit_chain_head WHERE id = 1');
  return { lastId: Number(row.last_id), lastHash: row.last_hash, updatedAt: toIso(row.updated_at) };
}

function toDto(row, { includeUser = false } = {}) {
  const dto = {
    id: row.id,
    eventType: row.event_type,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    details: row.details,
    ipAddress: row.ip_address,
    requestId: row.request_id,
    createdAt: toIso(row.created_at),
  };
  if (includeUser) Object.assign(dto, { userId: row.user_id, userEmail: row.email ?? null });
  return dto;
}

// A page of audit rows, newest first. userId limits it to one account's own trail.
async function list({ userId, eventType, action, page, pageSize }, { includeUser = false } = {}, db = database) {
  const where = ['1 = 1'];
  const params = [];
  if (userId) {
    where.push('a.user_id = ?');
    params.push(userId);
  }
  if (eventType) {
    where.push('a.event_type = ?');
    params.push(eventType);
  }
  if (action) {
    where.push('a.action = ?');
    params.push(action);
  }
  const limit = Number.parseInt(pageSize, 10);
  const offset = (Number.parseInt(page, 10) - 1) * limit;
  const rows = await db.query(
    `SELECT a.id, a.user_id, a.event_type, a.action, a.resource_type, a.resource_id, a.details, a.ip_address, a.request_id, a.created_at, u.email
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [count] = await db.query(`SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where.join(' AND ')}`, params);
  return { items: rows.map((row) => toDto(row, { includeUser })), totalItems: count.total };
}

module.exports = { EVENT_TYPES, append, record, verifyChain, checkAnchor, head, list };
