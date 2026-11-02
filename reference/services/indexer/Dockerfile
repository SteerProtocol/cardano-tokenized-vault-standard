# Exact CI runtime; node:sqlite is available without a flag at this version.
FROM node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e
WORKDIR /app/reference
COPY package.json package-lock.json ./
COPY packages ./packages
COPY implementations ./implementations
COPY testing/package.json ./testing/package.json
COPY services/indexer ./services/indexer
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund && mkdir /data && chown node:node /data
USER node
WORKDIR /app/reference/services/indexer
ENV CTVS_INDEXER_CONFIG=/configuration/indexer.json
EXPOSE 8080
# Run the daemon as PID 1 so Docker SIGTERM reaches its orderly shutdown handler.
CMD ["node", "--import", "tsx", "src/main.ts"]
