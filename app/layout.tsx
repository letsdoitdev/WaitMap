import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import Providers from "@/components/Providers";
import ActiveQuestBanner from "@/components/ActiveQuestBanner";
import BottomNav from "@/components/BottomNav";
import UploadQueueIndicator from "@/components/UploadQueueIndicator";
import UserMenu from "@/components/UserMenu";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Unemployed: The Side Quest App",
  description:
    "Unemployed is the side quest app. Spontaneous IRL adventures for you and your friends.",
  openGraph: {
    title: "Unemployed: The Side Quest App",
    description:
      "Unemployed is the side quest app. Spontaneous IRL adventures for you and your friends.",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${instrumentSerif.variable}`}
    >
      <body className="antialiased">
        <div aria-hidden="true" className="ds-bg-noise" />
        <div aria-hidden="true" className="ds-bg-blob" />
        <Providers initialUser={user}>
          <div className="ds-app-header">
            <UserMenu />
          </div>
          <ActiveQuestBanner />
          {children}
          <UploadQueueIndicator />
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
