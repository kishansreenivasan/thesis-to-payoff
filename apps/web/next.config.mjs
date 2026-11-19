import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@ttp/shared", "@ttp/treasury"],
  outputFileTracingRoot: path.join(here, "../.."),
};
export default nextConfig;
