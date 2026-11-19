// MySQL returns DATETIME as "YYYY-MM-DD HH:MM:SS.mmm" in UTC (see config/database.js).
// The API sends ISO 8601 with an explicit Z.
function toIso(mysqlDateTime) {
  return mysqlDateTime ? `${String(mysqlDateTime).replace(' ', 'T')}Z` : null;
}

module.exports = { toIso };
