ALTER TABLE cadets
-- Personal details (hometown already exists, so we skip place_of_birth)
-- Note: indos_number already exists and should store actual INDOS numbers
ADD COLUMN IF NOT EXISTS nationality VARCHAR(50) NULL DEFAULT 'Indian' AFTER hometown,
ADD COLUMN IF NOT EXISTS eye_color VARCHAR(20) NULL AFTER nationality,
ADD COLUMN IF NOT EXISTS eye_vision VARCHAR(50) NULL AFTER eye_color,
ADD COLUMN IF NOT EXISTS language_known TEXT NULL AFTER eye_vision,

-- Physical measurements (waist is new, height/weight/bmi already exist)
ADD COLUMN IF NOT EXISTS waist_in_cm DECIMAL(5,2) NULL AFTER weight,

-- COVID and medical details
ADD COLUMN IF NOT EXISTS covid_vaccination VARCHAR(50) NULL AFTER bmi,
ADD COLUMN IF NOT EXISTS covid_dose VARCHAR(100) NULL AFTER covid_vaccination,
ADD COLUMN IF NOT EXISTS medical_history TEXT NULL AFTER covid_dose,
ADD COLUMN IF NOT EXISTS family_medical_history TEXT NULL AFTER medical_history,

-- Address (permanent address separate from existing address if any)
ADD COLUMN IF NOT EXISTS permanent_address TEXT NULL AFTER family_medical_history,

-- Post applied for
ADD COLUMN IF NOT EXISTS post_applied_for VARCHAR(100) NULL DEFAULT 'Deck Cadet' AFTER permanent_address,

-- Graduation details (degree_percentage already exists)
ADD COLUMN IF NOT EXISTS graduation_course VARCHAR(100) NULL AFTER degree_percentage,
ADD COLUMN IF NOT EXISTS graduation_university VARCHAR(200) NULL AFTER graduation_course,

-- Family details
ADD COLUMN IF NOT EXISTS father_occupation VARCHAR(100) NULL AFTER graduation_university,
ADD COLUMN IF NOT EXISTS mother_occupation VARCHAR(100) NULL AFTER father_occupation,
ADD COLUMN IF NOT EXISTS sibling_occupation VARCHAR(100) NULL AFTER mother_occupation,

-- Marine and loan details
ADD COLUMN IF NOT EXISTS marine_relative TEXT NULL AFTER sibling_occupation,
ADD COLUMN IF NOT EXISTS educational_loan TEXT NULL AFTER marine_relative,

-- STCW courses (stored as JSON)
ADD COLUMN IF NOT EXISTS stcw_courses JSON NULL AFTER educational_loan,

-- CV form completion tracking
-- Note: Using existing imu_avg_percentage field instead of cgpa_till_last_semester
ADD COLUMN IF NOT EXISTS cv_form_status ENUM('pending', 'partial', 'complete') DEFAULT 'pending' AFTER stcw_courses,
ADD COLUMN IF NOT EXISTS cv_form_completed_at TIMESTAMP NULL AFTER cv_form_status,

-- Photo path
ADD COLUMN IF NOT EXISTS photo_path VARCHAR(255) NULL AFTER cv_form_completed_at;

-- ===========================================================
-- Create indexes for performance
-- ===========================================================

CREATE INDEX IF NOT EXISTS idx_cv_form_status ON cadets(cv_form_status);
