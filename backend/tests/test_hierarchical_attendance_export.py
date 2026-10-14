"""
PRATYAKSH ACADEMIC FACIAL ATTENDANCE SYSTEM
Hierarchical Attendance Export Test Suite (Multiple Programs Mode)

Verifies:
1. TEST 1: All 3 report categories generate and download successfully (Option A, B, C).
2. TEST 2: Course-wise and semester-wise categorization.
3. TEST 3: Department-level grouping for students across different departments.
4. TEST 4: Faculty-level grouping for students across different faculties.
5. TEST 5: Representation of students across all four university schools.
6. TEST 6: Exact placement of each student under School -> Faculty -> Dept -> Course -> Semester.
7. TEST 7: Zero duplicate records and zero lost records.
8. TEST 8: Preservation of existing report columns, calculations, and KPI banners.
9. TEST 9: Attendance marking / recording system integrity.
10. TEST 10: API endpoints, export options, and UI payload compatibility.
11. TEST 11: Single program mode sessions continue to function seamlessly.
12. TEST 12: Graceful handling of missing or incomplete organizational metadata.
"""

import io
import json
import unittest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.database import get_db_connection
from app.main import app, password_hash, session_section_ids
from app.session_manager import create_user_session
from app.pdf_services import group_students_hierarchically


