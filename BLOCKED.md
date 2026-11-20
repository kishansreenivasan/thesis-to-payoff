# BLOCKED

Append new entries at the top. Format: DESIGN.md Section 14. Humans fill in "Decision".

```
## [Lane X] Short title (OPEN | RESOLVED)
- When: <UTC time>
- Task: <what you were doing>
- Expected: <what this doc said would happen>
- Actual: <exact error or response, secrets redacted>
- Evidence: <file in evidence/>
- Options I see: <2-3 options>
- Meanwhile: <other unblocked task, or "waiting">
- Decision (filled by humans): <decision and date>
```

---

## [Lane C] Current blocker reconciliation after PR #28 (NOTED)
- When: 2026-11-20 00:39 UTC
- Task: reconcile historical credential/hosting blockers with the merged deployment and rehearsal evidence
- Actual: required local settings are populated; Railway dashboard/health and authenticated MCP tool listing succeed. Recorded testnet/sandbox fills, calibration, Arc request/cancel and reduce-only rescue are in `evidence/rehearsal-2026-11-19-*`.
- Evidence: PR #28, `STATUS.md`, `docs/GROK-HANDOFF.md`, rehearsal files
- Resolution: the older hosted-deployment and missing-Derive-access entries below are historical and superseded by this entry. Vault funding remains a repeat-rehearsal constraint, not evidence that the recorded rehearsal failed.
- Still open: checked BTC sandbox contracts have no YES bids; last vault read left 12 USDC above reserve; teammate Grok acceptance/export and final video remain.
- Meanwhile: Convex branding and submission documentation can proceed without trades or transfers.
- Decision (filled by humans): use the teammate's Grok account; no xAI API key is needed on the server.

## [Lane C/B] Gemini sandbox BTC2611302200 has no YES bids, so no L3b plan (OPEN)
- When: 2026-11-20 00:15 UTC
- Task: `pnpm demo:open` against the hosted server (real mode)
- Expected: the planner buys NO on the highest "or above" strike with a YES bid, sized to the book (BLOCKED decision 2026-11-18)
- Actual: `/api/strategies/quote` -> 422 `NO_L3B_STRIKE: no BTC2611302200 "or above" strike with a YES bid`. The books are empty: HI67500 has no bids or asks, and HI70000 has only an ask of 0.04 x 4. Our rehearsals bought NO 42 + 3 + 3, which used up the YES bids that existed (42 on 2026-11-19, 1 on 2026-11-18), so a sandbox maker does post liquidity at times.
- Evidence: `evidence/rehearsal-2026-11-19-*.json`; GET https://api.sandbox.gemini.com/v1/book/GEMI-BTC2611302200-HI67500
- Options I see: 1) wait for sandbox liquidity to come back and run `demo:open` once, about 10 minutes before the demo, with no more rehearsals that buy NO; 2) ask Gemini at office hours to refresh sandbox liquidity on BTC2611302200 (Human item 10); 3) allow a resting GTC NO order when the book is empty (a design change: the leg might not fill)
- Meanwhile: Derive positions flattened; the hosted server is in real mode and healthy; the full real rehearsal is already recorded in evidence/
- Decision (filled by humans): pending

## [Lane C] Hosted MCP deployment not available (OPEN)
- When: 2026-11-19
- Task: C9, host the API, web app and MCP connector
- Expected: an MCP HTTP transport authenticated with a bearer token, reachable at `PUBLIC_BASE_URL`
- Actual: stateless MCP HTTP transport and bearer auth are implemented and locally validated. No hosting project is configured; `PUBLIC_BASE_URL` is not available locally.
- Evidence: `docs/agents/lane-c.md`; Lane C handoff merged in PR #23
- Options I see: configure a hosting project and deploy the locally validated transport
- Meanwhile: dashboard and API mock demo work locally; read-only live venue quotes were verified
- Decision (filled by humans): pending hosting choice/setup

