// Application Constants

module.exports = {
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'your_jwt_secret_key',
  JWT_EXPIRE: '24h',

  // File Upload Limits
  MAX_FILE_SIZE: {
    EXCEL: 10 * 1024 * 1024, // 10MB
    CV: 5 * 1024 * 1024, // 5MB
    DOCUMENT: 5 * 1024 * 1024, // 5MB
    IMAGE: 2 * 1024 * 1024, // 2MB
  },

  // Allowed File Types
  ALLOWED_FILE_TYPES: {
    EXCEL: ['.xlsx', '.xls', '.csv'],
    CV: ['.pdf', '.doc', '.docx'],
    DOCUMENT: ['.pdf', '.jpg', '.jpeg', '.png'],
    IMAGE: ['.jpg', '.jpeg', '.png', '.gif'],
  },

  // Email
  CV_LINK_EXPIRY_HOURS: 72,
  EMAIL_FROM: process.env.EMAIL_FROM_ADDRESS || 'recruitment@molmi.com',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'MOLMI Recruitment Team',

  // Pagination
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 200,

  // Cadet Stages
  CADET_STAGES: {
    IMPORTED: 'imported',
    CV_PENDING: 'cv_pending',
    CV_SUBMITTED: 'cv_submitted',
    INITIAL_SCREENING: 'initial_screening',
    TEST_SCHEDULED: 'test_scheduled',
    TEST_COMPLETED: 'test_completed',
    INTERVIEW_SCHEDULED: 'interview_scheduled',
    INTERVIEW_COMPLETED: 'interview_completed',
    FINAL_EVALUATION: 'final_evaluation',
    MEDICAL_SCHEDULED: 'medical_scheduled',
    MEDICAL_COMPLETED: 'medical_completed',
    SELECTED: 'selected',
    STANDBY: 'standby',
    REJECTED: 'rejected',
    JOINED: 'joined',
  },

  // Overall Status
  OVERALL_STATUS: {
    ACTIVE: 'active',
    SELECTED: 'selected',
    REJECTED: 'rejected',
    WITHDRAWN: 'withdrawn',
  },

  // Test Types
  TEST_TYPES: {
    CES: 'CES',
    QA: 'QA',
    ENGLISH: 'ENGLISH',
    ESSAY: 'ESSAY',
  },

  // Medical Test Types
  MEDICAL_TEST_TYPES: {
    PRE_SELECTION: 'pre_selection',
    PSYCHOMETRIC: 'psychometric',
    PROFILING: 'profiling',
    PRE_JOINING: 'pre_joining',
  },

  // Document Types
  DOCUMENT_TYPES: {
    INDOS: 'INDOS',
    PASSPORT: 'PASSPORT',
    CDC: 'CDC',
    STCW: 'STCW',
    VISA: 'VISA',
    BANK_ACCOUNT: 'BANK_ACCOUNT',
    VALUE_ADDED_COURSE: 'VALUE_ADDED_COURSE',
    TAR_BOOK: 'TAR_BOOK',
    OTHER: 'OTHER',
  },

  // Scoring
  SCORING: {
    TEST_PASSING_PERCENTAGE: 40,
    INTERVIEW_PASSING_PERCENTAGE: 60,
    FINAL_SELECTION_PERCENTAGE: 65,
  },
};
