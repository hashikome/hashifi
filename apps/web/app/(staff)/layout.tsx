import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "HashiFi Admin",
  description: "Manage HashiFi venues, routers, packages and vouchers",
};

/** Everything staff use. The guest portal stays outside this, and loads none of it. */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {/* On the body, for dialogs and toasts too; the guest portal must not fetch this typeface. */}
      <style>{"body { font-family: var(--font-dm-sans), sans-serif; }"}</style>
      <AuthProvider>
        {children}
        <Toaster />
      </AuthProvider>
    </ThemeProvider>
  );
}
