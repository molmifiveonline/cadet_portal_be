const parseDateValue = (date) => {
  if (!date) return null;
  if (date instanceof Date && !isNaN(date.getTime())) return date;

  const value = String(date).trim();
  if (!value) return null;

  const isoDate = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (isoDate) {
    return new Date(
      Number(isoDate[1]),
      Number(isoDate[2]) - 1,
      Number(isoDate[3]),
    );
  }

  const dayFirstDate = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirstDate) {
    const day = Number(dayFirstDate[1]);
    const month = Number(dayFirstDate[2]);
    const year = Number(dayFirstDate[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateForDisplay = (date) => {
  const parsed = parseDateValue(date);
  if (!parsed) return '';

  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();

  return `${day}/${month}/${year}`;
};

module.exports = {
  formatDateForDisplay,
  parseDateValue,
};
