import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Order, OrderRequest, PositionSnapshot, Quote, StrategyPlan } from "@ttp/shared";

export function createOrderStore(path = process.env.DATABASE_PATH ?? "./data/ttp.sqlite") {
  const cwd = process.cwd();
  const projectRoot = cwd.endsWith("/apps/api") ? resolve(cwd, "../..") : cwd;
  const filename = path === ":memory:" ? path : isAbsolute(path) ? path : resolve(projectRoot, path);
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      strategy_id TEXT PRIMARY KEY,
      version_hash TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      quotes_json TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      position_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      client_order_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      venue TEXT NOT NULL,
      venue_order_id TEXT,
      state TEXT NOT NULL,
      request_json TEXT NOT NULL,
      order_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_strategy_id_idx ON orders(strategy_id);
  `);

  const strategy = db.prepare("SELECT * FROM strategies WHERE strategy_id = ?");
  const upsertPlan = db.prepare(`INSERT INTO strategies (strategy_id, version_hash, plan_json, quotes_json, updated_at)
    VALUES (@strategyId, @versionHash, @plan, @quotes, @updatedAt)
    ON CONFLICT(strategy_id) DO UPDATE SET version_hash=excluded.version_hash, plan_json=excluded.plan_json,
    quotes_json=excluded.quotes_json, approved=0, position_json=NULL, updated_at=excluded.updated_at`);
  const upsertOrder = db.prepare(`INSERT INTO orders (client_order_id, strategy_id, venue, state, request_json, created_at, updated_at)
    VALUES (@clientOrderId, @strategyId, @venue, 'SUBMITTING', @request, @now, @now)
    ON CONFLICT(client_order_id) DO NOTHING`);
  const updateOrder = db.prepare(`UPDATE orders SET venue_order_id=@venueOrderId, state=@state, order_json=@order, updated_at=@now
    WHERE client_order_id=@clientOrderId`);

  return {
    savePlan(plan: StrategyPlan, quotes: Quote[]) {
      upsertPlan.run({ strategyId: plan.strategyId, versionHash: plan.versionHash, plan: JSON.stringify(plan), quotes: JSON.stringify(quotes), updatedAt: new Date().toISOString() });
    },
    getPlan(strategyId: string): { plan: StrategyPlan; quotes: Quote[]; approved: boolean; position: PositionSnapshot | null } | null {
      const row = strategy.get(strategyId) as { plan_json: string; quotes_json: string; approved: number; position_json: string | null } | undefined;
      return row ? { plan: JSON.parse(row.plan_json) as StrategyPlan, quotes: JSON.parse(row.quotes_json) as Quote[], approved: row.approved === 1, position: row.position_json ? JSON.parse(row.position_json) as PositionSnapshot : null } : null;
    },
    approve(strategyId: string) { db.prepare("UPDATE strategies SET approved=1, updated_at=? WHERE strategy_id=?").run(new Date().toISOString(), strategyId); },
    savePosition(strategyId: string, position: PositionSnapshot) { db.prepare("UPDATE strategies SET position_json=?, updated_at=? WHERE strategy_id=?").run(JSON.stringify(position), new Date().toISOString(), strategyId); },
    saveSubmitting(request: OrderRequest) {
      upsertOrder.run({ clientOrderId: request.clientOrderId, strategyId: request.strategyId, venue: request.venue, request: JSON.stringify(request), now: new Date().toISOString() });
    },
    saveOrder(order: Order) {
      updateOrder.run({ clientOrderId: order.clientOrderId, venueOrderId: order.venueOrderId, state: order.state, order: JSON.stringify(order), now: new Date().toISOString() });
    },
    getOrder(clientOrderId: string): { request: OrderRequest; order: Order | null; state: string; venueOrderId: string | null } | null {
      const row = db.prepare("SELECT * FROM orders WHERE client_order_id=?").get(clientOrderId) as { request_json: string; order_json: string | null; state: string; venue_order_id: string | null } | undefined;
      return row ? { request: JSON.parse(row.request_json) as OrderRequest, order: row.order_json ? JSON.parse(row.order_json) as Order : null, state: row.state, venueOrderId: row.venue_order_id } : null;
    },
    close() { db.close(); },
  };
}
