import os
import unittest
from fastapi.testclient import TestClient

from app.main import app, get_db_connection, password_hash, DEFAULT_STUDENT_PASSWORD

client = TestClient(app)

class TestStudentDefaultPasswordAndReset(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create a test student account
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO students (student_id, name, email, phone)
                    VALUES ('TEST-STU-999', 'Test Scholar', 'scholar999@dsvv.ac.in', '+91 9999999999')
                    ON CONFLICT (student_id) DO UPDATE SET name=EXCLUDED.name
                """)
                cur.execute("""
                    INSERT INTO users (username, password_hash, role, student_id, display_name, email, must_reset_password)
                    VALUES ('TEST-STU-999', %s, 'student', 'TEST-STU-999', 'Test Scholar', 'scholar999@dsvv.ac.in', TRUE)
                    ON CONFLICT (username) DO UPDATE SET
                        password_hash=EXCLUDED.password_hash,
                        must_reset_password=TRUE
                """, (password_hash(DEFAULT_STUDENT_PASSWORD),))
            conn.commit()
        finally:
            conn.close()

    @classmethod
    def tearDownClass(cls):
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM users WHERE username IN ('TEST-STU-999', 'TEST-STU-ADMIN-NEW')")
                cur.execute("DELETE FROM students WHERE student_id IN ('TEST-STU-999', 'TEST-STU-ADMIN-NEW')")
            conn.commit()
        finally:
            conn.close()

    def test_01_default_student_password_login(self):
        res = client.post("/auth/login", json={
            "username": "TEST-STU-999",
            "password": DEFAULT_STUDENT_PASSWORD,
            "role": "student"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("access_token", data)
        self.assertTrue(data["user"]["must_reset_password"])
        self.assertEqual(data["user"]["student_id"], "TEST-STU-999")

    def test_02_reset_password_validations(self):
        login_res = client.post("/auth/login", json={
            "username": "TEST-STU-999",
            "password": DEFAULT_STUDENT_PASSWORD,
            "role": "student"
        })
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Wrong current password
        res = client.post("/auth/reset-password", json={
            "current_password": "wrongpassword",
            "new_password": "NewSecret@2026",
            "confirm_password": "NewSecret@2026"
        }, headers=headers)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Current password is incorrect", res.json()["detail"])

        # Password length < 6
        res = client.post("/auth/reset-password", json={
            "current_password": DEFAULT_STUDENT_PASSWORD,
            "new_password": "123",
            "confirm_password": "123"
        }, headers=headers)
        self.assertEqual(res.status_code, 422)
        self.assertIn("at least 6 characters", res.json()["detail"])

        # Passwords mismatch
        res = client.post("/auth/reset-password", json={
            "current_password": DEFAULT_STUDENT_PASSWORD,
            "new_password": "NewSecret@2026",
            "confirm_password": "DifferentSecret"
        }, headers=headers)
        self.assertEqual(res.status_code, 422)
        self.assertIn("do not match", res.json()["detail"])

        # Cannot reuse default password
        res = client.post("/auth/reset-password", json={
            "current_password": DEFAULT_STUDENT_PASSWORD,
            "new_password": DEFAULT_STUDENT_PASSWORD,
            "confirm_password": DEFAULT_STUDENT_PASSWORD
        }, headers=headers)
        self.assertEqual(res.status_code, 422)
        self.assertIn("default institutional password", res.json()["detail"])

    def test_03_successful_password_reset_and_subsequent_login(self):
        login_res = client.post("/auth/login", json={
            "username": "TEST-STU-999",
            "password": DEFAULT_STUDENT_PASSWORD,
            "role": "student"
        })
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Perform password reset
        new_password = "MySecurePersonalPassword#2026"
        res = client.post("/auth/reset-password", json={
            "current_password": DEFAULT_STUDENT_PASSWORD,
            "new_password": new_password,
            "confirm_password": new_password
        }, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["must_reset_password"])
        self.assertFalse(res.json()["user"]["must_reset_password"])

        # Check /auth/profile returns must_reset_password = False
        prof_res = client.get("/auth/profile", headers=headers)
        self.assertEqual(prof_res.status_code, 200)
        self.assertFalse(prof_res.json()["profile"]["must_reset_password"])

        # Old password should no longer work
        old_login = client.post("/auth/login", json={
            "username": "TEST-STU-999",
            "password": DEFAULT_STUDENT_PASSWORD,
            "role": "student"
        })
        self.assertEqual(old_login.status_code, 401)

        # New password works and must_reset_password is False
        new_login = client.post("/auth/login", json={
            "username": "TEST-STU-999",
            "password": new_password,
            "role": "student"
        })
        self.assertEqual(new_login.status_code, 200)
        self.assertFalse(new_login.json()["user"]["must_reset_password"])

    def test_04_admin_created_student_has_default_password_and_reset_flag(self):
        # Login as admin
        admin_login = client.post("/auth/login", json={
            "username": "admin",
            "password": "admin123",
            "role": "admin"
        })
        admin_token = admin_login.json()["access_token"]
        headers = {"Authorization": f"Bearer {admin_token}"}

        # Create new student user via admin
        res = client.post("/admin/users", json={
            "username": "TEST-STU-ADMIN-NEW",
            "student_id": "TEST-STU-ADMIN-NEW",
            "name": "Admin Created Student",
            "role": "student",
            "email": "admincreated@dsvv.ac.in",
            "phone": "+91 9888888888",
            "date_of_birth": "2003-01-01"
        }, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["user"]["must_reset_password"])

        # Verify student can login with default password and must_reset_password is True
        stu_login = client.post("/auth/login", json={
            "username": "TEST-STU-ADMIN-NEW",
            "password": DEFAULT_STUDENT_PASSWORD,
            "role": "student"
        })
        self.assertEqual(stu_login.status_code, 200)
        self.assertTrue(stu_login.json()["user"]["must_reset_password"])

if __name__ == "__main__":
    unittest.main()
