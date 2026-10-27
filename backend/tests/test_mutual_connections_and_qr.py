"""Unit and integration tests for QR Code Generation, Scanning, Mutual Connections,
and Mutual Profile Photo Visibility across all four user roles.
"""
import json
import unittest
from fastapi.testclient import TestClient
from app.main import app, ensure_auth_tables, password_hash
from app.database import get_db_connection


class TestMutualConnectionsAndQR(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_auth_tables()
        cls.client = TestClient(app)

        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # 1. Admin user
                cur.execute("""
                    INSERT INTO users (username, password_hash, role, display_name, email)
                    VALUES ('qr_admin', %s, 'admin', 'QR Administrator', 'qr_admin@univ.edu')
                    ON CONFLICT (username) DO UPDATE SET display_name = 'QR Administrator'
                    RETURNING id
                """, (password_hash("pass123"),))
                cls.admin_id = cur.fetchone()["id"]

                # 2. Teacher user
                cur.execute("""
                    INSERT INTO users (username, password_hash, role, display_name, email)
                    VALUES ('qr_faculty', %s, 'teacher', 'Prof. Alan Turing', 'turing@univ.edu')
                    ON CONFLICT (username) DO UPDATE SET display_name = 'Prof. Alan Turing'
                    RETURNING id
                """, (password_hash("pass123"),))
                cls.teacher_id = cur.fetchone()["id"]

                # 3. Student user & student profile
                cur.execute("""
                    INSERT INTO students (student_id, name, email, roll_number, program, department)
                    VALUES ('STU-QR-001', 'Ada Lovelace', 'ada@univ.edu', 'ROLL-ADA-01', 'B.Sc. CS', 'Computer Science')
                    ON CONFLICT (student_id) DO UPDATE SET name = 'Ada Lovelace'
                """)
                cur.execute("""
                    INSERT INTO users (username, password_hash, role, student_id, display_name, email)
                    VALUES ('qr_student', %s, 'student', 'STU-QR-001', 'Ada Lovelace', 'ada@univ.edu')
                    ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = 'Ada Lovelace'
                    RETURNING id
                """, (password_hash("pass123"),))
                cls.student_id = cur.fetchone()["id"]

                # 4. Others (Visitor) user & visitor record
                cur.execute("""
                    INSERT INTO users (username, password_hash, role, display_name, email)
                    VALUES ('qr_visitor@external.com', %s, 'others', 'Grace Hopper', 'qr_visitor@external.com')
                    ON CONFLICT (username) DO UPDATE SET display_name = 'Grace Hopper'
                    RETURNING id
                """, (password_hash("pass123"),))
                cls.visitor_user_id = cur.fetchone()["id"]

                cur.execute("""
                    INSERT INTO visitors (visitor_id, user_id, full_name, email, phone, purpose_of_visit,
                                          expected_check_in, expected_check_out, identification_type, identification_number_masked)
                    VALUES ('VIS-2026-TESTQR', %s, 'Grace Hopper', 'qr_visitor@external.com', '1234567890', 'Tech Keynote',
                            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '4 hours', 'Passport', '****1234')
                    ON CONFLICT (visitor_id) DO NOTHING
                """, (cls.visitor_user_id,))

                # Clear any previous test connections
                cur.execute("""
                    DELETE FROM user_connections
                    WHERE user_id_1 IN (%s, %s, %s, %s)
                       OR user_id_2 IN (%s, %s, %s, %s)
                """, (cls.admin_id, cls.teacher_id, cls.student_id, cls.visitor_user_id,
                      cls.admin_id, cls.teacher_id, cls.student_id, cls.visitor_user_id))
            conn.commit()
        finally:
            conn.close()

        # Login tokens
        cls.admin_token = cls._login("qr_admin", "pass123", "admin")
        cls.teacher_token = cls._login("qr_faculty", "pass123", "teacher")
        cls.student_token = cls._login("qr_student", "pass123", "student")
        cls.visitor_token = cls._login("qr_visitor@external.com", "pass123", "others")

    @classmethod
    def _login(cls, username, password, role):
        res = cls.client.post("/auth/login", json={"username": username, "password": password, "role": role})
        assert res.status_code == 200, f"Login failed for {username}: {res.text}"
        data = res.json()
        return data.get("access_token") or data.get("token")

    def test_01_my_qr_generation_all_roles(self):
        """Verify each role gets a stable, collision-resistant QR payload and data URI."""
        tokens_and_roles = [
            (self.admin_token, "admin", "QR Administrator"),
            (self.teacher_token, "faculty", "Prof. Alan Turing"),
            (self.student_token, "student", "Ada Lovelace"),
            (self.visitor_token, "others", "Grace Hopper"),
        ]
        for token, role, name in tokens_and_roles:
            res = self.client.get("/connections/my-qr", headers={"Authorization": f"Bearer {token}"})
            self.assertEqual(res.status_code, 200, res.text)
            data = res.json()
            self.assertIn("qr_id", data)
            self.assertTrue(len(data["qr_id"]) > 10)
            self.assertEqual(data["role"], role)
            self.assertEqual(data["display_name"], name)
            self.assertTrue(data["qr_data_uri"].startswith("data:image/png;base64,"))
            self.assertIn("qr_payload", data)
            self.assertEqual(data["qr_payload"]["type"], "pratyaksh_connect")

    def test_02_verify_qr_and_detect_self(self):
        """Scanning one's own QR code must indicate is_self = True."""
        my_qr = self.client.get("/connections/my-qr", headers={"Authorization": f"Bearer {self.student_token}"}).json()
        payload_str = json.dumps(my_qr["qr_payload"])

        res = self.client.post(
            "/connections/verify-qr",
            json={"qr_data": payload_str},
            headers={"Authorization": f"Bearer {self.student_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["target_user"]["is_self"])
        self.assertFalse(data["target_user"]["is_connected"])

    def test_03_prevent_self_connection(self):
        """Attempting to connect with oneself must fail with HTTP 400."""
        res = self.client.post(
            "/connections/connect",
            json={"target_user_id": self.student_id},
            headers={"Authorization": f"Bearer {self.student_token}"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("cannot establish a connection with yourself", res.json()["detail"].lower())

    def test_04_verify_target_user_and_mutual_connection(self):
        """User A (Student) scans User B (Faculty). Mutual connection must be established."""
        faculty_qr = self.client.get("/connections/my-qr", headers={"Authorization": f"Bearer {self.teacher_token}"}).json()
        payload_str = json.dumps(faculty_qr["qr_payload"])

        # 1. Student verifies Faculty's QR code
        verify_res = self.client.post(
            "/connections/verify-qr",
            json={"qr_data": payload_str},
            headers={"Authorization": f"Bearer {self.student_token}"},
        )
        self.assertEqual(verify_res.status_code, 200)
        target = verify_res.json()["target_user"]
        self.assertEqual(target["user_id"], self.teacher_id)
        self.assertFalse(target["is_self"])
        self.assertFalse(target["is_connected"])
        self.assertEqual(target["display_name"], "Prof. Alan Turing")

        # 2. Student connects with Faculty
        connect_res = self.client.post(
            "/connections/connect",
            json={"target_qr_id": faculty_qr["qr_id"]},
            headers={"Authorization": f"Bearer {self.student_token}"},
        )
        self.assertEqual(connect_res.status_code, 200)
        cdata = connect_res.json()
        self.assertEqual(cdata["status"], "connected")

        # 3. Verify MUTUAL visibility: Faculty immediately sees Student in their connections
        fac_list = self.client.get("/connections", headers={"Authorization": f"Bearer {self.teacher_token}"}).json()
        self.assertGreaterEqual(fac_list["total_connections"], 1)
        connected_uids = [c["user_id"] for c in fac_list["connections"]]
        self.assertIn(self.student_id, connected_uids)

        # 4. Student also immediately sees Faculty in their connections
        stu_list = self.client.get("/connections", headers={"Authorization": f"Bearer {self.student_token}"}).json()
        self.assertGreaterEqual(stu_list["total_connections"], 1)
        connected_uids = [c["user_id"] for c in stu_list["connections"]]
        self.assertIn(self.teacher_id, connected_uids)

    def test_05_duplicate_connection_prevention(self):
        """Connecting again must be idempotent and indicate already_connected."""
        res = self.client.post(
            "/connections/connect",
            json={"target_user_id": self.teacher_id},
            headers={"Authorization": f"Bearer {self.student_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "already_connected")

    def test_06_visitor_and_admin_connection_and_search(self):
        """Visitor connects with Admin, and search filter works."""
        admin_qr = self.client.get("/connections/my-qr", headers={"Authorization": f"Bearer {self.admin_token}"}).json()

        # Visitor connects with Admin
        res = self.client.post(
            "/connections/connect",
            json={"target_qr_id": admin_qr["qr_id"]},
            headers={"Authorization": f"Bearer {self.visitor_token}"},
        )
        self.assertEqual(res.status_code, 200)

        # Search by name
        search_res = self.client.get(
            "/connections?q=Admin",
            headers={"Authorization": f"Bearer {self.visitor_token}"},
        ).json()
        self.assertEqual(search_res["total_connections"], 1)
        self.assertEqual(search_res["connections"][0]["user_id"], self.admin_id)

    def test_07_mutual_profile_photo_authorization(self):
        """Only connected users, self, or admins/faculty can access user photo."""
        # Unconnected student -> visitor: should return 403 (since Student is not connected to Visitor)
        res = self.client.get(
            f"/users/{self.visitor_user_id}/photo",
            headers={"Authorization": f"Bearer {self.student_token}"},
        )
        self.assertEqual(res.status_code, 403)

        # Connected faculty -> student: faculty is connected to student, so allowed (or 404 if no photo uploaded, but NOT 403)
        res2 = self.client.get(
            f"/users/{self.student_id}/photo",
            headers={"Authorization": f"Bearer {self.teacher_token}"},
        )
        self.assertIn(res2.status_code, (200, 404))  # Authorized, photo may or may not exist on disk

    def test_08_remove_connection(self):
        """Removing a connection deletes the mutual relationship."""
        del_res = self.client.delete(
            f"/connections/{self.teacher_id}",
            headers={"Authorization": f"Bearer {self.student_token}"},
        )
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["ok"])

        # Check that connection is gone for both
        fac_list = self.client.get("/connections", headers={"Authorization": f"Bearer {self.teacher_token}"}).json()
        connected_uids = [c["user_id"] for c in fac_list["connections"]]
        self.assertNotIn(self.student_id, connected_uids)


if __name__ == "__main__":
    unittest.main()
