"use client";

import type { SignedInStaff } from "@hashifi/types";
import { Loader, Monitor, Moon, Save, ShieldCheck, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(user?.name ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name cannot be empty");
      return;
    }
    setIsSaving(true);
    try {
      const saved = await api.put<SignedInStaff>("/api/me", { name: name.trim() });
      updateUser({ name: saved.name });
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  const isAdmin = user?.role === "admin";

  return (
    <div className="max-w-2xl space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your profile and preferences</p>
      </div>

      {/* Profile section */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {/* Avatar banner */}
        <div className="bg-muted px-6 py-5 flex items-center gap-4 border-b">
          <div className="size-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground text-lg font-bold shadow-sm select-none shrink-0">
            {user?.name ? getInitials(user.name) : <User className="size-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-base leading-tight truncate">{user?.name}</p>
            <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
          </div>
          <span
            className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${isAdmin ? "bg-teal-500/15 text-teal-700 dark:text-teal-400" : "bg-sky-500/15 text-sky-600 dark:text-sky-400"}`}
          >
            <ShieldCheck className="size-3" />
            {isAdmin ? "Admin" : "Manager"}
          </span>
        </div>

        {/* Form fields */}
        <div className="p-6 space-y-4">
          <p className="text-sm font-medium">Profile Information</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs text-muted-foreground">
                Full Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-muted-foreground">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                defaultValue={user?.email ?? ""}
                disabled
                className="opacity-60"
              />
            </div>
          </div>
        </div>

        <div className="px-6 pb-5 flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Appearance section */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div>
          <p className="font-semibold">Appearance</p>
          <p className="text-sm text-muted-foreground">Choose how the interface looks</p>
        </div>
        <Separator />
        <div className="grid grid-cols-3 gap-3">
          {/* Light */}
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={`relative rounded-xl border-2 overflow-hidden transition-all ${theme === "light" ? "border-primary shadow-sm" : "border-border hover:border-muted-foreground/40"}`}
          >
            <div className="bg-[#f8f8f8] p-3 space-y-1.5">
              <div className="h-2 w-3/4 rounded bg-[#e0e0e0]" />
              <div className="h-2 w-1/2 rounded bg-[#e8e8e8]" />
              <div className="h-5 w-full rounded bg-white border border-[#e0e0e0]" />
            </div>
            <div
              className={`py-2 text-xs font-medium flex items-center justify-center gap-1.5 ${theme === "light" ? "text-primary" : "text-muted-foreground"}`}
            >
              <Sun className="size-3" />
              Light
            </div>
            {theme === "light" && (
              <div className="absolute top-2 right-2 size-4 rounded-full bg-primary flex items-center justify-center">
                <div className="size-1.5 rounded-full bg-primary-foreground" />
              </div>
            )}
          </button>

          {/* Dark */}
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={`relative rounded-xl border-2 overflow-hidden transition-all ${theme === "dark" ? "border-primary shadow-sm" : "border-border hover:border-muted-foreground/40"}`}
          >
            <div className="bg-[#1c1c1e] p-3 space-y-1.5">
              <div className="h-2 w-3/4 rounded bg-[#3a3a3c]" />
              <div className="h-2 w-1/2 rounded bg-[#2c2c2e]" />
              <div className="h-5 w-full rounded bg-[#2c2c2e] border border-[#3a3a3c]" />
            </div>
            <div
              className={`py-2 text-xs font-medium flex items-center justify-center gap-1.5 ${theme === "dark" ? "text-primary" : "text-muted-foreground"}`}
            >
              <Moon className="size-3" />
              Dark
            </div>
            {theme === "dark" && (
              <div className="absolute top-2 right-2 size-4 rounded-full bg-primary flex items-center justify-center">
                <div className="size-1.5 rounded-full bg-primary-foreground" />
              </div>
            )}
          </button>

          {/* System */}
          <button
            type="button"
            onClick={() => setTheme("system")}
            className={`relative rounded-xl border-2 overflow-hidden transition-all ${theme === "system" ? "border-primary shadow-sm" : "border-border hover:border-muted-foreground/40"}`}
          >
            <div className="bg-muted p-3 space-y-1.5">
              <div className="h-2 w-3/4 rounded bg-muted" />
              <div className="h-2 w-1/2 rounded bg-muted" />
              <div className="h-5 w-full rounded bg-muted border border-[#e0e0e0]" />
            </div>
            <div
              className={`py-2 text-xs font-medium flex items-center justify-center gap-1.5 ${theme === "system" ? "text-primary" : "text-muted-foreground"}`}
            >
              <Monitor className="size-3" />
              System
            </div>
            {theme === "system" && (
              <div className="absolute top-2 right-2 size-4 rounded-full bg-primary flex items-center justify-center">
                <div className="size-1.5 rounded-full bg-primary-foreground" />
              </div>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
