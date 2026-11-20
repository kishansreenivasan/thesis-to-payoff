# Convex video

## Recorded walkthrough — November 20

A silent 1920×1080 MP4 was captured from the actual local dashboard at a readable pace. Duration: **3:29**. The six history stages each hold for 10 seconds, followed by a new homepage strategy, approval, execution and venue receipts. The [finished MP4](../evidence/convex-walkthrough-2026-11-20.mp4) is included in the repository; a copy remains in the chat workspace at `output/convex-video/convex-walkthrough-2026-11-20.mp4`. Upload to a video host for the Devpost submission remains pending.

The fresh strategy used “Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.” The first execution attempt stopped before sending orders because the option price exceeded its approved limit. After refreshing and approving the new plan, all three executable legs filled at 10:17 UTC:

| Leg | Confirmed fill | Venue order ID |
|---|---|---|
| Gemini BTC NO | 1 at $0.99 | `145853902324831196` |
| Derive Dec 11 $60,000 call | 0.05 BTC at $3,827 | `e4a99ad3-381d-452f-a84a-b9bf51fdee75` |
| Derive BTC perp | 0.0172 BTC at $61,676 | `9d7f6e51-be96-495b-90ca-0136a105ee7b` |

Evidence: [fresh position response](../evidence/video-2026-11-20-open.json). Position `pos_strat_63491dbeab91` is OPEN, risk NORMAL; reported perp margin ratio was 4.3219. These are actual Derive testnet and Gemini sandbox fills. The Fed hedge remains modeled and has no order. The dated November 19 history is a separate run. No fresh shock, treasury release or position close was requested in this capture; the new positions remain open. Gemini exit liquidity remains a constraint.

## Examples for the recording

- **Homepage / simple:** “I am bullish on Bitcoin into December, but I want some downside protection. Max risk $500.” This is the default composer text and builds a call, perp and Gemini BTC NO hedge.
- **Grok / event-aware:** “Use Convex to build a strategy for this view: ‘Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.’ Show the legs, costs, and payoff scenarios. Ask for my approval before executing.” This keeps the Fed-hike concern in the chatbot and adds the modeled Fed hedge.
- The Grok prompt is prepared in the signed-in chat as an unsent draft for recording. Sending it is the next user step; a fresh Grok response has not been captured for this draft.



## Verified button sequence (Nov 20)

The complete interactive build → approve → execute → close flow passed browser checks against isolated fixtures. On the configured services, automatic access and the full build → approve → execute flow passed without a manual token during the capture above. The one available HI85000 NO entry filled; another opening needs fresh sandbox liquidity, and no NO exit liquidity was available at the last book check. The separate Arc precheck reports 22 USDC total / 12 above reserve, insufficient for the full approved-release rehearsal. The decline path does not itself require that release funding.

**The stable recording path checked on screen is http://localhost:3100/history.** It shows the real November 19 execution evidence. Use the same buttons below; these screens do not place new trades.

| Click | Expected screen/output |
|---|---|
| Open `/history` | Your thesis; bullish BTC, Fed concern, $500 budget; execution date visible |
| **Next →** | Four legs; call 0.04 BTC, perp 0.0172 BTC, modeled Fed hedge and 42 BTC NO contracts; modeled loss $445.31 |
| **Next →** | Three executable orders FILLED; Gemini and Derive venue IDs visible |
| **Next →** | Reported ratio 4.3214; hypothetical −15% ratio 1.3214; top-up 36.10 USDC |
| **Next →** | `ExceedsPerTxCap`; 36.10 requested against a 25-USDC cap; Arc revert and request links |
| **Next →** | Rejected request; reduce-only sell 0.01 BTC FILLED; later account size 0.0072 BTC, ratio 10.3214 and stress ratio 7.3209 |
| **Restart →** | Returns to the thesis; no financial action |

All six screens were clicked through and visually inspected; there are no demo banners or manual access prompts. Screenshots are saved locally in `output/convex-video/validated-history-1.png` through `validated-history-6.png` under the chat workspace.

