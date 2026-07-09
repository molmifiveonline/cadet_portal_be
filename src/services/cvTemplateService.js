const ExcelJS = require('exceljs');
const { INSTITUTE_UPLOAD_TYPES } = require('../config/constants');
const {
  getPhoneValidationMessage,
  sanitizePhoneValue,
} = require('../utils/validationUtils');
const { getEmailValidationMessage } = require('../utils/validationUtils');

const TEMPLATE_VERSION = '1';
const DATA_SHEET_NAME = 'CV Upload';
const META_SHEET_NAME = '_metadata';

const OTHER_FIELD_DEFINITIONS = [
  { key: 'cadet_unique_id', label: 'Cadet Unique ID', locked: true },
  { key: 'name_as_in_indos_cert', label: 'Name as in INDOS', required: true },
  { key: 'gender', label: 'Gender', required: true },
  { key: 'course', label: 'Deck/ Engine' },
  { key: 'batch_year', label: 'Batch Year' },
  { key: 'roll_no', label: 'Roll No' },
  { key: 'home_town_or_nearby_airport', label: 'Home town or nearby Airport' },
  { key: 'passing_out_date', label: 'Passing Out Date' },
  { key: 'date_of_birth', label: 'Date of Birth', required: true },
  { key: 'age_when_passing_out', label: 'Age when Passing Out' },
  { key: 'contact_number', label: 'Contact Number', required: true },
  { key: 'email_id', label: 'Email ID', required: true },
  { key: 'batch_rank_out_of_72_cadets', label: 'BATCH RANK OUT OF 72 CADETS' },
  { key: 'no_of_arrears', label: 'N0 OF ARREARS' },
  { key: 'tenth_std_board', label: '10th Std Board' },
  { key: 'tenth_std_pass_out_year', label: '10th Std Pass out Year' },
  { key: 'tenth_avg_percentage', label: '10th Avg %', required: true },
  { key: 'tenth_std_maths', label: '10th Std Maths', required: true },
  { key: 'tenth_std_science', label: '10th Std Science', required: true },
  { key: 'tenth_std_english', label: '10th Std English', required: true },
  { key: 'twelfth_std_board', label: '12th Std Board' },
  { key: 'twelfth_std_pass_out_year', label: '12th Std pass out year' },
  { key: 'twelfth_pcm_avg_percentage', label: '12th PCM Avg %', required: true },
  { key: 'twelfth_std_english', label: '12th Std English', required: true },
  { key: 'twelfth_std_physics', label: '12th Std Physics' },
  { key: 'twelfth_std_chemistry', label: '12th Std Chemistry' },
  { key: 'twelfth_std_maths', label: '12th Std Maths' },
  { key: 'imu_rank', label: 'IMU Rank', required: true },
  { key: 'imu_avg_all_semester_percentage', label: 'IMU Avg All Semester %' },
  { key: 'imu_sem_1_percentage', label: 'IMU Sem 1' },
  { key: 'imu_sem_2_percentage', label: 'IMU Sem 2' },
  { key: 'imu_sem_3_percentage', label: 'IMU Sem 3' },
  { key: 'imu_sem_4_percentage', label: 'IMU Sem 4' },
  { key: 'imu_sem_5_percentage', label: 'IMU Sem 5' },
  { key: 'imu_sem_6_percentage', label: 'IMU Sem 6' },
  { key: 'imu_sem_7_percentage', label: 'IMU Sem 7' },
  { key: 'imu_sem_8_percentage', label: 'IMU Sem 8' },
  { key: 'weight_in_kgs', label: 'Weight in KGs' },
  { key: 'height_in_cms', label: 'Height in CMs' },
  { key: 'bmi', label: 'BMI' },
  { key: 'any_extra_curricular_achievement', label: 'Any Extra Curricular achievement' },
];

