// The signed-in user's sessions, security events and activity trail, and the admin API.
import { api } from './apiClient.js';

const data = (promise) => promise.then((res) => res.data);
const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined));
const paged = (url, params) => api.get(url, { params: clean(params) }).then((res) => ({ items: res.data, pagination: res.meta.pagination }));

// own account
export const listSessions = () => data(api.get('/security/sessions'));
export const revokeSession = (id) => api.delete(`/security/sessions/${id}`);
export const revokeOtherSessions = () => data(api.delete('/security/sessions'));
export const listSecurityEvents = (params) => paged('/security/events', params);
export const listActivity = (params) => paged('/security/audit-logs', params);

// two-step sign-in
export const getMfaStatus = () => data(api.get('/security/mfa'));
export const startMfaSetup = () => data(api.post('/security/mfa/setup'));
export const enableMfa = (code) => data(api.post('/security/mfa/enable', { code }));
export const disableMfa = ({ password, code }) => data(api.post('/security/mfa/disable', { password, code }));
export const regenerateRecoveryCodes = (password) => data(api.post('/security/mfa/recovery-codes', { password }));

// administrators
export const getAdminOverview = () => data(api.get('/admin/overview'));
export const listUsers = (params) => paged('/admin/users', params);
export const setUserStatus = (id, status) => data(api.patch(`/admin/users/${id}/status`, { status }));
export const setUserRole = (id, role, granted) => data(api.put(`/admin/users/${id}/roles`, { role, granted }));
export const unlockUser = (id) => data(api.post(`/admin/users/${id}/unlock`));
export const listAllSecurityEvents = (params) => paged('/admin/security-events', params);
export const listAuditLogs = (params) => paged('/admin/audit-logs', params);
export const verifyAuditChain = () => data(api.post('/admin/audit-logs/verify'));
