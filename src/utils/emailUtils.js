const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmailRecipients = (value) => {
  if (value === undefined || value === null || value === '') return [];

  let parsedValue = value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      parsedValue = JSON.parse(value);
    } catch (_error) {
      throw new TypeError('Invalid CC recipient data');
    }
  }

  const rawValues = Array.isArray(parsedValue) ? parsedValue : [parsedValue];
  const recipients = rawValues
    .flatMap((item) =>
      item && typeof item === 'object'
        ? [{
            name: String(item.name || '').trim(),
            address: String(item.email || item.address || '').trim(),
          }]
        : String(item).split(/[;,]/).map((email) => email.trim()),
    )
    .map((recipient) =>
      typeof recipient === 'string' ? recipient.trim() : recipient,
    )
    .filter(Boolean);

  const invalidRecipients = recipients.filter(
    (recipient) =>
      !EMAIL_ADDRESS_PATTERN.test(
        typeof recipient === 'string' ? recipient : recipient.address,
      ),
  );

  if (invalidRecipients.length > 0) {
    throw new TypeError(
      `Invalid CC email address${invalidRecipients.length > 1 ? 'es' : ''}: ${invalidRecipients
        .map((recipient) =>
          typeof recipient === 'string' ? recipient : recipient.address,
        )
        .join(', ')}`,
    );
  }

  const uniqueRecipients = new Map();
  recipients.forEach((recipient) => {
    const address =
      typeof recipient === 'string' ? recipient : recipient.address;
    const key = address.toLowerCase();
    if (!uniqueRecipients.has(key)) uniqueRecipients.set(key, recipient);
  });

  return [...uniqueRecipients.values()];
};

module.exports = { normalizeEmailRecipients };
