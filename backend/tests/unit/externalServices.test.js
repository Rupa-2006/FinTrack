// The two outbound integrations, with the network replaced: the exchange-rate client and the
// email sender. Neither may leak user data, and neither may trust what comes back.
jest.mock('../../config/env', () => ({
  config: {
    isTest: false,
    env: 'test',
    logLevel: 'silent',
    fxApiUrl: 'https://fx.example',
    mail: { host: 'smtp.example', port: 465, user: 'mailer', password: 'smtp-secret', from: 'FinTrack <no-reply@fintrack.test>' },
  },
}));
jest.mock('nodemailer', () => {
  const sendMail = jest.fn().mockResolvedValue({});
  return { createTransport: jest.fn(() => ({ sendMail })), sendMail };
});

const nodemailer = require('nodemailer');
const { config } = require('../../config/env');
const { fetchRates } = require('../../services/fxClient');
const mail = require('../../services/mail.service');

const answer = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe('exchange-rate client', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterAll(() => {
    delete global.fetch;
  });

  test('asks only for currency codes and a date, with a timeout', async () => {
    fetchMock.mockReturnValue(answer({ date: '2026-10-02', rates: { USD: 0.0119, EUR: 0.0102, GBP: 0.0089, JPY: 1.78 } }));
    const result = await fetchRates('INR', '2026-10-04');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fx.example/2026-10-04?base=INR&symbols=USD,EUR,GBP,JPY');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ date: '2026-10-02', rates: { USD: '0.0119', EUR: '0.0102', GBP: '0.0089', JPY: '1.78' } });
  });

  test('drops unknown codes and rates that are not positive numbers', async () => {
    fetchMock.mockReturnValue(answer({ date: '2026-10-02', rates: { USD: 0.0119, XYZ: 5, EUR: -1, GBP: '0.5', JPY: Infinity } }));
    expect((await fetchRates('INR')).rates).toEqual({ USD: '0.0119' });
  });

  test.each([
    ['an error status', answer({}, 503), /answered 503/],
    ['a malformed date', answer({ date: 'yesterday', rates: { USD: 1 } }), /unexpected/],
    ['no usable rates', answer({ date: '2026-10-02', rates: { XYZ: 1 } }), /unexpected/],
    ['an empty body', answer(null), /unexpected/],
  ])('rejects %s', async (_name, response, message) => {
    fetchMock.mockReturnValue(response);
    await expect(fetchRates('INR')).rejects.toThrow(message);
  });
});

describe('email sender', () => {
  test('sends through SMTP over TLS on port 465 with the configured sender', async () => {
    await mail.send({ to: 'someone@example.test', subject: 'Reset your password', text: 'link' });
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example', port: 465, secure: true, auth: { user: 'mailer', pass: 'smtp-secret' },
    });
    expect(nodemailer.sendMail).toHaveBeenCalledWith({
      from: 'FinTrack <no-reply@fintrack.test>', to: 'someone@example.test', subject: 'Reset your password', text: 'link',
    });
    expect(mail.usesSmtp()).toBe(true);
    expect(mail.outbox).toHaveLength(0);
  });

  test('reuses one SMTP connection pool', async () => {
    await mail.send({ to: 'a@example.test', subject: 's', text: 't' });
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
  });

  test('a delivery failure reaches the caller instead of being swallowed', async () => {
    nodemailer.sendMail.mockRejectedValueOnce(new Error('connection refused'));
    await expect(mail.send({ to: 'a@example.test', subject: 's', text: 't' })).rejects.toThrow('connection refused');
  });

  test('the configuration under test is the mocked one', () => {
    expect(config.isTest).toBe(false);
  });
});
