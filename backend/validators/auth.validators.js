const { z } = require('zod');
const fields = require('./common');

const register = z.object({
  fullName: fields.fullName,
  email: fields.email,
  password: fields.newPassword,
  baseCurrency: fields.currencyCode.default('INR'),
});

const login = z.object({ email: fields.email, password: fields.existingPassword });

const forgotPassword = z.object({ email: fields.email });

const resetPassword = z.object({ token: fields.opaqueToken, password: fields.newPassword });

// A 6-digit authenticator code or a recovery code such as "k7mq-2xnd".
const mfaCode = z.string({ error: 'Enter the code' }).trim().min(6, 'Enter the code').max(20, 'Enter the code');

const verifyMfa = z.object({ challengeToken: fields.opaqueToken, code: mfaCode });

const mfaEnable = z.object({ code: mfaCode });
const mfaDisable = z.object({ password: fields.existingPassword, code: mfaCode });
const mfaPassword = z.object({ password: fields.existingPassword });

module.exports = { register, login, verifyMfa, forgotPassword, resetPassword, mfaEnable, mfaDisable, mfaPassword };
