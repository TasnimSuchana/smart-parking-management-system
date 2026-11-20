# One image definition for every backend service. Build with: --build-arg SERVICE=<dir name>
FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine
ARG SERVICE
ENV NODE_ENV=production SERVICE=${SERVICE}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/shared ./shared
COPY backend/${SERVICE} ./${SERVICE}
RUN chown -R node:node /app
USER node
HEALTHCHECK --interval=15s --timeout=4s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node ${SERVICE}/src/index.js"]
