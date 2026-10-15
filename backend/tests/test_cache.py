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

    def test_required_1_initial_cache_population(self):
        """TEST 1: Initial cache population creates expected entry."""
        key = "test:req1:population"
        cache.cache_delete(key)
        self.assertIsNone(cache.cache_get(key))

        ok = cache.cache_set(key, {"user": "faculty_1", "role": "teacher"}, ttl=60)
        self.assertTrue(ok)
        val = cache.cache_get(key)
        self.assertIsNotNone(val)
        self.assertEqual(val["user"], "faculty_1")
        cache.cache_delete(key)

    def test_required_2_cache_hit_and_latency(self):
        """TEST 2: Cache hit reuses cached result with sub-millisecond RAM latency."""
        key = "test:req2:hit"
        payload = {"catalog": [{"id": i, "name": f"Item {i}"} for i in range(50)]}
        cache.cache_set(key, payload, ttl=60)

        # First read populates L1
        val1 = cache.cache_get(key, use_l1=True)
        self.assertEqual(val1, payload)

        # Second read from L1 must be instantaneous (<1ms)
        t0 = time.perf_counter()
        val2 = cache.cache_get(key, use_l1=True)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        self.assertEqual(val2, payload)
        self.assertLess(elapsed_ms, 1.0)
        cache.cache_delete(key)

    def test_required_3_cache_miss_and_expiration(self):
        """TEST 3: Cache miss returns None, and short-TTL entries expire as expected."""
        key = "test:req3:miss"
        cache.cache_delete(key)
        # Miss on non-existent key
        self.assertIsNone(cache.cache_get(key))

        # Test L1 expiration
        cache._l1_cache.set(key, "temporary", ttl=0.1)
        time.sleep(0.15)
        self.assertIsNone(cache._l1_cache.get(key))

    def test_required_4_cache_invalidation(self):
        """TEST 4: Invalidation removes specific keys and wildcard patterns immediately."""
        key1 = "attendance:session:ATT-TEST-1:roster"
        key2 = "attendance:session:ATT-TEST-1:records:p=1"
        key3 = "attendance:session:ATT-TEST-2:roster"

        cache.cache_set(key1, {"students": [1, 2]}, ttl=60)
        cache.cache_set(key2, {"items": [1]}, ttl=60)
        cache.cache_set(key3, {"students": [3, 4]}, ttl=60)

        # Invalidate only session 1
        deleted = cache.cache_delete_pattern("attendance:session:ATT-TEST-1:*")
        self.assertGreaterEqual(deleted, 2)

        self.assertIsNone(cache.cache_get(key1))
        self.assertIsNone(cache.cache_get(key2))
        self.assertIsNotNone(cache.cache_get(key3))

        cache.cache_delete(key3)

    def test_required_5_error_handling_and_circuit_breaker(self):
        """TEST 5: Cache operations gracefully handle Redis errors without crashing."""
        original_client = cache._client
        try:
            # Force circuit breaker open
            cache._circuit_open_until = time.monotonic() + 1.0
            # Cache get should gracefully return None
            self.assertIsNone(cache.cache_get("some:unreachable:key", use_l1=False))
            # Cache set should return False without raising
            self.assertFalse(cache.cache_set("some:unreachable:key", "data", use_l1=False))
        finally:
            cache._circuit_open_until = 0.0
            cache._client = original_client

    def test_required_6_concurrent_access_and_stampede(self):
        """TEST 6: Concurrent threads requesting same missing key do not cause stampede."""
        import concurrent.futures

        call_count = 0
        def compute_slow_data():
            nonlocal call_count
            time.sleep(0.05)
            call_count += 1
            return {"heavy": "computation"}

        key = "test:req6:stampede"
        cache.cache_delete(key)

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [
                executor.submit(cache.cache_get_or_compute, key, compute_slow_data, ttl=30)
                for _ in range(10)
            ]
            results = [f.result() for f in futures]

        for r in results:
            self.assertEqual(r, {"heavy": "computation"})
        self.assertLessEqual(call_count, 2)
        cache.cache_delete(key)

    def test_required_7_memory_l1_mutation_isolation(self):
        """TEST 7: Mutating an object returned from L1 does not corrupt the cached data."""
        key = "test:req7:isolation"
        original = {"session_id": "ATT-SAFE", "students": [{"name": "Student A", "status": "ABSENT"}]}
        cache.cache_set(key, original, ttl=60)

        # Fetch and mutate the returned dictionary in-place
        retrieved = cache.cache_get(key, use_l1=True)
        retrieved["students"][0]["status"] = "PRESENT"
        retrieved["mutated_field"] = "CORRUPTED"

        # Re-fetch from cache: it must remain pristine and uncorrupted
        fresh_copy = cache.cache_get(key, use_l1=True)
        self.assertEqual(fresh_copy["students"][0]["status"], "ABSENT")
        self.assertNotIn("mutated_field", fresh_copy)
        cache.cache_delete(key)


if __name__ == "__main__":
    unittest.main()
