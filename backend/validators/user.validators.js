const { z } = require('zod');
const fields = require('./common');

const updateProfile = z.object({ fullName: fields.fullName, phone: fields.phone });

const changePassword = z.object({ currentPassword: fields.existingPassword, newPassword: fields.newPassword });

const deactivate = z.object({ password: fields.existingPassword });

const sessionParams = z.object({ id: fields.id });

module.exports = { updateProfile, changePassword, deactivate, sessionParams };
