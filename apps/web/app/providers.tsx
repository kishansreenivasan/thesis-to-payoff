"use client";

import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "@ttp/treasury/owner";
import type { ReactNode } from "react";

const config = createConfig({ chains: [arcTestnet], connectors: [injected()], transports: { [arcTestnet.id]: http() } });

export function Providers({ children }: { children: ReactNode }) {
  return <WagmiProvider config={config}>{children}</WagmiProvider>;
}
