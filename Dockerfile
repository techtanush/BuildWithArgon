# Build from repository root. Kernel is a persistent service, not a Vercel function.
FROM ghcr.io/astral-sh/uv:0.9.5 AS uv
FROM python:3.12-slim
COPY --from=uv /uv /uvx /bin/
ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    DATA_DIR=/data WEB_PUBLIC_DIR=/app/argon-app/web/public AUTH_MODE=gateway
WORKDIR /app/argon-app/kernel
COPY argon-app/kernel/pyproject.toml argon-app/kernel/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY argon-app/kernel/foundry_kernel ./foundry_kernel
RUN uv sync --frozen --no-dev && useradd --create-home --uid 10001 foundry && mkdir -p /data && chown foundry:foundry /data
COPY argon-app/web/public /app/argon-app/web/public
USER foundry
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=4)"
# Exactly one process: embedded scheduler + SQLite must not be duplicated.
CMD ["/app/argon-app/kernel/.venv/bin/uvicorn", "foundry_kernel.app:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1", "--no-access-log"]
