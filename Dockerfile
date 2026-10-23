# Satu image: build web, lalu Express menyajikan API + hasil build di satu port.
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DB_PATH=/data/inspections.db \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev
COPY server/src ./server/src
COPY --from=web /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server/src/index.js"]
