const PASSWORD_LENGTH_MESSAGE = 'Password must be 8 to 16 characters';
const EMAIL_VALIDATION_MESSAGE = 'Please enter a valid email address';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sanitizePhoneValue = (value) => {
  if (value === null || value === undefined) return '';

  const rawValue = String(value).trim();
  const hasLeadingPlus = rawValue.startsWith('+');
  const digits = rawValue.replace(/\D/g, '');

  return `${hasLeadingPlus ? '+' : ''}${digits}`;
};

const getPhoneValidationMessage = (value, fieldName) => {
  const rawValue =
    value === null || value === undefined ? '' : String(value).trim();
  const sanitizedValue = sanitizePhoneValue(value);

  if (!rawValue) return '';

  if (!sanitizedValue || sanitizedValue === '+') {
    return `${fieldName} must contain digits and may start with +`;
  }

  if (!/^\+?\d+$/.test(sanitizedValue)) {
    return `${fieldName} must contain digits and may start with +`;
  }

  if (sanitizedValue.length < 6) {
    return `${fieldName} must be at least 6 characters`;
  }

  if (sanitizedValue.length > 13) {
    return `${fieldName} must not exceed 13 characters`;
  }

  return '';
};

const isValidPasswordLength = (password) =>
  typeof password === 'string' && password.length >= 8 && password.length <= 16;

const getEmailValidationMessage = (value) => {
  const email = value === null || value === undefined ? '' : String(value).trim();

  if (!email) return '';
  return EMAIL_REGEX.test(email) ? '' : EMAIL_VALIDATION_MESSAGE;
};

module.exports = {
  EMAIL_VALIDATION_MESSAGE,
  PASSWORD_LENGTH_MESSAGE,
  sanitizePhoneValue,
  getPhoneValidationMessage,
  isValidPasswordLength,
  getEmailValidationMessage,
};
