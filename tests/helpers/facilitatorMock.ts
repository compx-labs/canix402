import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";

interface VerifyRequestBody {
  x402Version: number;
  paymentPayload: {
    paymentGroup: string;
    paymentIndex: number;
  };
  paymentRequirements: {
    network: string;
    asset: string;
    payTo: string;
    maxAmountRequired: string;
  };
}

export interface FacilitatorCallRecord {
  endpoint: "/verify" | "/settle";
  body: unknown;
}

export interface FacilitatorMockOptions {
  verifyResult?: {
    isValid: boolean;
    invalidReason?: string;
    invalidMessage?: string;
  };
  settleResult?: {
    success: boolean;
    errorReason?: string;
    errorMessage?: string;
  };
}

export interface FacilitatorMock {
  port: number;
  baseUrl: string;
  calls: FacilitatorCallRecord[];
  close: () => Promise<void>;
}

export async function startFacilitatorMock(
  options: FacilitatorMockOptions = {}
): Promise<FacilitatorMock> {
  const calls: FacilitatorCallRecord[] = [];

  const verifyResult = options.verifyResult ?? { isValid: true };
  const settleResult = options.settleResult ?? { success: true };

  const server = createServer(async (req, res) => {
    if (!req.url) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    if (req.method === "POST" && req.url === "/verify") {
      const body = (await readJson(req)) as VerifyRequestBody;
      calls.push({ endpoint: "/verify", body });

      sendJson(res, 200, {
        isValid: verifyResult.isValid,
        invalidReason: verifyResult.invalidReason,
        invalidMessage: verifyResult.invalidMessage,
        payer: "TEST_PAYER"
      });
      return;
    }

    if (req.method === "POST" && req.url === "/settle") {
      const body = (await readJson(req)) as VerifyRequestBody;
      calls.push({ endpoint: "/settle", body });

      sendJson(res, 200, {
        success: settleResult.success,
        errorReason: settleResult.errorReason,
        errorMessage: settleResult.errorMessage,
        payer: "TEST_PAYER",
        transaction: "TEST_TXN_ID",
        network: body.paymentRequirements.network
      });
      return;
    }

    if (req.method === "GET" && req.url === "/supported") {
      sendJson(res, 200, []);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  });

  await listenOnRandomPort(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind facilitator mock to a local port.");
  }

  const port = address.port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    close: async () => closeServer(server)
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text) {
    return {};
  }
  return JSON.parse(text) as unknown;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

async function listenOnRandomPort(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
