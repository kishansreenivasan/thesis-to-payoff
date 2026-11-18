// @ttp/risk mock, owned by Lane A. See docs/agents/lane-a.md.
//
// evaluateRisk is pure and has no external data to fake, so mock and real
// are the same function (see ./evaluateRisk.ts and ./real.ts).
import type { RiskApi } from "@ttp/shared";
import { evaluateRisk } from "./evaluateRisk";

export const mock = { evaluateRisk } satisfies RiskApi;
