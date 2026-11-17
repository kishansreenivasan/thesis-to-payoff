# Lane C brief: shared types, orchestrator, MCP, dashboard, submission

Spec: DESIGN.md Sections 4 (Lane C), 5, 8 (monitoring loop), 9, 10, 11, 16, 17. This brief is a checklist, not a replacement.

## You own

`packages/shared/`, `packages/mcp/`, `apps/`, `scripts/`, `tests/integration/`, `fixtures/c/`, `README.md`, root config. Branch: `lane-c`.

## Tasks, in order

- [x] 1. Repo skeleton, pnpm workspace, `pnpm check`, `STATUS.md`, `BLOCKED.md`, `CHANGES.md`, `packages/shared` verbatim from Section 5, lane interfaces in `packages/shared/src/interfaces.ts`. (Done in the initial commit.)
- [ ] 2. Orchestrator + REST routes (Section 10) in `apps/api` against Lane A/B mocks. Make `pnpm demo:mock` (`scripts/demo-mock.ts`) run the full Section 16 script with mocks.
- [ ] 3. Execution coordinator (Section 9) and 10 s monitoring loop (Section 8). SQLite append-only events table.
- [ ] 4. Dashboard (Section 11) in `apps/web`, incl. `/approve/:requestId` with wagmi. Tailwind, Recharts, wagmi are not installed yet; add them.
- [ ] 5. MCP server in `packages/mcp` (tools in Section 10), bearer auth, deployed at `PUBLIC_BASE_URL`.
- [ ] 6. Flip `*_MODE=real` as lanes land. Integration tests in `tests/integration/` (Section 17 list).
- [ ] 7. README, demo script, video script, Devpost text, Grok chat export.
- [ ] 8. Extra after Thu 2 PM: Telegram alerts.

## Also yours

- Apply `CHANGES.md` requests to `packages/shared` (optional fields only).
- Keep `main` green: `pnpm check` and `pnpm demo:mock`.
- Add `demo:open` and `demo:reset` scripts (Section 9, 17).
