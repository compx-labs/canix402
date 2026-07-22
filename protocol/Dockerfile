# Standalone image for App Platform when source directory is `protocol/`.
# Build locally: docker build -t canix402-protocol .
#
# --legacy-peer-deps: @myth-finance/dualstake-ts-sdk pins algokit-utils@7 while
# the rest of the stack uses algokit-utils@9 (same resolution as the monorepo lockfile).

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install --include=dev --legacy-peer-deps

COPY tsconfig.json ./
COPY src ./src/
COPY openapi ./openapi/
COPY public ./public/

RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY --from=build /app/dist ./dist
COPY openapi ./openapi/
COPY public ./public/

EXPOSE 3000

CMD ["node", "dist/index.js"]
