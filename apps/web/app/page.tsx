"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Wifi, ArrowRight, Loader } from "lucide-react"
import { toast } from "sonner"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"

export default function LoginPage() {
  const router = useRouter()
  const { sendOtp, login, user, isLoading } = useAuth()
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [step, setStep] = useState<"email" | "otp">("email")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoading && user) {
      router.push("/admin")
    }
  }, [isLoading, user, router])

  if (user) {
    return null
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      toast.error("Please enter your email")
      return
    }

    setIsSubmitting(true)
    const result = await sendOtp(email)
    setIsSubmitting(false)

    if (result.success) {
      setStep("otp")
      toast.success("OTP sent", {
        description: "Check your email for the 6-digit login code.",
      })
    } else {
      toast.error(result.error || "Email not found. Please use a valid admin email.")
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otp.length !== 6) {
      toast.error("Please enter the 6-digit OTP")
      return
    }

    setIsSubmitting(true)
    const result = await login(email, otp)

    if (result.success) {
      toast.success("Welcome back!")
      router.push("/admin")
      // button stays loading — navigating away
    } else {
      setIsSubmitting(false)
      toast.error(result.error || "Invalid OTP. Request a new code if it expired.")
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo and Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3">
            <div className="flex items-center justify-center size-12 rounded-full bg-primary text-primary-foreground">
              <Wifi className="size-6" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">WiFi Billing</h1>
          </div>
          <p className="text-muted-foreground">Enterprise Admin Portal</p>
        </div>

        {/* Login Card */}
        <Card className="border-border shadow-lg">
          <CardHeader className="text-center">
            <CardTitle>{step === "email" ? "Sign In" : "Enter OTP"}</CardTitle>
            <CardDescription>
              {step === "email"
                ? "Enter your admin email to receive an OTP"
                : `We sent a code to ${email}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "email" ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@wifibilling.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isSubmitting}
                    className="rounded-lg"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader className="size-4 animate-spin" />
                  ) : (
                    <>
                      Continue
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label>One-Time Password</Label>
                  <div className="flex justify-center">
                    <InputOTP maxLength={6} value={otp} onChange={setOtp} disabled={isSubmitting}>
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting || otp.length !== 6}
                >
                  {isSubmitting ? <Loader className="size-4 animate-spin" /> : "Sign In"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setStep("email")
                    setOtp("")
                  }}
                >
                  Use a different email
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
