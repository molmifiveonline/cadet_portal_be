-- Phase 3: Vessel Master Enhancement

ALTER TABLE vessels
  ADD COLUMN location VARCHAR(255),
  ADD COLUMN total_seats INT DEFAULT 0,
  ADD COLUMN voyage_ref VARCHAR(100),
  ADD COLUMN reporting_port VARCHAR(255),
  ADD COLUMN joining_date DATE,
  ADD COLUMN communication_details TEXT;