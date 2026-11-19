// The AI assistant. Questions and answers live only in the page's memory.
import { api } from './apiClient.js';

export const getInsights = () => api.get('/assistant/insights').then((res) => res.data);

export const askQuestion = (question) => api.post('/assistant/ask', { question }).then((res) => res.data);
