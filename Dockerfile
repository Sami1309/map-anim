# Use the official Puppeteer image (Chrome preinstalled)
FROM ghcr.io/puppeteer/puppeteer:22.12.1

# Run as the non-root user the image provides
USER pptruser
WORKDIR /app

# 1) Copy only the manifests first, with correct ownership
COPY --chown=pptruser:pptruser package.json package-lock.json ./

# 2) Install deps (uses the lockfile but won’t try to rewrite it)
RUN npm ci --no-audit --no-fund

# 3) Copy the rest of the sources, also with correct ownership
COPY --chown=pptruser:pptruser tsconfig.json ./
COPY --chown=pptruser:pptruser src ./src

# 4) Build
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.js"]
