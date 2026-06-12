FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

RUN mkdir -p /data/uploads
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --retries=12 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "src/index.js"]
