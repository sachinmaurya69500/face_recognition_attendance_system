"""Enterprise High-Concurrency PostgreSQL Connection Pool.

Maintains a robust ThreadedConnectionPool for database operations, avoiding TCP
connection creation bottlenecks under heavy concurrent load (>100k requests/sec).
"""
import logging
import os
from contextlib import contextmanager
from typing import Optional

import psycopg2
from pgvector.psycopg2 import register_vector
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

logger = logging.getLogger("attendance.database")

# Docker Compose supplies DB_HOST=db through backend/.env. Native runs default
# to the PostgreSQL service on this computer.
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "attendance_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres_secure_pass")
DB_POOL_MIN = int(os.getenv("DB_POOL_MIN", "5"))
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "50"))

_db_pool: Optional[pool.ThreadedConnectionPool] = None


def _init_pool():
    global _db_pool
    if _db_pool is None:
        try:
            _db_pool = pool.ThreadedConnectionPool(
                minconn=DB_POOL_MIN,
                maxconn=DB_POOL_MAX,
                host=DB_HOST,
                port=DB_PORT,
                dbname=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
                cursor_factory=RealDictCursor,
            )
            logger.info("Database connection pool initialized (min=%d, max=%d)", DB_POOL_MIN, DB_POOL_MAX)
        except Exception as exc:
            logger.warning("Failed to initialize database connection pool, falling back to direct connections: %s", exc)
            _db_pool = None
    return _db_pool


class PooledConnection:
    """Wrapper that returns the connection to ThreadedConnectionPool on .close()."""

    def __init__(self, raw_conn, pool_ref):
        self._conn = raw_conn
        self._pool = pool_ref
        self._closed = False

    def close(self):
        if not self._closed:
            self._closed = True
            if self._pool is not None:
                try:
                    # Roll back any dangling transaction before returning to pool
                    self._conn.rollback()
                    self._pool.putconn(self._conn)
                except Exception:
                    pass
            else:
                self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def __getattr__(self, name):
        return getattr(self._conn, name)


def get_db_connection():
    """Obtain a pooled connection, falling back to a direct connection if needed."""
    p = _init_pool()
    if p is not None:
        try:
            raw_conn = p.getconn()
            register_vector(raw_conn)
            return PooledConnection(raw_conn, p)
        except Exception as exc:
            logger.warning("Error getting connection from pool: %s, falling back to direct", exc)

    # Fallback to direct connection if pool fails or is exhausted
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        cursor_factory=RealDictCursor,
    )
    register_vector(conn)
    return conn


@contextmanager
def db_cursor(commit: bool = False):
    """Context manager for clean, pooled database transactions."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            yield cur
        if commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
