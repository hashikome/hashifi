"use client";

import type { SignedInStaff } from "@hashifi/types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiRequestError, api } from "./api";

interface AuthContextType {
  user: SignedInStaff | null;
  isLoading: boolean;
  /** Asks the API who is signed in; the API alone decides. */
  refresh: () => Promise<SignedInStaff | null>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<SignedInStaff>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SignedInStaff | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const staff = await api.get<SignedInStaff>("/api/me");
      setUser(staff);
      return staff;
    } catch (error) {
      if (!(error instanceof ApiRequestError)) throw error;
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/sign-out");
    } finally {
      setUser(null);
    }
  }, []);

  const updateUser = useCallback((updates: Partial<SignedInStaff>) => {
    setUser((previous) => (previous ? { ...previous, ...updates } : previous));
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, refresh, logout, updateUser }),
    [user, isLoading, refresh, logout, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === null) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
