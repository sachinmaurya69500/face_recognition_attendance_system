"""Comprehensive unit test suite for Redis Session & State Management."""
import time
import unittest
from unittest.mock import patch

from app.session_manager import (
    create_user_session,
    decode_and_validate_token,
    delete_attendance_live_state,
    get_attendance_live_state,
    get_batch_progress,
    get_user_session,
    init_attendance_live_state,
    is_token_revoked,
    list_user_sessions,
    redis_lock,
    revoke_all_user_sessions,
    revoke_user_session,
    set_attendance_live_status,
    set_batch_progress,
    touch_user_session,
    update_attendance_live_counters,
    update_batch_progress_step,
    LockAcquisitionError,
)


class TestSessionManager(unittest.TestCase):

    def setUp(self):
        self.mock_user = {
            "id": 9999,
            "username": "testuser_enterprise",
            "role": "teacher",
            "student_id": None,
        }

    def tearDown(self):
        revoke_all_user_sessions(self.mock_user["id"])

    def test_create_and_get_user_session(self):
        token, sid = create_user_session(
            self.mock_user,
            client_ip="192.168.1.100",
            user_agent="PratyakshMobile/2.0",
        )
        self.assertTrue(token)
        self.assertTrue(sid.startswith("sid_"))

        session = get_user_session(sid)
        self.assertIsNotNone(session)
        self.assertEqual(session["user_id"], 9999)
        self.assertEqual(session["username"], "testuser_enterprise")
        self.assertEqual(session["client_ip"], "192.168.1.100")
        self.assertEqual(session["user_agent"], "PratyakshMobile/2.0")

    def test_touch_session(self):
        token, sid = create_user_session(self.mock_user)
        session_before = get_user_session(sid)
        time.sleep(0.01)
        # Call with throttle_seconds=0 so it updates immediately
        touch_user_session(sid, throttle_seconds=0)
        session_after = get_user_session(sid)
        self.assertGreaterEqual(session_after["last_active"], session_before["last_active"])

    def test_revoke_user_session(self):
        token, sid = create_user_session(self.mock_user)
        self.assertFalse(is_token_revoked(sid))
        self.assertIsNotNone(get_user_session(sid))

        revoked = revoke_user_session(sid, user_id=self.mock_user["id"])
        self.assertTrue(revoked)
        self.assertTrue(is_token_revoked(sid))
        self.assertIsNone(get_user_session(sid))

    def test_revoke_all_user_sessions(self):
        token1, sid1 = create_user_session(self.mock_user, client_ip="10.0.0.1")
        token2, sid2 = create_user_session(self.mock_user, client_ip="10.0.0.2")

        sessions = list_user_sessions(self.mock_user["id"])
        self.assertEqual(len(sessions), 2)

        revoked_count = revoke_all_user_sessions(self.mock_user["id"])
        self.assertEqual(revoked_count, 2)

        self.assertTrue(is_token_revoked(sid1))
        self.assertTrue(is_token_revoked(sid2))
        self.assertEqual(len(list_user_sessions(self.mock_user["id"])), 0)

    def test_list_user_sessions_with_current(self):
        _token1, sid1 = create_user_session(self.mock_user, client_ip="10.0.0.1")
        _token2, sid2 = create_user_session(self.mock_user, client_ip="10.0.0.2")

        sessions = list_user_sessions(self.mock_user["id"], current_sid=sid2)
        self.assertEqual(len(sessions), 2)
        s2_match = next((s for s in sessions if s["session_id"] == sid2), None)
        self.assertIsNotNone(s2_match)
        self.assertTrue(s2_match["is_current"])

    def test_decode_and_validate_token_success_and_revocation(self):
        token, sid = create_user_session(self.mock_user)
        header = f"Bearer {token}"

        # 1. Valid token validation
        payload = decode_and_validate_token(header)
        self.assertEqual(payload["sub"], 9999)
        self.assertEqual(payload["username"], "testuser_enterprise")
        self.assertEqual(payload["sid"], sid)

        # 2. Revoked token validation
        revoke_user_session(sid, user_id=self.mock_user["id"])
        with self.assertRaises(ValueError) as ctx:
            decode_and_validate_token(header)
        self.assertIn("revoked", str(ctx.exception).lower())

    def test_decode_and_validate_legacy_token(self):
        # Generate token without "sid" (backward compatibility test)
        import base64
        import hashlib
        import hmac
        import json
        import os
        secret = os.getenv("AUTH_SECRET", "81a9a56aa630c0e7335ce105e1a7892b5a54268ef8ca821d1fdfb6d6fe6c5e2e")
        payload = {"sub": 8888, "username": "legacy_user", "role": "student", "exp": int(time.time()) + 3600}
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
        encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
        sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        legacy_token = f"{encoded}.{sig}"

        decoded = decode_and_validate_token(f"Bearer {legacy_token}")
        self.assertEqual(decoded["sub"], 8888)
        self.assertEqual(decoded["username"], "legacy_user")

    def test_redis_lock(self):
        lock_name = "test_unit_lock"
        with redis_lock(lock_name, timeout_seconds=5.0) as acquired1:
            self.assertTrue(acquired1)
            # Attempt to acquire same lock with 0.1s blocking timeout should fail
            with self.assertRaises(LockAcquisitionError):
                with redis_lock(lock_name, timeout_seconds=5.0, blocking_timeout=0.1):
                    pass

        # After exiting block, lock is released and can be re-acquired
        with redis_lock(lock_name, timeout_seconds=5.0, blocking_timeout=0.5) as acquired2:
            self.assertTrue(acquired2)

    def test_live_attendance_state_and_counters(self):
        session_id = "ATT-TEST-LIVE-01"
        delete_attendance_live_state(session_id)

        # 1. Initialize
        initialized = init_attendance_live_state(
            session_id=session_id,
            teacher_id=9999,
            total_roster=60,
            status="ACTIVE",
        )
        self.assertTrue(initialized)

        state = get_attendance_live_state(session_id)
        self.assertIsNotNone(state)
        self.assertEqual(state["total_roster"], 60)
        self.assertEqual(state["present_count"], 0)
        self.assertEqual(state["absent_count"], 60)

        # 2. Update counters (e.g. 15 recognized present)
        updated = update_attendance_live_counters(
            session_id=session_id,
            present_delta=15,
            absent_delta=-15,
            recognized_delta=15,
        )
        self.assertEqual(updated["present_count"], 15)
        self.assertEqual(updated["absent_count"], 45)
        self.assertEqual(updated["recognized_count"], 15)

        # 3. Update status
        set_attendance_live_status(session_id, "FINALIZED")
        state_after = get_attendance_live_state(session_id)
        self.assertEqual(state_after["status"], "FINALIZED")

        # 4. Clean up
        delete_attendance_live_state(session_id)
        self.assertIsNone(get_attendance_live_state(session_id))

    def test_batch_progress_tracking(self):
        batch_id = "batch-test-progress-01"
        set_batch_progress(
            batch_id=batch_id,
            total_files=5,
            processed_files=0,
            status="PROCESSING",
        )

        p1 = get_batch_progress(batch_id)
        self.assertIsNotNone(p1)
        self.assertEqual(p1["total_files"], 5)
        self.assertEqual(p1["progress_percent"], 0)

        # Process 3 files
        p2 = update_batch_progress_step(
            batch_id=batch_id,
            processed_delta=3,
            recognized_delta=10,
        )
        self.assertEqual(p2["processed_files"], 3)
        self.assertEqual(p2["progress_percent"], 60)
        self.assertEqual(p2["recognized_count"], 10)

        # Process final 2 files
        p3 = update_batch_progress_step(
            batch_id=batch_id,
            processed_delta=2,
            recognized_delta=8,
        )
        self.assertEqual(p3["processed_files"], 5)
        self.assertEqual(p3["progress_percent"], 100)
        self.assertEqual(p3["status"], "COMPLETED")


if __name__ == "__main__":
    unittest.main()
