// /api/assistant: insights and questions over the signed-in user's own records.
// Limited per user, because every call sends the user's history to the AI service.
const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const { createRateLimiter } = require('../middleware/rateLimiters');
const { sendSuccess } = require('../utils/response');
const assistantService = require('../services/assistant.service');

const askBody = z.object({
  question: z
    .string({ error: 'Type a question' })
    .trim()
    .min(2, 'Type a question')
    .max(500, 'Keep questions under 500 characters')
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/, 'The question contains characters that are not allowed'),
});

function createAssistantRouter(limit) {
  const router = Router();
  const perUser = createRateLimiter({ ...limit, keyGenerator: (req) => `user:${req.auth.userId}` });

  router.use(authenticate, perUser);
  router.get('/insights', async (req, res) => sendSuccess(res, await assistantService.insights(req.auth.userId)));
  router.post('/ask', validate({ body: askBody }), async (req, res) => sendSuccess(res, await assistantService.ask(req.auth.userId, req.validated.body)));
  return router;
}

module.exports = { createAssistantRouter };
