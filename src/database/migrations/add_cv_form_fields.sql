-- Migration: Add CV Form Fields to Cadets Table and Create CV Tokens Table
-- Created: 2026-02-13
-- Description: Adds additional fields for CV form data collection and creates cv_tokens table for managing form access
-- NOTE: This migration accounts for existing fields and only adds new ones

-- ===========================================================
-- Create CV Tokens Table
-- ===========================================================

CREATE TABLE IF NOT EXISTS cv_tokens (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  cadet_id VARCHAR(36) NOT NULL,
  institute_id VARCHAR(36) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  status ENUM('active', 'used', 'expired') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP NULL,
  FOREIGN KEY (cadet_id) REFERENCES cadets(id) ON DELETE CASCADE,
  FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE,
  INDEX idx_token (token),
  INDEX idx_status (status),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- Add NEW CV Form Fields to Cadets Table
-- ===========================================================
-- Fields that already exist in the database:
-- passport_number (not passport_no), indos_number, height, weight, bmi
-- tenth_percentage, tenth_maths, tenth_science, tenth_english, tenth_board, tenth_year
-- twelfth_percentage, twelfth_english, twelfth_physics, twelfth_chemistry, twelfth_maths, twelfth_board, twelfth_year
-- pcm_percentage, imu_rank, imu_avg_percentage, imu_sem1-8, blood_group
-- We will only add NEW fields that don't exist yet

ALTER TABLE cadets
-- Additional identification number (since indos_number already exists)
ADD COLUMN IF NOT EXISTS indos_no2 VARCHAR(50) NULL AFTER indos_number,

-- Personal details (hometown already exists, so we skip place_of_birth)
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

-- CGPA (separate from imu_avg_percentage)
ADD COLUMN IF NOT EXISTS cgpa_till_last_semester DECIMAL(4,2) NULL AFTER stcw_courses,

-- CV form completion tracking
ADD COLUMN IF NOT EXISTS cv_form_status ENUM('pending', 'partial', 'complete') DEFAULT 'pending' AFTER cgpa_till_last_semester,
ADD COLUMN IF NOT EXISTS cv_form_completed_at TIMESTAMP NULL AFTER cv_form_status,

-- Photo path
ADD COLUMN IF NOT EXISTS photo_path VARCHAR(255) NULL AFTER cv_form_completed_at;

-- ===========================================================
-- Create indexes for performance
-- ===========================================================

CREATE INDEX IF NOT EXISTS idx_cv_form_status ON cadets(cv_form_status);
CREATE INDEX IF NOT EXISTS idx_indos_no2 ON cadets(indos_no2);
