# Web app image (Next.js). The /api/v1 rewrite target is fixed at build time.
# docker build -f deploy/docker/frontend.Dockerfile --build-arg BACKEND_URL=http://nextgen-backend:4000 -t nextgen/frontend:<tag> .

FROM node:22-alpine AS build
WORKDIR /app
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=$BACKEND_URL NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY database/package.json database/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend --include-workspace-root --no-audit --no-fund
COPY frontend frontend
RUN npm run build -w frontend

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
COPY database/package.json database/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend --include-workspace-root --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/frontend/.next frontend/.next
COPY --from=build /app/frontend/public frontend/public
COPY --from=build /app/frontend/next.config.ts frontend/
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/login || exit 1
WORKDIR /app/frontend
CMD ["npx", "next", "start", "-p", "3000"]
