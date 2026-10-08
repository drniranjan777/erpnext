# API + background worker image (NestJS on Fastify). Also runs database migrations (see the Helm hook).
# Build from the repository root:  docker build -f deploy/docker/backend.Dockerfile -t nextgen/backend:<tag> .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY database/package.json database/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace database --workspace backend --include-workspace-root --no-audit --no-fund
COPY database database
COPY backend backend
RUN npm run build -w database && npm run build -w backend

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
COPY database/package.json database/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Migrations run with tsx, so the database workspace keeps its dev tools.
RUN npm ci --workspace database --workspace backend --include-workspace-root --omit=dev --no-audit --no-fund \
 && npm install --no-save --workspace database tsx \
 && npm cache clean --force
COPY --from=build /app/database/dist database/dist
COPY --from=build /app/database/src database/src
COPY --from=build /app/database/sql database/sql
COPY --from=build /app/database/migrations database/migrations
COPY --from=build /app/backend/dist backend/dist
RUN mkdir -p /data/storage /data/mail && chown -R app:app /data
USER app
ENV PORT=4000 STORAGE_DIR=/data/storage MAIL_DIR=/data/mail
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:4000/api/v1/health/live || exit 1
WORKDIR /app/backend
CMD ["node", "dist/main.js"]
