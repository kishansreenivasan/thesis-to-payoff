# Convex — Devpost draft

**Status:** draft only; this file does not publish or change the Devpost form.

**Track:** DeFi and Onchain Applications · **Chain award:** Arc · **Bounties:** Gemini Prediction Markets, Grok

**Links:**
- Repository: https://github.com/kishansreenivasan/thesis-to-payoff
- Live demo: https://ttp-production-7410ea00.up.railway.app
- Logo: [selected Convex logo](../apps/web/public/convex-logo.png)
- MCP connector: `https://ttp-production-7410ea00.up.railway.app/mcp` (bearer authentication; never publish the token)
- Video: TODO — record and add the final URL; [timed narration and capture guide](VIDEO.md) prepared
- Vault: [Arc testnet deployment](https://explorer.testnet.arc.io/address/0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07)
- Grok chat: [verified read-only conversation transcript](../evidence/grok-chat-2026-11-19.md); [repeat setup / handoff](GROK-HANDOFF.md)

## Elevator pitch (200-character field)

Have a market view, but no plan for being wrong? Our agent builds hedged strategies across options, perps, and prediction markets, automating execution and risk monitoring.

## Inspiration

Having a market opinion is easy. Turning it into a position you understand—and planning for being wrong—is harder.

An investor might say, "I'm bullish on Bitcoin, but I'm worried about the Fed." Acting on that view means selecting instruments, sizing positions, pricing hedges, and managing margin across platforms. Beginners face a steep learning curve; experienced traders spend time coordinating the same moving parts manually.

Convex closes that gap. You bring the thesis and risk budget; Convex structures, prices and coordinates a supported strategy.

## What it does

Convex starts with a supported bullish Bitcoin thesis, an optional Fed-hike concern and an explicit risk budget. Deterministic code builds a coordinated plan: a BTC call and perpetual on Derive testnet, a Gemini sandbox BTC NO contract, and a Fed-hike position simulated using live mainnet pricing. It shows the costs and modeled payoff scenarios, then requires approval of the exact plan version before submitting executable legs.

After execution, the risk engine evaluates margin under stress. A release over the Arc vault's cap reverts onchain and becomes an owner approval request. In the recorded decline path, cancellation is followed by a filled reduce-only Derive order. The vault enforces spending authority; the owner's wallet signs owner approvals.

The application is deployed on Railway. Recorded real testnet/sandbox rehearsals include all three executable legs filled, calibration, an Arc request/cancel and a filled rescue order. The stress shock and Fed position remain simulated, and Arc releases go to a settlement wallet rather than crediting venue margin.

## How we built it

We divided development into treasury/risk, venues/strategy, and orchestration/interface lanes, using shared Zod schemas to keep their contracts aligned.

- **Arc:** a deployed Solidity treasury vault with per-transaction, daily and strategy caps, a reserve floor, destination allowlist and pause controls. Foundry tests cover its constraints; viem and Wagmi support chain interactions and owner wallet approval.
- **Gemini Prediction Markets:** sandbox discovery and signed BTC event orders, plus live read-only Fed-market quotes. Lossless parsing preserves large venue order identifiers.
- **Derive:** testnet BTC option and perpetual orders signed with EIP-712, margin reads and reduce-only execution.
- **Grok-compatible MCP:** seven tools expose thesis validation, event discovery, quoting, strategy approval/execution and position/transfer status through authenticated Streamable HTTP. Our server hosts the tools; Grok runs in the connected account. No Grok/xAI API key or server-side LLM is required. The hosted tool listing is verified, and Grok invoked thesis compilation and position status in a recorded acceptance conversation. Status correctly returned no open position.
- **Application stack:** TypeScript, pnpm workspaces, Next.js, React, Fastify, SQLite/better-sqlite3, Zod, decimal.js, and the MCP TypeScript SDK. Docker and Railway host the API, dashboard and MCP at one origin. Vitest and Foundry provide automated validation.

SQLite persists order submissions and venue identifiers before execution, alongside position snapshots and an append-only activity log. A 10-second risk monitor and server-sent events keep the dashboard updated.

## Challenges we ran into

Our original derivatives venue became unavailable, so we moved to Derive and adapted signing, instrument names, minimum sizes and margin conventions.

Real rehearsals exposed delayed order visibility, thin books and minimum-size constraints on rescue orders. We added persistent order tracking and recovered venue states, while preserving exact large Gemini identifiers. Repeated sandbox fills eventually exhausted the available YES bids; fresh strategy opening is currently blocked until liquidity returns.

Gemini's sandbox does not list the Fed market. We retained a live-priced simulated Fed leg and clearly labeled it alongside the real sandbox BTC leg. Arc test USDC also serves as gas, making wallet reserves and funding checks necessary.

## Accomplishments that we're proud of

We integrated three development lanes into a deployed workflow with actual fills on Derive testnet and Gemini sandbox. The committed open/reopen recordings report all executable legs FILLED and the position OPEN.

Our rescue recording shows an Arc owner-approval request, its cancellation after decline, and a FILLED reduce-only Derive order. Separate Arc evidence records allowed releases, over-limit reverts, owner-approved execution and pause controls. We distinguish those earlier owner-approval transactions from the coordinated rehearsal's decline path.

We also shipped a dashboard with venue/source labels, real versus projected margin, an activity stream, owner approval links and authenticated operator controls.

## What we learned

Financial automation depends on precise boundaries between systems. A successful request does not establish a fill, a treasury release does not credit exchange margin, and a modeled loss budget cannot guarantee losses in every market condition.

Those lessons shaped Convex around deterministic calculations, explicit approvals, durable execution records and visible source labels. Spending authority belongs in enforceable contract rules, and a live demonstration needs evidence for every claimed action.

## What's next for Convex

Our immediate priorities are final screenshots and video, and a fresh staged demo when sandbox liquidity and treasury funding permit. The Grok connector is configured and read-only thesis/status acceptance is recorded; showing a pending request in Grok remains a staged-demo check. Hosted MCP access is already configured; no new xAI API key is required.

Next we would improve strategy explanations and scenario comparison, add risk alerts and validate additional supported strategies and instruments. Any cross-venue funding capability would require a separate integration; this prototype's Arc vault does not fund either venue.

## Evidence and demo readiness

The `/history` walkthrough presents saved November 19 execution evidence, with the run date and source labels visible. It performs no trading and enables video capture while fresh sandbox execution is liquidity-constrained. This follow-up is prepared on `finish/video-replay`; verify deployment before sharing its hosted URL.

- [Open](../evidence/rehearsal-2026-11-19-open.json) / [reopen](../evidence/rehearsal-2026-11-19-reopen.json): filled sandbox and testnet legs.
- [Calibration](../evidence/rehearsal-2026-11-19-calibrate.txt): a real margin read with a simulated -15% stress projecting a 1.3226 ratio.
- [Rescue](../evidence/rehearsal-2026-11-19-rescue.json): Arc request/cancel and filled reduce-only order.
- [Demo/video runbook](DEMO-SCRIPT.md): preserve existing positions when liquidity is scarce.
- Last vault read: 22 USDC total, 12 above reserve. Funding readiness must be rechecked before a new full release rehearsal.
- Testnet/sandbox only. The Fed position and projected stress values are simulated; no profit, loss ceiling or liquidation-prevention guarantee is made.

## Sponsor answers

**How is Arc used?** One vault enforces transfer authority onchain, with normal releases subject to caps, allowlisting and a reserve floor, and a separate owner-approved path. The owner key stays off the server. Releases reach a settlement wallet; any modeled venue credit is labeled simulated and does not change reported margin.

**How are Gemini Prediction Markets used?** Live read-only mainnet Fed-decision prices inform the simulated Fed leg and payoff grid. Real Gemini sandbox NO orders supply the executable BTC event leg, subject to available liquidity.

**How is Grok used?** The hosted MCP endpoint is connected to Grok. The recorded acceptance conversation invoked `compile_thesis` and `position_status`. Grok supplies structured thesis fields; deterministic code selects prices, instruments and quantities. The redacted Markdown UI transcript is committed; it shows a correctly empty position status and does not demonstrate trading initiated from Grok. Grok cannot sign owner approvals.
