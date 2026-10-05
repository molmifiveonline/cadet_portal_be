const { createHash, randomBytes } = require('node:crypto');

const PASSWORD_RESET_EXPIRY_MINUTES = 15;
const PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS = 60;
const PASSWORD_RESET_REQUEST_LIMIT = 5;
const PASSWORD_RESET_REQUEST_WINDOW_HOURS = 4;
const PASSWORD_RESET_LIMIT_MESSAGE =
  'Your maximum limit has been reached. Please try again after some time.';
const INVALID_RESET_LINK_MESSAGE =
  'This reset link is invalid, expired, or already used. Please request a new link using Forgot Password.';
const PASSWORD_RESET_REQUEST_MESSAGE =
  'If an active account exists for this email, a password reset link will be sent. Please wait one minute before requesting another link.';

const createPasswordResetToken = () => randomBytes(32).toString('hex');
const isValidPasswordResetToken = (token) =>
  typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const hashPasswordResetToken = (token) =>
  createHash('sha256').update(token).digest('hex');

module.exports = {
  PASSWORD_RESET_EXPIRY_MINUTES,
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS,
  PASSWORD_RESET_REQUEST_LIMIT,
  PASSWORD_RESET_REQUEST_WINDOW_HOURS,
  PASSWORD_RESET_LIMIT_MESSAGE,
  INVALID_RESET_LINK_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
  createPasswordResetToken,
  isValidPasswordResetToken,
  hashPasswordResetToken,
};
