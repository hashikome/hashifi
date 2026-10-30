"use client";

import {
  BarChart3,
  Building2,
  ChevronDown,
  DollarSign,
  LayoutDashboard,
  Loader,
  LogOut,
  Package,
  Radio,
  Router,
  Settings,
  Smartphone,
  Ticket,
  Users,
  Users2,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard, roles: ["admin", "manager"] },
  { name: "Live Sessions", href: "/admin/sessions", icon: Radio, roles: ["admin", "manager"] },
  { name: "Vouchers", href: "/admin/vouchers", icon: Ticket, roles: ["admin", "manager"] },
  { name: "Packages", href: "/admin/packages", icon: Package, roles: ["admin", "manager"] },
  { name: "Venues", href: "/admin/venues", icon: Building2, roles: ["admin", "manager"] },
  { name: "Routers", href: "/admin/routers", icon: Router, roles: ["admin", "manager"] },
  { name: "Users", href: "/admin/users", icon: Users, roles: ["admin"] },
  { name: "Portal Pages", href: "/admin/portal", icon: Smartphone, roles: ["admin"] },
  { name: "Analytics", href: "/admin/analytics", icon: BarChart3, roles: ["admin", "manager"] },
  { name: "Revenue", href: "/admin/revenue", icon: DollarSign, roles: ["admin"] },
  { name: "Team", href: "/admin/team", icon: Users2, roles: ["admin"] },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState<string | null>(null);

  // Clear loading state when pathname changes (navigation completes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation to reset the pending state
  useEffect(() => {
    setLoadingRoute(null);
  }, [pathname]);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin":
        return "Admin";
      case "manager":
        return "Manager";
      default:
        return role;
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);

    try {
      await logout();
      toast.success("Signed out");
      setIsSignOutOpen(false);
      router.replace("/");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="flex items-center justify-center size-9 rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
          <Wifi className="size-5" />
        </div>
        <div>
          <p className="font-semibold text-sm">HashiFi</p>
          <p className="text-xs text-sidebar-foreground/60">Admin Portal</p>
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="min-h-0 flex-1 px-3 py-4">
        <nav className="space-y-1">
          {navigation
            .filter((item) => !user || item.roles.includes(user.role))
            .map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/admin" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  )}
                  onClick={() => {
                    if (pathname !== item.href && !pathname.startsWith(`${item.href}/`)) {
                      setLoadingRoute(item.href);
                    }
                  }}
                >
                  {loadingRoute === item.href ? (
                    <Loader className="size-5 animate-spin" />
                  ) : (
                    <item.icon className="size-5" />
                  )}
                  {item.name}
                </Link>
              );
            })}
        </nav>
      </ScrollArea>

      {/* User Menu */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 px-3 py-6 text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                  {user?.name ? getInitials(user.name) : "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium truncate">{user?.name || "User"}</p>
                <p className="text-xs text-sidebar-foreground/60">
                  {user?.role ? getRoleBadge(user.role) : ""}
                </p>
              </div>
              <ChevronDown className="size-4 text-sidebar-foreground/60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{user?.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin/settings">
                <Settings className="size-4 mr-2" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault();
                setIsSignOutOpen(true);
              }}
            >
              <LogOut className="size-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog open={isSignOutOpen} onOpenChange={setIsSignOutOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign Out</AlertDialogTitle>
              <AlertDialogDescription>
                This will end your admin session on this device.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSigningOut}>Cancel</AlertDialogCancel>
              <Button variant="destructive" onClick={handleSignOut} disabled={isSigningOut}>
                {isSigningOut ? (
                  <Loader className="size-4 animate-spin" />
                ) : (
                  <LogOut className="size-4" />
                )}
                Sign Out
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
