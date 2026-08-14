import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  output: "static",
  site: "https://canix402.compx.io",
  trailingSlash: "never",
  vite: {
    server: {
      fs: {
        allow: [repoRoot]
      }
    }
  }
});
