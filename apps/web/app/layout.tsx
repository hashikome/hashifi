import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

// Not preloaded: the guest portal uses system fonts, and must download none on a slow link.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", preload: false });

export const metadata: Metadata = { title: "HashiFi" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <body className="antialiased bg-background" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