const PANAMA_FIELD_DEFINITIONS = [
  { key: 'cadet_unique_id', label: 'Cadet Unique ID', locked: true },
  { key: 'name_as_in_indos_cert', label: 'Name', required: true },
  { key: 'course', label: 'Deck/ Engine', locked: true },
  { key: 'batch_year', label: 'Batch Year', locked: true },
  { key: 'roll_no', label: 'Roll No', locked: true },
  { key: 'national_id_number', label: 'Panama ID', locked: true },
  { key: 'nationality', label: 'Nationality', locked: true },
  { key: 'imu_avg_all_semester_percentage', label: 'GPA', locked: true },
  {
    key: 'ces_test',
    label: 'CES Test',
    source: 'assessment',
    locked: true,
  },
  {
    key: 'english_test',
    label: 'English Test',
    source: 'assessment',
    locked: true,
  },
  { key: 'gender', label: 'Gender', required: true },
  { key: 'date_of_birth', label: 'Date of Birth', required: true },
  { key: 'contact_number', label: 'Contact Number', required: true },
  { key: 'email_id', label: 'Email ID', required: true },
  { key: 'passport_number', label: 'Passport Number' },
  { key: 'height_in_cms', label: 'Height in CMs' },
  { key: 'weight_in_kgs', label: 'Weight in KGs' },
  { key: 'bmi', label: 'BMI' },
  {
    key: 'remarks',
    label: 'Remarks / Comments',
    source: 'assessment',
  },
];

const normalizeUploadType = (uploadType) => {
  const normalized =
    typeof uploadType === 'string' ? uploadType.trim().toLowerCase() : '';

  if (normalized === 'panama') return INSTITUTE_UPLOAD_TYPES.PANAMA;
  return INSTITUTE_UPLOAD_TYPES.OTHER;
};

const getCvTemplateConfig = (uploadType) => {
  const resolvedUploadType = normalizeUploadType(uploadType);
  const fields =
    resolvedUploadType === INSTITUTE_UPLOAD_TYPES.PANAMA
      ? PANAMA_FIELD_DEFINITIONS
      : OTHER_FIELD_DEFINITIONS;

  return {
    uploadType: resolvedUploadType,
    sheetTitle:
      resolvedUploadType === INSTITUTE_UPLOAD_TYPES.PANAMA
        ? 'Panama Pending Details'
        : DATA_SHEET_NAME,
    filenameSuffix:
      resolvedUploadType === INSTITUTE_UPLOAD_TYPES.PANAMA
        ? 'Panama_Pending_Details'
        : 'CV_Template',
    fields,
    requiredFields: fields
      .filter((field) => field.required)
      .map((field) => field.key),
  };
};

const getFieldValue = (field, cadet) => {
  if (field.source !== 'assessment') return cadet[field.key] ?? '';

  if (field.key === 'remarks') {
    return cadet.assessment_remarks ?? cadet.any_extra_curricular_achievement ?? '';
  }

  return cadet[field.key] ?? '';
};

const safeFilenamePart = (value) =>
  String(value || 'cadet')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'cadet';

const normalizeCellValue = (value) => {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (value.text !== undefined) return value.text;
    if (value.result !== undefined) return value.result;
    if (value.richText) return value.richText.map((part) => part.text).join('');
  }
  return value;
};

const isBlank = (value) =>
  value === undefined || value === null || String(value).trim() === '';

const normalizeComparable = (value) => String(value ?? '').trim();

const formatExcelDateForDb = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return value;
};

const addMetadata = (workbook, metadata) => {
  const sheet = workbook.addWorksheet(META_SHEET_NAME, {
    state: 'veryHidden',
  });
  Object.entries(metadata).forEach(([key, value], index) => {
    sheet.getCell(index + 1, 1).value = key;
    sheet.getCell(index + 1, 2).value = value ?? '';
  });
};

const readMetadata = (workbook) => {
  const sheet = workbook.getWorksheet(META_SHEET_NAME);
  if (!sheet) return {};

  const metadata = {};
  sheet.eachRow((row) => {
    const key = normalizeComparable(row.getCell(1).value);
    if (key) metadata[key] = normalizeComparable(row.getCell(2).value);
  });
  return metadata;
};

