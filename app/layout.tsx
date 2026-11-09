import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OgniOra, le notizie con le fonti",
  description: "Riepiloghi essenziali delle notizie, verificati dalla redazione con collegamenti alle fonti originali.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
