// Where a request came from, for session rows, security events and audit rows.
function requestMeta(req) {
  return {
    ip: req.ip || null,
    userAgent: (req.get('user-agent') || '').slice(0, 255) || null,
    requestId: req.id || null,
  };
}

module.exports = { requestMeta };
