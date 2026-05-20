import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Side Quest Generator",
  description: "Spontaneous IRL adventure quests for you and your friends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
