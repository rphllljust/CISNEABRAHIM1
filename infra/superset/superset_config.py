# MASTER 015 — isolated Superset settings for HML, not a production template.
import os
from sqlalchemy.engine import URL

SECRET_KEY = os.environ["SUPERSET_SECRET_KEY"]
GUEST_TOKEN_JWT_SECRET = os.environ["SUPERSET_GUEST_TOKEN_JWT_SECRET"]
GUEST_TOKEN_JWT_EXP_SECONDS = 120
GUEST_ROLE_NAME = "CISNE_EMBEDDED_GUEST"

SQLALCHEMY_DATABASE_URI = URL.create(
    "postgresql+psycopg2",
    username=os.environ["SUPERSET_METADATA_USER"],
    password=os.environ["SUPERSET_METADATA_PASSWORD"],
    host="superset-metadata",
    port=5432,
    database="superset",
).render_as_string(hide_password=False)

FEATURE_FLAGS = {
    "EMBEDDED_SUPERSET": True,
    "DISABLE_EMBEDDED_SUPERSET_LOGOUT": True,
}
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_SAMESITE = "None"
ENABLE_PROXY_FIX = True

CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 120,
    "CACHE_REDIS_URL": "redis://superset-cache:6379/0",
}
DATA_CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 120,
    "CACHE_REDIS_URL": "redis://superset-cache:6379/1",
}
# Set strict frame-ancestors in the HML TLS reverse proxy.
# Restrict Allowed Domains in each dashboard's Superset Embed settings.
# The embedded guest role must never receive SQL Lab or SQL dataset creation.
