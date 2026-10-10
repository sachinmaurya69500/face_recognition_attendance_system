import json

from app import cache


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.ttls = {}

    def ping(self):
        return True

    def get(self, key):
        return self.values.get(key)

    def setex(self, key, ttl, value):
        self.values[key] = value
        self.ttls[key] = ttl

    def delete(self, *keys):
        for key in keys:
            self.values.pop(key, None)


def setup_function():
    cache._client = FakeRedis()


def test_cache_round_trip_and_ttl():
    cache.cache_set("academic:sections", [{"id": 1}], ttl=300)
    assert cache.cache_get("academic:sections") == [{"id": 1}]
    assert cache._client.ttls["academic:sections"] == 300


def test_cache_delete_invalidates_keys():
    cache.cache_set("session:list", {"count": 2})
    cache.cache_delete("session:list")
    assert cache.cache_get("session:list") is None


def test_cache_available():
    assert cache.cache_available() is True

