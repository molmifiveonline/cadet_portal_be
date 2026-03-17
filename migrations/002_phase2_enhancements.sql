-- Phase 2: Pipeline Enhancement (Assessment → Interview → Medical)

-- Interview Enhancements
ALTER TABLE interviews
  ADD COLUMN interview_sheet_data LONGBLOB,
  ADD COLUMN interview_sheet_name VARCHAR(255),
  ADD COLUMN interview_sheet_mime_type VARCHAR(100),
  ADD COLUMN total_score DECIMAL(10,2);

-- Medical Enhancements
ALTER TABLE cadet_medical_results
  ADD COLUMN medical_time TIME,
  ADD COLUMN medical_center_id VARCHAR(36),
  ADD COLUMN report_data LONGBLOB,
  ADD COLUMN report_name VARCHAR(255),
  ADD COLUMN report_mime_type VARCHAR(100),
  ADD FOREIGN KEY (medical_center_id) REFERENCES medical_centers(id);