import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { executionRegistry } from "../../src/execution/index.js";

test("GET /execution/shapes returns the live registry catalog for free", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/execution/shapes"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: Array<{
      shapeKey: string;
      requiredInputs: string[];
      opportunityRole: string;
      docsPath?: string;
    }>;
    meta: {
      paymentRequired: boolean;
      shapeCount: number;
      note?: string;
    };
  };

  assert.equal(body.meta.paymentRequired, false);
  assert.equal(body.meta.shapeCount, body.data.length);
  assert.equal(body.data.length, executionRegistry.keys().length);
  assert.ok(body.data.length >= 40);

  const flexible = body.data.find(
    (shape) => shape.shapeKey === "mainnet:tinyman:v2:addLiquidity:flexible"
  );
  assert.ok(flexible);
  assert.ok(flexible.requiredInputs.includes("userAddress"));
  assert.equal(flexible.opportunityRole, "enter");
  assert.equal(
    flexible.docsPath,
    "protocol/docs/execution-shapes/tinyman-add-liquidity-flexible.md"
  );

  const reti = body.data.find(
    (shape) => shape.shapeKey === "mainnet:reti:v1:stake:algo"
  );
  assert.ok(reti);
  assert.ok(reti.requiredInputs.includes("validatorId"));

  await app.close();
});
