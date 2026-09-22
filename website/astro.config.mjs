import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  output: "static",
  site: "https://canix402.compx.io",
  trailingSlash: "never",
  vite: {
    define: {
      global: "globalThis"
    },
    server: {
      fs: {
        allow: [repoRoot]
      }
    },
    optimizeDeps: {
      include: [
        "algosdk",
        "@txnlab/use-wallet",
        "@txnlab/use-wallet-pera",
        "@txnlab/use-wallet-defly",
        "viem",
        "@wagmi/core",
        "@wagmi/connectors",
        "@coinbase/wallet-sdk"
      ],
      esbuildOptions: {
        define: {
          global: "globalThis"
        }
      }
    }
  }
});
