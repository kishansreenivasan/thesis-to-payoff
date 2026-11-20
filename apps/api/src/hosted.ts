// Hosted entry point (Railway, DESIGN.md Section 13 item 6). One process on $PORT:
// Fastify serves /api/* and /mcp; every other GET goes to the built Next.js dashboard in apps/web,
// so the dashboard, the /approve/:requestId page and the MCP endpoint share PUBLIC_BASE_URL.
// Env comes from the host (no .env file). Build the web app first: pnpm --filter @ttp/web build.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { risk } from "@ttp/risk";
import { strategy } from "@ttp/strategy";
import { simulateOwnerDecision, treasury } from "@ttp/treasury";
import { venues } from "@ttp/venues";
import { buildApp } from "./app";

type NextApp = { prepare(): Promise<void>; getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void> };

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web");
const next = createRequire(resolve(webDir, "package.json"))("next") as (options: { dev: boolean; dir: string }) => NextApp;

async function main() {
  const web = next({ dev: false, dir: webDir });
  await web.prepare();
  const handle = web.getRequestHandler();
  const app = buildApp({ strategy, venues, treasury, risk, decideMockRequest: simulateOwnerDecision });
  const toNext = async (request: { raw: IncomingMessage }, reply: { hijack(): void; raw: ServerResponse }) => {
    reply.hijack();
    await handle(request.raw, reply.raw);
  };
  app.route({ method: ["GET", "HEAD"], url: "/", handler: toNext });
  app.route({ method: ["GET", "HEAD"], url: "/*", handler: toNext });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
