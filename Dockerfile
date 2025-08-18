# Use Puppeteer’s maintained image that bundles Chrome + deps
FROM ghcr.io/puppeteer/puppeteer:22.12.1

WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm i --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
