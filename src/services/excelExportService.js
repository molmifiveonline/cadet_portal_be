const ExcelJS = require('exceljs');

/**
 * Generate an Excel file with cadet data
 * @param {Array} cadets - Array of cadet objects
 * @param {Object} instituteInfo - Institute information (optional)
 * @returns {Buffer} - Excel file buffer
 */
const generateCadetsExcel = async (cadets, instituteInfo = null) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Shortlisted Cadets');

  // Set page setup
  worksheet.pageSetup.orientation = 'landscape';
  worksheet.pageSetup.fitToPage = true;

  // Add header if institute info is provided
  let startRow = 1;
  if (instituteInfo) {
    worksheet.mergeCells('A1:F1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Shortlisted Cadets - ${instituteInfo.institute_name}`;
    titleCell.font = { size: 16, bold: true, color: { argb: 'FF1F4788' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 30;

    worksheet.mergeCells('A2:F2');
    const subtitleCell = worksheet.getCell('A2');
    subtitleCell.value = `Total Shortlisted: ${cadets.length} candidates`;
    subtitleCell.font = { size: 12, color: { argb: 'FF666666' } };
    subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(2).height = 20;

    startRow = 4;
  }

  // Define columns
  worksheet.columns = [
    { header: 'Sr. No', key: 'sr_no', width: 8 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Gender', key: 'gender', width: 10 },
    { header: 'DOB', key: 'dob', width: 12 },
    { header: 'Blood Group', key: 'blood_group', width: 12 },
    { header: 'Height (cm)', key: 'height', width: 12 },
    { header: 'Weight (kg)', key: 'weight', width: 12 },
    { header: 'BMI', key: 'bmi', width: 10 },
    { header: 'Hometown', key: 'hometown', width: 20 },
    { header: 'Course', key: 'course', width: 15 },
    { header: 'Batch', key: 'batch', width: 15 },
    { header: 'Batch Rank', key: 'batch_rank', width: 12 },
    { header: 'INDoS Number', key: 'indos_number', width: 15 },
    { header: 'CDC Number', key: 'cdc_number', width: 15 },
    { header: 'Passport Number', key: 'passport_number', width: 18 },
    { header: '10th Board', key: 'tenth_board', width: 15 },
    { header: '10th Year', key: 'tenth_year', width: 10 },
    { header: '10th %', key: 'tenth_percentage', width: 10 },
    { header: '10th Maths', key: 'tenth_maths', width: 12 },
    { header: '10th Science', key: 'tenth_science', width: 12 },
    { header: '10th English', key: 'tenth_english', width: 12 },
    { header: '12th Board', key: 'twelfth_board', width: 15 },
    { header: '12th Year', key: 'twelfth_year', width: 10 },
    { header: '12th %', key: 'twelfth_percentage', width: 10 },
    { header: '12th English', key: 'twelfth_english', width: 12 },
    { header: '12th Physics', key: 'twelfth_physics', width: 12 },
    { header: '12th Chemistry', key: 'twelfth_chemistry', width: 12 },
    { header: '12th Maths', key: 'twelfth_maths', width: 12 },
    { header: 'PCM %', key: 'pcm_percentage', width: 10 },
    { header: 'Degree %', key: 'degree_percentage', width: 12 },
    { header: 'Arrears', key: 'no_of_arrears', width: 10 },
    { header: 'IMU Rank', key: 'imu_rank', width: 12 },
    { header: 'IMU Avg %', key: 'imu_avg_percentage', width: 12 },
    { header: 'Sem 1', key: 'imu_sem1', width: 10 },
    { header: 'Sem 2', key: 'imu_sem2', width: 10 },
    { header: 'Sem 3', key: 'imu_sem3', width: 10 },
    { header: 'Sem 4', key: 'imu_sem4', width: 10 },
    { header: 'Sem 5', key: 'imu_sem5', width: 10 },
    { header: 'Sem 6', key: 'imu_sem6', width: 10 },
    { header: 'Sem 7', key: 'imu_sem7', width: 10 },
    { header: 'Sem 8', key: 'imu_sem8', width: 10 },
    { header: 'Passing Out Date', key: 'passing_out_date', width: 15 },
    { header: 'Age at Passing', key: 'age_at_passing_out', width: 15 },
    { header: 'Extra Curricular', key: 'extra_curricular', width: 30 },
  ];

  // Move header row if institute info was added
  if (startRow > 1) {
    const headerRow = worksheet.getRow(startRow);
    worksheet.columns.forEach((column, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = column.header;
    });
  }

  // Style header row
  const headerRowIndex = startRow;
  const headerRow = worksheet.getRow(headerRowIndex);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4788' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add data rows
  cadets.forEach((cadet, index) => {
    const row = worksheet.addRow({
      sr_no: index + 1,
      name: cadet.name || '',
      email: cadet.email || '',
      phone: cadet.phone || '',
      gender: cadet.gender || '',
      dob: cadet.dob ? new Date(cadet.dob).toLocaleDateString() : '',
      blood_group: cadet.blood_group || '',
      height: cadet.height || '',
      weight: cadet.weight || '',
      bmi: cadet.bmi || '',
      hometown: cadet.hometown || '',
      course: cadet.course || '',
      batch: cadet.batch || '',
      batch_rank: cadet.batch_rank || '',
      indos_number: cadet.indos_number || '',
      cdc_number: cadet.cdc_number || '',
      passport_number: cadet.passport_number || '',
      tenth_board: cadet.tenth_board || '',
      tenth_year: cadet.tenth_year || '',
      tenth_percentage: cadet.tenth_percentage || '',
      tenth_maths: cadet.tenth_maths || '',
      tenth_science: cadet.tenth_science || '',
      tenth_english: cadet.tenth_english || '',
      twelfth_board: cadet.twelfth_board || '',
      twelfth_year: cadet.twelfth_year || '',
      twelfth_percentage: cadet.twelfth_percentage || '',
      twelfth_english: cadet.twelfth_english || '',
      twelfth_physics: cadet.twelfth_physics || '',
      twelfth_chemistry: cadet.twelfth_chemistry || '',
      twelfth_maths: cadet.twelfth_maths || '',
      pcm_percentage: cadet.pcm_percentage || '',
      degree_percentage: cadet.degree_percentage || '',
      no_of_arrears: cadet.no_of_arrears || '',
      imu_rank: cadet.imu_rank || '',
      imu_avg_percentage: cadet.imu_avg_percentage || '',
      imu_sem1: cadet.imu_sem1 || '',
      imu_sem2: cadet.imu_sem2 || '',
      imu_sem3: cadet.imu_sem3 || '',
      imu_sem4: cadet.imu_sem4 || '',
      imu_sem5: cadet.imu_sem5 || '',
      imu_sem6: cadet.imu_sem6 || '',
      imu_sem7: cadet.imu_sem7 || '',
      imu_sem8: cadet.imu_sem8 || '',
      passing_out_date: cadet.passing_out_date
        ? new Date(cadet.passing_out_date).toLocaleDateString()
        : '',
      age_at_passing_out: cadet.age_at_passing_out || '',
      extra_curricular: cadet.extra_curricular || '',
    });

    // Alternate row colors
    if (index % 2 === 1) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F5F5' },
      };
    }
  });

  // Add borders to all cells
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      };
    });
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

module.exports = {
  generateCadetsExcel,
};
