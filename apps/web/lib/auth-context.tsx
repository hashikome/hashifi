"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import type { AdminUser } from "./types"

interface AuthResult {
  success: boolean
  error?: string
}

interface AuthContextType {
  user: AdminUser | null
  isLoading: boolean
  login: (email: string, otp: string) => Promise<AuthResult>
  logout: () => Promise<void>
  sendOtp: (email: string) => Promise<AuthResult>
  updateUser: (updates: Partial<AdminUser>) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadSession() {
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          credentials: "include",
        })

        if (!isMounted) return

        if (response.ok) {
          const data = (await response.json()) as { user: AdminUser }
          setUser(data.user)
        } else {
          localStorage.removeItem("wifi_admin_user")
          setUser(null)
        }
      } catch {
        if (isMounted) {
          localStorage.removeItem("wifi_admin_user")
          setUser(null)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadSession()

    return () => {
      isMounted = false
    }
  }, [])

  const sendOtp = async (email: string): Promise<AuthResult> => {
    try {
      const response = await fetch(`${API_URL}/api/auth/request-otp`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        return { success: false, error: data?.error }
      }

      return { success: true }
    } catch {
      return { success: false }
    }
  }

  const login = async (email: string, otp: string): Promise<AuthResult> => {
    try {
      const response = await fetch(`${API_URL}/api/auth/verify-otp`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, otp }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        return { success: false, error: data?.error }
      }

      const data = (await response.json()) as { user: AdminUser }
      setUser(data.user)
      return { success: true }
    } catch {
      return { success: false }
    }
  }

  const updateUser = (updates: Partial<AdminUser>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev))
  }

  const logout = async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      })
    } finally {
      localStorage.removeItem("wifi_admin_user")
      setUser(null)
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, sendOtp, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
