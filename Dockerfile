FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY app.js ./
COPY lib ./lib
COPY public ./public
COPY fixtures ./fixtures

RUN mkdir -p /app/data \
    && chown -R node:node /app

USER node

ENV NODE_ENV=production \
    PORT=8080 \
    PROXY_PORT=3456 \
    DATA_DIR=/app/data \
    AMAZON_PAGE=amazon.de \
    ACCEPT_LANGUAGE=de-DE \
    MOCK_MODE=false

EXPOSE 8080 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/api/status >/dev/null || exit 1

CMD ["node", "app.js"]
