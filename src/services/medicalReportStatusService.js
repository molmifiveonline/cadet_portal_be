const parseMedicalReportResults = (reportResults) => {
  if (Array.isArray(reportResults)) return reportResults;
  if (typeof reportResults !== 'string' || !reportResults.trim()) return [];

  try {
    const parsed = JSON.parse(reportResults);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const haveAllMedicalReportsPassed = (reportResults) => {
  const results = parseMedicalReportResults(reportResults);
  return (
    results.length > 0 &&
    results.every(
      (result) => String(result?.status || '').trim().toLowerCase() === 'pass',
    )
  );
};

module.exports = { haveAllMedicalReportsPassed };
