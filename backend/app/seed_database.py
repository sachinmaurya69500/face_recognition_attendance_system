"""Pratyaksh Database Seeding Script.

Creates all necessary PostgreSQL tables with vector extension and populates
comprehensive, realistic data:
- Academic hierarchy sections
- Admin, Teacher, and Student user accounts with secure hashes
- 15+ Students in Section 1 with complete profiles
- Real 512-D ArcFace biometric embedding extracted from picture.jpeg for DEMO-STUDENT
- Normalized 512-D embeddings for other students
- Teacher course and section assignments
- Complete weekly timetable / schedules (Monday - Friday)
- Past and current attendance sessions with logs (Present / Absent)
- System and user notifications
- Audit logs
"""

import hashlib
import json
import logging
import math
import os
from pathlib import Path
import random
import secrets
import sys

import numpy as np

# Add backend directory to sys.path if running directly
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.database import get_db_connection

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("seed_database")


def password_hash(password: str, salt: str = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120000).hex()
    return f"{salt}${digest}"


def get_demo_face_embedding() -> list[float]:
    """Load pre-extracted embedding from demo_embedding.json or generate a normalized vector."""
    json_path = backend_dir / "demo_embedding.json"
    if json_path.exists():
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) == 512:
                    logger.info("Loaded real 512-D ArcFace embedding from demo_embedding.json")
                    return data
        except Exception as e:
            logger.warning("Could not read demo_embedding.json: %s", e)

    # Fallback to generating a deterministic normalized unit vector
    rng = np.random.RandomState(42)
    vec = rng.randn(512).astype(np.float32)
    vec /= np.linalg.norm(vec)
    return vec.tolist()


def get_demo_face_photo_bytes() -> bytes | None:
    """Load raw image bytes from picture.jpeg or demo_face.jpg."""
    candidates = [
        backend_dir / "demo_face.jpg",
        backend_dir.parent / "picture.jpeg",
        Path("/workspace/picture.jpeg"),
    ]
    for p in candidates:
        if p.exists():
            try:
                return p.read_bytes()
            except Exception:
                pass
    return None


def generate_unit_embedding(seed_val: int) -> list[float]:
    """Generate deterministic 512-D unit vector."""
    rng = np.random.RandomState(seed_val)
    vec = rng.randn(512).astype(np.float32)
    vec /= np.linalg.norm(vec)
    return vec.tolist()


