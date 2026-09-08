CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS students (
    student_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(160),
    phone VARCHAR(40),
    date_of_birth DATE,
    program VARCHAR(160),
    profile_photo BYTEA,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_embeddings (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(50) REFERENCES students(student_id) ON DELETE CASCADE,
    embedding vector(512) NOT NULL,
    CONSTRAINT one_embedding_per_student UNIQUE (student_id)
);

CREATE INDEX IF NOT EXISTS embedding_hnsw_idx 
ON student_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE UNIQUE INDEX IF NOT EXISTS student_embeddings_student_id_uidx ON student_embeddings(student_id);

CREATE TABLE IF NOT EXISTS attendance_logs (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(50) REFERENCES students(student_id),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    session_id VARCHAR(50) NOT NULL,
    confidence_score FLOAT NOT NULL,
    CONSTRAINT one_attendance_per_session UNIQUE (student_id, session_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_session_student_uidx ON attendance_logs(student_id, session_id);

CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    subject VARCHAR(120) NOT NULL,
    teacher VARCHAR(120) NOT NULL,
    room VARCHAR(80) NOT NULL,
    starts_at VARCHAR(10) NOT NULL,
    ends_at VARCHAR(10) NOT NULL,
    day VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
