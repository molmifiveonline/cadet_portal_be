-- Migration: 001_create_recruitment_drives.sql
-- Create the recruitment_drives table and modify cadets table

CREATE TABLE recruitment_drives (
  id            VARCHAR(36) PRIMARY KEY,
  drive_name    VARCHAR(255) NOT NULL,
  institute_id  VARCHAR(36) NOT NULL,
  course_type   ENUM('Deck','Engine') NOT NULL,
  intake_capacity INT DEFAULT 0,
  eligibility_criteria TEXT,
  status        ENUM('Draft','Active','Completed','Cancelled') DEFAULT 'Draft',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (institute_id) REFERENCES institutes(id)
);

-- Link cadets to drives
ALTER TABLE cadets ADD COLUMN drive_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE cadets ADD CONSTRAINT fk_cadet_drive
  FOREIGN KEY (drive_id) REFERENCES recruitment_drives(id) ON DELETE SET NULL;