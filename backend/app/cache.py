"""Best-effort Redis cache helpers.

Redis is an optimization only: API requests continue to work when Redis is
down, so cache availability never affects attendance correctness.
"""
import json
import os

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None

_client = None

def _get_client():
    global _client
    if _client is None and redis is not None:
        try:
            _client = redis.Redis.from_url(
                os.getenv("REDIS_URL", "redis://redis:6379/0"),
                decode_responses=True,
                socket_connect_timeout=0.25,
                socket_timeout=0.25,
            )
            _client.ping()
        except Exception:
            _client = False
    return _client if _client is not False else None

def cache_get(key):
    try:
        value = _get_client().get(key)
        return json.loads(value) if value else None
    except Exception:
        return None

def cache_set(key, value, ttl=60):
    try:
        client = _get_client()
        if client:
            client.setex(key, ttl, json.dumps(value, default=str))
    except Exception:
        pass

def cache_delete(*keys):
    try:
        client = _get_client()
        if client and keys:
            client.delete(*keys)
    except Exception:
        pass

def cache_available():
    """Return whether Redis is currently reachable."""
    try:
        client = _get_client()
        return bool(client and client.ping())
    except Exception:
        return False
