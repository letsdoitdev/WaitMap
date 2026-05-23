import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

// Geist ships its own next/font wrapper from the `geist` package because it
// is not yet exposed via `next/font/google`. Bind it to our --font-body
// variable so the design tokens stay agnostic.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Unemployment",
  description: "Spontaneous IRL adventure quests for you and your friends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${instrumentSerif.variable}`}
    >
      <body className="antialiased">
        {/* Design v2 page-level background — noise texture + single accent blob. */}
        <div aria-hidden="true" className="ds-bg-noise" />
        <div aria-hidden="true" className="ds-bg-blob" />
        {children}
      </body>
    </html>
  );
}
