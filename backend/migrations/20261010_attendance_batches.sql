-- Apply once to existing PostgreSQL deployments before deploying the batch API.
-- The application bootstrap repeats these statements safely for fresh installs.
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS attendance_upload_batches (
    id UUID PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL REFERENCES attendance_sessions(session_id) ON DELETE CASCADE,
    submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    section_id INTEGER REFERENCES academic_sections(id) ON DELETE SET NULL,
    program VARCHAR(160) NOT NULL,
    semester VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
    idempotency_key VARCHAR(100),
    total_files INTEGER NOT NULL DEFAULT 0,
    processed_files INTEGER NOT NULL DEFAULT 0,
    recognized_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    unknown_faces INTEGER NOT NULL DEFAULT 0,
    failed_files INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    UNIQUE (session_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS attendance_batch_photos (
    id UUID PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES attendance_upload_batches(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
    faces_detected INTEGER NOT NULL DEFAULT 0,
    recognized_count INTEGER NOT NULL DEFAULT 0,
    unknown_faces INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS attendance_batches_session_created_idx ON attendance_upload_batches(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attendance_batch_photos_batch_idx ON attendance_batch_photos(batch_id);
