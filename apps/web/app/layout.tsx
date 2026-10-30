import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (OFL-1.1, see public/fonts/OFL.txt) on every page, the guest portal included: the
// product looks the same on every phone and makes no third-party font request. It sits in public/
// because the router's own pages load it by address.
const figtree = localFont({
  src: "../public/fonts/figtree-latin-wght-normal.woff2",
  weight: "300 900",
  variable: "--font-figtree",
});

export const metadata: Metadata = { title: "HashiFi" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={figtree.variable} suppressHydrationWarning>
      <body className="antialiased bg-background" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
