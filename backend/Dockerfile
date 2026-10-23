# Build from the repository root so the backend can also copy shared/:
#   docker build -f backend/Dockerfile -t dienacademy-api .
FROM node:22-alpine AS dependencies

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN apk add --no-cache python3 make g++ \
    && cd backend \
    && npm ci --omit=dev

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=dependencies /app/backend/node_modules ./backend/node_modules
COPY backend ./backend
COPY shared ./shared

# Receipts and tickets are written here when DOCUMENT_STORAGE_MODE=local.
RUN mkdir -p /app/backend/out/receipts /app/backend/out/tickets \
    && chown -R node:node /app/backend/out

USER node
WORKDIR /app/backend

EXPOSE 3001
CMD ["node", "server.js"]
