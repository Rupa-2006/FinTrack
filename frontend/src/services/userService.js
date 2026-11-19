// The signed-in user's own account.
import { api } from './apiClient.js';

export const getProfile = () => api.get('/users/profile').then((res) => res.data);

export const updateProfile = ({ fullName, phone }) => api.put('/users/profile', { fullName, phone }).then((res) => res.data);

export const changePassword = ({ currentPassword, newPassword }) =>
  api.put('/users/password', { currentPassword, newPassword }).then((res) => res.data);

export const deactivateAccount = (password) => api.post('/users/deactivate', { password });
