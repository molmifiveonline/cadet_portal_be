const xlsx = require('xlsx');
const {
  getEmailValidationMessage,
  getPhoneValidationMessage,
  sanitizePhoneValue,
} = require('../utils/validationUtils');

const PHONE_HEADER_KEYWORDS = ['mobile', 'phone', 'whatsapp', 'contact'];

const getPhoneFieldName = (header = '') => {
  const lowerHeader = String(header).toLowerCase();
  const matchedKeyword = PHONE_HEADER_KEYWORDS.find((keyword) =>
    lowerHeader.includes(keyword),
  );

  if (!matchedKeyword) return '';
  if (matchedKeyword === 'whatsapp') return 'WhatsApp';
  return matchedKeyword.charAt(0).toUpperCase() + matchedKeyword.slice(1);
};

const isPhoneHeader = (header) => !!getPhoneFieldName(header);

const parseExcelFile = (buffer) => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });

  return {
    rawData,
  };
};

const parseExcelWorkbook = (buffer) => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });

  return workbook.SheetNames.map((sheetName) => ({
    sheetName,
    rawData: xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: true,
    }),
  }));
};

// Convert Excel date values to standard SQL YYYY-MM-DD format for DB storage
const formatDate = (value) => {
  if (!value) return null;
  // If it's already a Date object
  if (value instanceof Date && !isNaN(value.getTime())) {
    const d = String(value.getDate()).padStart(2, '0');
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const y = value.getFullYear();
    return `${y}-${m}-${d}`;
  }
  // If it's a number (Excel serial date number), convert it robustly
  if (typeof value === 'number') {
    try {
      const parsed = xlsx.SSF.parse_date_code(value);
      if (parsed) {
        const d = String(parsed.d).padStart(2, '0');
        const m = String(parsed.m).padStart(2, '0');
        const y = parsed.y;
        return `${y}-${m}-${d}`;
      }
    } catch (err) {
      console.error('Error parsing Excel date code:', err);
    }
  }
  // If it's a string, try parsing it from expected day-first formats.
  if (typeof value === 'string') {
    value = value.trim();
    const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    }
  }
  return null;
};

// Explicitly extract ONLY the year for passing_out_date
const formatYear = (value) => {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.getFullYear();
  }
  if (typeof value === 'number') {
    if (value >= 1900 && value <= 2100) return Math.floor(value); // If they literally typed "2026"
    try {
      const parsed = xlsx.SSF.parse_date_code(value);
      if (parsed) return parsed.y;
    } catch (err) {}
  }
  if (typeof value === 'string') {
    value = value.trim();
    if (value.length === 4 && !isNaN(parseInt(value))) return parseInt(value);
    const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (match) return parseInt(match[3], 10);
  }
  return null;
};

const findHeaderRow = (rawData, keywords, threshold = 2) => {
  for (let i = 0; i < Math.min(rawData.length, 20); i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const matchCount = row.filter((cell) => {
      if (!cell) return false;
      const cellStr = String(cell).toLowerCase();
      return keywords.some((keyword) => cellStr.includes(keyword));
    }).length;

    if (matchCount >= threshold) {
      return { rowIndex: i, headers: row };
    }
  }
  return null;
};

const cleanHeaderValue = (header = '') =>
  String(header).replace(/[\r\n]+/g, ' ').trim();

const normalizeHeaderValue = (header = '') =>
  cleanHeaderValue(header).toLowerCase().replace(/\s+/g, ' ');

const getRowValue = (row, keys) => {
  for (const key of keys) {
    const exactKey = Object.keys(row).find(
      (rowKey) => normalizeHeaderValue(rowKey) === normalizeHeaderValue(key),
    );
    if (exactKey && row[exactKey] !== undefined) return row[exactKey];
  }

  for (const key of keys) {
    const partialKey = Object.keys(row).find((rowKey) =>
      normalizeHeaderValue(rowKey).includes(normalizeHeaderValue(key)),
    );
    if (partialKey && row[partialKey] !== undefined) return row[partialKey];
  }

  return null;
};

const buildRowObject = (rowData, headers) => {
  const row = {};
  headers.forEach((header, index) => {
    const cleanHeader = cleanHeaderValue(header);
    if (cleanHeader) row[cleanHeader] = rowData[index];
  });
  return row;
};

