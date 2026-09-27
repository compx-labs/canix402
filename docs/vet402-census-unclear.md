# vet402 census — canix402 UNCLEAR

Source: [census board, latest](https://vet402-algorand.vercel.app/board?view=census) (2026-09-27, Algorand MainNet).

Seller `canix402-api.compx.io` is listed as **DELIVERED (16)**. Of those 16 resources, **12 delivered** and **4 are UNCLEAR**. None of the unclear probes settled on-chain (`tx` empty).

Work through the four below. Check an item when the probe outcome is understood and either fixed or accepted.

Replay with real x402 payments (0.156 USDC, opt-in, not part of CI):

```sh
X402_CENSUS_UNCLEAR_PAID_TEST=1 npm run test:x402-census-unclear -w protocol
```

The test sends the same Bazaar example input vet402 used and expects these outcomes.

## Unclear

- [ ] **GET** `https://canix402-api.compx.io/positions/claimable?address=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ`
  - Price: 0.001000 USDC
  - Probed: 2026-09-27T04:35:03.640Z
  - Reason: `payment_failed`
  - Detail: The operation was aborted due to timeout
  - Replay (2026-09-27): aborted at 20s. The zero address is valid, so the handler does not 400; `fetchClaimableRewards` does not finish inside vet402's probe timeout.
  - Notes:

- [ ] **POST** `https://canix402-api.compx.io/swaps/transactions`
  - Price: 0.005000 USDC
  - Probed: 2026-09-27T04:40:02.156Z
  - Reason: `payment_failed`
  - Detail: status 400, no settlement receipt
  - Bazaar body vet402 sends: `{"amount":"1000000","fromAssetId":0,"toAssetId":31566704}`
  - Replay (2026-09-27): 400 `VALIDATION_ERROR`, missing required `address` (and the route also requires `quote` and `slippage`). No `PAYMENT-RESPONSE`.
  - Notes:

- [ ] **GET** `https://canix402-api.compx.io/opportunities/personalized?address=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ`
  - Price: 0.050000 USDC
  - Probed: 2026-09-27T04:57:29.394Z
  - Reason: `payment_failed`
  - Detail: status 500, no settlement receipt
  - Replay (2026-09-27): aborted at 20s instead of returning 500. Still no settlement receipt. The test accepts either a 500 or that timeout.
  - Notes:

- [ ] **POST** `https://canix402-api.compx.io/execution/quotes`
  - Price: 0.100000 USDC
  - Probed: 2026-09-27T05:00:25.775Z
  - Reason: `payment_failed`
  - Detail: status 400, no settlement receipt
  - Bazaar body vet402 sends: `{"quotes":[{"input":{},"shapeKey":"tinyman-v2:lp:add:flexible"}]}`
  - Replay (2026-09-27): 400 `VALIDATION_ERROR`, `quotes/0/input` missing required `userAddress`. Shape key is also not a catalog key. No `PAYMENT-RESPONSE`.
  - Notes:

## Delivered the same day (for context)

These 12 settled and are not in the unclear set:

| Resource | Price (USDC) | Tx |
| --- | --- | --- |
| `/positions?address=AAAA…Y5HFKQ` | 0.005 | [WY47NEIN…](https://allo.info/tx/WY47NEIN65BOZJA3T6BSZRVHERJEPVIOB35ZRYFJOFFDIK3ZVKGA) |
| `/opportunities/search?limit=10&platform=tinyman` | 0.010 | [C4XVJBN3…](https://allo.info/tx/C4XVJBN3Z43GYORR7XPG5WR7NMPE7DLTCWD636MVLEVNSVHAHT4Q) |
| `/protocols/compx/opportunities` | 0.010 | [TI42TZ4X…](https://allo.info/tx/TI42TZ4XKBTOL56Y7CHZWZCU4ZX7SH7SMEN3GM5B5ALVQDW5C6BA) |
| `/protocols/dorkfi/opportunities` | 0.010 | [4HSUE4OX…](https://allo.info/tx/4HSUE4OX3MK5Q5QZXTF5OSQXC5QOJLUZWQ57LMFZD63YKDB2YRUA) |
| `/opportunities` | 0.010 | [6HHYBSJ4…](https://allo.info/tx/6HHYBSJ4JO4TM62KNPQCNUTJCDDMVVX6LSSHREVYQCQDJSY33OJQ) |
| `/protocols/haystack/opportunities` | 0.010 | [2EG5SJC2…](https://allo.info/tx/2EG5SJC2WVRD44KQED7AQPFXTGGRVJANGKJWAWSCXQWVNNLQYUCA) |
| `/protocols/folks-finance/opportunities` | 0.010 | [I3ALIIQY…](https://allo.info/tx/I3ALIIQY5ZIT5FLSGJ6GWPIVAJUVDZBSVROYPND2TEUVVFI3RAGA) |
| `/protocols/morpho/opportunities` | 0.010 | [JFDGWP4D…](https://allo.info/tx/JFDGWP4DLSNLPHZ3YELSBNFRNORFARYQ5GIFZQQG6I5WREABVFPQ) |
| `/protocols/myth-finance/opportunities` | 0.010 | [SHIWJLG5…](https://allo.info/tx/SHIWJLG5YQONIY6RXOWMGJXWWEPO2Y3DQUODMYWRQFU674MQGQGA) |
| `/protocols/pact/opportunities` | 0.010 | [2PVBO4JT…](https://allo.info/tx/2PVBO4JTT7XMI4ANVSHR2LYVRLIZR6AZW64WFMNRIUPJRT65C2DQ) |
| `/protocols/reti/opportunities` | 0.010 | [ZFVEJX6T…](https://allo.info/tx/ZFVEJX6TQBH5NOQBIYQOQIQWOTCSHGIC6O7RBX62GVWDCZ7QYP7Q) |
| `/protocols/tinyman/opportunities` | 0.010 | [J4JAZTL2…](https://allo.info/tx/J4JAZTL2BBDMUPPIQ4B56BOREHKXPNGQZFBFXWRKN6QPB4YPI2UQ) |
