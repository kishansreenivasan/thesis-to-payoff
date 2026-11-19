import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = { title: "Thesis-to-Payoff" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f6f7f9", color: "#17202a", fontFamily: "system-ui, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