const isPanamaCourseSheet = (sheetName, rawData, courseType) => {
  const normalizedCourse = normalizeHeaderValue(courseType);
  if (!normalizedCourse) return true;

  const searchText = [
    sheetName,
    ...rawData
      .slice(0, 6)
      .flat()
      .map((cell) => String(cell || '')),
  ]
    .join(' ')
    .toLowerCase();

  return searchText.includes(normalizedCourse);
};

const findPanamaHeaderRow = (rawData) => {
  for (let i = 0; i < Math.min(rawData.length, 20); i++) {
    const row = rawData[i] || [];
    const normalizedHeaders = row.map(normalizeHeaderValue);
    const headerSet = new Set(normalizedHeaders);

    const hasUmipLayout =
      headerSet.has('no.') &&
      headerSet.has('name, last name') &&
      headerSet.has('genre') &&
      headerSet.has('id') &&
      (headerSet.has('cellphone') || headerSet.has('e-mail')) &&
      headerSet.has('gpa');

    const hasColumbusLayout =
      headerSet.has('no.') &&
      headerSet.has('id') &&
      headerSet.has('last name') &&
      headerSet.has('name') &&
      headerSet.has('gpa') &&
      (headerSet.has('cest') || headerSet.has('english t'));

    if (hasUmipLayout || hasColumbusLayout) {
      return {
        rowIndex: i,
        headers: row,
        layout: hasUmipLayout ? 'umip' : 'columbus',
      };
    }
  }

  return null;
};

const normalizePanamaGender = (value) => {
  if (!value) return null;
  const lower = String(value).trim().toLowerCase();
  if (lower === 'male' || lower === 'm') return 'Male';
  if (lower === 'female' || lower === 'f') return 'Female';
  return value;
};

const joinNameParts = (...parts) =>
  parts
    .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' ')
    .trim();

const mapPanamaRowToCadetData = (rowData, headers, submission, layout) => {
  const row = buildRowObject(rowData, headers);
  const firstName = getRowValue(row, ['Name']);
  const lastName = getRowValue(row, ['Last Name']);
  const fullName =
    layout === 'columbus'
      ? joinNameParts(firstName, lastName)
      : getRowValue(row, ['Name, Last Name', 'Name']);
  const comments = getRowValue(row, ['Comentarios', 'Comments', 'Remarks']);

  const cadetData = {
    institute_id: submission.institute_id,
    submission_id: submission.id,
    batch_year: submission.batch_year,
    status: 'Uploaded',
    workflow_phase: 'uploaded',
    workflow_result: 'pending',
    course: submission.course_type || 'General',
    roll_no: getRowValue(row, ['No.', 'No']),
    name_as_in_indos_cert: fullName,
    gender: normalizePanamaGender(getRowValue(row, ['Genre', 'Gender'])),
    national_id_number: getRowValue(row, ['ID']),
    nationality: getRowValue(row, ['Status']),
    contact_number: sanitizePhoneValue(getRowValue(row, ['Cellphone', 'Phone', 'Mobile'])),
    email_id: getRowValue(row, ['E-mail', 'Email']),
    age_when_passing_out: getRowValue(row, ['AGE', 'Age']),
    imu_avg_all_semester_percentage: getRowValue(row, ['GPA']),
    bmi: getRowValue(row, ['BMI']),
    weight_in_kgs: getRowValue(row, ['WEIGHT', 'Weight']),
    height_in_cms: getRowValue(row, ['HEIGHT', 'Height']),
    any_extra_curricular_achievement: comments,
  };

  const assessmentData = {
    ces_test: getRowValue(row, ['CES TEST', 'CEST']),
    english_test: getRowValue(row, ['ENGLISH T', 'ENGLISH']),
    remarks: comments,
    status: null,
  };

  return { cadetData, assessmentData };
};

const getPanamaRowValidationMessage = (cadetData, rowNumber) => {
  if (!cadetData.name_as_in_indos_cert) {
    return `Row ${rowNumber}: Cadet name is required.`;
  }

  const phoneValidationMessage = getPhoneValidationMessage(
    cadetData.contact_number,
    'Cellphone',
  );
  if (phoneValidationMessage) return `Row ${rowNumber}: ${phoneValidationMessage}`;

  const emailValidationMessage = getEmailValidationMessage(cadetData.email_id);
  if (emailValidationMessage) return `Row ${rowNumber}: ${emailValidationMessage}`;

  return '';
};