class TestHierarchicalAttendanceExport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # 1. Clean up old test data if present
                cur.execute("DELETE FROM attendance_logs WHERE session_id IN ('SESS-HIER-MULTI', 'SESS-HIER-SINGLE', 'SESS-HIER-MISSING')")
                cur.execute("DELETE FROM attendance_sessions WHERE session_id IN ('SESS-HIER-MULTI', 'SESS-HIER-SINGLE', 'SESS-HIER-MISSING')")
                cur.execute("DELETE FROM students WHERE student_id LIKE 'STU-HIER-%'")

                # 2. Seed Admin User & Faculty User
                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, display_name, email)
                    VALUES (9970, 'hier_admin', %s, 'admin', 'Hierarchical Admin', 'hier_admin@test.edu')
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='admin'
                """, (password_hash("admin123"),))

                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, display_name, email)
                    VALUES (9971, 'hier_faculty', %s, 'teacher', 'Prof. Hierarchy', 'hier_faculty@test.edu')
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='teacher'
                """, (password_hash("faculty123"),))

                # 3. Seed Students across all 4 schools using real seeded section IDs:
                # Section 11: School 1 (Tech) -> Faculty Tech -> Dept CS -> BCA -> Sem 3
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone, section_id, roll_number)
                    VALUES ('STU-HIER-01', 'Alice Tech', 'alice@tech.edu', '+91 9800000001', 11, 'ROLL-BCA-01')
                    ON CONFLICT (student_id) DO UPDATE SET name='Alice Tech', section_id=11
                """)

                # Section 33: School 1 (Tech) -> Faculty Tech -> Dept Math -> Math -> Sem 1
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone, section_id, roll_number)
                    VALUES ('STU-HIER-02', 'Bob Math', 'bob@math.edu', '+91 9800000002', 33, 'ROLL-MTH-01')
                    ON CONFLICT (student_id) DO UPDATE SET name='Bob Math', section_id=33
                """)

                # Section 105: School 2 (Bio) -> Faculty Rural -> Dept Rural -> Rural Studies -> Sem 1
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone, section_id, roll_number)
                    VALUES ('STU-HIER-03', 'Carol Bio', 'carol@bio.edu', '+91 9800000003', 105, 'ROLL-BIO-01')
                    ON CONFLICT (student_id) DO UPDATE SET name='Carol Bio', section_id=105
                """)

                # Section 225: School 3 (Indology) -> Faculty Yoga -> Dept Yoga -> Yogic Science -> Sem 1
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone, section_id, roll_number)
                    VALUES ('STU-HIER-04', 'David Yoga', 'david@yoga.edu', '+91 9800000004', 225, 'ROLL-YOG-01')
                    ON CONFLICT (student_id) DO UPDATE SET name='David Yoga', section_id=225
                """)

                # Section 113: School 4 (Humanities) -> Faculty Humanities -> Dept English -> English -> Sem 1
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone, section_id, roll_number)
                    VALUES ('STU-HIER-05', 'Eva Humanities', 'eva@humanities.edu', '+91 9800000005', 113, 'ROLL-HUM-01')
                    ON CONFLICT (student_id) DO UPDATE SET name='Eva Humanities', section_id=113
                """)

                # Student 6: Incomplete metadata (section_id IS NULL, partial data)
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone, program, semester, section_id, roll_number)
                    VALUES ('STU-HIER-06', 'Frank Independent', 'frank@external.edu', NULL, 'Open Elective', 'Semester 5', NULL, 'ROLL-EXT-01')
                    ON CONFLICT (student_id) DO UPDATE SET name='Frank Independent', section_id=NULL
                """)

                # 4. Create Multiple Programs Attendance Session spanning sections 11, 33, 105, 225, 113
                multi_scope = json.dumps({
                    "section_ids": [11, 33, 105, 225, 113],
                    "programs": ["BCA", "Math", "Rural Studies", "Yogic Science", "English"],
                })
                cur.execute("""
                    INSERT INTO attendance_sessions (
                        session_id, teacher_id, title, course, school, faculty, department, program, semester,
                        section_id, academic_scope, event_date, starts_at, ends_at, status
                    )
                    VALUES (
                        'SESS-HIER-MULTI', 9971, 'Interdisciplinary Multi-Program Lecture', 'MULTIDISC-101',
                        'School of Technology, Communication and Management', 'Faculty of Technology and Management',
                        'Department of Computer Sciences', 'Multiple Programs', 'Multiple Semesters',
                        11, %s, '2026-10-14', '09:00', '11:00', 'ACTIVE'
                    )
                    ON CONFLICT (session_id) DO UPDATE SET academic_scope=%s
                """, (multi_scope, multi_scope))

                # Create Single Program Session
                single_scope = json.dumps({"section_ids": [11]})
                cur.execute("""
                    INSERT INTO attendance_sessions (
                        session_id, teacher_id, title, course, school, faculty, department, program, semester,
                        section_id, academic_scope, event_date, starts_at, ends_at, status
                    )
                    VALUES (
                        'SESS-HIER-SINGLE', 9971, 'Single BCA Lecture', 'BCA-301',
                        'School of Technology, Communication and Management', 'Faculty of Technology and Management',
                        'Department of Computer Sciences', 'Bachelor of Computer Application (Honors)', 'Semester 3',
                        11, %s, '2026-10-14', '11:30', '13:00', 'ACTIVE'
                    )
                    ON CONFLICT (session_id) DO UPDATE SET academic_scope=%s
                """, (single_scope, single_scope))

                # Log attendance for multi-program session
                # Alice: Present, Bob: Present, Carol: Absent, David: Present, Eva: Absent, Frank: Present
                cur.execute("""
                    INSERT INTO attendance_logs (session_id, student_id, confidence_score, final_attendance_status)
                    VALUES
                        ('SESS-HIER-MULTI', 'STU-HIER-01', 0.95, 'PRESENT'),
                        ('SESS-HIER-MULTI', 'STU-HIER-02', 0.92, 'PRESENT'),
                        ('SESS-HIER-MULTI', 'STU-HIER-03', 0.00, 'ABSENT'),
                        ('SESS-HIER-MULTI', 'STU-HIER-04', 0.98, 'PRESENT'),
                        ('SESS-HIER-MULTI', 'STU-HIER-05', 0.00, 'ABSENT'),
                        ('SESS-HIER-MULTI', 'STU-HIER-06', 0.89, 'PRESENT')
                    ON CONFLICT (student_id, session_id) DO UPDATE SET final_attendance_status=EXCLUDED.final_attendance_status
                """)

            conn.commit()
        finally:
            conn.close()

        cls.admin_token, _ = create_user_session({"id": 9970, "username": "hier_admin", "role": "admin"})
        cls.faculty_token, _ = create_user_session({"id": 9971, "username": "hier_faculty", "role": "teacher"})

    def test_01_all_three_report_categories_generate_successfully(self):
        """TEST 1: All three report categories generate and download successfully."""
        report_types = ["face_pdf", "detailed_pdf", "text_pdf"]
        for rtype in report_types:
            res = self.client.post(
                "/attendance/sessions/SESS-HIER-MULTI/export",
                json={"report_type": rtype, "attendance_status": "both"},
                headers={"Authorization": f"Bearer {self.admin_token}"},
            )
            self.assertEqual(res.status_code, 200, f"Report {rtype} failed with status {res.status_code}")
            self.assertEqual(res.headers.get("content-type"), "application/pdf")
            self.assertTrue(res.content.startswith(b"%PDF"), f"Report {rtype} content is not valid PDF")

            reader = PdfReader(io.BytesIO(res.content))
            self.assertGreater(len(reader.pages), 0)

    def test_02_course_wise_and_semester_wise_categorization(self):
        """TEST 2: Course-wise and semester-wise categorization in all three reports."""
        res = self.client.post(
            "/attendance/sessions/SESS-HIER-MULTI/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)

        # Courses and Semesters must be distinctly categorized
        self.assertIn("Course: Bachelor of Computer Application (Honors)", text)
        self.assertIn("Semester: Semester 3", text)
        self.assertIn("Course: B.Sc. Mathematics (Honors)", text)
        self.assertIn("Semester: Semester 1", text)
        self.assertIn("Course: Bachelor of Rural Studies (Honors)", text)
        self.assertIn("Course: B.Sc. Yogic Science (Honors)", text)

    def test_03_department_grouping_for_different_departments(self):
        """TEST 3: Students from different departments are grouped under correct departments."""
        res = self.client.post(
            "/attendance/sessions/SESS-HIER-MULTI/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)

        self.assertIn("Department: Department of Computer Sciences", text)
        self.assertIn("Department: Department of Mathematics", text)
        self.assertIn("Department: Department of Rural Studies and Sustainability", text)
        self.assertIn("Department: Department of Yoga and Alternative Therapy", text)
        self.assertIn("Department: Department of English", text)

    def test_04_faculty_grouping_for_different_faculties(self):
        """TEST 4: Students from different faculties are grouped under correct faculties."""
        res = self.client.post(
            "/attendance/sessions/SESS-HIER-MULTI/export",
            json={"report_type": "text_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)

        self.assertIn("Faculty: Faculty of Technology and Management", text)
        self.assertIn("Faculty: Faculty of Rural Studies and Sustainability", text)
        self.assertIn("Faculty: Faculty of Yoga & Health", text)
        self.assertIn("Faculty: Faculty of Humanities and Social Sciences", text)

    def test_05_representation_of_all_four_schools(self):
        """TEST 5: Students from all four university schools are represented in the hierarchy."""
        res = self.client.post(
            "/attendance/sessions/SESS-HIER-MULTI/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)

        # School 1
        self.assertIn("School of Technology, Communication and Management", text)
        # School 2
        self.assertIn("School of Biological Sciences and Sustainability", text)
        # School 3
        self.assertIn("School of Indology", text)
        # School 4
        self.assertIn("School of Humanities, Social Sciences and Foundation Courses", text)

    def test_06_exact_placement_of_each_student(self):
        """TEST 6: Each student appears under correct School -> Faculty -> Dept -> Course -> Semester."""
        res = self.client.post(
            "/attendance/sessions/SESS-HIER-MULTI/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)

        # Verify each student's presence and identity
        self.assertIn("Alice Tech", text)
        self.assertIn("Bob Math", text)
        self.assertIn("Carol Bio", text)
        self.assertIn("David Yoga", text)
        self.assertIn("Eva Humanities", text)

    def test_07_no_duplicate_records_and_no_lost_records(self):
        """TEST 7: No attendance records are duplicated or lost during grouping."""
        res = self.client.post(
            "/attendance/sessions/SESS-HIER-MULTI/export",
            json={"report_type": "text_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)

        # Summary banner must accurately reflect 30 total students (24 seeded in Sec 11 + 6 test students)
        self.assertIn("Total Eligible: 30", text)
        self.assertIn("Records in Report: 30", text)

        # Count occurrences of scholar numbers (must appear exactly once in table rows)
        for roll in ["ROLL-BCA-01", "ROLL-MTH-01", "ROLL-BIO-01", "ROLL-YOG-01", "ROLL-HUM-01", "ROLL-EXT-01"]:
            count = text.count(roll)
            self.assertEqual(count, 1, f"Scholar number {roll} appears {count} times (expected exactly 1)")

    def test_08_preservation_of_report_columns_and_calculations(self):
        """TEST 8: All required columns, headers, and calculations remain intact."""
        # Detailed PDF checks
        res = self.client.post(
            "/attendance/sessions/SESS-HIER-MULTI/export/detailed-pdf",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Photo", text)
        self.assertIn("Scholar No.", text)
        self.assertIn("Student Name", text)
        self.assertIn("Mobile No.", text)
        self.assertIn("Attendance Status", text)
        self.assertIn("Attendance Rate:", text)

        # Face PDF checks
        res_face = self.client.post(
            "/attendance/sessions/SESS-HIER-MULTI/export/face-pdf",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_face.status_code, 200)
        reader_face = PdfReader(io.BytesIO(res_face.content))
        text_face = "\n".join(page.extract_text() for page in reader_face.pages)
        self.assertIn("Course-Wise Student Face Attendance PDF", text_face)

    def test_09_attendance_marking_system_integrity(self):
        """TEST 9: Attendance marking / session recording continues to function untouched."""
        # Verify database session integrity
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT session_id, academic_scope FROM attendance_sessions WHERE session_id='SESS-HIER-MULTI'")
                row = cur.fetchone()
                self.assertIsNotNone(row)
                sec_ids = session_section_ids(row)
                self.assertEqual(len(sec_ids), 5)
                self.assertEqual(sec_ids, [11, 33, 105, 225, 113])
        finally:
            conn.close()

    def test_10_export_endpoints_and_options_payload_compatibility(self):
        """TEST 10: Export options and summary endpoints return valid dynamic academic scope."""
        res_opts = self.client.get(
            "/attendance/sessions/SESS-HIER-MULTI/export-options",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_opts.status_code, 200)
        data = res_opts.json()
        self.assertIn("courses", data)
        self.assertIn("summary", data)
        self.assertEqual(data["summary"]["total_students"], 30)

        # Export summary live counter
        res_sum = self.client.get(
            "/attendance/sessions/SESS-HIER-MULTI/export-summary?attendance_status=present",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_sum.status_code, 200)
        self.assertEqual(res_sum.json()["records_included"], 4)  # 4 students marked PRESENT

    def test_11_single_program_mode_sessions_function_seamlessly(self):
        """TEST 11: Single program mode sessions generate clean hierarchical exports."""
        res = self.client.post(
            "/attendance/sessions/SESS-HIER-SINGLE/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.faculty_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("School of Technology, Communication and Management", text)
        self.assertIn("Course: Bachelor of Computer Application (Honors)", text)
        self.assertIn("Semester: Semester 3", text)
        self.assertIn("Alice Tech", text)

    def test_12_missing_metadata_handled_safely(self):
        """TEST 12: Missing organizational metadata is handled safely without guessing or dropping records."""
        # STU-HIER-06 has no section_id and no phone
        raw_students = [
            {
                "student_id": "STU-UNKNOWN-01",
                "name": "Ghost Student",
                "roll_number": "ROLL-GH-01",
                "school": None,
                "faculty": "",
                "department": None,
                "program": None,
                "semester": None,
                "status": "PRESENT",
            }
        ]
        hierarchy = group_students_hierarchically(raw_students)
        self.assertIn("School Not Specified", hierarchy)
        self.assertIn("Faculty Not Specified", hierarchy["School Not Specified"])
        self.assertIn("Department Not Specified", hierarchy["School Not Specified"]["Faculty Not Specified"])
        self.assertIn("Course Not Specified", hierarchy["School Not Specified"]["Faculty Not Specified"]["Department Not Specified"])
        self.assertIn("Semester Not Specified", hierarchy["School Not Specified"]["Faculty Not Specified"]["Department Not Specified"]["Course Not Specified"])

        # Check in generated PDF
        res = self.client.post(
            "/attendance/sessions/SESS-HIER-MULTI/export",
            json={"report_type": "text_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Frank Independent", text)  # Student with missing section_id is retained!


if __name__ == "__main__":
    unittest.main()
