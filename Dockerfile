FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app/games/star-sprint

COPY games/star-sprint/package*.json ./
RUN npm ci --omit=dev

COPY games/star-sprint ./

WORKDIR /app/games/star-sprint

CMD ["node", "server.js"]