const parsePanamaWorkbookRows = (buffer, courseType, submission) => {
  const matchingSheets = parseExcelWorkbook(buffer).filter(({ sheetName, rawData }) =>
    isPanamaCourseSheet(sheetName, rawData, courseType),
  );

  if (matchingSheets.length === 0) {
    throw new Error(`No Panama ${courseType || ''} sheet found in the workbook.`.trim());
  }

  const parsedRows = [];
  const recognizedSheetNames = [];

  for (const sheet of matchingSheets) {
    const headerInfo = findPanamaHeaderRow(sheet.rawData);
    if (!headerInfo) continue;

    recognizedSheetNames.push(sheet.sheetName);
    for (let i = headerInfo.rowIndex + 1; i < sheet.rawData.length; i++) {
      const rowData = sheet.rawData[i];
      if (isRowEmpty(rowData)) continue;

      const parsed = mapPanamaRowToCadetData(
        rowData,
        headerInfo.headers,
        submission,
        headerInfo.layout,
      );
      const validationMessage = getPanamaRowValidationMessage(parsed.cadetData, i + 1);
      if (validationMessage) {
        throw new Error(`${sheet.sheetName}: ${validationMessage}`);
      }
      parsedRows.push(parsed);
    }
  }

  if (recognizedSheetNames.length === 0) {
    throw new Error(
      `No recognizable Panama ${courseType || ''} sheet headers found in the workbook.`.trim(),
    );
  }

  if (parsedRows.length === 0) {
    throw new Error(
      `No cadet rows found in the matching Panama ${courseType || ''} sheet(s).`.trim(),
    );
  }

  return { rows: parsedRows, sheetNames: recognizedSheetNames };
};

const validateExcelPhoneFields = (rawData, headers, startRowIndex) => {
  for (let i = startRowIndex; i < rawData.length; i++) {
    const rowData = rawData[i];
    if (isRowEmpty(rowData)) continue;

    for (let index = 0; index < headers.length; index++) {
      const header = headers[index];
      if (!isPhoneHeader(header)) continue;

      const fieldName = getPhoneFieldName(header);
      const message = getPhoneValidationMessage(rowData[index], fieldName);
      if (message) return message;
    }
  }

  return '';
};

const validateExcelGenderFields = (rawData, headers, startRowIndex) => {
  const genderKeywords = ['gender', 'sex'];
  const genderColIndex = headers.findIndex((h) => {
    if (!h) return false;
    const hStr = String(h).toLowerCase().trim();
    return genderKeywords.some((kw) => hStr === kw || hStr.includes(kw));
  });

  if (genderColIndex === -1) {
    return 'Gender / Sex column is missing from the Excel file.';
  }

  for (let i = startRowIndex; i < rawData.length; i++) {
    const rowData = rawData[i];
    if (isRowEmpty(rowData)) continue;

    const value = rowData[genderColIndex];
    if (value === undefined || value === null || String(value).trim() === '') {
      return `Row ${i + 1}: Gender is a mandatory field and cannot be empty.`;
    }
    const valLower = String(value).trim().toLowerCase();
    if (valLower !== 'male' && valLower !== 'female') {
      return `Row ${i + 1}: Gender must be either "Male" or "Female" (found: "${value}").`;
    }
  }

  return '';
};

