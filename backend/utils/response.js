// The one response shape every endpoint uses.
//   success: { success: true, data, meta? }
//   failure: { success: false, error: { code, message, details?, requestId } }  (see errorHandler)

function sendSuccess(res, data = null, { status = 200, meta } = {}) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

function sendCreated(res, data, options = {}) {
  return sendSuccess(res, data, { ...options, status: 201 });
}

function sendNoContent(res) {
  return res.status(204).end();
}

function paginationMeta({ page, pageSize, totalItems }) {
  return {
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    },
  };
}

module.exports = { sendSuccess, sendCreated, sendNoContent, paginationMeta };
