-- Phase 5: Recruitment Drive Workflow Alignment

ALTER TABLE recruitment_drives
  MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'Draft';

ALTER TABLE cadets
  ADD COLUMN roll_no VARCHAR(100) NULL,
  ADD COLUMN workflow_phase VARCHAR(50) NOT NULL DEFAULT 'uploaded',
  ADD COLUMN workflow_result VARCHAR(50) NOT NULL DEFAULT 'pending',
  ADD COLUMN rejection_stage VARCHAR(50) NULL,
  ADD COLUMN workflow_updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN shortlisted_at TIMESTAMP NULL,
  ADD COLUMN selected_at TIMESTAMP NULL,
  ADD COLUMN shortlist_email_sent TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS recruitment_communications (
  id VARCHAR(36) PRIMARY KEY,
  drive_id VARCHAR(36) NULL,
  cadet_id VARCHAR(36) NULL,
  institute_id VARCHAR(36) NULL,
  communication_type VARCHAR(100) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  remarks TEXT NULL,
  payload_json JSON NULL,
  send_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  sent_by VARCHAR(36) NULL,
  sent_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (drive_id) REFERENCES recruitment_drives(id) ON DELETE SET NULL,
  FOREIGN KEY (cadet_id) REFERENCES cadets(id) ON DELETE SET NULL,
  FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE SET NULL
);

ALTER TABLE institute_submissions
  ADD COLUMN remarks TEXT NULL,
  ADD COLUMN submission_notified_at TIMESTAMP NULL;

ALTER TABLE assessments
  ADD COLUMN assessment_date DATE NULL,
  ADD COLUMN assessment_time TIME NULL,
  ADD COLUMN invite_remark TEXT NULL,
  ADD COLUMN invite_document_link TEXT NULL;

ALTER TABLE interviews
  ADD COLUMN interview_time TIME NULL,
  ADD COLUMN comments TEXT NULL,
  ADD COLUMN invite_remark TEXT NULL,
  ADD COLUMN invite_document_link TEXT NULL;

ALTER TABLE cadet_medical_results
  ADD COLUMN final_decision VARCHAR(50) NULL,
  ADD COLUMN psychometric_status VARCHAR(50) NULL,
  ADD COLUMN profiling_status VARCHAR(50) NULL,
  ADD COLUMN invite_remark TEXT NULL;

ALTER TABLE cadet_documents
  ADD COLUMN source VARCHAR(50) NOT NULL DEFAULT 'portal',
  ADD COLUMN external_upload_link TEXT NULL,
  ADD COLUMN external_reference VARCHAR(255) NULL,
  ADD COLUMN request_token VARCHAR(100) NULL,
  ADD COLUMN request_expires_at TIMESTAMP NULL,
  ADD COLUMN requested_at TIMESTAMP NULL,
  ADD COLUMN last_reupload_requested_at TIMESTAMP NULL;
