import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Not preloaded: the guest portal uses system fonts, and must download none on a slow link.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", preload: false });

export const metadata: Metadata = { title: "HashiFi" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="antialiased bg-background" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
