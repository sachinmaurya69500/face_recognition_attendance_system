"""Comprehensive test suite for the 'Others' role, Visitor Registration,
Authentication, QR Code Generation, Security, and Role Isolation.
"""
import base64
import json
import os
import re
import unittest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.main import app, get_db_connection, password_hash
from app.visitor_services import (
    VALID_ID_TYPES,
    VALID_PURPOSES,
    build_visitor_qr_payload,
    generate_qr_code_bytes,
    generate_qr_code_data_uri,
    generate_visitor_id,
    hash_identification_number,
    mask_identification_number,
    validate_email_format,
)


class TestVisitorServicesUnit(unittest.TestCase):
    """Unit tests for visitor service cryptographic, ID masking, and QR functions."""

    def test_mask_identification_number(self):
        # 12-char ID
        self.assertEqual(mask_identification_number("IND987654321"), "********4321")
        # 8-char passport
        self.assertEqual(mask_identification_number("P1234567"), "****4567")
        # Exact 4 chars
        self.assertEqual(mask_identification_number("1234"), "****")
        # Short / empty
        self.assertEqual(mask_identification_number(""), "****")
        self.assertEqual(mask_identification_number(None), "****")
        self.assertEqual(mask_identification_number("12"), "**")

    def test_hash_identification_number(self):
        h1 = hash_identification_number("IND987654321")
        h2 = hash_identification_number("ind987654321 ")  # case and whitespace normalization
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 64)
        self.assertNotIn("IND987654321", h1)

    def test_generate_visitor_id_format_and_uniqueness(self):
        today_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        pattern = rf"^VIS-{today_str}-\d{{4}}$"
        ids = []
        for _ in range(50):
            vid = generate_visitor_id()
            self.assertRegex(vid, pattern)
            ids.append(vid)
        # Check collision resistance and strict sequential ascending order across 50 generated IDs
        self.assertEqual(len(set(ids)), 50)
        self.assertEqual(ids, sorted(ids))
        # Check explicit date passing
        custom_date = datetime(2025, 5, 20, 10, 30, tzinfo=timezone.utc)
        custom_vid = generate_visitor_id(target_date=custom_date)
        self.assertTrue(custom_vid.startswith("VIS-20250520-"))

    def test_build_visitor_qr_payload_security_exclusion(self):
        sample_visitor = {
            "visitor_id": "VIS-2026-ABC12345",
            "full_name": "Test Visitor",
            "email": "test.visitor@example.com",
            "phone": "+919876543210",
            "purpose_of_visit": "Interview",
            "expected_check_in": "2026-10-20T10:00:00+00:00",
            "expected_check_out": "2026-10-20T16:00:00+00:00",
            "registration_date": "2026-10-15T12:00:00+00:00",
            "identification_type": "Passport",
            "identification_number_masked": "*****4321",
            "password": "SecretPassword123!",
            "password_hash": "salt$hashvalue",
            "token": "bearer.token.jwt",
        }
        payload = build_visitor_qr_payload(sample_visitor)
        self.assertEqual(payload["type"], "visitor")
        self.assertEqual(payload["visitor_id"], "VIS-2026-ABC12345")
        self.assertEqual(payload["identification_number_masked"], "*****4321")
        # Explicit exclusion of sensitive authentication data
        self.assertNotIn("password", payload)
        self.assertNotIn("password_hash", payload)
        self.assertNotIn("token", payload)
        self.assertNotIn("SecretPassword123!", json.dumps(payload))

    def test_generate_qr_code_bytes_and_data_uri(self):
        payload = {"type": "visitor", "visitor_id": "VIS-2026-TEST0001"}
        qr_bytes = generate_qr_code_bytes(payload)
        # PNG signature: 89 50 4E 47 0D 0A 1A 0A
        self.assertTrue(qr_bytes.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(len(qr_bytes), 200)

        data_uri = generate_qr_code_data_uri(payload)
        self.assertTrue(data_uri.startswith("data:image/png;base64,"))

    def test_validate_email_format(self):
        self.assertTrue(validate_email_format("visitor@example.com"))
        self.assertTrue(validate_email_format("dr.name+sub@univ.edu.in"))
        self.assertFalse(validate_email_format(""))
        self.assertFalse(validate_email_format("invalid-email"))
        self.assertFalse(validate_email_format("missing@domain"))
        self.assertFalse(validate_email_format("@nodomain.com"))


class TestOthersRoleIntegration(unittest.TestCase):
    """End-to-end integration and API tests for the Others role."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        # Clean up any leftover test data
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM users WHERE email LIKE '%@testvisitor.org'")
                cur.execute("DELETE FROM visitors WHERE email LIKE '%@testvisitor.org'")
            conn.commit()
        finally:
            conn.close()

    def setUp(self):
        self.unique_suffix = os.urandom(4).hex()
        self.test_email = f"guest_{self.unique_suffix}@testvisitor.org"
        self.test_password = "VisitorStrongPassword#2026"
        self.test_full_name = f"Guest Scientist {self.unique_suffix}"
        self.dt_in = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        self.dt_out = (datetime.now(timezone.utc) + timedelta(days=1, hours=4)).isoformat()

    def test_registration_validation_errors(self):
        # 1. Missing name
        bad_payload = {
            "full_name": "",
            "email": self.test_email,
            "phone": "+919876543210",
            "purpose_of_visit": "Interview",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Passport",
            "identification_number": "A12345678",
            "password": self.test_password,
            "confirm_password": self.test_password,
        }
        res = self.client.post("/auth/others/register", json=bad_payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Full Name", res.json()["detail"])

        # 2. Invalid email
        bad_payload["full_name"] = "Valid Name"
        bad_payload["email"] = "not-an-email"
        res = self.client.post("/auth/others/register", json=bad_payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("email", res.json()["detail"].lower())

        # 3. Purpose Other without explanation
        bad_payload["email"] = self.test_email
        bad_payload["purpose_of_visit"] = "Other"
        bad_payload["purpose_other"] = ""
        res = self.client.post("/auth/others/register", json=bad_payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("specify the purpose", res.json()["detail"].lower())

        # 4. Check-out before check-in
        bad_payload["purpose_of_visit"] = "Interview"
        bad_payload["expected_check_in"] = self.dt_out
        bad_payload["expected_check_out"] = self.dt_in
        res = self.client.post("/auth/others/register", json=bad_payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("after", res.json()["detail"].lower())

        # 5. Password mismatch
        bad_payload["expected_check_in"] = self.dt_in
        bad_payload["expected_check_out"] = self.dt_out
        bad_payload["confirm_password"] = "MismatchedPassword123"
        res = self.client.post("/auth/others/register", json=bad_payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("not match", res.json()["detail"].lower())

    def test_successful_registration_and_db_persistence(self):
        payload = {
            "full_name": self.test_full_name,
            "email": self.test_email,
            "phone": "+919876543210",
            "purpose_of_visit": "Academic Visit",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Government-Issued Identity Card",
            "identification_number": "IND987654321",
            "password": self.test_password,
            "confirm_password": self.test_password,
        }
        res = self.client.post("/auth/others/register", json=payload)
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertTrue(data["ok"])
        self.assertTrue(data["visitor_id"].startswith("VIS-"))
        self.assertEqual(data["email"], self.test_email)
        self.assertTrue(data["qr_data_uri"].startswith("data:image/png;base64,"))
        self.assertEqual(data["qr_payload"]["identification_number_masked"], "********4321")
        self.assertNotIn(self.test_password, str(data))
        self.assertNotIn("IND987654321", str(data["qr_payload"]))

        # Verify DB records
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, username, role FROM users WHERE LOWER(email) = %s", (self.test_email.lower(),))
                user = cur.fetchone()
                self.assertIsNotNone(user)
                self.assertEqual(user["role"], "others")

                cur.execute("SELECT visitor_id, identification_number_masked, identification_number_hash FROM visitors WHERE user_id = %s", (user["id"],))
                visitor = cur.fetchone()
                self.assertIsNotNone(visitor)
                self.assertEqual(visitor["visitor_id"], data["visitor_id"])
                self.assertEqual(visitor["identification_number_masked"], "********4321")
                self.assertIsNotNone(visitor["identification_number_hash"])
        finally:
            conn.close()

    def test_duplicate_registration_rejected(self):
        payload = {
            "full_name": self.test_full_name,
            "email": self.test_email,
            "phone": "+919876543210",
            "purpose_of_visit": "Vendor",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Driver's License",
            "identification_number": "DL12345678",
            "password": self.test_password,
            "confirm_password": self.test_password,
        }
        res1 = self.client.post("/auth/others/register", json=payload)
        self.assertEqual(res1.status_code, 201)

        # Re-register with the same email
        res2 = self.client.post("/auth/others/register", json=payload)
        self.assertEqual(res2.status_code, 409)
        self.assertIn("already exists", res2.json()["detail"].lower())

    def test_login_workflows_and_token_generation(self):
        # Register user first
        payload = {
            "full_name": self.test_full_name,
            "email": self.test_email,
            "phone": "+919876543210",
            "purpose_of_visit": "Official Meeting",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Passport",
            "identification_number": "P87654321",
            "password": self.test_password,
            "confirm_password": self.test_password,
        }
        self.client.post("/auth/others/register", json=payload)

        # 1. Login via /auth/others/login
        login_res = self.client.post("/auth/others/login", json={"email": self.test_email, "password": self.test_password})
        self.assertEqual(login_res.status_code, 200)
        login_data = login_res.json()
        self.assertEqual(login_data["user"]["role"], "others")
        token = login_data["access_token"]
        self.assertIsNotNone(token)

        # 2. Login via /auth/login with role="others"
        gen_login = self.client.post("/auth/login", json={"username": self.test_email, "password": self.test_password, "role": "others"})
        self.assertEqual(gen_login.status_code, 200)
        self.assertEqual(gen_login.json()["user"]["role"], "others")

        # 3. Wrong password
        bad_pass = self.client.post("/auth/others/login", json={"email": self.test_email, "password": "WrongPassword!"})
        self.assertEqual(bad_pass.status_code, 401)

    def test_role_isolation_and_cross_portal_denial(self):
        # Register visitor
        payload = {
            "full_name": self.test_full_name,
            "email": self.test_email,
            "phone": "+919876543210",
            "purpose_of_visit": "Interview",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Passport",
            "identification_number": "P87654321",
            "password": self.test_password,
            "confirm_password": self.test_password,
        }
        self.client.post("/auth/others/register", json=payload)

        # Visitor cannot log in through Admin portal tab
        admin_login = self.client.post("/auth/login", json={"username": self.test_email, "password": self.test_password, "role": "admin"})
        self.assertEqual(admin_login.status_code, 403)
        self.assertIn("cannot log in", admin_login.json()["detail"].lower())

        # Visitor cannot log in through Student portal tab
        student_login = self.client.post("/auth/login", json={"username": self.test_email, "password": self.test_password, "role": "student"})
        self.assertEqual(student_login.status_code, 403)

        # Admin cannot log in through Others portal tab
        spoof_admin = self.client.post("/auth/login", json={"username": "admin", "password": "admin123", "role": "others"})
        self.assertEqual(spoof_admin.status_code, 403)
        self.assertIn("invalid credentials for visitor", spoof_admin.json()["detail"].lower())

    def test_resource_protection_against_others_role(self):
        # Register and log in visitor
        payload = {
            "full_name": self.test_full_name,
            "email": self.test_email,
            "phone": "+919876543210",
            "purpose_of_visit": "Interview",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Passport",
            "identification_number": "P87654321",
            "password": self.test_password,
            "confirm_password": self.test_password,
        }
        reg = self.client.post("/auth/others/register", json=payload)
        login = self.client.post("/auth/others/login", json={"email": self.test_email, "password": self.test_password})
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Visitor cannot access protected Admin/Faculty endpoints:
        self.assertEqual(self.client.get("/students", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/admin/users", headers=headers).status_code, 403)
        self.assertEqual(self.client.post("/admin/academic/sections", headers=headers, json={}).status_code, 403)
        self.assertEqual(self.client.post("/teacher/attendance-sessions", headers=headers, json={}).status_code, 403)

    def test_visitor_profile_and_cross_visitor_data_protection(self):
        # Register Visitor 1
        payload1 = {
            "full_name": "Visitor One",
            "email": f"visitor1_{self.unique_suffix}@testvisitor.org",
            "phone": "+919876543211",
            "purpose_of_visit": "Client Meeting",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Passport",
            "identification_number": "PASS111111",
            "password": self.test_password,
            "confirm_password": self.test_password,
        }
        reg1 = self.client.post("/auth/others/register", json=payload1)
        vid1 = reg1.json()["visitor_id"]
        login1 = self.client.post("/auth/others/login", json={"email": payload1["email"], "password": self.test_password})
        token1 = login1.json()["access_token"]
        headers1 = {"Authorization": f"Bearer {token1}"}

        # Register Visitor 2
        payload2 = {
            "full_name": "Visitor Two",
            "email": f"visitor2_{self.unique_suffix}@testvisitor.org",
            "phone": "+919876543212",
            "purpose_of_visit": "Vendor",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Driver's License",
            "identification_number": "DRIV222222",
            "password": self.test_password,
            "confirm_password": self.test_password,
        }
        reg2 = self.client.post("/auth/others/register", json=payload2)
        vid2 = reg2.json()["visitor_id"]
        login2 = self.client.post("/auth/others/login", json={"email": payload2["email"], "password": self.test_password})
        token2 = login2.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}

        # Visitor 1 retrieves their own profile
        me1 = self.client.get("/visitors/me", headers=headers1)
        self.assertEqual(me1.status_code, 200)
        self.assertEqual(me1.json()["visitor_id"], vid1)
        self.assertEqual(me1.json()["identification_number_masked"], "******1111")

        # Visitor 1 downloads their own QR code
        qr1 = self.client.get(f"/visitors/{vid1}/qr", headers=headers1)
        self.assertEqual(qr1.status_code, 200)
        self.assertEqual(qr1.headers["content-type"], "image/png")
        self.assertIn("attachment", qr1.headers["content-disposition"])

        # Unauthenticated / direct visitor pass QR download succeeds without 401
        qr1_public = self.client.get(f"/visitors/{vid1}/qr")
        self.assertEqual(qr1_public.status_code, 200)
        self.assertEqual(qr1_public.headers["content-type"], "image/png")

        # SNOOPING DENIAL: Visitor 1 attempts to view Visitor 2's details -> 403
        snoop_details = self.client.get(f"/visitors/{vid2}", headers=headers1)
        self.assertEqual(snoop_details.status_code, 403)

        # SNOOPING DENIAL: Visitor 1 attempts to download Visitor 2's QR code -> 403
        snoop_qr = self.client.get(f"/visitors/{vid2}/qr", headers=headers1)
        self.assertEqual(snoop_qr.status_code, 403)

        # Admin CAN access Visitor 1's QR code
        admin_login = self.client.post("/auth/login", json={"username": "admin", "password": "admin123"})
        admin_token = admin_login.json()["access_token"]
        admin_qr = self.client.get(f"/visitors/{vid1}/qr", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(admin_qr.status_code, 200)
        self.assertEqual(admin_qr.headers["content-type"], "image/png")

    def test_existing_admin_login_and_attendance_preserved(self):
        # Verify standard admin login remains 100% operational
        res = self.client.post("/auth/login", json={"username": "admin", "password": "admin123"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["user"]["role"], "admin")
        token = res.json()["access_token"]
        # Verify admin access to core endpoints
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertIn("model_loaded", health.json())
    def test_registration_with_optional_photo(self):
        # 1x1 valid PNG transparent pixel in base64
        sample_png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        photo_payload = {
            "full_name": f"Photogenic Visitor {self.unique_suffix}",
            "email": f"photo_{self.unique_suffix}@testvisitor.org",
            "phone": "+919876543210",
            "purpose_of_visit": "Interview",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Passport",
            "identification_number": "PHOTO1234",
            "password": self.test_password,
            "confirm_password": self.test_password,
            "photo_base64": f"data:image/png;base64,{sample_png_b64}",
        }
        res = self.client.post("/auth/others/register", json=photo_payload)
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertTrue(data["ok"])
        self.assertIsNotNone(data.get("profile_photo_url"))

        # Log in and verify /visitors/me has photo
        login_res = self.client.post("/auth/others/login", json={"email": photo_payload["email"], "password": self.test_password})
        self.assertEqual(login_res.status_code, 200)
        tok = login_res.json()["access_token"]
        me_res = self.client.get("/visitors/me", headers={"Authorization": f"Bearer {tok}"})
        self.assertEqual(me_res.status_code, 200)
        # Verify DB: profile_photo is NULL and profile_picture points to relative path
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT profile_photo, profile_picture FROM users WHERE LOWER(email) = %s", (photo_payload["email"].lower(),))
                u = cur.fetchone()
                self.assertIsNotNone(u)
                self.assertIsNone(u["profile_photo"], "profile_photo in users must be NULL (no BLOB/base64 stored in DB)")
                self.assertIsNotNone(u["profile_picture"])
                self.assertTrue(u["profile_picture"].startswith("student_photos/"))

                cur.execute("SELECT profile_photo, profile_picture FROM visitors WHERE LOWER(email) = %s", (photo_payload["email"].lower(),))
                v = cur.fetchone()
                self.assertIsNotNone(v)
                self.assertIsNone(v["profile_photo"], "profile_photo in visitors must be NULL (no BLOB/base64 stored in DB)")
                self.assertIsNotNone(v["profile_picture"])
        finally:
            conn.close()

    def test_registration_with_multipart_photo_file(self):
        sample_png_bytes = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        email = f"multi_{self.unique_suffix}@testvisitor.org"
        form_data = {
            "full_name": f"Multipart Visitor {self.unique_suffix}",
            "email": email,
            "phone": "+919876543210",
            "purpose_of_visit": "Vendor",
            "expected_check_in": self.dt_in,
            "expected_check_out": self.dt_out,
            "identification_type": "Passport",
            "identification_number": "MULTI1234",
            "password": self.test_password,
            "confirm_password": self.test_password,
        }
        files = {
            "file": ("avatar.png", sample_png_bytes, "image/png"),
        }
        res = self.client.post("/auth/others/register", data=form_data, files=files)
        self.assertEqual(res.status_code, 201)
        res_data = res.json()
        self.assertTrue(res_data["ok"])
        self.assertIsNotNone(res_data.get("profile_photo_url"))
        self.assertIsNotNone(res_data.get("profile_photo_base64"))
        self.assertTrue(res_data.get("profile_photo_base64", "").startswith("data:image/"))

        # Verify DB has profile_photo = NULL and profile_picture set
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT profile_photo, profile_picture FROM users WHERE LOWER(email) = %s", (email.lower(),))
                u = cur.fetchone()
                self.assertIsNotNone(u)
                self.assertIsNone(u["profile_photo"], "users.profile_photo must be NULL")
                self.assertIsNotNone(u["profile_picture"])
                self.assertTrue(u["profile_picture"].startswith("student_photos/"))

                cur.execute("SELECT profile_photo, profile_picture FROM visitors WHERE LOWER(email) = %s", (email.lower(),))
                v = cur.fetchone()
                self.assertIsNotNone(v)
                self.assertIsNone(v["profile_photo"], "visitors.profile_photo must be NULL")
                self.assertIsNotNone(v["profile_picture"])
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()

