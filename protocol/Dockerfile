# Standalone image for App Platform when source directory is `protocol/`.
# Build locally: docker build -t canix402-protocol .

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install --include=dev

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
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY openapi ./openapi/
COPY public ./public/

EXPOSE 3000

CMD ["node", "dist/index.js"]
