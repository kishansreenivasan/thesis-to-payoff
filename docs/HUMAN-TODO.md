# Human to-do (things agents cannot do)

Updated 2026-11-19. The full checklist with history is GitHub issue #1. Lane A/B work and Lane C tasks C1-C8 are merged to `main` (Lane C PR #23).

## Done
- [x] Gemini sandbox account, prediction terms accepted, API key in `.env` (smoke test 8/8)
- [x] Derive testnet wallet, main subaccount `88265` (300 USDC), perp subaccount `88268` (230 USDC), values in `.env` (smoke test 9/9)
- [x] Arc testnet wallets and vault deployed (Lane A)

## Next, in order

0. **Finish local real-mode setup.** Derive authenticated credentials and subaccount IDs are not configured in the local `.env`. Set `DERIVE_WALLET`, `DERIVE_SIGNER_PRIVATE_KEY`, `DERIVE_MAIN_SUBACCOUNT_ID`, and `DERIVE_PERP_SUBACCOUNT_ID` using testnet-only values. Public quotes work; authenticated order and margin calls do not yet. Never share or commit the private key.

1. **Fund the Arc vault with about 150 test USDC.** A read-only precheck on 2026-11-19 found 22 USDC in the vault (12 releasable above its reserve floor) and $100 needed for the rehearsal flow.
   - **Why:** it held 22 USDC at the last read-only check, with 12 USDC above the 10 USDC reserve floor. The rehearsal needs up to 100 USDC available for releases, so funding about 150 USDC provides room for the reserve.
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
4. **Complete the remaining technical handoffs.**
   - **Lane C:** implement and host the MCP HTTP transport, then deploy API + web + MCP after the hosting URL and bearer token are available.
   - **Lane A:** run live `calibrate` after Derive credentials are configured and the perp is open.
   - **Lane B:** check whether Gemini sandbox lists `FED261211`; record the result in `STATUS.md`.
5. **Judging.** Confirm who attends in person on Sat Nov 21. No one there means no prize.

## Optional
- Ask Gemini (office hours) whether the sandbox can list `FED261211`, and BTC strikes near the current price with more liquidity. L3b currently gets 1 contract.
- Telegram bot token and chat id for margin alerts (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
- The Derive perp subaccount is in the rescue band at 230 USDC (projected 1.43). Re-check after the perp opens; the calibration tool says how much to add or withdraw.

## Never
- Commit `.env`, or paste private keys or API secrets into chat.
- Use a wallet that holds real money.
