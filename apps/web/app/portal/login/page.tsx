import type { Metadata } from "next";
import { GuestPortal } from "./guest-portal";

export const metadata: Metadata = {
  title: "Connect to the WiFi",
  // Nothing here belongs in a search engine or a referrer header.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PortalLoginPage() {
  return <GuestPortal />;
}
