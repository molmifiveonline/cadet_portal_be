// Include historical records: closed drives and rejected submissions still
// depend on their institute. Keep the list and delete checks in sync.
const dependencies = [
  ['recruitment_drives', 'institute_id', 'recruitment drives'],
  ['cadets', 'institute_id', 'cadets'],
  ['institute_submissions', 'institute_id', 'uploaded submissions'],
  ['recruitment_communications', 'institute_id', 'communication history'],
  [
    'notifications',
    'recipient_id',
    'institute notifications',
    "AND d.recipient_type = 'Institute'",
  ],
];

const getInstituteDependencySelect = (lockRows = false) =>
  dependencies
    .map(
      ([table, column, , condition = '']) =>
        `EXISTS (SELECT 1 FROM ${table} d
      WHERE d.${column} = i.id COLLATE utf8mb4_unicode_ci ${condition}
      ${lockRows ? 'FOR UPDATE' : ''}) AS has_${table}`,
    )
    .join(', ');

const getInstituteDeletionInfo = (row) => {
  const linked = dependencies
    .filter(([table]) => Number(row[`has_${table}`]) > 0)
    .map(([, , label]) => label);
  return {
    can_delete: linked.length === 0,
    delete_blocked_reason: linked.length
      ? `Cannot delete this institute because it is linked to ${linked.join(', ')}.`
      : null,
  };
};

module.exports = { getInstituteDependencySelect, getInstituteDeletionInfo };
