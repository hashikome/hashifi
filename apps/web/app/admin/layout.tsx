"use client";

import { Loader } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AdminSidebar } from "@/components/admin-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth-context";

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
      <div className="flex h-screen overflow-hidden bg-background print:h-auto print:overflow-visible">
        <div className="shrink-0 print:hidden">
          <AdminSidebar />
        </div>
        <main className="flex-1 overflow-y-auto print:overflow-visible">
          <div className="container mx-auto p-6 max-w-7xl print:max-w-none print:p-0">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
