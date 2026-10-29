FROM node:22.23.2-bookworm-slim AS node
FROM ubuntu:24.04

COPY --from=node /usr/local/ /usr/local/
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git unzip \
    libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
    libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
    libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxkbcommon0 libxrandr2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 pfpdf \
    && useradd --uid 10001 --gid 10001 --create-home pfpdf

WORKDIR /opt/pfpdf
COPY package.json package-lock.json npm-shrinkwrap.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY resources/ ./resources/
RUN npm run build

ENV HOME=/tmp XDG_CACHE_HOME=/cache
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["node", "/opt/pfpdf/dist/launcher.js"]
