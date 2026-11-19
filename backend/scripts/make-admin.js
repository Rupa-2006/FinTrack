// Gives an existing account the ADMIN role (run from backend/):
//
//   npm run make-admin -- someone@example.com
//
// For the first administrator of a new installation; after that, administrators manage
// roles on the Admin page. The change is written to the audit trail as made from the
// command line.
const database = require('../config/database');
const audit = require('../services/audit.service');

async function makeAdmin(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('Give the email address of an existing account');
  return database.withTransaction(async (tx) => {
    const [user] = await tx.query("SELECT id FROM users WHERE email = ? AND status = 'ACTIVE'", [normalized]);
    if (!user) throw new Error('No active account has that email address');
    const result = await tx.query("INSERT IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'ADMIN'", [user.id]);
    if (!result.affectedRows) return { userId: user.id, changed: false };
    await audit.append(tx, {
      eventType: audit.EVENT_TYPES.ADMIN, action: 'ROLE_GRANTED', resourceType: 'user', resourceId: user.id,
      details: { role: 'ADMIN', via: 'command line' }, ctx: { requestId: 'command-line' },
    });
    return { userId: user.id, changed: true };
  });
}

if (require.main === module) {
  makeAdmin(process.argv[2])
    .then(({ userId, changed }) => console.log(changed ? `Account ${userId} is now an administrator.` : `Account ${userId} was already an administrator.`))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => database.close());
}

module.exports = { makeAdmin };
