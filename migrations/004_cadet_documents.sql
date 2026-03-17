-- Phase 4: Cadet Document Management

CREATE TABLE IF NOT EXISTS cadet_documents (
  id              VARCHAR(36) PRIMARY KEY,
  cadet_id        VARCHAR(36) NOT NULL,
  document_name   VARCHAR(255) NOT NULL,
  document_type   VARCHAR(100) NOT NULL,
  document_data   LONGBLOB,
  document_mime_type VARCHAR(100),
  original_filename VARCHAR(255),
  status          ENUM('pending','accepted','rejected','reupload_requested') DEFAULT 'pending',
  admin_remarks   TEXT,
  reviewed_by     VARCHAR(36),
  reviewed_at     TIMESTAMP NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (cadet_id) REFERENCES cadets(id) ON DELETE CASCADE
);
