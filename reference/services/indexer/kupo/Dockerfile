# Build the portable component once; no Rust toolchain is needed at startup.
FROM rust:1.95.0-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1 AS component
WORKDIR /plugin
RUN rustup target add wasm32-wasip2
COPY packages/plugins/integrations/example-plugin/plugin ./
RUN --mount=type=cache,target=/usr/local/cargo/registry cargo build --locked --release --target wasm32-wasip2

FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS packages
WORKDIR /app/reference
COPY package.json package-lock.json tsconfig.json ./
COPY packages/plugins ./packages/plugins
COPY services/indexer/kupo/package.json ./services/indexer/kupo/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY --from=component /plugin/target/wasm32-wasip2/release/example_plugin.wasm ./packages/plugins/integrations/example-plugin/plugin/target/wasm32-wasip2/release/example_plugin.wasm
RUN npm run build --workspace @ctvs/plugins \
    && npm run build:js --workspace @ctvs/example-plugin \
    && node packages/plugins/integrations/example-plugin/tools/assets.js \
    && npx tsc -p packages/plugins/integrations/example-plugin/tsconfig.build.json
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --omit=dev --no-audit --no-fund --workspace @ctvs/kupo-startup

FROM cardanosolutions/kupo@sha256:7d3c62368a4a5a609f5cf0ee6949eb8d491ed8f5a4d05b38da3213d95735f03b AS kupo

FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe
WORKDIR /app/reference
COPY --from=kupo /bin/kupo /usr/local/bin/kupo
COPY --from=packages /app/reference/node_modules ./node_modules
COPY --from=packages /app/reference/packages/plugins/package.json ./packages/plugins/package.json
COPY --from=packages /app/reference/packages/plugins/dist ./packages/plugins/dist
COPY --from=packages /app/reference/packages/plugins/integrations/example-plugin/package.json ./packages/plugins/integrations/example-plugin/package.json
COPY --from=packages /app/reference/packages/plugins/integrations/example-plugin/dist ./packages/plugins/integrations/example-plugin/dist
COPY services/indexer/kupo/package.json services/indexer/kupo/entrypoint.sh ./services/indexer/kupo/
COPY services/indexer/kupo/src ./services/indexer/kupo/src
# Preserve upstream Kupo's user so the node's existing socket permissions still apply.
RUN mkdir /kupo-db /plugin-cache
WORKDIR /app/reference/services/indexer/kupo
EXPOSE 1442
STOPSIGNAL SIGINT
HEALTHCHECK --interval=10s --timeout=5s --retries=1 CMD ["kupo", "health-check"]
ENTRYPOINT ["./entrypoint.sh"]