**Verified fresh execution sequence:** open the dashboard → **Build strategy** → review legs/payoff → **Next: review and execute this plan** → **Approve plan** → **Execute plan** → **View positions and manage exits**. Another opening requires available sandbox liquidity. For exit footage, once exit liquidity permits, choose the saved position → **Close positions** → **Confirm close**. A partial exit must remain visible, not be narrated as fully closed. Do not cut current quote footage into the dated history as though it were the same fresh execution.



Use `/history` on the Convex web app. It displays the original November 19 execution evidence with its dates, receipt IDs and plain-language modeling notes. Next/Back only move between screens; this page makes no API calls, submits no transactions, and needs no token or wallet. No fresh Gemini liquidity or Arc funding is needed to record this walkthrough.

Local: `pnpm dev:web`, then open http://localhost:3000/history. Hosted after deployment: https://ttp-production-7410ea00.up.railway.app/history.

Record the browser at 1440×900 or 1920×1080, with notifications hidden. Keep the execution date and modeling explanation visible. Start on “Your thesis” and click Next at the cue. Aim for 2 minutes 30 seconds. Read naturally; leave a short pause between screens.

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:25 | Your thesis | “Have a market view, but no plan for being wrong? This is Convex. Give it a supported Bitcoin thesis, your Fed concern and a risk budget. Grok structures the intent; deterministic code chooses the instruments, prices, sizes and limits. We’ll walk through our November 19 testnet run.” |
| 0:25–0:50 | The strategy | “Convex coordinates a call and a perpetual on Derive testnet, a BTC downside event contract on Gemini sandbox, and a simulated Fed-hike hedge priced from read-only Gemini mainnet data. The venue receipts show the executed legs; the Fed hedge remains modeled. The loss budget is a model, not a guarantee.” |
| 0:50–1:10 | Execution | “Execution requires approval of the exact plan version. Here are the venue-confirmed fills: Gemini first, then the Derive call and perp. Each has a real venue order ID. The simulated Fed position has no order receipt.” |
| 1:10–1:35 | Stress test | “Now we apply a simulated fifteen-percent BTC shock. The actual margin read is separate from the projection. The projected ratio drops to about 1.32, inside the funding band, and the risk engine calculates a top-up of about 36 USDC.” |
| 1:35–2:00 | Owner control | “The Arc vault enforces spending authority onchain. This request exceeds the 25-USDC transaction cap, so the release reverts. The agent then files an owner approval request. These links lead to the real Arc transactions. Only the owner’s wallet can approve. Arc releases go to a settlement wallet, not into exchange margin.” |
| 2:00–2:30 | The rescue | “In this run the owner declined. The agent canceled the request and filled a real reduce-only sell on Derive testnet. The later account check shows the smaller position and greater margin headroom. Grok gives users the interface; deterministic execution and onchain controls enforce the boundaries. One thesis. Event-aware execution. Onchain spending discipline.” |

For a Grok opening shot, click **Create with Grok**, enable the **Convex connector** in that Grok account, and prompt: “Use Convex to compile this thesis: Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.” Ask for compilation only while current sandbox pricing is blocked by liquidity, then return to the demo walkthrough. This is a real Grok tool call; the `/history` controls advance through the saved execution evidence.

You can also use the actual Grok acceptance chat, which invoked `compile_thesis` and `position_status`. That chat returned no open position. The pending-request status in the rescue evidence was an MCP response from the rehearsal, not a pending request shown inside that Grok chat. Do not splice those into a claim that Grok showed a pending approval.

## Recording and upload

1. Open `/history` and verify all six screens; leave it at the first screen.
2. Start the computer's screen recorder with microphone enabled. Record the browser window and follow the table.
3. Stop after the closing line. Trim the beginning/end; keep the execution date and modeling explanation visible.
4. Upload the video and check that it plays while signed out. Add its URL to the Devpost form and `docs/DEVPOST.md`.

The silent walkthrough is recorded and included in the repository. Voiceover and upload to a video host remain; a new opening requires fresh Gemini entry liquidity, and the full approved-release path still needs vault funding. Opening the strategy itself does not require an Arc release.