const generateCadetCvTemplate = async ({ cadet, institute, drive }) => {
  const config = getCvTemplateConfig(institute?.institute_upload_type);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MOLMI Cadet Portal';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(DATA_SHEET_NAME);
  sheet.columns = [
    { header: 'Field', key: 'field', width: 38 },
    { header: 'Value', key: 'value', width: 42 },
    { header: 'Required', key: 'required', width: 14 },
  ];

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E78' },
  };

  config.fields.forEach((field) => {
    const row = sheet.addRow({
      field: field.label,
      value: getFieldValue(field, cadet),
      required: field.required ? 'Yes' : '',
    });
    row.getCell(1).protection = { locked: true };
    row.getCell(2).protection = { locked: !!field.locked };
    row.getCell(3).protection = { locked: true };
  });

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getColumn(2).eachCell((cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFF2CC' },
      };
    }
  });

  addMetadata(workbook, {
    templateVersion: TEMPLATE_VERSION,
    uploadType: config.uploadType,
    cadetId: cadet.id,
    cadetUniqueId: cadet.cadet_unique_id,
    instituteId: cadet.institute_id,
    driveId: drive?.id || cadet.drive_id || '',
    instituteName: institute?.institute_name || cadet.institute_name || '',
    driveName: drive?.drive_name || cadet.drive_name || '',
  });

  await sheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: true,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${safeFilenamePart(cadet.cadet_unique_id || cadet.id)}_${safeFilenamePart(cadet.name_as_in_indos_cert)}_${config.filenameSuffix}.xlsx`;

  return {
    filename,
    content: Buffer.from(buffer),
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
};

const parseCadetCvTemplate = async (buffer, { cadet, driveId, institute }) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const metadata = readMetadata(workbook);
  const errors = [];
  const expectedUploadType = normalizeUploadType(institute?.institute_upload_type);
  const templateUploadType = normalizeUploadType(metadata.uploadType);
  const config = getCvTemplateConfig(templateUploadType);

  if (metadata.templateVersion !== TEMPLATE_VERSION) {
    errors.push('Invalid or unsupported pending details template version.');
  }

  if (templateUploadType !== expectedUploadType) {
    errors.push(
      `Uploaded template format does not match this institute. Expected ${expectedUploadType} template.`,
    );
  }

  if (metadata.cadetId !== normalizeComparable(cadet.id)) {
    errors.push('Uploaded Excel does not match the selected cadet.');
  }

  if (metadata.instituteId !== normalizeComparable(cadet.institute_id)) {
    errors.push('Uploaded Excel does not match the cadet institute.');
  }

  const expectedDriveId = normalizeComparable(driveId || cadet.drive_id || '');
  if (expectedDriveId && metadata.driveId !== expectedDriveId) {
    errors.push('Uploaded Excel does not match the recruitment drive.');
  }

  const sheet = workbook.getWorksheet(DATA_SHEET_NAME) || workbook.worksheets[0];
  if (!sheet) {
    errors.push('Pending details upload sheet is missing.');
    return { errors, data: {} };
  }

  const data = {};
  const assessmentData = {};
  config.fields.forEach((field, index) => {
    const row = sheet.getRow(index + 2);
    const value = normalizeCellValue(row.getCell(2).value);
    if (field.source === 'assessment') {
      assessmentData[field.key] = value;
    } else {
      data[field.key] = value;
    }
  });

  config.requiredFields.forEach((field) => {
    if (isBlank(data[field])) {
      const label = config.fields.find((item) => item.key === field)?.label || field;
      errors.push(`${label} is required.`);
    }
  });

  const gender = normalizeComparable(data.gender).toLowerCase();
  if (data.gender && gender !== 'male' && gender !== 'female') {
    errors.push('Gender must be either Male or Female.');
  }

  data.contact_number = sanitizePhoneValue(data.contact_number);
  const phoneMessage = getPhoneValidationMessage(data.contact_number, 'Phone');
  if (phoneMessage) errors.push(phoneMessage);

  const emailMessage = getEmailValidationMessage(data.email_id);
  if (emailMessage) errors.push(emailMessage);

  data.date_of_birth = formatExcelDateForDb(data.date_of_birth);

  delete data.cadet_unique_id;
  if (templateUploadType === INSTITUTE_UPLOAD_TYPES.PANAMA) {
    delete data.course;
    delete data.batch_year;
    delete data.roll_no;
    delete data.national_id_number;
    delete data.nationality;
    delete data.imu_avg_all_semester_percentage;
  }

  return {
    errors,
    data,
    assessmentData,
    metadata,
    uploadType: templateUploadType,
    requiredFields: config.requiredFields,
  };
};

module.exports = {
  FIELD_DEFINITIONS: OTHER_FIELD_DEFINITIONS,
  OTHER_FIELD_DEFINITIONS,
  PANAMA_FIELD_DEFINITIONS,
  getCvTemplateConfig,
  generateCadetCvTemplate,
  parseCadetCvTemplate,
};
