const normalizePassingOutYear = (value) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;

  const normalized = String(value).trim();
  const match = normalized.match(/^(\d{4})(?:-\d{1,2}-\d{1,2})?$/);
  const year = match ? Number(match[1]) : NaN;

  if (!Number.isInteger(year) || year < 1901 || year > 2155) {
    throw new TypeError('Passing Out Year must be a valid four-digit year');
  }

  return year;
};

const normalizeMySqlDateTime = (value, fieldLabel = 'Date and time') => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`${fieldLabel} must be a valid date and time`);
    }
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${fieldLabel} must be a valid date and time`);
  }

  // mysql2 safely converts Date objects to the format expected by DATETIME.
  return parsed;
};

const CADET_DATETIME_FIELDS = [
  'workflow_updated_at',
  'shortlisted_at',
  'selected_at',
];

const normalizeCadetDatabaseValues = (cadetData = {}) => {
  const normalized = { ...cadetData };
  if (Object.prototype.hasOwnProperty.call(normalized, 'passing_out_date')) {
    normalized.passing_out_date = normalizePassingOutYear(
      normalized.passing_out_date,
    );
  }

  CADET_DATETIME_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = normalizeMySqlDateTime(normalized[field], field);
    }
  });

  return normalized;
};

module.exports = {
  normalizePassingOutYear,
  normalizeMySqlDateTime,
  normalizeCadetDatabaseValues,
};