## [Lane A/C] Live rehearsal awaits Derive access and Arc vault funding (OPEN)
- When: 2026-11-19
- Task: run live calibration and the Arc-backed rehearsal
- Expected: authenticated Derive margin/position reads and enough vault funds for the approval/release sequence
- Actual: authenticated Derive credentials are missing locally. The read-only Arc precheck found 22 USDC total, 12 USDC above the reserve floor; the rehearsal can require up to 100 USDC.
- Evidence: `docs/HUMAN-TODO.md`, `docs/agents/lane-a.md`, `docs/agents/lane-c.md`
- Options I see: 1) configure Derive testnet credentials and fund the Arc test vault; 2) continue using mock execution until then
- Meanwhile: mock demo and public/read-only quote route are available
- Decision (filled by humans): pending credential setup and testnet funding

## [Lane B] Daily Gemini sandbox FED261211 check not recorded (OPEN)
- When: 2026-11-19
- Task: confirm whether the Gemini sandbox lists `FED261211`
- Expected: record sandbox discovery result in `STATUS.md`
- Actual: rechecked 2026-11-19 at `https://api.sandbox.gemini.com/v1/prediction-markets/events/FED261211`; the endpoint returned `Event not found` (HTTP 404)
- Evidence: `docs/agents/lane-b.md`, `evidence/gemini-smoke.json`
- Options I see: 1) recheck the sandbox and update status; 2) leave L3a as a live read-only mainnet quote with simulated position
- Meanwhile: strategy already handles the L3a/L3b split; L3a uses a live read-only quote and simulated position
- Decision (filled by humans): pending recheck

---

## [Lane B] Deribit testnet sign-up unavailable to the team (RESOLVED)
- When: 2026-11-18
- Task: human setup items 2-3 (Deribit testnet accounts and API keys)
- Expected: DESIGN.md Section 13: humans create Deribit testnet accounts
- Actual: the team could not create a Deribit testnet account, even over a VPN.
- Evidence: Derive testnet checked live on 2026-11-18. It lists BTC options for 20261211 (activates 2026-11-20 08:00 UTC) and 20261225 (active, ATM 65000C about 3,048 bid/ask, 5 BTC size), min 0.01 BTC, and BTC-PERP (tight spread, min 0.01 BTC). The Gemini sandbox also lists BTCGUSDPERP.
- Options I see: 1) Derive testnet for L1 and L2; 2) perp on Gemini sandbox, option venue still needed; 3) keep Deribit.
- Meanwhile: n/a
- Decision (filled by humans): 2026-11-18. Use Derive testnet for L1 (call) and L2 (perp). The L1 out-of-the-money fallback is no longer needed at current prices (0.07 BTC ATM fits $230). Live plan: BTC-20261225-65000-C 0.07 BTC ($210.57), BTC-PERP 0.0166 BTC; modeled max loss $441.25.

## [Lane B] L1 budget too small for Deribit's 0.1 BTC option minimum (RESOLVED)
- When: 2026-11-18 00:10 UTC
- Task: buildPlan against live Deribit testnet quotes (task 5)
- Expected: DESIGN.md Section 8: L1 call premium + fees <= $230, strike nearest at-the-money
- Actual: Deribit's minimum option size is 0.1 BTC. Live testnet ask for BTC-25DEC26-65000-C is about $3,468 per BTC, so 0.1 BTC costs $348.76 with fees. buildPlan stops with L1_BUDGET_BELOW_MIN_SIZE. An 11DEC26 ATM call would likely be about $2,200 to $2,700 per BTC, which is still at or above budget.
- Evidence: rerun `buildPlan` on live quotes; error text above. Instrument spec: public/get_instrument min_trade_amount 0.1.
- Options I see:
  1. Raise the L1 budget to about $360 and shrink the perp stop to keep max loss <= $500 (for example L1 $360, stop $40). Changes the demo's risk story.
  2. Pick the nearest strike whose 0.1 BTC cost fits $230 (an out-of-the-money call, roughly 70000 to 72000). Keeps the budget table; L1 is no longer at-the-money.
  3. Raise max risk for the demo thesis (for example $650). Changes the fixed demo text.