def seed_database():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            logger.info("Ensuring pgvector extension and core tables exist...")
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")

            # 1. Base tables
            cur.execute("""
            CREATE TABLE IF NOT EXISTS students (
                student_id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(160),
                phone VARCHAR(40),
                date_of_birth DATE,
                program VARCHAR(160),
                semester VARCHAR(80),
                department VARCHAR(160),
                gpa VARCHAR(30),
                enrollment_year VARCHAR(10),
                section_id INTEGER,
                roll_number VARCHAR(50),
                profile_photo BYTEA,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS student_embeddings (
                id SERIAL PRIMARY KEY,
                student_id VARCHAR(50) REFERENCES students(student_id) ON DELETE CASCADE,
                embedding vector(512) NOT NULL,
                CONSTRAINT one_embedding_per_student UNIQUE (student_id)
            );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS embedding_hnsw_idx ON student_embeddings USING hnsw (embedding vector_cosine_ops);")

            cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(80) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role VARCHAR(20) NOT NULL CHECK (role IN ('admin','teacher','student')),
                student_id VARCHAR(50) REFERENCES students(student_id) ON DELETE SET NULL,
                display_name VARCHAR(160),
                email VARCHAR(160),
                phone VARCHAR(40),
                profile_photo BYTEA,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS academic_sections (
                id SERIAL PRIMARY KEY,
                school VARCHAR(160) NOT NULL,
                faculty VARCHAR(160) NOT NULL,
                department VARCHAR(160) NOT NULL,
                program VARCHAR(160) NOT NULL,
                semester VARCHAR(80) NOT NULL,
                section VARCHAR(80) NOT NULL,
                UNIQUE(school, faculty, department, program, semester, section)
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS teacher_assignments (
                id SERIAL PRIMARY KEY,
                teacher_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                section_id INTEGER REFERENCES academic_sections(id) ON DELETE CASCADE,
                subject VARCHAR(160) NOT NULL,
                UNIQUE(teacher_user_id, section_id, subject)
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS schedules (
                id SERIAL PRIMARY KEY,
                subject VARCHAR(120) NOT NULL,
                teacher VARCHAR(120) NOT NULL,
                room VARCHAR(80) NOT NULL,
                starts_at VARCHAR(10) NOT NULL,
                ends_at VARCHAR(10) NOT NULL,
                day VARCHAR(20) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS attendance_sessions (
                session_id VARCHAR(50) PRIMARY KEY,
                teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                title VARCHAR(160) NOT NULL,
                course VARCHAR(160) NOT NULL,
                school VARCHAR(160) NOT NULL,
                faculty VARCHAR(160) NOT NULL,
                department VARCHAR(160) NOT NULL,
                program VARCHAR(160) NOT NULL,
                semester VARCHAR(80) NOT NULL,
                section_id INTEGER REFERENCES academic_sections(id) ON DELETE SET NULL,
                academic_scope JSONB,
                room VARCHAR(80),
                event_date DATE NOT NULL,
                starts_at TIME NOT NULL,
                ends_at TIME NOT NULL,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS attendance_logs (
                id SERIAL PRIMARY KEY,
                student_id VARCHAR(50) REFERENCES students(student_id) ON DELETE CASCADE,
                session_id VARCHAR(50) NOT NULL,
                confidence_score FLOAT NOT NULL,
                teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                recognition_status VARCHAR(20) NOT NULL DEFAULT 'NOT_RECOGNIZED',
                initial_attendance_status VARCHAR(10) NOT NULL DEFAULT 'ABSENT',
                final_attendance_status VARCHAR(10),
                attendance_method VARCHAR(24) NOT NULL DEFAULT 'FACE_RECOGNITION',
                is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
                updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT one_attendance_per_session UNIQUE (student_id, session_id)
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                category VARCHAR(30) NOT NULL,
                title VARCHAR(160) NOT NULL,
                body TEXT NOT NULL,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                action VARCHAR(80) NOT NULL,
                entity VARCHAR(80) NOT NULL,
                entity_id VARCHAR(120),
                previous_value JSONB,
                new_value JSONB,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
            """)

            # 2. Seed Academic Sections if empty
            cur.execute("SELECT COUNT(*) AS count FROM academic_sections;")
            sec_count = cur.fetchone()["count"]
            if sec_count == 0:
                logger.info("Seeding academic catalogue sections...")
                catalog = [
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Computer Sciences", "B.Sc. Information Technology (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Computer Sciences", "Bachelor of Computer Application (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Computer Sciences", "Master of Computer Application (Data Science)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Computer Sciences", "Ph. D. Computer Science"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Mathematics", "B.Sc. Mathematics (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Tourism Management", "B.B.A Tourism & Travel Management (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Communication", "Department of Journalism & Mass Communication", "B.A. Journalism and Mass Communication (Honors)"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of English", "B.A. English (Honors)"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of Education", "B.Ed. (Bachelor of Education)"),
                    ("School of Indology", "Faculty of Yoga & Health", "Department of Yoga and Alternative Therapy", "B.Sc. Yogic Science (Honors)"),
                ]
                rows = [
                    (s, f, d, p, f"Semester {sem}", sec)
                    for s, f, d, p in catalog
                    for sem in range(1, 9)
                    for sec in ["Section A", "Section B"]
                ]
                cur.executemany(
                    "INSERT INTO academic_sections (school,faculty,department,program,semester,section) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING;",
                    rows,
                )
                logger.info("Inserted academic sections.")

            # 3. Seed Admin and Faculty Users
            logger.info("Seeding system users (Admin and Faculty)...")
            faculty_users = [
                ("admin", "admin123", "admin", "System Administrator", "admin@university.edu", "+91 90000 00001"),
                ("demo.teacher", "DemoTeacher123!", "teacher", "Prof. Vikram Malhotra", "demo.teacher@university.edu", "+91 98765 43210"),
                ("teacher", "teacher123", "teacher", "Dr. A. K. Sharma", "sharma.ak@university.edu", "+91 98111 22334"),
                ("prof.verma", "Verma123!", "teacher", "Prof. Neha Verma", "verma.neha@university.edu", "+91 98222 33445"),
                ("dr.ranjan", "Ranjan123!", "teacher", "Dr. Rajiv Ranjan", "ranjan.rajiv@university.edu", "+91 98333 44556"),
            ]
            for uname, pwd, role, dname, email, phone in faculty_users:
                cur.execute(
                    """
                    INSERT INTO users (username, password_hash, role, display_name, email, phone)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (username) DO UPDATE
                    SET display_name=EXCLUDED.display_name, email=EXCLUDED.email, phone=EXCLUDED.phone;
                    """,
                    (uname, password_hash(pwd), role, dname, email, phone),
                )

            # Get user IDs for teachers
            cur.execute("SELECT id, username FROM users WHERE username IN ('demo.teacher', 'teacher', 'prof.verma', 'dr.ranjan');")
            teacher_map = {r["username"]: r["id"] for r in cur.fetchall()}
            demo_teacher_id = teacher_map.get("demo.teacher")

            # 4. Seed Teacher Assignments
            logger.info("Seeding teacher assignments...")
            assignments = [
                (demo_teacher_id, 1, "Computer Networks & Distributed Systems"),
                (teacher_map.get("teacher"), 1, "Data Structures & Algorithms"),
                (teacher_map.get("prof.verma"), 1, "Artificial Intelligence & Machine Learning"),
                (teacher_map.get("dr.ranjan"), 1, "Database Management Systems"),
                (demo_teacher_id, 2, "Operating Systems Architecture"),
                (teacher_map.get("prof.verma"), 2, "Cloud Computing Infrastructure"),
            ]
            for tid, sec_id, subj in assignments:
                if tid and sec_id:
                    cur.execute(
                        """
                        INSERT INTO teacher_assignments (teacher_user_id, section_id, subject)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (teacher_user_id, section_id, subject) DO NOTHING;
                        """,
                        (tid, sec_id, subj),
                    )

            # 5. Seed Students (Cohort for Section 1 and Section 2)
            logger.info("Seeding students roster with profiles...")
            photo_bytes = get_demo_face_photo_bytes()
            demo_embedding = get_demo_face_embedding()

            students_data = [
                ("DEMO-STUDENT", "Demo Scholar", "demo.student@university.edu", "+91 98980 12345", "2000-01-01", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.85", "2024", 1, "24CS001", photo_bytes, demo_embedding),
                ("STU-2024-002", "Aarav Sharma", "aarav.sharma@university.edu", "+91 98123 45671", "2003-04-12", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.92", "2024", 1, "24CS002", None, generate_unit_embedding(102)),
                ("STU-2024-003", "Priya Patel", "priya.patel@university.edu", "+91 98123 45672", "2003-08-25", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.78", "2024", 1, "24CS003", None, generate_unit_embedding(103)),
                ("STU-2024-004", "Rohan Gupta", "rohan.gupta@university.edu", "+91 98123 45673", "2002-11-15", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.65", "2024", 1, "24CS004", None, generate_unit_embedding(104)),
                ("STU-2024-005", "Ananya Mishra", "ananya.mishra@university.edu", "+91 98123 45674", "2003-02-18", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.88", "2024", 1, "24CS005", None, generate_unit_embedding(105)),
                ("STU-2024-006", "Vikramaditya Singh", "vikram.singh@university.edu", "+91 98123 45675", "2002-09-30", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.70", "2024", 1, "24CS006", None, generate_unit_embedding(106)),
                ("STU-2024-007", "Sneha Reddy", "sneha.reddy@university.edu", "+91 98123 45676", "2003-06-05", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.95", "2024", 1, "24CS007", None, generate_unit_embedding(107)),
                ("STU-2024-008", "Rahul Verma", "rahul.verma@university.edu", "+91 98123 45677", "2002-12-22", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.52", "2024", 1, "24CS008", None, generate_unit_embedding(108)),
                ("STU-2024-009", "Neha Joshi", "neha.joshi@university.edu", "+91 98123 45678", "2003-01-14", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.82", "2024", 1, "24CS009", None, generate_unit_embedding(109)),
                ("STU-2024-010", "Arjun Nair", "arjun.nair@university.edu", "+91 98123 45679", "2002-10-08", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.60", "2024", 1, "24CS010", None, generate_unit_embedding(110)),
                ("STU-2024-011", "Divya Choudhary", "divya.c@university.edu", "+91 98123 45680", "2003-07-19", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.75", "2024", 1, "24CS011", None, generate_unit_embedding(111)),
                ("STU-2024-012", "Siddharth Rao", "siddharth.rao@university.edu", "+91 98123 45681", "2002-05-03", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.89", "2024", 1, "24CS012", None, generate_unit_embedding(112)),
                ("STU-2024-013", "Pooja Malhotra", "pooja.m@university.edu", "+91 98123 45682", "2003-03-27", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.68", "2024", 1, "24CS013", None, generate_unit_embedding(113)),
                ("STU-2024-014", "Karan Kapoor", "karan.k@university.edu", "+91 98123 45683", "2002-08-11", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.58", "2024", 1, "24CS014", None, generate_unit_embedding(114)),
                ("STU-2024-015", "Ishita Sen", "ishita.sen@university.edu", "+91 98123 45684", "2003-09-09", "B.Sc. Information Technology (Honors)", "Semester 1", "Department of Computer Sciences", "3.91", "2024", 1, "24CS015", None, generate_unit_embedding(115)),
                # Section 2 students
                ("STU-2024-016", "Manish Saxena", "manish.s@university.edu", "+91 98123 45685", "2002-06-15", "B.Sc. Information Technology (Honors)", "Semester 2", "Department of Computer Sciences", "3.72", "2024", 2, "24CS016", None, generate_unit_embedding(116)),
                ("STU-2024-017", "Ritu Kulkarni", "ritu.k@university.edu", "+91 98123 45686", "2003-05-20", "B.Sc. Information Technology (Honors)", "Semester 2", "Department of Computer Sciences", "3.84", "2024", 2, "24CS017", None, generate_unit_embedding(117)),
                ("STU-2024-018", "Tanmay Bhat", "tanmay.b@university.edu", "+91 98123 45687", "2002-07-31", "B.Sc. Information Technology (Honors)", "Semester 2", "Department of Computer Sciences", "3.63", "2024", 2, "24CS018", None, generate_unit_embedding(118)),
            ]

            for sid, name, email, phone, dob, prog, sem, dept, gpa, ey, sec_id, roll, photo, emb in students_data:
                # Upsert student
                cur.execute(
                    """
                    INSERT INTO students (student_id, name, email, phone, date_of_birth, program, semester, department, gpa, enrollment_year, section_id, roll_number, profile_photo)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (student_id) DO UPDATE SET
                        name=EXCLUDED.name, email=EXCLUDED.email, phone=EXCLUDED.phone,
                        date_of_birth=EXCLUDED.date_of_birth, program=EXCLUDED.program,
                        semester=EXCLUDED.semester, department=EXCLUDED.department,
                        gpa=EXCLUDED.gpa, section_id=EXCLUDED.section_id,
                        roll_number=EXCLUDED.roll_number,
                        profile_photo=COALESCE(EXCLUDED.profile_photo, students.profile_photo);
                    """,
                    (sid, name, email, phone, dob, prog, sem, dept, gpa, ey, sec_id, roll, photo),
                )

                # Upsert student user account
                cur.execute(
                    """
                    INSERT INTO users (username, password_hash, role, student_id, display_name, email, phone)
                    VALUES (%s, %s, 'student', %s, %s, %s, %s)
                    ON CONFLICT (username) DO UPDATE SET
                        display_name=EXCLUDED.display_name, email=EXCLUDED.email, phone=EXCLUDED.phone;
                    """,
                    (sid, password_hash(str(dob)), sid, name, email, phone),
                )

                # Upsert 512-D embedding
                emb_str = f"[{','.join(f'{x:.6f}' for x in emb)}]"
                cur.execute(
                    """
                    INSERT INTO student_embeddings (student_id, embedding)
                    VALUES (%s, %s::vector(512))
                    ON CONFLICT (student_id) DO UPDATE SET embedding=EXCLUDED.embedding;
                    """,
                    (sid, emb_str),
                )

            logger.info("Successfully seeded %d students and biometric embeddings.", len(students_data))

            # 6. Seed Schedules (Weekly Timetable)
            cur.execute("SELECT COUNT(*) AS count FROM schedules;")
            sched_count = cur.fetchone()["count"]
            if sched_count == 0:
                logger.info("Seeding weekly timetable schedules...")
                schedules_data = [
                    ("Computer Networks & Distributed Systems", "Prof. Vikram Malhotra", "Lab 302", "09:00", "10:30", "Monday"),
                    ("Data Structures & Algorithms", "Dr. A. K. Sharma", "Lecture Hall B", "11:00", "12:30", "Monday"),
                    ("Artificial Intelligence & Machine Learning", "Prof. Neha Verma", "Room 204", "10:00", "11:30", "Tuesday"),
                    ("Database Management Systems", "Dr. Rajiv Ranjan", "Lab 105", "14:00", "15:30", "Tuesday"),
                    ("Computer Networks & Distributed Systems", "Prof. Vikram Malhotra", "Lab 302", "09:00", "10:30", "Wednesday"),
                    ("Operating Systems Architecture", "Dr. A. K. Sharma", "Room 108", "11:30", "13:00", "Wednesday"),
                    ("Cloud Computing Infrastructure", "Prof. Neha Verma", "Room 204", "10:00", "11:30", "Thursday"),
                    ("Software Engineering Practices", "Dr. Rajiv Ranjan", "Lecture Hall A", "14:00", "15:30", "Thursday"),
                    ("Computer Networks & Distributed Systems", "Prof. Vikram Malhotra", "Lab 302", "09:00", "10:30", "Friday"),
                    ("Cyber Security & Cryptography", "Prof. Neha Verma", "Lab 301", "11:00", "12:30", "Friday"),
                ]
                cur.executemany(
                    "INSERT INTO schedules (subject, teacher, room, starts_at, ends_at, day) VALUES (%s,%s,%s,%s,%s,%s);",
                    schedules_data,
                )
                logger.info("Seeded %d schedule entries.", len(schedules_data))

            # 7. Seed Attendance Sessions & Logs
            cur.execute("SELECT COUNT(*) AS count FROM attendance_sessions;")
            session_count = cur.fetchone()["count"]
            if session_count == 0:
                logger.info("Seeding historical attendance sessions and recognition logs...")
                sessions_list = [
                    (
                        "SESS-2026-10-01-CN",
                        demo_teacher_id,
                        "Lecture 10: IP Addressing, Subnetting & CIDR",
                        "Computer Networks & Distributed Systems",
                        "School of Technology, Communication and Management",
                        "Faculty of Technology and Management",
                        "Department of Computer Sciences",
                        "B.Sc. Information Technology (Honors)",
                        "Semester 1",
                        1,
                        "Lab 302",
                        "2026-10-01",
                        "09:00:00",
                        "10:30:00",
                        "Biometric facial recognition session finalized. 14 present, 1 absent.",
                    ),
                    (
                        "SESS-2026-10-03-CN",
                        demo_teacher_id,
                        "Lecture 11: Routing Protocols & Link State Algorithms",
                        "Computer Networks & Distributed Systems",
                        "School of Technology, Communication and Management",
                        "Faculty of Technology and Management",
                        "Department of Computer Sciences",
                        "B.Sc. Information Technology (Honors)",
                        "Semester 1",
                        1,
                        "Lab 302",
                        "2026-10-03",
                        "09:00:00",
                        "10:30:00",
                        "Biometric facial recognition session finalized. 15 present, 0 absent.",
                    ),
                    (
                        "SESS-2026-10-06-CN",
                        demo_teacher_id,
                        "Lecture 12: Distributed Consensus & Paxos Protocol",
                        "Computer Networks & Distributed Systems",
                        "School of Technology, Communication and Management",
                        "Faculty of Technology and Management",
                        "Department of Computer Sciences",
                        "B.Sc. Information Technology (Honors)",
                        "Semester 1",
                        1,
                        "Lab 302",
                        "2026-10-06",
                        "09:00:00",
                        "10:30:00",
                        "Biometric facial recognition session finalized. 13 present, 2 absent.",
                    ),
                    (
                        "SESS-2026-10-08-CN",
                        demo_teacher_id,
                        "Lecture 13: Transport Layer & TCP Congestion Control",
                        "Computer Networks & Distributed Systems",
                        "School of Technology, Communication and Management",
                        "Faculty of Technology and Management",
                        "Department of Computer Sciences",
                        "B.Sc. Information Technology (Honors)",
                        "Semester 1",
                        1,
                        "Lab 302",
                        "2026-10-08",
                        "09:00:00",
                        "10:30:00",
                        "Today's lecture session. 15 students evaluated.",
                    ),
                ]

                for sess in sessions_list:
                    cur.execute(
                        """
                        INSERT INTO attendance_sessions (
                            session_id, teacher_id, title, course, school, faculty,
                            department, program, semester, section_id, room,
                            event_date, starts_at, ends_at, notes
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (session_id) DO NOTHING;
                        """,
                        sess,
                    )

                # Seed attendance logs for all Section 1 students in each session
                section1_students = [s[0] for s in students_data if s[10] == 1]
                absent_patterns = {
                    "SESS-2026-10-01-CN": {"STU-2024-008"},
                    "SESS-2026-10-03-CN": set(),
                    "SESS-2026-10-06-CN": {"STU-2024-004", "STU-2024-014"},
                    "SESS-2026-10-08-CN": set(),
                }

                for sess_id, absent_set in absent_patterns.items():
                    for sid in section1_students:
                        is_present = sid not in absent_set
                        status = "PRESENT" if is_present else "ABSENT"
                        confidence = round(random.uniform(0.85, 0.94), 4) if is_present else 0.0
                        recog_status = "RECOGNIZED" if is_present else "NOT_RECOGNIZED"
                        cur.execute(
                            """
                            INSERT INTO attendance_logs (
                                student_id, session_id, confidence_score, teacher_id,
                                recognition_status, initial_attendance_status,
                                final_attendance_status, attendance_method
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'FACE_RECOGNITION')
                            ON CONFLICT (student_id, session_id) DO NOTHING;
                            """,
                            (sid, sess_id, confidence, demo_teacher_id, recog_status, status, status),
                        )
                logger.info("Seeded attendance sessions and logs.")

            # 8. Seed Notifications
            cur.execute("SELECT COUNT(*) AS count FROM notifications;")
            notif_count = cur.fetchone()["count"]
            if notif_count == 0:
                logger.info("Seeding initial notifications...")
                # Get demo student user id
                cur.execute("SELECT id FROM users WHERE username='DEMO-STUDENT';")
                stu_user = cur.fetchone()
                stu_uid = stu_user["id"] if stu_user else None

                cur.execute("SELECT id FROM users WHERE username='admin';")
                admin_user = cur.fetchone()
                admin_uid = admin_user["id"] if admin_user else None

                notifications_data = [
                    (stu_uid, "biometric", "Biometrics Activated", "Your face biometrics have been verified and linked to your student ID DEMO-STUDENT.", True),
                    (stu_uid, "attendance", "Attendance Recorded", "You were marked PRESENT in Computer Networks & Distributed Systems (Lecture 13) with 91.2% confidence.", False),
                    (stu_uid, "schedule", "Upcoming Lecture", "Computer Networks & Distributed Systems starts in 30 minutes at Lab 302.", False),
                    (demo_teacher_id, "attendance", "Session Finalized", "Lecture 13 attendance finalized. 15/15 students verified via facial recognition.", False),
                    (demo_teacher_id, "system", "AI Models Ready", "InsightFace (SCRFD + ArcFace 512D) loaded with CUDA execution provider.", True),
                    (admin_uid, "system", "Database Operational", "PostgreSQL 16 with pgvector extension initialized with active biometric indexing.", True),
                ]
                for uid, cat, title, body, is_read in notifications_data:
                    if uid:
                        cur.execute(
                            "INSERT INTO notifications (user_id, category, title, body, is_read) VALUES (%s, %s, %s, %s, %s);",
                            (uid, cat, title, body, is_read),
                        )
                logger.info("Seeded notifications.")

            # 9. Seed Audit Logs
            cur.execute("SELECT COUNT(*) AS count FROM audit_logs;")
            if cur.fetchone()["count"] == 0 and admin_uid:
                cur.execute(
                    """
                    INSERT INTO audit_logs (actor_id, action, entity, entity_id, new_value)
                    VALUES (%s, 'INITIALIZE_SYSTEM', 'database', 'attendance_db', '{"status": "initialized", "version": "2.0.0"}'::jsonb);
                    """,
                    (admin_uid,),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (actor_id, action, entity, entity_id, new_value)
                    VALUES (%s, 'ENROLL_BIOMETRIC', 'student_embeddings', 'DEMO-STUDENT', '{"dimensions": 512, "source": "picture.jpeg"}'::jsonb);
                    """,
                    (admin_uid,),
                )

        conn.commit()
        logger.info("Database schema and complete dataset successfully seeded into PostgreSQL!")
    finally:
        conn.close()


if __name__ == "__main__":
    seed_database()
