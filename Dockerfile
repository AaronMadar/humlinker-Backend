# ─── Image de production du backend Humlinker ───────────────────────────────
# Build :   docker build -t humlinker-backend .
# Lancer :  docker run --env-file .env -p 3000:3000 humlinker-backend
# Les migrations sont appliquées au démarrage (prisma migrate deploy).

# 1. Build : dépendances complètes + compilation TypeScript
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json tsconfig-paths-bootstrap.js ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# 2. Exécution : uniquement le nécessaire, utilisateur non-root
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl wget && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json tsconfig.json tsconfig-paths-bootstrap.js ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node -r ./tsconfig-paths-bootstrap dist/main"]
