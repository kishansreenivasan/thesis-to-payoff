# AGENTS.md: start here

You are one of three coding agents (Lane A, Lane B, Lane C) building the Thesis-to-Payoff Agent.
This file tells you where everything is. The full spec is [DESIGN.md](DESIGN.md). **DESIGN.md wins every conflict.**

## Read in this order

1. [DESIGN.md](DESIGN.md), all of it. Section 0 (working without talking) and Section 2 (rules) are mandatory.
2. Your lane brief:
   - Lane A (Arc vault, treasury, risk): [docs/agents/lane-a.md](docs/agents/lane-a.md)
   - Lane B (venues, strategy): [docs/agents/lane-b.md](docs/agents/lane-b.md)
   - Lane C (shared, orchestrator, MCP, web, submission): [docs/agents/lane-c.md](docs/agents/lane-c.md)
3. [STATUS.md](STATUS.md), [BLOCKED.md](BLOCKED.md), [CHANGES.md](CHANGES.md) for the current state.

## Ownership (stay in your directories)

| Path | Owner |
|---|---|
| `contracts/`, `packages/treasury/`, `packages/risk/`, `fixtures/a/` | Lane A |
| `packages/venues/`, `packages/strategy/`, `fixtures/b/` | Lane B |
| `packages/shared/`, `packages/mcp/`, `apps/`, `scripts/`, `tests/integration/`, `fixtures/c/`, `README.md`, root config | Lane C |
| `STATUS.md` | everyone edits **only their own line** |
| `BLOCKED.md`, `CHANGES.md` | everyone appends |
| `evidence/` | everyone, real redacted responses and receipts only |

Need a change in `packages/shared`? Append it to `CHANGES.md`. Lane C applies it. Only new optional fields, never renames or removals.

## The contract between lanes

- Types and Zod schemas: `packages/shared/src/schemas.ts` (verbatim DESIGN.md Section 5). Import from `@ttp/shared`.
- Function signatures each lane exports: `packages/shared/src/interfaces.ts` (`TreasuryApi`, `RiskApi`, `VenuesApi`, `StrategyApi`). Implement them with `satisfies`, e.g. `export const mock = { ... } satisfies VenuesApi`.
- Each package exports both `mock` and `real` implementations from `src/index.ts` and picks one with `<PKG>_MODE=mock|real` (default `mock`).
- Packages import **only** `@ttp/shared`. Only `apps/api` composes packages.

## Commands

Install pnpm via corepack if it is missing: `corepack enable` (or prefix commands with `corepack pnpm`).

| Command | What |
|---|---|
| `pnpm install` | install workspace |
| `pnpm check` | typecheck + lint + tests. Must pass before you merge. |
| `pnpm test` | Vitest across the repo |
| `pnpm demo:mock` | full demo against mocks. Must always work on `main`. |
| `pnpm dev:api` | Fastify orchestrator on `:4000` |
| `pnpm dev:web` | Next.js dashboard on `:3000` |
| `pnpm test:contracts` | `forge test` in `contracts/` |

## Git

- Branch per lane: `lane-a`, `lane-b`, `lane-c`. Small commits. Rebase on `main` before merging.
- Merge your own PR to `main` only if it touches only your directories and `pnpm check` passes.
- Never commit `.env` or secrets. Add new env var names to `.env.example` with placeholders.

## Hard rules (short form of DESIGN.md Section 2)

- Blocked by an external service? Stop that task, write a `BLOCKED.md` entry, continue other unblocked work. Do not swap in mocks, other instruments, or skip legs on your own.
- Never create accounts, handle passwords, or request API keys. Read secrets from env only.
- Never trade or transfer on mainnet. Public Gemini mainnet market data is fine.
- Every external number, order and tx carries a `source` field.
- No LLM on our server. Grok Bot only supplies thesis fields; code validates them and picks instruments, prices, sizes, limits.
- Never claim anything in DESIGN.md Section 12.

## After every task

Overwrite your line in `STATUS.md`:

```
Lane X | <YYYY-MM-DD HH:MM UTC> | Done: ... | Now: ... | Next: ... | Blocked: none
```
