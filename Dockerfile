# One container runs the whole app: FastAPI serves the API and the built frontend.

# ---- build the frontend ----
FROM node:22-slim AS web
WORKDIR /web
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# ---- run the backend ----
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/src ./src
COPY --from=web /web/dist ./static

# SQLite in /data by default (mount a volume there); set DATABASE_URL for Postgres instead.
ENV FRONTEND_DIST=/app/static DATABASE_URL=sqlite:////data/pianoteacher.db PORT=8000
EXPOSE 8000
# Hosts terminate HTTPS in front of the app; trust their forwarded headers so cookies are marked secure.
CMD ["sh", "-c", "uvicorn src.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
