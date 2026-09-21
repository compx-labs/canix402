import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

import { resolvePublicBaseUrl } from "../constants/public-url.js";

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");

const faviconPng = readFileSync(resolve(publicDir, "favicon.png"));
const faviconIco = readFileSync(resolve(publicDir, "favicon.ico"));
const logoPng = readFileSync(resolve(publicDir, "logo.png"));
const bannerPng = readFileSync(resolve(publicDir, "banner.png"));

const SITE_NAME = "CANIX402";
const DEFAULT_TITLE = "CANIX402 | Hunting down the best yields";
const DEFAULT_DESCRIPTION =
  "Canix402 is an x402-paid DeFi opportunity API for autonomous agents. Discover endpoints, pay in USDC, and fetch normalized APY data — including wallet-personalized yield recommendations.";
const DOCS_URL = "https://canix402.compx.io";

function publicBaseUrl(): string {
  return resolvePublicBaseUrl();
}

function buildRootHtml(): string {
  const base = publicBaseUrl();
  const logoUrl = `${base}/logo.png?v=2`;
  const bannerUrl = `${base}/banner.png?v=2`;
  const faviconUrl = `${base}/favicon.png?v=2`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${DEFAULT_TITLE}</title>
    <meta name="description" content="${DEFAULT_DESCRIPTION}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${base}/" />
    <link rel="icon" type="image/png" href="${faviconUrl}" />
    <link rel="icon" href="${base}/favicon.ico?v=2" sizes="any" />
    <link rel="apple-touch-icon" href="${logoUrl}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${DEFAULT_TITLE}" />
    <meta property="og:description" content="${DEFAULT_DESCRIPTION}" />
    <meta property="og:url" content="${base}/" />
    <meta property="og:image" content="${bannerUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="CANIX402 — x402-paid DeFi API" />
    <meta property="og:locale" content="en_US" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${DEFAULT_TITLE}" />
    <meta name="twitter:description" content="${DEFAULT_DESCRIPTION}" />
    <meta name="twitter:image" content="${bannerUrl}" />

    <link rel="logo" href="${logoUrl}" />
    <meta name="logo" content="${logoUrl}" />
    <meta name="banner" content="${bannerUrl}" />

    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: SITE_NAME,
        url: base,
        logo: logoUrl,
        description: DEFAULT_DESCRIPTION,
        sameAs: [DOCS_URL]
      })}
    </script>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; background: #0a0e14; color: #e8eef7; }
      main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
      img.logo { width: 72px; height: 72px; border-radius: 16px; display: block; }
      img.banner { width: 100%; height: auto; margin: 1.5rem 0; border-radius: 12px; }
      h1 { font-size: 1.75rem; margin: 1rem 0 0.5rem; }
      p { line-height: 1.55; color: #b7c3d6; }
      a { color: #7eb6ff; }
      ul { padding-left: 1.2rem; color: #b7c3d6; }
    </style>
  </head>
  <body>
    <main>
      <img class="logo" src="${logoUrl}" width="72" height="72" alt="CANIX402 logo" />
      <h1>${SITE_NAME}</h1>
      <p>${DEFAULT_DESCRIPTION}</p>
      <img class="banner" src="${bannerUrl}" width="1200" height="630" alt="CANIX402 banner" />
      <ul>
        <li><a href="${base}/discovery">Discovery catalog</a></li>
        <li><a href="${base}/openapi.json">OpenAPI</a></li>
        <li><a href="${base}/.well-known/x402.json">x402 manifest</a></li>
        <li><a href="${DOCS_URL}">Documentation</a></li>
      </ul>
    </main>
  </body>
</html>
`;
}

function sendPng(reply: { header: (k: string, v: string) => unknown; type: (t: string) => { send: (b: Buffer) => unknown } }, body: Buffer) {
  reply.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  return reply.type("image/png").send(body);
}

export function registerAssetRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "public, max-age=60");
      return reply.type("text/html; charset=utf-8").send(buildRootHtml());
    }
  );

  app.get(
    "/favicon.png",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => sendPng(reply, faviconPng)
  );

  app.get(
    "/favicon.ico",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      return reply.type("image/x-icon").send(faviconIco);
    }
  );

  app.get(
    "/logo.png",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => sendPng(reply, logoPng)
  );

  app.get(
    "/banner.png",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => sendPng(reply, bannerPng)
  );
}
