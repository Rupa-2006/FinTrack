// Schemas for the security and admin routes.
const { z } = require('zod');
const fields = require('./common');

const page = z.coerce.number().int().min(1).max(100000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(20);
const code = z.string().trim().regex(/^[A-Z_]{2,40}$/, 'Use an event code such as LOGIN_FAILED').optional();

const ownEventsQuery = z.object({ page, pageSize, eventType: code });
const ownActivityQuery = z.object({ page, pageSize, eventType: z.enum(['AUTH', 'ACCOUNT', 'DATA', 'ADMIN']).optional() });

const userListQuery = z.object({
  page,
  pageSize,
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
});
const adminEventsQuery = z.object({ page, pageSize, eventType: code, severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(), userId: fields.id.optional() });
const adminAuditQuery = z.object({
  page, pageSize, eventType: z.enum(['AUTH', 'ACCOUNT', 'DATA', 'ADMIN']).optional(), action: code, userId: fields.id.optional(),
});

const idParams = z.object({ id: fields.id });
const statusBody = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED'], { error: 'Status must be ACTIVE or SUSPENDED' }) });
const roleBody = z.object({ role: z.enum(['ADMIN', 'USER'], { error: 'Role must be ADMIN or USER' }), granted: z.boolean({ error: 'granted must be true or false' }) });

module.exports = { ownEventsQuery, ownActivityQuery, userListQuery, adminEventsQuery, adminAuditQuery, idParams, statusBody, roleBody };
