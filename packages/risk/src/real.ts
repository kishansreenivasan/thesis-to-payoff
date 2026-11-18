// @ttp/risk real, owned by Lane A. See docs/agents/lane-a.md.
//
// evaluateRisk is pure and has no external data to fake, so real and mock
// are the same function (see ./evaluateRisk.ts and ./mock.ts).
import type { RiskApi } from "@ttp/shared";
import { evaluateRisk } from "./evaluateRisk";

export const real = { evaluateRisk } satisfies RiskApi;
