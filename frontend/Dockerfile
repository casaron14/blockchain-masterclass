# Build from the repository root so the frontend can also import shared/ and
# the Express API in backend/ (served by pages/api/[...all].js):
#   docker build -f frontend/Dockerfile -t dienacademy-web .
FROM node:22-alpine AS dependencies

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

FROM node:22-alpine AS builder

WORKDIR /app
COPY --from=dependencies /app/frontend/node_modules ./frontend/node_modules
COPY frontend ./frontend
COPY shared ./shared
# The API is compiled into the Next server bundle, so its source must be in the
# build context.
COPY backend ./backend

WORKDIR /app/frontend
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/frontend/package.json ./frontend/package.json
COPY --from=builder /app/frontend/next.config.mjs ./frontend/next.config.mjs
COPY --from=builder /app/frontend/.next ./frontend/.next
COPY --from=builder /app/frontend/node_modules ./frontend/node_modules

USER node
WORKDIR /app/frontend

EXPOSE 3000
CMD ["npm", "run", "start"]
