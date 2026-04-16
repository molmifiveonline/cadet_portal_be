-- Phase 6: Backfill workflow fields for existing cadets after 005 schema changes

UPDATE cadets
SET
  workflow_phase = CASE
    WHEN status IN ('Shortlisted', 'Eligible for Assessment') THEN 'shortlisted'
    WHEN status = 'Assessment Passed' THEN 'assessment'
    WHEN status = 'Eligible for Interview' THEN 'interview'
    WHEN status IN ('Interview Selected', 'Eligible for Medical') THEN 'medical'
    WHEN status IN ('Medical Completed', 'Selected', 'CTV Assigned', 'Onboarded') THEN 'selected'
    WHEN status IN ('Rejected', 'Assessment Failed', 'Interview Failed', 'Medical Failed') THEN 'rejected'
    ELSE 'uploaded'
  END,
  workflow_result = CASE
    WHEN status IN ('Rejected', 'Assessment Failed', 'Interview Failed', 'Medical Failed') THEN 'failed'
    WHEN status = 'Assessment Passed' THEN 'passed'
    WHEN status = 'Eligible for Interview' THEN 'queued'
    WHEN status IN ('Interview Selected', 'Eligible for Medical') THEN 'queued'
    WHEN status = 'Medical Completed' THEN 'medical_passed'
    WHEN status = 'CTV Assigned' THEN 'ctv_assigned'
    WHEN status = 'Onboarded' THEN 'onboarded'
    ELSE 'pending'
  END,
  rejection_stage = CASE
    WHEN status = 'Assessment Failed' THEN 'assessment'
    WHEN status = 'Interview Failed' THEN 'interview'
    WHEN status = 'Medical Failed' THEN 'medical'
    ELSE NULL
  END,
  workflow_updated_at = COALESCE(workflow_updated_at, created_at, CURRENT_TIMESTAMP),
  shortlisted_at = CASE
    WHEN status IN ('Shortlisted', 'Eligible for Assessment')
    THEN COALESCE(shortlisted_at, created_at, CURRENT_TIMESTAMP)
    ELSE shortlisted_at
  END,
  selected_at = CASE
    WHEN status IN ('Medical Completed', 'Selected', 'CTV Assigned', 'Onboarded')
    THEN COALESCE(selected_at, created_at, CURRENT_TIMESTAMP)
    ELSE selected_at
  END;
