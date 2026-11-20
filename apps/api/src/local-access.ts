import type { FastifyRequest } from "fastify";

export const apiHost = () => process.env.LOCAL_OPERATOR_ACCESS === "true" ? "127.0.0.1" : "0.0.0.0";

export function localOperatorAccess(request: Pick<FastifyRequest, "ip" | "headers">) {
  if (process.env.LOCAL_OPERATOR_ACCESS !== "true") return false;
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip)) return false;
  const host = request.headers.host ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  const origin = request.headers.origin;
  return request.headers["sec-fetch-site"] !== "cross-site" && (!origin || origin === `http://${host}` || origin === `https://${host}`);
}
