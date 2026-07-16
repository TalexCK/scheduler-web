FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM rust:1.88-bookworm AS backend-builder
WORKDIR /build/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home scheduler-web
WORKDIR /app
COPY --from=backend-builder /build/backend/target/release/scheduler-web-backend /usr/local/bin/scheduler-web
COPY --from=frontend-builder /build/frontend/dist ./frontend
ENV BIND_ADDR=0.0.0.0:8080 \
  FRONTEND_DIR=/app/frontend \
  DB_MAX_CONNECTIONS=10 \
  RUST_LOG=info
EXPOSE 8080
USER scheduler-web
ENTRYPOINT ["scheduler-web"]
