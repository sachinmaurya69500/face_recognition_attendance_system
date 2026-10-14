"""Automated test suite verifying the 10 mandatory Phase 6 Cache & Authorization Scenarios."""
import json
import time
import unittest
from unittest.mock import patch

from app.cache import (
    _get_client,
    cache_delete,
    cache_delete_pattern,
    cache_get,
    cache_set,
    cache_stats,
)
from app.database import get_db_connection
from app.main import (
    app,
    password_hash,
    session_section_ids,
)
from app.session_manager import (
    create_user_session,
    decode_and_validate_token,
    is_token_revoked,
    is_user_disabled,
    revoke_all_user_sessions,
    revoke_user_session,
    set_user_account_status,
)
from fastapi.testclient import TestClient


class TestPhase6CorrectnessAndSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # 1. Ensure test admin exists
                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, is_active)
                    VALUES (9901, 'test_admin_p6', %s, 'admin', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='admin'
                """, (password_hash("admin123"),))

                # 2. Ensure test faculty A and faculty B exist
                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, is_active)
                    VALUES (9902, 'test_faculty_a', %s, 'teacher', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='teacher'
                """, (password_hash("faculty123"),))

                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, is_active)
                    VALUES (9903, 'test_faculty_b', %s, 'teacher', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='teacher'
                """, (password_hash("faculty123"),))

                # 3. Ensure test students A and B exist in students & users tables
                cur.execute("""
                    INSERT INTO students (student_id, name, email, section_id, roll_number)
                    VALUES ('STU-P6-A', 'Student Alpha', 'alpha@university.edu', 1, '24A001')
                    ON CONFLICT (student_id) DO UPDATE SET name='Student Alpha', email='alpha@university.edu', section_id=1
                """)
                cur.execute("""
                    INSERT INTO students (student_id, name, email, section_id, roll_number)
                    VALUES ('STU-P6-B', 'Student Beta', 'beta@university.edu', 1, '24B001')
                    ON CONFLICT (student_id) DO UPDATE SET name='Student Beta', email='beta@university.edu', section_id=1
                """)

                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, student_id, is_active)
                    VALUES (9904, 'student_a', %s, 'student', 'STU-P6-A', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='student', student_id='STU-P6-A'
                """, (password_hash("student123"),))

                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, student_id, is_active)
                    VALUES (9905, 'student_b', %s, 'student', 'STU-P6-B', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='student', student_id='STU-P6-B'
                """, (password_hash("student123"),))

                # Assign Faculty A to Section 1
                cur.execute("""
                    INSERT INTO teacher_assignments (teacher_user_id, section_id, subject)
                    VALUES (9902, 1, 'Computer Science A')
                    ON CONFLICT (teacher_user_id, section_id, subject) DO NOTHING
                """)

                # 4. Create Session A (owned by Faculty A, section 1)
                cur.execute("""
                    INSERT INTO attendance_sessions (session_id, teacher_id, title, course, school, faculty, department, program, semester, section_id, event_date, starts_at, ends_at, status, academic_scope)
                    VALUES ('SESS-P6-A', 9902, 'Lecture A', 'CS-101', 'School of Tech', 'Faculty of Tech', 'Dept CS', 'B.Sc. IT', 'Semester 1', 1, '2026-10-14', '09:00', '10:00', 'ACTIVE', '{"section_ids": [1]}')
                    ON CONFLICT (session_id) DO UPDATE SET teacher_id=9902, status='ACTIVE', section_id=1
                """)

                # Create Session B (owned by Faculty B, section 20 unassigned to Faculty A)
                cur.execute("""
                    INSERT INTO attendance_sessions (session_id, teacher_id, title, course, school, faculty, department, program, semester, section_id, event_date, starts_at, ends_at, status, academic_scope)
                    VALUES ('SESS-P6-B', 9903, 'Lecture B', 'CS-201', 'School of Tech', 'Faculty of Tech', 'Dept CS', 'BCA', 'Semester 1', 20, '2026-10-14', '11:00', '12:00', 'ACTIVE', '{"section_ids": [20]}')
                    ON CONFLICT (session_id) DO UPDATE SET teacher_id=9903, status='ACTIVE', section_id=20
                """)

                # Log attendance for Student A in Session A (PRESENT) and Student B in Session A (ABSENT)
                cur.execute("""
                    INSERT INTO attendance_logs (student_id, session_id, teacher_id, confidence_score, initial_attendance_status, final_attendance_status)
                    VALUES ('STU-P6-A', 'SESS-P6-A', 9902, 0.95, 'PRESENT', 'PRESENT')
                    ON CONFLICT (student_id, session_id) DO UPDATE SET final_attendance_status='PRESENT'
                """)
                cur.execute("""
                    INSERT INTO attendance_logs (student_id, session_id, teacher_id, confidence_score, initial_attendance_status, final_attendance_status)
                    VALUES ('STU-P6-B', 'SESS-P6-A', 9902, 0.0, 'ABSENT', 'ABSENT')
                    ON CONFLICT (student_id, session_id) DO UPDATE SET final_attendance_status='ABSENT'
                """)
            conn.commit()
        finally:
            conn.close()

        # Generate tokens
        cls.admin_token, _ = create_user_session({"id": 9901, "username": "test_admin_p6", "role": "admin", "student_id": None})
        cls.faculty_a_token, _ = create_user_session({"id": 9902, "username": "test_faculty_a", "role": "teacher", "student_id": None})
        cls.faculty_b_token, _ = create_user_session({"id": 9903, "username": "test_faculty_b", "role": "teacher", "student_id": None})
        cls.student_a_token, cls.student_a_sid = create_user_session({"id": 9904, "username": "student_a", "role": "student", "student_id": "STU-P6-A"})
        cls.student_b_token, cls.student_b_sid = create_user_session({"id": 9905, "username": "student_b", "role": "student", "student_id": "STU-P6-B"})

    def test_scenario_1_student_cache_and_data_isolation(self):
        """Scenario 1: Student A and Student B request attendance history. Neither receives other's data."""
        # Student A request
        res_a = self.client.get("/student/attendance", headers={"Authorization": f"Bearer {self.student_a_token}"})
        self.assertEqual(res_a.status_code, 200)
        data_a = res_a.json()
        self.assertEqual(data_a["student_id"], "STU-P6-A")
        # Student A should have PRESENT for SESS-P6-A
        a_sess_log = next((r for r in data_a["items"] if r["session_id"] == "SESS-P6-A"), None)
        self.assertIsNotNone(a_sess_log)
        self.assertEqual(a_sess_log["status"], "PRESENT")

        # Student B request
        res_b = self.client.get("/student/attendance", headers={"Authorization": f"Bearer {self.student_b_token}"})
        self.assertEqual(res_b.status_code, 200)
        data_b = res_b.json()
        self.assertEqual(data_b["student_id"], "STU-P6-B")
        b_sess_log = next((r for r in data_b["items"] if r["session_id"] == "SESS-P6-A"), None)
        self.assertIsNotNone(b_sess_log)
        self.assertEqual(b_sess_log["status"], "ABSENT")

        # Verify cache keys are separated and never leak
        cached_a = cache_get("student:STU-P6-A:attendance:logs:p=None:ps=20:st=None")
        cached_b = cache_get("student:STU-P6-B:attendance:logs:p=None:ps=20:st=None")
        self.assertIsNotNone(cached_a)
        self.assertIsNotNone(cached_b)
        self.assertEqual(cached_a["student_id"], "STU-P6-A")
        self.assertEqual(cached_b["student_id"], "STU-P6-B")

    def test_scenario_2_student_idor_protection(self):
        """Scenario 2: Student A requests an endpoint and manipulates the student ID to Student B. Server denies access."""
        # 1. Direct profile request with Student B's ID by Student A
        res_profile = self.client.get("/students/STU-P6-B", headers={"Authorization": f"Bearer {self.student_a_token}"})
        self.assertEqual(res_profile.status_code, 403)
        self.assertIn("only view your own", res_profile.text)

        # 2. Attendance history request with Student B's ID by Student A
        res_att = self.client.get("/attendance/student/STU-P6-B", headers={"Authorization": f"Bearer {self.student_a_token}"})
        self.assertEqual(res_att.status_code, 403)
        self.assertIn("only view your own", res_att.text)

    def test_scenario_3_faculty_unrelated_class_idor_protection(self):
        """Scenario 3: Faculty A requests attendance for an assigned class, then changes session ID to an unrelated class."""
        # 1. Faculty A requests their own session SESS-P6-A -> SUCCESS
        res_own = self.client.get("/attendance/SESS-P6-A", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_own.status_code, 200)

        # 2. Faculty A requests session SESS-P6-B (owned by Faculty B, section 20 unassigned to A) -> 403
        res_unrelated = self.client.get("/attendance/SESS-P6-B", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_unrelated.status_code, 403)
        self.assertIn("not authorized", res_unrelated.text.lower())

        # 3. Faculty A requests paginated records for SESS-P6-B -> 403
        res_records_unrelated = self.client.get("/attendance/sessions/SESS-P6-B/records", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_records_unrelated.status_code, 403)

        # 4. Faculty A requests PDF for SESS-P6-B -> 403
        res_pdf_unrelated = self.client.get("/attendance/SESS-P6-B/pdf", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_pdf_unrelated.status_code, 403)

    def test_scenario_4_admin_profile_update_invalidates_cache(self):
        """Scenario 4: Administrator updates student's profile. Cached profile data is invalidated appropriately."""
        # Initial read populates cache
        res1 = self.client.get("/students/STU-P6-A", headers={"Authorization": f"Bearer {self.admin_token}"})
        self.assertEqual(res1.status_code, 200)

        # Update profile via admin endpoint
        new_name = f"Student Alpha Updated {int(time.time())}"
        payload = {
            "name": new_name,
            "email": "alpha.updated@university.edu",
            "phone": "+91 99999 11111",
            "date_of_birth": "2003-01-01",
            "program": "B.Sc. Information Technology (Honors)",
            "department": "Department of Computer Sciences",
            "semester": "Semester 1",
            "gpa": "3.90",
            "enrollment_year": "2024",
            "roll_number": "24A001"
        }
        res_update = self.client.patch("/admin/students/STU-P6-A", json=payload, headers={"Authorization": f"Bearer {self.admin_token}"})
        self.assertEqual(res_update.status_code, 200)

        # Subsequent read must return updated data
        res2 = self.client.get("/students/STU-P6-A", headers={"Authorization": f"Bearer {self.admin_token}"})
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["name"], new_name)

    def test_scenario_5_attendance_record_correction_and_consistency(self):
        """Scenario 5: Attendance record is corrected. Attendance pages reflect change."""
        # 1. Read SESS-P6-A records: Student B is ABSENT
        res_before = self.client.get("/attendance/sessions/SESS-P6-A/records?page_size=100", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_before.status_code, 200)
        b_item_before = next(item for item in res_before.json()["items"] if item["student_id"] == "STU-P6-B")
        self.assertEqual(b_item_before["status"], "ABSENT")

        # 2. Faculty A corrects Student B to PRESENT
        res_patch = self.client.patch(
            "/attendance/SESS-P6-A/STU-P6-B",
            json={"status": "PRESENT"},
            headers={"Authorization": f"Bearer {self.faculty_a_token}"}
        )
        self.assertEqual(res_patch.status_code, 200)

        # 3. Read records again: Student B must be PRESENT and marked with is_manual_override=True
        res_after = self.client.get("/attendance/sessions/SESS-P6-A/records?page_size=100", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_after.status_code, 200)
        b_item_after = next(item for item in res_after.json()["items"] if item["student_id"] == "STU-P6-B")
        self.assertEqual(b_item_after["status"], "PRESENT")
        self.assertTrue(b_item_after["is_manual_override"])

    def test_scenario_6_redis_failure_resilience(self):
        """Scenario 6: Redis becomes unavailable. Application continues serving eligible requests without bypassing authorization."""
        with patch("app.cache._get_client", return_value=None):
            # 1. Authorized read succeeds from DB fallback
            res_roster = self.client.get("/attendance/sessions/SESS-P6-A/records", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
            self.assertEqual(res_roster.status_code, 200)
            self.assertGreaterEqual(len(res_roster.json()["items"]), 1)

            # 2. Authorization is NEVER bypassed during cache failure
            res_unauth = self.client.get("/attendance/sessions/SESS-P6-B/records", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
            self.assertEqual(res_unauth.status_code, 403)

    def test_scenario_7_permission_revocation_and_disabled_account(self):
        """Scenario 7: User's account is disabled or permissions revoked. Cannot continue accessing newly forbidden data."""
        # 1. Ensure temporary student user exists in database
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO users (id, username, password_hash, role, student_id, is_active)
                    VALUES (9988, 'temp_student', %s, 'student', 'STU-P6-A', TRUE)
                    ON CONFLICT (id) DO UPDATE SET is_active=TRUE, role='student', student_id='STU-P6-A'
                """, (password_hash("temp123"),))
            conn.commit()
        finally:
            conn.close()

        # Ensure user account is active before starting
        set_user_account_status(9988, is_active=True)

        temp_token, _ = create_user_session({"id": 9988, "username": "temp_student", "role": "student", "student_id": "STU-P6-A"})

        # Check access before disabling
        res_before = self.client.get("/students/STU-P6-A", headers={"Authorization": f"Bearer {temp_token}"})
        self.assertEqual(res_before.status_code, 200)

        # Disable the account
        set_user_account_status(9988, is_active=False)
        self.assertTrue(is_user_disabled(9988))

        # Request with old token must now be rejected
        res_after = self.client.get("/students/STU-P6-A", headers={"Authorization": f"Bearer {temp_token}"})
        self.assertEqual(res_after.status_code, 401)
        self.assertTrue(any(term in res_after.text.lower() for term in ["disabled", "deactivated", "revoked"]))

        # Clean up
        set_user_account_status(9988, is_active=True)

    def test_scenario_8_logout_and_session_invalidation(self):
        """Scenario 8: User logs out. Application invalidates session and rejects further requests with that token."""
        logout_token, sid = create_user_session({"id": 9901, "username": "test_admin_p6", "role": "admin", "student_id": None})

        # Check access before logout
        res1 = self.client.get("/auth/me", headers={"Authorization": f"Bearer {logout_token}"})
        self.assertEqual(res1.status_code, 200)

        # Perform logout
        res_logout = self.client.post("/auth/logout", headers={"Authorization": f"Bearer {logout_token}"})
        self.assertEqual(res_logout.status_code, 200)

        # Token must be revoked immediately
        self.assertTrue(is_token_revoked(sid))
        res2 = self.client.get("/auth/me", headers={"Authorization": f"Bearer {logout_token}"})
        self.assertEqual(res2.status_code, 401)
        self.assertIn("revoked", res2.text.lower())

    def test_scenario_9_shared_resource_cache_reuse_without_leakage(self):
        """Scenario 9: Multiple users request shared public/academic catalog resource without leakage."""
        # Faculty A fetches sections
        res_a = self.client.get("/academic/sections", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_a.status_code, 200)

        # Student A fetches sections (cache hit on academic:sections)
        res_s = self.client.get("/academic/sections", headers={"Authorization": f"Bearer {self.student_a_token}"})
        self.assertEqual(res_s.status_code, 200)

        # Data must match exactly and contain catalog without user credentials or private data
        self.assertEqual(len(res_a.json()["sections"]), len(res_s.json()["sections"]))
        sample = res_a.json()["sections"][0]
        self.assertNotIn("password", sample)
        self.assertNotIn("student_id", sample)
        self.assertIn("program", sample)

    def test_scenario_10_pagination_limits_and_boundary_checks(self):
        """Scenario 10: User requests large pages or filters. Input validation, page size limits (max 100) are enforced."""
        # 1. Request page_size=500 -> rejected by validation (422)
        res_huge = self.client.get("/attendance/sessions/SESS-P6-A/records?page_size=500", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_huge.status_code, 422)

        # 2. Request page=0 -> rejected (page must be ge=1)
        res_zero = self.client.get("/attendance/sessions/SESS-P6-A/records?page=0", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_zero.status_code, 422)

        # 3. Request valid page with limit 20
        res_valid = self.client.get("/attendance/sessions/SESS-P6-A/records?page=1&page_size=20", headers={"Authorization": f"Bearer {self.faculty_a_token}"})
        self.assertEqual(res_valid.status_code, 200)
        pagination = res_valid.json()["pagination"]
        self.assertEqual(pagination["page"], 1)
        self.assertEqual(pagination["page_size"], 20)
        self.assertGreaterEqual(pagination["total_items"], 1)


if __name__ == "__main__":
    unittest.main()
