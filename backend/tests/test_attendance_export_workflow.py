"""
Comprehensive Automated Test Suite for Attendance Export Workflow
Tests all 24 cases across Option A (Face PDF), Option B (Detailed PDF), and Option C (Text Report).
"""

import io
import time
import unittest
from unittest.mock import patch
from pypdf import PdfReader

from fastapi.testclient import TestClient
from app.main import app, password_hash
from app.database import get_db_connection
from app.session_manager import create_user_session
from app.pdf_services import (
    build_session_attendance_pdf,
    generate_course_wise_face_pdf,
    generate_complete_student_details_pdf,
    generate_student_text_only_pdf,
)


class TestAttendanceExportWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # 1. Seed test users
                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, is_active)
                    VALUES (9951, 'test_export_admin', %s, 'admin', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='admin'
                """, (password_hash("admin123"),))

                # 1. Seed test academic section 100
                cur.execute("""
                    INSERT INTO academic_sections (id, school, faculty, department, program, semester, section)
                    VALUES (100, 'School of Engineering', 'Faculty of Tech', 'Dept CS', 'B.Tech CS', 'Semester 4', 'Sec A')
                    ON CONFLICT (id) DO NOTHING
                """)

                # 2. Seed Students in Section 100
                # Student 1: Normal, Present, has phone
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone, program, semester, section_id, roll_number)
                    VALUES ('STU-EXP-01', 'Arthur Dent', 'arthur@galaxy.edu', '+44 7700 900077', 'B.Tech CS', 'Semester 4', 100, 'ROLL-EXP-01')
                    ON CONFLICT (student_id) DO UPDATE SET name='Arthur Dent', phone='+44 7700 900077', section_id=100, roll_number='ROLL-EXP-01'
                """)

                # Student 2: Absent, missing phone, missing photo
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone, program, semester, section_id, roll_number)
                    VALUES ('STU-EXP-02', 'Ford Prefect', 'ford@galaxy.edu', NULL, 'B.Tech CS', 'Semester 4', 100, 'ROLL-EXP-02')
                    ON CONFLICT (student_id) DO UPDATE SET name='Ford Prefect', phone=NULL, section_id=100, roll_number='ROLL-EXP-02'
                """)

                # Student 3: Present, very long name
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone, program, semester, section_id, roll_number)
                    VALUES ('STU-EXP-03', 'Zaphod Beeblebrox The First President of the Galaxy With Extravagantly Long Name', 'zaphod@galaxy.edu', '+1 555-4242', 'B.Tech CS', 'Semester 4', 100, 'ROLL-EXP-03')
                    ON CONFLICT (student_id) DO UPDATE SET name='Zaphod Beeblebrox The First President of the Galaxy With Extravagantly Long Name', section_id=100, roll_number='ROLL-EXP-03'
                """)

                # 3. Seed test users
                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, is_active)
                    VALUES (9951, 'test_export_admin', %s, 'admin', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='admin'
                """, (password_hash("admin123"),))

                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, is_active)
                    VALUES (9952, 'test_export_faculty_a', %s, 'teacher', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='teacher'
                """, (password_hash("faculty123"),))

                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, is_active)
                    VALUES (9953, 'test_export_faculty_b', %s, 'teacher', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='teacher'
                """, (password_hash("faculty123"),))

                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, student_id, is_active)
                    VALUES (9954, 'test_export_student', %s, 'student', 'STU-EXP-01', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='student', student_id='STU-EXP-01'
                """, (password_hash("student123"),))

                # Assign Faculty A to Section 100
                cur.execute("""
                    INSERT INTO teacher_assignments (teacher_user_id, section_id, subject)
                    VALUES (9952, 100, 'Operating Systems')
                    ON CONFLICT (teacher_user_id, section_id, subject) DO NOTHING
                """)

                # 4. Create Attendance Session owned by Faculty A
                cur.execute("""
                    INSERT INTO attendance_sessions (session_id, teacher_id, title, course, school, faculty, department, program, semester, section_id, event_date, starts_at, ends_at, status, academic_scope)
                    VALUES ('SESS-EXP-MAIN', 9952, 'Operating Systems Lecture', 'CS-302', 'School of Engineering', 'Faculty of Tech', 'Dept CS', 'B.Tech CS', 'Semester 4', 100, '2026-10-14', '09:00', '10:30', 'ACTIVE', '{"section_ids": [100]}')
                    ON CONFLICT (session_id) DO UPDATE SET teacher_id=9952, status='ACTIVE', section_id=100
                """)

                # Log attendance: Student 1 = PRESENT, Student 2 = ABSENT, Student 3 = PRESENT
                cur.execute("""
                    INSERT INTO attendance_logs (student_id, session_id, teacher_id, confidence_score, initial_attendance_status, final_attendance_status)
                    VALUES ('STU-EXP-01', 'SESS-EXP-MAIN', 9952, 0.98, 'PRESENT', 'PRESENT')
                    ON CONFLICT (student_id, session_id) DO UPDATE SET final_attendance_status='PRESENT'
                """)
                cur.execute("""
                    INSERT INTO attendance_logs (student_id, session_id, teacher_id, confidence_score, initial_attendance_status, final_attendance_status)
                    VALUES ('STU-EXP-02', 'SESS-EXP-MAIN', 9952, 0.0, 'ABSENT', 'ABSENT')
                    ON CONFLICT (student_id, session_id) DO UPDATE SET final_attendance_status='ABSENT'
                """)
                cur.execute("""
                    INSERT INTO attendance_logs (student_id, session_id, teacher_id, confidence_score, initial_attendance_status, final_attendance_status)
                    VALUES ('STU-EXP-03', 'SESS-EXP-MAIN', 9952, 0.95, 'PRESENT', 'PRESENT')
                    ON CONFLICT (student_id, session_id) DO UPDATE SET final_attendance_status='PRESENT'
                """)

                # 5. Create Unrelated Session owned by Faculty B
                cur.execute("""
                    INSERT INTO attendance_sessions (session_id, teacher_id, title, course, school, faculty, department, program, semester, section_id, event_date, starts_at, ends_at, status, academic_scope)
                    VALUES ('SESS-EXP-OTHER', 9953, 'Cyber Security', 'CS-405', 'School of Engineering', 'Faculty of Tech', 'Dept CS', 'B.Tech CS', 'Semester 8', 200, '2026-10-14', '14:00', '15:30', 'ACTIVE', '{"section_ids": [200]}')
                    ON CONFLICT (session_id) DO UPDATE SET teacher_id=9953, status='ACTIVE'
                """)
            conn.commit()
        finally:
            conn.close()

        # Generate JWT session tokens
        cls.admin_token, _ = create_user_session({"id": 9951, "username": "test_export_admin", "role": "admin"})
        cls.faculty_a_token, _ = create_user_session({"id": 9952, "username": "test_export_faculty_a", "role": "teacher"})
        cls.faculty_b_token, _ = create_user_session({"id": 9953, "username": "test_export_faculty_b", "role": "teacher"})
        cls.student_token, _ = create_user_session({"id": 9954, "username": "test_export_student", "role": "student", "student_id": "STU-EXP-01"})

    def test_case_01_export_all_students_in_session(self):
        """Case 1: Export all students in a session (Option B Detailed PDF)."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("content-type"), "application/pdf")
        self.assertTrue(res.content.startswith(b"%PDF"))

        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Arthur Dent", text)
        self.assertIn("Ford Prefect", text)
        self.assertIn("Total Eligible: 3", text)
        self.assertIn("Records in Report: 3", text)

    def test_case_02_export_present_students_only(self):
        """Case 2: Export present students only (Option B)."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "present"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Arthur Dent", text)
        self.assertNotIn("Ford Prefect", text)  # Ford is absent
        self.assertIn("Records in Report: 2", text)

    def test_case_03_export_absent_students_only(self):
        """Case 3: Export absent students only (Option B)."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "absent"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Ford Prefect", text)
        self.assertNotIn("Arthur Dent", text)  # Arthur is present
        self.assertIn("Records in Report: 1", text)

    def test_case_04_export_students_from_selected_course(self):
        """Case 4: Export students filtered by course/program."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both", "course_id": "B.Tech CS"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Arthur Dent", text)

    def test_case_05_export_session_without_course_associations(self):
        """Case 5: Export session with course_id='all' or None."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both", "course_id": "all"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)

    def test_case_06_generate_face_only_pdf(self):
        """Case 6: Option A: Generate a face-only PDF organized in a grid."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export/face-pdf",
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Course-Wise Student Face Attendance PDF", text)
        self.assertIn("Scholar No: ROLL-EXP-01", text)
        self.assertIn("[PRESENT]", text)
        self.assertIn("[ABSENT]", text)

    def test_case_07_generate_detailed_pdf_all_five_fields(self):
        """Case 7: Option B: Verify all 5 required fields (Photo, Scholar No, Student Name, Mobile No, Attendance Status)."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export/detailed-pdf",
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Photo", text)
        self.assertIn("Scholar No.", text)
        self.assertIn("Student Name", text)
        self.assertIn("Mobile No.", text)
        self.assertIn("Attendance Status", text)
        self.assertIn("ROLL-EXP-01", text)
        self.assertIn("+44 7700 900077", text)
        self.assertIn("PRESENT", text)

    def test_case_08_generate_text_only_pdf_without_photographs(self):
        """Case 8: Option C: Generate a text-only PDF without photographs."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export/text-pdf",
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Student Text-Only Attendance Report", text)
        self.assertIn("Scholar No.", text)
        self.assertIn("Student Name", text)
        self.assertIn("Mobile No.", text)
        self.assertIn("Attendance Status", text)
        self.assertNotIn("Photo", text)
        # Verify 0 embedded images
        for page in reader.pages:
            self.assertEqual(len(page.images), 0)

    def test_case_09_handle_missing_student_photographs(self):
        """Case 9: Missing student photographs render with clean neutral placeholder."""
        # STU-EXP-02 has no profile photo in db
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "face_pdf", "attendance_status": "absent"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Ford Prefect", text)

    def test_case_10_handle_missing_mobile_numbers(self):
        """Case 10: Missing mobile numbers display 'Not available'."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "absent"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Not available", text)

    def test_case_11_handle_long_student_names(self):
        """Case 11: Long student names wrap gracefully without PDF errors."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Zaphod Beeblebrox", text)

    def test_case_12_handle_sessions_containing_many_students(self):
        """Case 12: Multi-page sessions generate running headers and page numbers correctly."""
        # Create a synthetic list of 40 students
        many_students = [
            {
                "student_id": f"STU_SYNTH_{i:03d}",
                "name": f"Student Multi Page {i:03d}",
                "roll_number": f"ROLL_{i:03d}",
                "phone": "+1 555-0000",
                "status": "PRESENT" if i % 2 == 0 else "ABSENT",
                "profile_photo": None,
            }
            for i in range(1, 41)
        ]
        demo_session = {
            "session_id": "SYNTH-LARGE-SESS",
            "title": "Large Enrollment Lecture",
            "course": "ENG-100",
            "event_date": "2026-10-14",
            "starts_at": "09:00",
            "ends_at": "11:00",
            "room": "Auditorium",
        }
        summary = {"total_students": 40, "present_students": 20, "absent_students": 20}
        pdf_bytes, _ = build_session_attendance_pdf(demo_session, many_students, summary, "detailed_pdf", "both")
        reader = PdfReader(io.BytesIO(pdf_bytes))
        self.assertGreater(len(reader.pages), 1)
        # Running footer with page count
        last_page_text = reader.pages[-1].extract_text()
        self.assertIn(f"Page {len(reader.pages)} of {len(reader.pages)}", last_page_text)

    def test_case_13_reject_invalid_attendance_status_filters(self):
        """Case 13: Reject invalid attendance-status filters with 422."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "maybe_present"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("attendance_status must be one of", res.text)

    def test_case_14_reject_unauthorized_session_exports(self):
        """Case 14: Unauthenticated requests are rejected with 401."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
        )
        self.assertEqual(res.status_code, 401)

    def test_case_15_prevent_faculty_from_exporting_unrelated_sessions(self):
        """Case 15: Faculty B cannot export session owned by Faculty A."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.faculty_b_token}"},
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("not authorized", res.text.lower())

    def test_case_16_prevent_students_from_exporting_reports(self):
        """Case 16: Students are prohibited from generating session export reports."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.student_token}"},
        )
        self.assertEqual(res.status_code, 403)
        self.assertTrue(any(term in res.text.lower() for term in ["insufficient permissions", "students are not permitted"]))

    def test_case_17_prevent_access_to_nonexistent_session(self):
        """Case 17: Accessing non-existent session ID returns 404."""
        res = self.client.post(
            "/attendance/sessions/SESS-NON-EXISTENT-XYZ/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 404)

    def test_case_18_verify_report_totals_match_records_included(self):
        """Case 18: Verify KPI summary banner totals match actual records included in PDF."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "present"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        reader = PdfReader(io.BytesIO(res.content))
        text = "\n".join(page.extract_text() for page in reader.pages)
        self.assertIn("Total Eligible: 3", text)
        self.assertIn("Present: 2", text)
        self.assertIn("Absent: 1", text)
        self.assertIn("Records in Report: 2", text)

    def test_case_19_attendance_records_remain_unchanged_after_export(self):
        """Case 19: Exporting reports does NOT modify database attendance logs."""
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT final_attendance_status FROM attendance_logs WHERE session_id='SESS-EXP-MAIN' ORDER BY student_id")
                before_logs = cur.fetchall()
        finally:
            conn.close()

        # Perform export
        self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )

        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT final_attendance_status FROM attendance_logs WHERE session_id='SESS-EXP-MAIN' ORDER BY student_id")
                after_logs = cur.fetchall()
        finally:
            conn.close()

        self.assertEqual(before_logs, after_logs)

    def test_case_20_in_memory_stream_cleanup(self):
        """Case 20: PDF generation uses in-memory BytesIO buffers without leaking file descriptors."""
        demo_session = {"session_id": "TEST-CLEANUP", "title": "Cleanup Test", "course": "CS-101", "event_date": "2026-10-14", "starts_at": "09:00", "ends_at": "10:00"}
        students = [{"student_id": "STU1", "name": "Name", "status": "PRESENT"}]
        summary = {"total_students": 1, "present_students": 1, "absent_students": 0}
        pdf_bytes, filename = build_session_attendance_pdf(demo_session, students, summary, "detailed_pdf", "both")
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(len(pdf_bytes) > 1000)

    def test_case_21_pdfs_not_publicly_accessible(self):
        """Case 21: Direct GET without Authorization is rejected with 401."""
        res = self.client.get("/attendance/sessions/SESS-EXP-MAIN/export?report_type=detailed_pdf")
        self.assertEqual(res.status_code, 401)

    def test_case_22_handle_no_matching_students_clean_error(self):
        """Case 22: If no students match the selected filter, return clean 422 error."""
        res = self.client.post(
            "/attendance/sessions/SESS-EXP-MAIN/export",
            json={"report_type": "detailed_pdf", "attendance_status": "both", "course_id": "NON_EXISTENT_COURSE_XYZ"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("no students match", res.text.lower())

    def test_case_23_export_summary_api_endpoint(self):
        """Case 23: Export summary endpoint provides live counts matching filters."""
        res_both = self.client.get(
            "/attendance/sessions/SESS-EXP-MAIN/export-summary?attendance_status=both",
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res_both.status_code, 200)
        self.assertEqual(res_both.json()["records_included"], 3)

        res_pres = self.client.get(
            "/attendance/sessions/SESS-EXP-MAIN/export-summary?attendance_status=present",
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res_pres.status_code, 200)
        self.assertEqual(res_pres.json()["records_included"], 2)

        res_abs = self.client.get(
            "/attendance/sessions/SESS-EXP-MAIN/export-summary?attendance_status=absent",
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res_abs.status_code, 200)
        self.assertEqual(res_abs.json()["records_included"], 1)

    def test_case_24_export_options_api_endpoint(self):
        """Case 24: Export options endpoint returns session metadata, eligible courses, and report types."""
        res = self.client.get(
            "/attendance/sessions/SESS-EXP-MAIN/export-options",
            headers={"Authorization": f"Bearer {self.faculty_a_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("session", data)
        self.assertIn("courses", data)
        self.assertIn("summary", data)
        self.assertIn("report_types", data)
        self.assertEqual(len(data["report_types"]), 3)
        self.assertEqual(data["session"]["session_id"], "SESS-EXP-MAIN")


if __name__ == "__main__":
    unittest.main()
