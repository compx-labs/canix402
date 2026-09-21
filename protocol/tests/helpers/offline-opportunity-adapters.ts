import {
  setFolksFinanceSdkDependenciesForTests,
  setMorphoAdapterDependenciesForTests
} from "../../src/adapters/index.js";

/**
 * HTTP tests that only care about session/x402 gating should not hit live
 * Morpho GraphQL or the Folks SDK. Those defaults 429 under parallel CI.
 */
export function stubOfflineOpportunityAdaptersForHttpTests(): void {
  setMorphoAdapterDependenciesForTests({
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: { vaults: { items: [] } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });
  setFolksFinanceSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    retrievePoolManagerInfoFn: async () => {
      throw new Error("folks live SDK disabled in HTTP gating tests");
    },
    getOraclePricesFn: async () => {
      throw new Error("folks live SDK disabled in HTTP gating tests");
    },
    getConsensusStateFn: async () => {
      throw new Error("folks live SDK disabled in HTTP gating tests");
    },
    estimateConsensusApr: async () => {
      throw new Error("folks live SDK disabled in HTTP gating tests");
    }
  });
}

export function resetOfflineOpportunityAdaptersForHttpTests(): void {
  setMorphoAdapterDependenciesForTests(undefined);
  setFolksFinanceSdkDependenciesForTests(undefined);
}
