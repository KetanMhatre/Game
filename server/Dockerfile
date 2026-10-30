# Build from the repo root (the server shares code with the game):
#   docker build -f server/Dockerfile -t nutshell-navy-server .
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY shared shared
COPY src/game/config.ts src/game/config.ts
COPY server/src server/src
COPY server/tsconfig.json server/
WORKDIR /app/server
ENV NODE_ENV=production PORT=2567
EXPOSE 2567
CMD ["npx", "tsx", "src/index.ts"]
