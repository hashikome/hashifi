"use client";

import { Loader, Menu } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth-context";
import { LOGO_SRC } from "@/lib/brand";

function isManagerAllowedRoute(pathname: string) {
  const exact = [
    "/admin",
    "/admin/venues",
    "/admin/routers",
    "/admin/sessions",
    "/admin/vouchers",
    "/admin/packages",
    "/admin/analytics",
    "/admin/settings",
  ];
  if (exact.includes(pathname)) return true;

  return (
    pathname.startsWith("/admin/vouchers/") ||
    pathname.startsWith("/admin/routers/") ||
    pathname.startsWith("/admin/venues/") ||
    pathname.startsWith("/admin/settings/")
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isNavOpen, setIsNavOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: choosing a page closes the phone menu
  useEffect(() => setIsNavOpen(false), [pathname]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/");
    } else if (user?.twoFactorEnrollmentRequired) {
      router.replace("/setup-authenticator");
    } else if (!isLoading && user && user.role === "manager") {
      if (!isManagerAllowedRoute(pathname)) {
        router.replace("/admin");
      }
    }
  }, [user, isLoading, router, pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || user.twoFactorEnrollmentRequired) {
    return null;
  }

  if (user.role === "manager" && !isManagerAllowedRoute(pathname)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background md:flex-row print:h-auto print:overflow-visible">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 md:hidden print:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setIsNavOpen(true)}
            className="flex size-11 items-center justify-center rounded-md text-sidebar-foreground"
          >
            <Menu className="size-5" />
          </button>
          {/* biome-ignore lint/performance/noImgElement: a small static SVG; image optimisation is off (next.config.mjs) */}
          <img src={LOGO_SRC} alt="" className="size-6" />
          <span className="text-sm font-semibold text-foreground">HashiFi</span>
        </header>
        <div className="hidden shrink-0 md:block print:hidden">
          <AdminSidebar />
        </div>
        <Sheet open={isNavOpen} onOpenChange={setIsNavOpen}>
          <SheetContent className="w-64">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <AdminSidebar />
          </SheetContent>
        </Sheet>
        <main className="flex-1 overflow-y-auto print:overflow-visible">
          <div className="container mx-auto max-w-7xl p-4 md:p-6 print:max-w-none print:p-0">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
