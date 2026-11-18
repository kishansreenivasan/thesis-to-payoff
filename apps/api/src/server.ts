import { risk } from "@ttp/risk";
import { strategy } from "@ttp/strategy";
import { simulateOwnerDecision, treasury } from "@ttp/treasury";
import { venues } from "@ttp/venues";
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 4000);
buildApp({ strategy, venues, treasury, risk, decideMockRequest: simulateOwnerDecision })
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
