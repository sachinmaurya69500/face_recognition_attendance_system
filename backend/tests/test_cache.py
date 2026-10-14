"""Unit tests for high-throughput multi-tier Redis and in-memory cache engine."""
import time
import unittest
from app import cache


class TestCacheEngine(unittest.TestCase):
    def setUp(self):
        # Clear L1 memory store
        cache._l1_cache.clear()

    def test_cache_available(self):
        self.assertTrue(cache.cache_available())

    def test_round_trip_and_serialization(self):
        test_payload = {
            "id": 101,
            "name": "Distributed Attendance Node",
            "active": True,
            "metrics": [1.2, 3.4, 5.6],
        }
        ok = cache.cache_set("unit:test:payload", test_payload, ttl=60)
        self.assertTrue(ok)

        # Retrieve via L1
        retrieved_l1 = cache.cache_get("unit:test:payload", use_l1=True)
        self.assertEqual(retrieved_l1, test_payload)

        # Retrieve bypassing L1 (direct from L2 Redis)
        retrieved_l2 = cache.cache_get("unit:test:payload", use_l1=False)
        self.assertEqual(retrieved_l2, test_payload)

    def test_deletion_single_and_multi(self):
        cache.cache_set("unit:del:1", "val1", ttl=60)
        cache.cache_set("unit:del:2", "val2", ttl=60)

        self.assertEqual(cache.cache_get("unit:del:1"), "val1")
        self.assertEqual(cache.cache_get("unit:del:2"), "val2")

        cache.cache_delete("unit:del:1", "unit:del:2")

        self.assertIsNone(cache.cache_get("unit:del:1"))
        self.assertIsNone(cache.cache_get("unit:del:2"))

    def test_pattern_deletion(self):
        cache.cache_set("unit:wildcard:session:1", {"session": 1}, ttl=60)
        cache.cache_set("unit:wildcard:session:2", {"session": 2}, ttl=60)
        cache.cache_set("unit:wildcard:other", {"other": True}, ttl=60)

        deleted = cache.cache_delete_pattern("unit:wildcard:session:*")
        self.assertGreaterEqual(deleted, 2)

        self.assertIsNone(cache.cache_get("unit:wildcard:session:1"))
        self.assertIsNone(cache.cache_get("unit:wildcard:session:2"))
        self.assertEqual(cache.cache_get("unit:wildcard:other"), {"other": True})

        cache.cache_delete("unit:wildcard:other")

    def test_compression_large_payload(self):
        # 100 items with long strings to exceed 4KB compression threshold
        large_list = [
            {"student_id": f"STU_{i:04d}", "metadata": "a" * 80, "score": 98.5}
            for i in range(100)
        ]
        ok = cache.cache_set("unit:compression:large", large_list, ttl=60)
        self.assertTrue(ok)

        # Retrieve direct from Redis L2
        retrieved = cache.cache_get("unit:compression:large", use_l1=False)
        self.assertEqual(retrieved, large_list)
        cache.cache_delete("unit:compression:large")

    def test_bulk_mget_and_mset(self):
        mapping = {
            "unit:bulk:a": {"letter": "A"},
            "unit:bulk:b": {"letter": "B"},
            "unit:bulk:c": {"letter": "C"},
        }
        ok = cache.cache_mset(mapping, ttl=60)
        self.assertTrue(ok)

        results = cache.cache_mget(list(mapping.keys()))
        self.assertEqual(results, mapping)

        cache.cache_delete(*mapping.keys())

    def test_rate_limiter(self):
        test_key = f"test_device_{int(time.time())}"
        # Allow 3 requests per 10-second window
        allowed1, rem1, _ = cache.cache_rate_limit(test_key, max_requests=3, window_seconds=10)
        self.assertTrue(allowed1)

        allowed2, rem2, _ = cache.cache_rate_limit(test_key, max_requests=3, window_seconds=10)
        self.assertTrue(allowed2)

        allowed3, rem3, _ = cache.cache_rate_limit(test_key, max_requests=3, window_seconds=10)
        self.assertTrue(allowed3)

        # 4th request should be blocked
        allowed4, rem4, reset4 = cache.cache_rate_limit(test_key, max_requests=3, window_seconds=10)
        self.assertFalse(allowed4)
        self.assertEqual(rem4, 0)
        self.assertGreater(reset4, 0)

    def test_cache_stats(self):
        stats = cache.cache_stats()
        self.assertEqual(stats["status"], "online")
        self.assertIn("l1_hits", stats)
        self.assertIn("l2_hits", stats)
        self.assertIn("hit_ratio_percent", stats)

    def test_cached_result_decorator(self):
        call_count = 0

        @cache.cached_result("unit:decorated", ttl=30)
        def expensive_computation(x, y):
            nonlocal call_count
            call_count += 1
            return x + y

        res1 = expensive_computation(10, 20)
        self.assertEqual(res1, 30)
        self.assertEqual(call_count, 1)

        # Second call should be served from cache
        res2 = expensive_computation(10, 20)
        self.assertEqual(res2, 30)
        self.assertEqual(call_count, 1)

        cache.cache_delete_pattern("unit:decorated:*")


if __name__ == "__main__":
    unittest.main()
