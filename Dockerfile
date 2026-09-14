FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/conductor-panel/package.json packages/conductor-panel/package.json
COPY tools/patch-cxone-utf8.mjs tools/patch-cxone-utf8.mjs
RUN npm ci --no-audit

COPY . .
RUN npm run build --workspace @libretexts/remedy-core \
    && npm run build --workspace @libretexts/remedy-cli \
    && npm run build --workspace @libretexts/remedy-conductor-panel

EXPOSE 5175
CMD ["npx", "tsx", "packages/conductor-panel/server/server.ts"]
