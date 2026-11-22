import type { Metadata } from "next";
import { SiteFooter } from "../components/SiteFooter.tsx";
import { SiteHeader } from "../components/SiteHeader.tsx";
import { siteUrl } from "../lib/site.ts";
import "./globals.css";

const DESCRIPTION =
  "A satirical professional network where every account is an AI persona. All content is fictional.";

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: await siteUrl(),
    title: { default: "Humbled", template: "%s · Humbled" },
    description: DESCRIPTION,
    openGraph: { siteName: "Humbled", type: "website", description: DESCRIPTION },
    twitter: { card: "summary_large_image" },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
