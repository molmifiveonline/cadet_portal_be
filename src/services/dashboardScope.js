const badRequest = (message) =>
  Object.assign(new Error(message), { status: 400 });

const readFilters = (query = {}) => {
  const filters = {};
  for (const key of ['driveId', 'stream', 'batchYear', 'from', 'to']) {
    const value = query[key];
    if (value === undefined || value === '' || value === 'all') continue;
    if (typeof value !== 'string' || value.length > 100)
      throw badRequest(`Invalid ${key}`);
    filters[key] = value;
  }
  if (filters.stream && !['Deck', 'Engine', 'Other'].includes(filters.stream))
    throw badRequest('Invalid stream');
  if (filters.batchYear && !/^\d{4}$/.test(filters.batchYear))
    throw badRequest('Invalid batch year');
  for (const key of ['from', 'to']) {
    if (
      filters[key] &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) ||
        Number.isNaN(Date.parse(filters[key])) ||
        new Date(filters[key]).toISOString().slice(0, 10) !== filters[key])
    )
      throw badRequest(`Invalid ${key} date`);
  }
  if (filters.from && filters.to && filters.from > filters.to)
    throw badRequest('Start date must precede end date');
  return filters;
};

const streamExpression =
  "CASE WHEN LOWER(c.course) LIKE '%deck%' THEN 'Deck' WHEN LOWER(c.course) LIKE '%engine%' THEN 'Engine' ELSE 'Other' END";

const cadetScope = (filters = {}, access = {}) => {
  const clauses = ['1=1'];
  const params = [];
  if (access.role === 'Institute') {
    if (!access.instituteId)
      throw Object.assign(new Error('Institute identity is required'), {
        status: 403,
      });
    clauses.push('c.institute_id = ?');
    params.push(access.instituteId);
  }
  if (access.role === 'Cadet') {
    clauses.push('c.id = ?');
    params.push(access.cadetId || '__unlinked__');
  }
  for (const [key, column] of [
    ['driveId', 'c.drive_id'],
    ['batchYear', 'c.batch_year'],
  ]) {
    if (filters[key]) {
      clauses.push(`${column} = ?`);
      params.push(filters[key]);
    }
  }
  if (filters.stream) {
    clauses.push(`(${streamExpression}) = ?`);
    params.push(filters.stream);
  }
  if (filters.from) {
    clauses.push('c.created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('c.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(filters.to);
  }
  return { sql: clauses.join(' AND '), params };
};

const pageNumber = (value) => {
  if (value === undefined) return 1;
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 1000000
  )
    throw badRequest('Invalid page');
  return Number(value);
};

const buildPipeline = (stages, row = {}) =>
  stages.map((stage, index) => {
    const count = Number(row[stage.key] || 0);
    const previous = index ? Number(row[stages[index - 1].key] || 0) : null;
    // Inconsistent historical records must not produce negative drop-off rates.
    const comparable = previous > 0 && count <= previous;
    const conversionRate = comparable
      ? Math.round((count / previous) * 1000) / 10
      : null;
    return {
      ...stage,
      count,
      conversionRate,
      dropOffRate:
        conversionRate === null
          ? null
          : Math.round((100 - conversionRate) * 10) / 10,
    };
  });

module.exports = {
  readFilters,
  cadetScope,
  streamExpression,
  pageNumber,
  buildPipeline,
};
