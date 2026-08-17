# pfpdf Docker renderer image (experimental in v0.1.0).
#
# The image entrypoint is the internal render command contract described in
# docs/design.ja/05_renderers.md. The external CLI is not exposed to prevent
# recursive renderer selection inside the container.
FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS builder

WORKDIR /opt/pfpdf
COPY package.json package-lock.json npm-shrinkwrap.json tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY resources ./resources
RUN npm ci --ignore-scripts && npm run build

FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46

# Debian's Chromium packages move independently of this repository. Keep the
# tested browser build explicit so a rebuild cannot silently change rendering.
ARG CHROMIUM_VERSION=151.0.7922.71-1~deb12u1

LABEL org.opencontainers.image.title="pfpdf"
LABEL jp.preferred.pfpdf.renderer-protocol="1"

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 \
      libdrm2 libgbm1 libglib2.0-0 libnss3 libpango-1.0-0 libx11-6 \
      libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
      fonts-liberation ca-certificates \
      chromium=${CHROMIUM_VERSION} chromium-common=${CHROMIUM_VERSION} \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/pfpdf
COPY package.json package-lock.json npm-shrinkwrap.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /opt/pfpdf/dist ./dist
COPY --from=builder /opt/pfpdf/resources ./resources

RUN useradd --create-home pfpdf
RUN mkdir -p /pfpdf-assets /work && chown pfpdf:pfpdf /work
USER pfpdf
RUN node dist/launcher.js --version

ENTRYPOINT ["node", "/opt/pfpdf/dist/launcher.js"]
