import { api } from './apiClient.js';

// Resolves with { status: 'ready', checks, schemaVersion }; rejects when the API or its
// database is unavailable.
export async function getReadiness() {
  const { data } = await api.get('/health/ready', { skipAuthRefresh: true, timeout: 5000 });
  return data;
}
