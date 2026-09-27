import { setProtocolManifest } from "./manifest.js";
import { ORACLE_PRICE_SCALE, V2_ORACLE_MESSAGE_VERSION, validateRawPrice12, } from "./oracle.js";
export class PdexApiClient {
    baseUrl;
    publicArtifactBaseUrl;
    network;
    fetchImpl;
    accountSessionToken;
    constructor(options) {
        const config = typeof options === "string" ? undefined : options;
        this.baseUrl = trimSlash(typeof options === "string" ? options : options.baseUrl);
        this.publicArtifactBaseUrl = config?.publicArtifactBaseUrl ? trimSlash(config.publicArtifactBaseUrl) : undefined;
        this.network = config?.network?.trim() || undefined;
        this.fetchImpl = typeof options === "string" ? fetch : (options.fetchImpl ?? fetch);
        this.accountSessionToken = typeof options === "string" ? undefined : options.accountSessionToken;
    }
    setAccountSessionToken(token) {
        this.accountSessionToken = token;
    }
    async health() {
        return this.get("/health");
    }
    async ready() {
        return this.get("/ready");
    }
    async loadProtocol(version = 2) {
        if (Number(version) !== 2)
            throw new Error("PDex API client only supports the V2 protocol manifest");
        const manifest = await this.get(`/v${version}/protocol`);
        return setProtocolManifest(manifest, version);
    }
    async v2Markets() {
        return this.get("/v2/markets");
    }
    async v2Market(marketId) {
        return this.get(`/v2/markets/${pathPart(marketId)}`);
    }
    async v2Pools() {
        return this.get("/v2/pools");
    }
    async v2Pool(poolId) {
        return this.get(`/v2/pools/${pathPart(poolId)}`);
    }
    async v2PoolPerformance(poolId, period = "30d") {
        return this.get(`/v2/pools/${pathPart(poolId)}/performance?${queryString({ period })}`);
    }
    async v2MarketSummary() {
        return this.get("/v2/summary/markets");
    }
    async v2OrderPolicy() {
        return this.get("/v2/order-policy");
    }
    async v2StaticMetadataCurrent(kind = "resources") {
        return this.get(`/v2/static-metadata/${encodeURIComponent(kind)}/current`);
    }
    async v2StaticMetadataArtifact(kind, artifactHash) {
        return this.get(`/v2/static-metadata/${encodeURIComponent(kind)}/${encodeURIComponent(artifactHash)}`);
    }
    async deployment(network) {
        return this.get(`/v2/networks/${encodeURIComponent(network)}/deployments`);
    }
    async v2SdkBootstrap() {
        return this.get("/v2/sdk/bootstrap");
    }
    async v2SdkResources() {
        return this.get("/v2/sdk/resources");
    }
    async v2PriceCandles(input) {
        return this.get(`/v2/prices/candles?${queryString({
            marketId: input.marketId,
            period: input.period,
            limit: input.limit,
            to: input.to,
            symbol: input.symbol,
        })}`);
    }
    async v2LatestPrice(marketId) {
        const artifactKey = this.v2LatestPriceBundleArtifactKey();
        if (artifactKey) {
            const id = numericPathPart(marketId);
            const bundle = await this.getPublicArtifactJson(artifactKey);
            validatePriceEnvelopeContext(bundle, "latest-price bundle");
            const payload = id ? bundle.prices?.[id] : undefined;
            if (!payload)
                throw new Error(`PDex latest-price artifact has no market ${String(marketId)}`);
            validateLatestPricePayload(payload);
            return payload;
        }
        const payload = await this.get(`/v2/prices/latest/${pathPart(marketId)}`);
        validateLatestPricePayload(payload);
        return payload;
    }
    async createAccountSession(input) {
        return this.post("/v2/auth/session", input);
    }
    async logoutAccountSession() {
        return this.post("/v2/auth/logout", {});
    }
    async v2Trader(address) {
        return this.get(`/v2/accounts/${encodeURIComponent(address)}`);
    }
    async v2Positions(address) {
        return this.get(`/v2/accounts/${encodeURIComponent(address)}/positions`);
    }
    async v2Orders(owner) {
        const query = owner ? `?owner=${encodeURIComponent(owner)}` : "";
        return this.get(`/v2/orders${query}`);
    }
    async v2Order(owner, ownerOrderId) {
        return this.get(`/v2/orders/${encodeURIComponent(owner)}/${pathPart(ownerOrderId)}`);
    }
    async v2AccountOrders(address) {
        return this.get(`/v2/accounts/${encodeURIComponent(address)}/orders`);
    }
    async v2AccountTrades(address, input = {}) {
        const query = queryString({
            market_id: input.marketId,
            limit: input.limit,
            cursor: input.cursor,
        });
        return this.get(`/v2/accounts/${encodeURIComponent(address)}/trades${query ? `?${query}` : ""}`);
    }
    async v2AccountActivity(address, input = {}) {
        const query = queryString({ limit: input.limit, cursor: input.cursor });
        return this.get(`/v2/accounts/${encodeURIComponent(address)}/activity${query ? `?${query}` : ""}`);
    }
    async v2Lps(address) {
        return this.get(`/v2/accounts/${encodeURIComponent(address)}/lps`);
    }
    async margin(address) {
        return this.v2AccountMargin(address);
    }
    async v2Account(address) {
        const [trader, positions, orders, lps, margin] = await Promise.all([
            this.v2Trader(address),
            this.v2Positions(address),
            this.v2AccountOrders(address),
            this.v2Lps(address),
            this.v2AccountMargin(address),
        ]);
        return { trader, positions, orders, lps, margin };
    }
    async v2QuoteOpen(input) {
        return this.post("/v2/quote/open", input);
    }
    async v2QuoteDecrease(input) {
        return this.post("/v2/quote/decrease", input);
    }
    async v2QuoteDecreaseWithSwap(input) {
        return this.post("/v2/quote/decrease-with-swap", input);
    }
    async v2QuoteAdjustMargin(input) {
        return this.post("/v2/quote/adjust-margin", input);
    }
    async v2QuoteLpDeposit(input) {
        return this.post("/v2/quote/lp-deposit", input);
    }
    async v2QuoteLpWithdraw(input) {
        return this.post("/v2/quote/lp-withdraw", input);
    }
    async v2MarketYieldStrategies() {
        return this.get("/v2/market-yield/strategies");
    }
    async v2MarketYieldStrategy(marketId, assetId) {
        return this.get(`/v2/market-yield/strategies/${pathPart(marketId)}/${pathPart(assetId)}`);
    }
    async v2MarketYieldObservations() {
        return this.get("/v2/market-yield/observations");
    }
    async v2MarketYieldObservation(marketId, assetId) {
        return this.get(`/v2/market-yield/observations/${pathPart(marketId)}/${pathPart(assetId)}`);
    }
    async v2MarketYieldResourceRegistry() {
        return this.get("/v2/resource-registry/market-yield");
    }
    async v2MarketYieldActionRecallPlan(input) {
        return this.post("/v2/market-yield/action-recall-plan", input);
    }
    async v2MarketYieldHealth() {
        return this.get("/v2/market-yield/health");
    }
    async v2QuoteLpWithdrawWithSwap(input) {
        return this.post("/v2/quote/lp-withdraw-with-swap", input);
    }
    async v2QuoteSwap(input) {
        return this.post("/v2/quote/swap", input);
    }
    async v2QuoteSwapRoute(input) {
        return this.post("/v2/quote/swap-route", input);
    }
    async v2QuoteLiquidation(input) {
        return this.post("/v2/quote/liquidation", input);
    }
    async v2QuoteAdl(input) {
        return this.post("/v2/quote/adl", input);
    }
    async v2QuoteSingleTokenLpDeposit(input) {
        return this.post("/v2/quote/single-token/lp-deposit", input);
    }
    async v2QuoteSingleTokenLpWithdraw(input) {
        return this.post("/v2/quote/single-token/lp-withdraw", input);
    }
    async v2QuoteSingleTokenOpen(input) {
        return this.post("/v2/quote/single-token/open", input);
    }
    async v2QuoteSingleTokenDecrease(input) {
        return this.post("/v2/quote/single-token/decrease", input);
    }
    async v2QuoteSingleTokenLiquidation(input) {
        return this.post("/v2/quote/single-token/liquidation", input);
    }
    async v2QuoteSingleTokenAdl(input) {
        return this.post("/v2/quote/single-token/adl", input);
    }
    async v2QuoteOrderOpenLimit(input) {
        return this.post("/v2/orders/quote/open-limit", input);
    }
    async v2QuoteOrderDecrease(input) {
        return this.post("/v2/orders/quote/decrease", input);
    }
    async v2QuoteOrderExecute(input) {
        return this.post("/v2/orders/quote/execute", input);
    }
    async v2AnalyzeOrder(input) {
        return this.post("/v2/orders/analyze", input);
    }
    async v2CvaVaults() {
        return this.get("/v2/cva/vaults");
    }
    async v2CvaVault(vaultId) {
        return this.get(`/v2/cva/vaults/${pathPart(vaultId)}`);
    }
    async v2CvaPerformance(vaultId, period = "30d") {
        return this.get(`/v2/cva/vaults/${pathPart(vaultId)}/performance?${queryString({ period })}`);
    }
    async v2CvaAllocations(vaultId) {
        return this.get(`/v2/cva/vaults/${pathPart(vaultId)}/allocations`);
    }
    async v2CvaAccount(owner) {
        return this.get(`/v2/cva/accounts/${encodeURIComponent(owner)}`);
    }
    async v2QuoteCvaDeposit(input) {
        return this.post("/v2/cva/quote/deposit", input);
    }
    async v2QuoteCvaWithdraw(input) {
        return this.post("/v2/cva/quote/withdraw", input);
    }
    async v2QuoteCvaWithdrawRoute(input) {
        return this.post("/v2/cva/quote/withdraw-route", input);
    }
    async v2QuoteCvaAllocate(input) {
        return this.post("/v2/cva/quote/allocate", input);
    }
    async v2QuoteCvaRebalance(input) {
        return this.post("/v2/cva/quote/rebalance", input);
    }
    async v2AccountMargin(address) {
        return this.get(`/v2/accounts/${encodeURIComponent(address)}/margin`);
    }
    async v2OraclePayload(input) {
        const cacheKey = this.v2OraclePayloadCacheKey(input);
        const artifactKey = this.v2OraclePayloadBundleArtifactKey();
        if (artifactKey && cacheKey) {
            try {
                const bundle = await this.getPublicArtifactJson(artifactKey);
                validatePriceEnvelopeContext(bundle, "oracle bundle");
                const payload = bundle.payloads?.[cacheKey];
                if (!payload)
                    throw new Error(`PDex oracle artifact has no payload ${cacheKey}`);
                validateBackendV2OraclePayload(payload);
                return payload;
            }
            catch (artifactError) {
                try {
                    return await this.getV2OraclePayloadFromBackend(input);
                }
                catch (backendError) {
                    throw oracleTransportError(artifactError, backendError);
                }
            }
        }
        return this.getV2OraclePayloadFromBackend(input);
    }
    async getV2OraclePayloadFromBackend(input) {
        const payload = await this.get(`/v2/oracle/${pathPart(input.marketId)}?${queryString({
            oracle_message_version: V2_ORACLE_MESSAGE_VERSION,
            price_scale: ORACLE_PRICE_SCALE,
            app_id: input.appId,
            target: input.target,
            asset_id: input.assetId,
            asset: input.asset,
            index_asset_id: input.indexAssetId,
            long_asset_id: input.longAssetId,
            short_asset_id: input.shortAssetId,
        })}`);
        validateBackendV2OraclePayload(payload);
        return payload;
    }
    async v2OracleArgs(input) {
        const { oraclePayloadFromBackend } = await import("./oracle.js");
        return oraclePayloadFromBackend(await this.v2OraclePayload(input));
    }
    async get(path) {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            headers: await this.headers(),
        });
        if (!response.ok)
            throw new Error(`PDex backend ${path} failed: ${response.status} ${await response.text()}`);
        return response.json();
    }
    async post(path, payload) {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { ...(await this.headers()), "content-type": "application/json" },
            body: JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
        });
        if (!response.ok)
            throw new Error(`PDex backend ${path} failed: ${response.status} ${await response.text()}`);
        return response.json();
    }
    async getPublicArtifactJson(key) {
        const response = await this.fetchImpl(`${this.publicArtifactBaseUrl}/${key}`, {
            headers: { accept: "application/json" },
            cache: key.endsWith("/current.json") ? "no-store" : "default",
        });
        if (!response.ok) {
            throw new Error(`PDex public artifact ${key} failed: ${response.status} ${await response.text()}`);
        }
        return response.json();
    }
    v2LatestPriceBundleArtifactKey() {
        if (!this.publicArtifactBaseUrl || !this.network)
            return undefined;
        return `v2/latest-prices/${encodeURIComponent(this.network)}/current.json`;
    }
    v2OraclePayloadBundleArtifactKey() {
        if (!this.publicArtifactBaseUrl || !this.network)
            return undefined;
        return `v2/oracle-payloads/${encodeURIComponent(this.network)}/current.json`;
    }
    v2OraclePayloadCacheKey(input) {
        if (!this.publicArtifactBaseUrl || !this.network || input.appId === undefined)
            return undefined;
        const appId = numericPathPart(input.appId);
        if (!appId)
            return undefined;
        const marketId = positiveNumber(input.marketId);
        let subject;
        if (marketId > 0) {
            subject = `market-${marketId}`;
        }
        else {
            const assetId = positiveNumber(input.assetId) || positiveNumber(input.indexAssetId) || positiveNumber(input.longAssetId);
            if (assetId > 0) {
                subject = `asset-${assetId}`;
            }
            else if (input.asset !== undefined && String(input.asset).trim()) {
                subject = `symbol-${normalizeArtifactSymbol(String(input.asset))}`;
            }
        }
        if (!subject)
            return undefined;
        return `app-${appId}/${subject}`;
    }
    async headers() {
        const headers = { accept: "application/json" };
        const tokenProvider = this.accountSessionToken;
        const token = typeof tokenProvider === "function" ? await tokenProvider() : tokenProvider;
        if (token)
            headers.authorization = `Bearer ${token}`;
        return headers;
    }
}
export function createPdexApiClient(options) {
    return new PdexApiClient(options);
}
export function buildAccountSessionMessage(input) {
    return canonicalJsonString({
        address: input.address,
        audience: input.audience ?? "pdex-public-api",
        expires_at: Math.trunc(input.expiresAt),
        genesis_hash: input.genesisHash,
        genesis_id: input.genesisId,
        issued_at: Math.trunc(input.issuedAt),
        network: input.network,
        nonce: input.nonce,
        origin: input.origin,
        protocol: "PDex",
        purpose: "account:read",
        scopes: [...(input.scopes ?? ["account:read"])],
        version: 1,
    });
}
const ORACLE_RAW_PRICE_FIELDS = [
    "index_price_min",
    "index_price_max",
    "long_price_min",
    "long_price_max",
    "short_price_min",
    "short_price_max",
];
const LATEST_RAW_PRICE_FIELDS = [
    ...ORACLE_RAW_PRICE_FIELDS,
    "index_price",
    "long_price",
    "short_price",
];
export function validateBackendV2OraclePayload(payload) {
    validatePriceEnvelopeContext(payload, "oracle payload");
    for (const field of ORACLE_RAW_PRICE_FIELDS)
        validateRawPriceString(payload[field], field);
}
export function validateLatestPricePayload(payload) {
    validatePriceEnvelopeContext(payload, "latest-price payload");
    for (const field of LATEST_RAW_PRICE_FIELDS) {
        const value = payload[field];
        if (value !== undefined)
            validateRawPriceString(value, field);
    }
}
function validatePriceEnvelopeContext(payload, label) {
    if (Number(payload.oracle_message_version ?? 0) !== V2_ORACLE_MESSAGE_VERSION) {
        throw new Error(`${label} oracle_message_version mismatch`);
    }
    if (BigInt(String(payload.price_scale ?? 0)) !== ORACLE_PRICE_SCALE) {
        throw new Error(`${label} price_scale mismatch`);
    }
}
function validateRawPriceString(value, field) {
    if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
        throw new TypeError(`${field} must be a canonical decimal string`);
    }
    validateRawPrice12(value);
}
function trimSlash(value) {
    return value.replace(/\/+$/, "");
}
function pathPart(value) {
    return encodeURIComponent(String(value));
}
function queryString(values) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
        if (value !== undefined)
            params.set(key, String(value));
    }
    return params.toString();
}
function positiveNumber(value) {
    if (value === undefined)
        return 0;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}
function numericPathPart(value) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
        return undefined;
    return String(parsed);
}
function normalizeArtifactSymbol(value) {
    return encodeURIComponent(value.trim().toLowerCase().replace(/\s+/g, "-").replace(/\//g, "-"));
}
function oracleTransportError(artifactError, backendError) {
    return new Error("PDex signed oracle payload is unavailable from both the public artifact and backend", { cause: new AggregateError([artifactError, backendError], "PDex oracle transports failed") });
}
function canonicalJsonString(value) {
    return JSON.stringify(canonicalJsonValue(value));
}
function canonicalJsonValue(value) {
    if (Array.isArray(value))
        return value.map(canonicalJsonValue);
    if (value && typeof value === "object") {
        const entries = Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        const result = {};
        for (const [key, item] of entries)
            result[key] = canonicalJsonValue(item);
        return result;
    }
    return value;
}
//# sourceMappingURL=api.js.map