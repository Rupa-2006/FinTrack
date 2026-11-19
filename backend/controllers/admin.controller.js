// HTTP layer for /api/admin. Every route sits behind authenticate + authorize('ADMIN').
const { sendSuccess, paginationMeta } = require('../utils/response');
const { requestMeta } = require('../utils/requestMeta');
const adminService = require('../services/admin.service');

const paged = async (req, res, load) => {
  const query = req.validated.query;
  const { items, totalItems } = await load(query);
  sendSuccess(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, totalItems }) });
};

module.exports = {
  overview: async (req, res) => sendSuccess(res, await adminService.overview()),
  listUsers: (req, res) => paged(req, res, adminService.listUsers),
  setStatus: async (req, res) => sendSuccess(res, await adminService.setStatus(req.auth, req.validated.params.id, req.validated.body, requestMeta(req))),
  setRole: async (req, res) => sendSuccess(res, await adminService.setRole(req.auth, req.validated.params.id, req.validated.body, requestMeta(req))),
  unlock: async (req, res) => sendSuccess(res, await adminService.unlock(req.auth, req.validated.params.id, requestMeta(req))),
  securityEvents: (req, res) => paged(req, res, adminService.listSecurityEvents),
  auditLogs: (req, res) => paged(req, res, adminService.listAuditLogs),
  verifyAuditChain: async (req, res) => sendSuccess(res, await adminService.verifyAuditChain(req.auth, requestMeta(req))),
};