const mapRowToCadetData = (rowData, headers, submission) => {
  const row = buildRowObject(rowData, headers);
  const getValue = (keys) => getRowValue(row, keys);

  return {
    institute_id: submission.institute_id,
    submission_id: submission.id,
    batch_year: submission.batch_year,
    status: 'Uploaded',
    workflow_phase: 'uploaded',
    workflow_result: 'pending',
    roll_no: getValue(['Roll No', 'Roll Number', 'Cadet Roll No']),

    // Core mapped fields based on user exact excel layout
    course: getValue(['Deck/ Engine', 'Course', 'Stream']) || 'General',
    name_as_in_indos_cert: getValue(['Name as in INDOS', 'Name', 'Cadet Name']),
    gender: (() => {
      const gVal = getValue(['Gender', 'Sex']);
      if (!gVal) return null;
      const lower = String(gVal).trim().toLowerCase();
      if (lower === 'male') return 'Male';
      if (lower === 'female') return 'Female';
      return gVal;
    })(),
    home_town_or_nearby_airport: getValue([
      'Home town or nearby Airport',
      'Hometown',
      'Home town',
    ]),
    passing_out_date: formatYear(getValue(['Passing Out Date', 'Passing Out'])),
    date_of_birth: formatDate(getValue(['Date of Birth', 'DOB', 'Birth Date'])),
    age_when_passing_out: getValue(['Age when Passing Out', 'Age']),
    contact_number: sanitizePhoneValue(getValue(['Contact Number', 'Phone', 'Mobile'])),
    email_id: getValue(['Email ID', 'Email']),
    batch_rank_out_of_72_cadets: getValue([
      'BATCH RANK OUT OF 72 CADETS',
      'Batch Rank',
    ]),
    no_of_arrears: getValue(['N0 OF ARREARS', 'No of Arrears', 'Arrears']),

    // 10th standard
    tenth_std_board: getValue(['10th Std Board', '10th Board']),
    tenth_std_pass_out_year: getValue(['10th Std Pass out Year', '10th Year']),
    tenth_avg_percentage: getValue([
      '10th Avg %',
      '10th Percentage',
      '10th %',
      '10th Avg',
    ]),
    tenth_std_maths: getValue(['10th Std Maths', '10th Maths']),
    tenth_std_science: getValue(['10th Std Science', '10th Science']),
    tenth_std_english: getValue(['10th Std English', '10th English']),

    // 12th standard
    twelfth_std_board: getValue(['12th Std Board', '12th Board']),
    twelfth_std_pass_out_year: getValue([
      '12th Std pass out year',
      '12th pass out year',
      '12th pass year',
    ]),
    twelfth_pcm_avg_percentage: getValue([
      '12th PCM Avg %',
      '12th PCM',
      '12th Percentage',
      '12th %',
    ]),
    twelfth_std_english: getValue(['12th Std English', '12th English']),
    twelfth_std_physics: getValue(['12th Std Physics', '12th Physics']),
    twelfth_std_chemistry: getValue(['12th Std Chemistry', '12th Chemistry']),
    twelfth_std_maths: getValue(['12th Std Maths', '12th Maths']),

    // IMU
    imu_rank: getValue(['IMU Rank', 'IMU Rank =<3000']),
    imu_avg_all_semester_percentage: getValue([
      'IMU Avg All Semester',
      'IMU Avg All Semester %',
      'IMU Avg All Semester Percentage',
      'IMU Avg',
    ]),
    imu_sem_1_percentage: getValue(['IMU Sem 1']),
    imu_sem_2_percentage: getValue(['IMU Sem 2']),
    imu_sem_3_percentage: getValue(['IMU Sem 3']),
    imu_sem_4_percentage: getValue(['IMU Sem 4']),
    imu_sem_5_percentage: getValue(['IMU Sem 5']),
    imu_sem_6_percentage: getValue(['IMU Sem 6']),
    imu_sem_7_percentage: getValue(['IMU Sem 7']),
    imu_sem_8_percentage: getValue(['IMU Sem 8']),

    // Physical & Extracurricular
    weight_in_kgs: getValue(['Weight in KGs', 'Weight']),
    height_in_cms: getValue(['Height in CMs', 'Height']),
    bmi: getValue(['BMI']),
    any_extra_curricular_achievement: getValue([
      'Any Extra Curricular achievement',
      'Extra Curricular',
      'Achievements',
    ]),
  };
};

// Check if a row is effectively empty (all cells are empty/null/whitespace)
const isRowEmpty = (rowData) => {
  if (!rowData || rowData.length === 0) return true;
  return rowData.every((cell) => {
    if (cell === null || cell === undefined) return true;
    if (typeof cell === 'string' && cell.trim() === '') return true;
    if (cell === '') return true;
    return false;
  });
};

module.exports = {
  parseExcelFile,
  parseExcelWorkbook,
  findHeaderRow,
  parsePanamaWorkbookRows,
  mapRowToCadetData,
  formatDate,
  isRowEmpty,
  validateExcelPhoneFields,
  validateExcelGenderFields,
};
