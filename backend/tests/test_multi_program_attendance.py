"""Test suite for Multi-Program / Multi-Semester Attendance taking."""
import json
import unittest

from app.database import get_db_connection
from app.main import session_section_ids


class TestMultiProgramAttendance(unittest.TestCase):

    def test_session_section_ids_extraction(self):
        # Case 1: single section
        s1 = {"section_id": 10, "academic_scope": None}
        self.assertEqual(session_section_ids(s1), [10])

        # Case 2: multiple sections in scope as dict
        s2 = {
            "section_id": 1,
            "academic_scope": {
                "section_ids": [1, 9, 17, 25],
                "programs": ["B.Sc. IT", "BCA", "MCA"],
            },
        }
        self.assertEqual(session_section_ids(s2), [1, 9, 17, 25])

        # Case 3: multiple sections in scope as json string
        s3 = {
            "section_id": 1,
            "academic_scope": json.dumps({"section_ids": [1, 5, 11]}),
        }
        self.assertEqual(session_section_ids(s3), [1, 5, 11])

    def test_multi_program_database_queries(self):
        """Verify database queries for multi-section sessions execute cleanly without SQL errors."""
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Select sections from two different programs (e.g. B.Sc. IT sem 1 & BCA sem 1)
                cur.execute("SELECT id, school, faculty, department, program, semester FROM academic_sections WHERE id IN (1, 9) ORDER BY id")
                sections = cur.fetchall()
                self.assertEqual(len(sections), 2)

                # Query combined roster
                cur.execute("SELECT student_id, name, section_id FROM students WHERE section_id = ANY(%s)", ([1, 9],))
                roster = cur.fetchall()
                # We know section 1 has 34 students and section 9 has 29 students in the database
                self.assertGreaterEqual(len(roster), 50)
                sec_ids = {r["section_id"] for r in roster}
                self.assertTrue(1 in sec_ids and 9 in sec_ids)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
