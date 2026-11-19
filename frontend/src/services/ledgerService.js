// Calls for the money features. Amounts travel as decimal strings in both directions.
import { api } from './apiClient.js';

const data = (promise) => promise.then((res) => res.data);
// Empty filters are left out of the query string.
const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined));
const withParams = (params) => ({ params: clean(params) });

// categories
export const listCategories = (params) => data(api.get('/categories', withParams(params)));
export const createCategory = (body) => data(api.post('/categories', body));
export const deleteCategory = (id) => data(api.delete(`/categories/${id}`));

// transactions
export const listTransactions = (params) =>
  api.get('/transactions', withParams(params)).then((res) => ({ items: res.data, pagination: res.meta.pagination }));
export const getTransaction = (id) => data(api.get(`/transactions/${id}`));
export const createTransaction = (body) => data(api.post('/transactions', body));
export const updateTransaction = (id, body) => data(api.put(`/transactions/${id}`, body));
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`);

// import: { rows, dryRun, skipDuplicates, fallbackCategories } -> { summary, rows }
export const importTransactions = (body) => data(api.post('/transactions/import', body));

// recurring transactions
export const listRecurring = () => data(api.get('/recurring'));
export const createRecurring = (body) => data(api.post('/recurring', body));
export const updateRecurring = (id, body) => data(api.put(`/recurring/${id}`, body));
export const deleteRecurring = (id) => api.delete(`/recurring/${id}`);

// budgets
export const listBudgets = (month) => data(api.get('/budgets', withParams({ month })));
export const createBudget = (body) => data(api.post('/budgets', body));
export const updateBudget = (id, body) => data(api.put(`/budgets/${id}`, body));
export const deleteBudget = (id) => api.delete(`/budgets/${id}`);
export const copyBudgets = (fromMonth, toMonth) => data(api.post('/budgets/copy', { fromMonth, toMonth }));

// savings goals
export const listGoals = () => data(api.get('/goals'));
export const createGoal = (body) => data(api.post('/goals', body));
export const updateGoal = (id, body) => data(api.put(`/goals/${id}`, body));
export const deleteGoal = (id) => api.delete(`/goals/${id}`);
export const contributeToGoal = (id, body) => data(api.post(`/goals/${id}/contributions`, body));

// currencies
export const getCurrencies = () => data(api.get('/currencies'));
export const getRates = (base) => data(api.get('/currencies/rates', withParams({ base })));
export const refreshRates = () => data(api.post('/currencies/rates/refresh'));
export const convertAmount = (params) => data(api.get('/currencies/convert', withParams(params)));
export const changeBaseCurrency = (baseCurrency) => data(api.put('/currencies/base', { baseCurrency }));

// analytics and reports
export const getDashboard = (month) => data(api.get('/analytics/dashboard', withParams({ month })));
export const getSummary = (params) => data(api.get('/analytics/summary', withParams(params)));
export const getMonthlyTrend = (params) => data(api.get('/analytics/monthly', withParams(params)));
export const getCategoryBreakdown = (params) => data(api.get('/analytics/categories', withParams(params)));
export const getMonthlyReport = (month) => data(api.get('/reports/monthly', withParams({ month })));

// Resolves with { blob, filename } for the browser to save.
export async function downloadTransactionsCsv(params) {
  const res = await api.get('/reports/export', { ...withParams(params), responseType: 'blob' });
  const match = /filename="([^"]+)"/.exec(res.headers?.['content-disposition'] ?? '');
  return { blob: res.data, filename: match ? match[1] : 'fintrack-transactions.csv' };
}

// notifications
export const listNotifications = (params) =>
  api.get('/notifications', withParams(params)).then((res) => ({ items: res.data, pagination: res.meta.pagination, unreadCount: res.meta.unreadCount }));
export const getUnreadCount = () => data(api.get('/notifications/unread-count')).then((result) => result.unreadCount);
export const markNotificationRead = (id) => api.patch(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => data(api.post('/notifications/read-all'));
export const deleteNotification = (id) => api.delete(`/notifications/${id}`);
