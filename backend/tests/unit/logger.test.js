const { Writable } = require('stream');
const { createLogger } = require('../../utils/logger');

function captureLogger() {
  const lines = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: createLogger({ level: 'info', pretty: false }, destination), output: () => lines.join('') };
}

describe('logger redaction', () => {
  test('secrets in logged objects are replaced, wherever they are nested', () => {
    const { logger, output } = captureLogger();
    logger.info(
      {
        password: 'TopSecret#1',
        body: { email: 'user@example.test', password: 'TopSecret#2', newPassword: 'TopSecret#3' },
        session: { tokens: { refreshToken: 'TopSecret#4', accessToken: 'TopSecret#5' } },
        user: { id: 7, password_hash: 'TopSecret#6' },
      },
      'login attempt'
    );
    const text = output();
    expect(text).not.toMatch(/TopSecret/);
    expect(text).toContain('[REDACTED]');
    expect(text).toContain('user@example.test'); // non-secret fields are kept
    expect(JSON.parse(text).user.id).toBe(7);
  });

  test('authorization and cookie headers are redacted', () => {
    const { logger, output } = captureLogger();
    logger.info(
      {
        req: { headers: { authorization: 'Bearer eyJ.secret.jwt', cookie: 'refresh_token=abc123secret', accept: 'application/json' } },
        res: { headers: { 'set-cookie': ['refresh_token=newsecretvalue; HttpOnly'] } },
      },
      'request'
    );
    const text = output();
    expect(text).not.toMatch(/eyJ\.secret\.jwt|abc123secret|newsecretvalue/);
    expect(text).toContain('application/json');
  });

  test('log lines are structured JSON with a timestamp and service name', () => {
    const { logger, output } = captureLogger();
    logger.warn({ requestId: 'r-1' }, 'something happened');
    const entry = JSON.parse(output());
    expect(entry).toMatchObject({ service: 'fintrack-api', msg: 'something happened', requestId: 'r-1' });
    expect(Date.parse(entry.time)).not.toBeNaN();
  });
});
