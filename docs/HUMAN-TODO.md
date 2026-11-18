# Human to-do (things agents cannot do)

Updated 2026-11-18. The full checklist with history is GitHub issue #1. Tick items there as you go.

## Done
- [x] Gemini sandbox account, prediction terms accepted, API key in `.env` (smoke test 8/8)
- [x] Derive testnet wallet, main subaccount `88265` (300 USDC), perp subaccount `88268` (230 USDC), values in `.env` (smoke test 9/9)
- [x] Arc testnet wallets and vault deployed (Lane A)

## Next, in order

1. **Fund the Arc vault with about 150 test USDC.**
   - **Why:** it holds about 22 USDC. The demo needs up to 100 USDC above its 10 USDC floor: the allowed 20 USDC release plus an approved request.
   - **Where:** vault `0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07` on Arc testnet (chain 5042002). Explorer: https://explorer.testnet.arc.io/address/0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07
   - **How:** get test USDC at https://faucet.circle.com (Arc testnet), then send about 150 from your Arc wallet to the vault address.
   - **Careful:** on Arc, test USDC is also the gas token, so leave some in the sending wallet.
   - **Check:** ask an agent to run `pnpm --filter @ttp/treasury precheck`.
2. **Hosting.**
   - Create a Railway or Render project linked to the GitHub repo.
   - Put its public HTTPS URL in `PUBLIC_BASE_URL`.
   - Set `MCP_BEARER_TOKEN` to a long random string.
   - Add both to the host's settings and to `.env`.
3. **Grok Bot.** Get access. When Lane C says the MCP server is live, add it in Grok as a custom connector (URL plus bearer token).
4. **Tell the agents to pull `main`.**
   - **Lane C:** "Do the hand-off tasks C1 to C10 in `docs/agents/lane-c.md`."
   - **Lane A:** "Re-run `calibrate` once the perp is open."
5. **Judging.** Confirm who attends in person on Sat Nov 21. No one there means no prize.

## Optional
- Ask Gemini (office hours) whether the sandbox can list `FED261211`, and BTC strikes near the current price with more liquidity. L3b currently gets 1 contract.
- Telegram bot token and chat id for margin alerts (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
- The Derive perp subaccount is in the rescue band at 230 USDC (projected 1.43). Re-check after the perp opens; the calibration tool says how much to add or withdraw.

## Never
- Commit `.env`, or paste private keys or API secrets into chat.
- Use a wallet that holds real money.
