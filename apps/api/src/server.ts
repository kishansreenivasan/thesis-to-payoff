import { risk } from "@ttp/risk";
import { strategy } from "@ttp/strategy";
import { simulateOwnerDecision, treasury } from "@ttp/treasury";
import { venues } from "@ttp/venues";
import { buildApp } from "./app";
import { apiHost } from "./local-access";

const port = Number(process.env.PORT ?? 4000);
buildApp({ strategy, venues, treasury, risk, decideMockRequest: simulateOwnerDecision })
  .listen({ port, host: apiHost() })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
