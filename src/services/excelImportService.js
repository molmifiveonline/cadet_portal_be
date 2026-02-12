const xlsx = require('xlsx');

const parseExcelFile = (buffer) => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(sheet, { header: 1 });
};

const findHeaderRow = (rawData, keywords, threshold = 2) => {
  for (let i = 0; i < Math.min(rawData.length, 20); i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const matchCount = row.filter(
      (cell) =>
        cell &&
        typeof cell === 'string' &&
        keywords.some((keyword) => cell.toLowerCase().includes(keyword)),
    ).length;

    if (matchCount >= threshold) {
      return { rowIndex: i, headers: row };
    }
  }
  return null;
};

const mapRowToCadetData = (rowData, headers, submission) => {
  const row = {};
  headers.forEach((header, index) => {
    if (header && typeof header === 'string') {
      const cleanHeader = header.replace(/[\r\n]+/g, ' ').trim();
      row[cleanHeader] = rowData[index];
    } else if (header) {
      row[header] = rowData[index];
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
    name: getValue([
      'Name as in INDOS Cert',
      'Name',
      'Applicant Name',
      'Candidate Name',
      'Cadet Name',
    ]),
    email: getValue(['Email ID', 'Email', 'Email Address', 'Student Email']),
    phone: getValue([
      'Contact Number',
      'Phone',
      'Mobile',
      'Mobile No',
      'Contact',
    ]),
    course: getValue(['Course', 'Stream', 'Deck/ Engine']) || 'General',
    batch: getValue(['Batch', 'Batch No', 'Passing Out Date']) || 'Batch 1',

    // New Fields Mapping
    gender: getValue(['Gender', 'Sex']),
    dob: getValue(['Date of Birth', 'DOB', 'Birth Date']),
    indos_number: getValue(['INDoS Number', 'INDoS No', 'Indos']),
    cdc_number: getValue(['CDC Number', 'CDC No', 'CDC']),
    passport_number: getValue(['Passport Number', 'Passport No', 'Passport']),
    tenth_percentage: getValue([
      '10th Avg %',
      '10th %',
      '10th Percentage',
      'X %',
      'SSLC %',
    ]),
    twelfth_percentage: getValue([
      '12th PCM Avg %',
      '12th %',
      '12th Percentage',
      'XII %',
      'HSC %',
    ]),
    pcm_percentage: getValue(['PCM %', 'PCM Percentage']),
    degree_percentage: getValue([
      'Degree %',
      'Degree Percentage',
      'Graduation %',
      'BE/BTech %',
      'IMU Avg All Semester %',
      'IMU Avg',
    ]),
    height: getValue(['Height in CMs', 'Height (cms)', 'Height']),
    weight: getValue(['Weight in KGs', 'Weight (kgs)', 'Weight']),

    // Extended Fields Mapping
    hometown: getValue([
      'Home town or nearby Airport',
      'Home town',
      'Hometown',
      'Airport',
    ]),
    passing_out_date: getValue(['Passing Out Date', 'Passing Out']),
    age_at_passing_out: getValue(['Age when Passing Out', 'Age']),
    batch_rank: getValue(['BATCH RANK OUT OF 72 CADETS', 'Batch Rank']),
    no_of_arrears: getValue(['N0 OF ARREARS', 'No of Arrears', 'Arrears']),

    tenth_board: getValue(['10th Std Board', '10th Board']),
    tenth_year: getValue(['10th Std Pass out Year', '10th Year']),
    tenth_maths: getValue(['10th Std Maths', '10th Maths']),
    tenth_science: getValue(['10th Std Science', '10th Science']),
    tenth_english: getValue(['10th Std English', '10th English']),

    twelfth_board: getValue(['12th Std Board', '12th Board']),
    twelfth_year: getValue(['12th Std pass out year', '12th Year']),
    twelfth_english: getValue(['12th Std English', '12th English']),
    twelfth_physics: getValue(['12th Std Physics', '12th Physics']),
    twelfth_chemistry: getValue(['12th Std Chemistry', '12th Chemistry']),
    twelfth_maths: getValue(['12th Std Maths', '12th Maths']),

    imu_rank: getValue(['IMU Rank', 'IMU Rank =<3000']),
    imu_avg_percentage: getValue(['IMU Avg All Semester %', 'IMU Avg']),
    imu_sem1: getValue(['IMU Sem 1 Percentage']),
    imu_sem2: getValue(['IMU Sem 2 Percentage']),
    imu_sem3: getValue(['IMU Sem 3 Percentage']),
    imu_sem4: getValue(['IMU Sem 4 Percentage']),
    imu_sem5: getValue(['IMU Sem 5 Percentage']),
    imu_sem6: getValue(['IMU Sem 6 Percentage']),
    imu_sem7: getValue(['IMU Sem 7 Percentage']),
    imu_sem8: getValue(['IMU Sem 8 Percentage']),

    bmi: getValue(['BMI<25', 'BMI']),
    extra_curricular: getValue([
      'Any Extra Curricular achievement / participation / projects',
      'Extra Curricular',
      'Achievements',
    ]),

    status: 'active',
  };
};

module.exports = {
  parseExcelFile,
  findHeaderRow,
  mapRowToCadetData,
};
