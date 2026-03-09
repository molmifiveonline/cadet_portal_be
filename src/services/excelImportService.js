const xlsx = require('xlsx');

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
  // If it's a string, try parsing it from expected dd-mm-yyyy
  if (typeof value === 'string') {
    value = value.trim();
    const parts = value.split('-');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
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
    const parts = value.split('-');
    if (parts.length === 3) return parseInt(parts[2]); // Extract year if it's dd-mm-yyyy
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

const mapRowToCadetData = (rowData, headers, submission) => {
  const row = {};
  headers.forEach((header, index) => {
    if (header) {
      const headerStr = String(header);
      const cleanHeader = headerStr.replace(/[\r\n]+/g, ' ').trim();
      row[cleanHeader] = rowData[index];
    }
  });

  const getValue = (keys) => {
    for (const key of keys) {
      if (row[key] !== undefined) return row[key];
      const rowKey = Object.keys(row).find(
        (k) =>
          k.toLowerCase() === key.toLowerCase() ||
          k.toLowerCase().includes(key.toLowerCase()),
      );
      if (rowKey) return row[rowKey];
    }
    return null;
  };

  return {
    institute_id: submission.institute_id,
    submission_id: submission.id,
    batch_year: submission.batch_year,
    status: 'active',

    // Core mapped fields based on user exact excel layout
    course: getValue(['Deck/ Engine', 'Course', 'Stream']) || 'General',
    name_as_in_indos_cert: getValue(['Name as in INDOS', 'Name', 'Cadet Name']),
    gender: getValue(['Gender', 'Sex']),
    home_town_or_nearby_airport: getValue([
      'Home town or nearby Airport',
      'Hometown',
      'Home town',
    ]),
    passing_out_date: formatYear(getValue(['Passing Out Date', 'Passing Out'])),
    date_of_birth: formatDate(getValue(['Date of Birth', 'DOB', 'Birth Date'])),
    age_when_passing_out: getValue(['Age when Passing Out', 'Age']),
    contact_number: getValue(['Contact Number', 'Phone', 'Mobile']),
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
  findHeaderRow,
  mapRowToCadetData,
  formatDate,
  isRowEmpty,
};
