#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createCanixMcpServer } from "./server.js";

serveStdio(() => createCanixMcpServer(), {
  onerror: (error) => {
    console.error("[canix402-mcp]", error.message);
  }
});