- Meanwhile: mocks use an 11DEC26 ATM price that fits ($2,180 per BTC), so `pnpm demo:mock` works. Real mode will refuse to build a plan until this is decided.
- Decision (filled by humans): 2026-11-18. Use the cheaper out-of-the-money call (option 2).
  buildPlan takes the at-the-money call if 0.1 BTC fits the L1 budget, otherwise the lowest strike
  above BTC whose 0.1 BTC cost fits. Never an in-the-money strike. Live run 2026-11-18: BTC-25DEC26-68000-C, 0.1 BTC, $212.31.

## [Lane B] No BTC2611302200 strike at or below the BTC index in Gemini sandbox (RESOLVED)
- When: 2026-11-18 00:10 UTC
- Task: L3b selection against live sandbox data (task 5)
- Expected: DESIGN.md Section 6.1: "or above" contract with the highest strike at or below the current BTC index
- Actual: sandbox BTC2611302200 strikes are 67,500 to 85,000. BTC index is about 64,826. No strike qualifies, so buildPlan stops with NO_L3B_STRIKE. The book is also thin: HI67500 has one YES bid (0.32 x 1 contract) and no asks.
- Evidence: GET https://api.sandbox.gemini.com/v1/prediction-markets/events/BTC2611302200 and /v1/book/GEMI-BTC2611302200-HI67500
- Options I see:
  1. Use the lowest listed strike above the index (HI67500). NO pays if BTC finishes below $67,500, so it still hedges the downside, but costs about $0.68 per contract (about 58 contracts for $40) and there is only 1 contract of liquidity.
  2. Use another sandbox BTC event whose strikes bracket the index, if one exists. Recheck daily.
  3. Ask Gemini (human item 10) whether sandbox strikes can be relisted around the current price.
- Meanwhile: mock data includes a 62,500 strike, so `pnpm demo:mock` works.
- Decision (filled by humans): 2026-11-18. Use the 67,500 strike (option 1).
  buildPlan takes the highest strike at or below BTC if one has a YES bid, otherwise the lowest strike
  above BTC. Size is capped at the NO liquidity on the book (YES bid size). Live run 2026-11-18:
  HI67500 NO at 0.68, 1 contract ($0.68), because the book shows 1 contract. The hedge is real but tiny until sandbox liquidity improves.

## [Lane B] No 11 Dec 2026 BTC option expiry on Deribit testnet (RESOLVED)
- When: 2026-11-17 23:45 UTC
- Task: preflight check for L1 (setup, before any lane started)
- Expected: DESIGN.md Section 1/6.2: "BTC call expiring 11 Dec 2026" on Deribit testnet
- Actual: `public/get_instruments?currency=BTC&kind=option` lists 18/19/20/21/27 NOV, 4 DEC, 25 DEC 2026, then 2027 expiries. No 11DEC26.
- Evidence: evidence/preflight-2026-11-17.json
- Options I see:
  1. Wait. Deribit usually lists Friday weeklies a few weeks ahead, so 11DEC26 may appear within days. Recheck daily.
  2. Use 25DEC26 (expires after the Fed decision; covers the event; costs more premium).
  3. Use 4DEC26 (cheaper, but expires before the Fed decision and breaks the thesis).
- Meanwhile: Lane B mocks and strategy code can use `BTC-11DEC26-<strike>-C` as a placeholder and select expiry at runtime.
- Decision (filled by humans): 2026-11-17. Wait, then fall back to 25DEC26.
  L1 expiry is chosen at runtime: use 11DEC26 if Deribit testnet lists it, otherwise 25DEC26.
  Lane B rechecks daily and records the result in STATUS.md. If 11DEC26 is still missing at
  2026-11-18 17:00 UTC (Wed 12 PM ET, before the Wed 2 PM gate), build and test against 25DEC26.
  UI and pitch copy must show the actual expiry used.

## [Lane B] FED261211 not in Gemini sandbox (RESOLVED)
- When: 2026-11-17 22:00 UTC
- Actual: sandbox lists no economics events; mainnet lists FED261211 with HIKEGT25 at 0.02/0.07
- Decision: 2026-11-17. L3 split into L3a (Fed hedge, live mainnet quote, simulated position)
  and L3b (real sandbox NO on BTC2611302200 strike). See Section 1. Recheck sandbox daily.
