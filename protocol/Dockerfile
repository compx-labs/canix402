# Build from repo root so npm workspaces can install protocol dependencies:
#   docker build -f protocol/Dockerfile .

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY protocol/package.json ./protocol/

RUN npm ci --workspace=protocol --include=dev

COPY protocol/tsconfig.json ./protocol/
COPY protocol/src ./protocol/src/
COPY protocol/openapi ./protocol/openapi/

RUN npm run build -w protocol

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
COPY protocol/package.json ./protocol/

RUN npm ci --workspace=protocol --omit=dev

COPY --from=build /app/protocol/dist ./protocol/dist
COPY protocol/openapi ./protocol/openapi/

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "protocol"]
