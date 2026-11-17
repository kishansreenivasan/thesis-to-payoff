# CHANGES

Two uses:
1. **Shared schema requests.** Lanes A and B propose changes to `packages/shared` here. Lane C applies them. Only new optional fields; never rename or remove.
2. **Spec deviations.** When an external API differs from DESIGN.md, follow the official docs and record the difference here.

Format:

```
## [Lane X] <title> (PROPOSED | APPLIED | NOTED)
- When: <UTC time>
- What: <field / endpoint / behavior>
- Why: <reason>
```

---

## [Setup] Preflight findings (NOTED)
- When: 2026-11-17 23:45 UTC
- What:
  - Deribit testnet lists both `BTC-PERPETUAL` and the linear `BTC_USDC-PERPETUAL`. Per Section 6.2, L2 should prefer `BTC_USDC-PERPETUAL`. Lane B confirms when wiring the adapter.
  - Gemini FED261211 terms say the FOMC meeting is **Dec 8 to 9, 2026**; the contract expires Dec 11 05:00 UTC. Copy that says "Fed on Dec 11" should say "Fed decision (Dec 9), market settles Dec 11".
  - Arc testnet RPC returns chain id 0x4cef52 (5042002); USDC at 0x3600...0000 reports 6 decimals. Matches Section 7.
- Why: avoid surprises during adapter work and in pitch copy.
