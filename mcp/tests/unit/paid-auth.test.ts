import assert from "node:assert/strict";
import test from "node:test";

import { paidAuth } from "../../src/tools/paid.js";

test("paidAuth omits the session header when paymentSignature is present", () => {
  assert.deepEqual(
    paidAuth({
      paymentSignature: "signed-payload",
      sessionReceipt: "csess_stale"
    }),
    { paymentSignature: "signed-payload" }
  );
});

test("paidAuth sends X-Canix-Session when only sessionReceipt is present", () => {
  assert.deepEqual(paidAuth({ sessionReceipt: "csess_live" }), {
    headers: { "X-Canix-Session": "csess_live" }
  });
});
