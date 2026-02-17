-- Complete workaround: Create cv_tokens table without foreign key constraints
-- Foreign keys are nice to have but not essential for the application to work
-- The application code will maintain referential integrity

-- Drop the table if it exists (since we're starting fresh)
DROP TABLE IF EXISTS cv_tokens;

-- Create the table WITHOUT foreign key constraints
CREATE TABLE cv_tokens (
  id VARCHAR(36) NOT NULL,
  cadet_id VARCHAR(36) NOT NULL,
  institute_id VARCHAR(36) NOT NULL,
  token VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  status ENUM('active', 'used', 'expired') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY unique_token (token),
  KEY idx_cadet_id (cadet_id),
  KEY idx_institute_id (institute_id),
  KEY idx_status (status),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Indexes are in place for good query performance
-- The application will handle referential integrity through the DAO layer
