// Outgoing email.
//
//   SMTP_HOST set      -> sent through that SMTP server
//   SMTP_HOST empty    -> development: written to backend/tmp/mail/ as a text file
//                         tests: kept in memory (see `outbox`)
//
// Message bodies can contain reset links, so they are never logged.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { config } = require('../config/env');
const { logger } = require('../utils/logger');

const MAIL_DIR = path.join(__dirname, '..', 'tmp', 'mail');
const outbox = []; // test environment only

let transporter;
function smtp() {
  transporter ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
  });
  return transporter;
}

const usesSmtp = () => Boolean(config.mail.host);

async function send({ to, subject, text }) {
  if (usesSmtp()) {
    await smtp().sendMail({ from: config.mail.from, to, subject, text });
    return;
  }
  if (config.isTest) {
    outbox.push({ to, subject, text });
    return;
  }
  await fs.mkdir(MAIL_DIR, { recursive: true });
  const file = path.join(MAIL_DIR, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
  await fs.writeFile(file, `To: ${to}\nSubject: ${subject}\n\n${text}\n`, 'utf8');
  logger.info({ file: path.relative(path.join(__dirname, '..'), file) }, 'SMTP is not configured: email written to a local file');
}

module.exports = { send, usesSmtp, outbox };
