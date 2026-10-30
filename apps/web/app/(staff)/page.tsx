"use client";

import { ArrowRight, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { LOGO_SRC } from "@/lib/brand";
import { errorMessage } from "@/lib/errors";

const TITLES = {
  email: "Sign in",
  otp: "Check your email",
  authenticator: "Authenticator app",
  backup: "Backup code",
};

const DESCRIPTIONS = {
  email: "Enter your email to receive a sign-in code",
  otp: "",
  authenticator: "Enter the 6-digit code from your authenticator app",
  backup: "Enter one of the backup codes you saved. Each works once.",
};

export default function LoginPage() {
  const router = useRouter();
  const { refresh, user, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [step, setStep] = useState<"email" | "otp" | "authenticator" | "backup">("email");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoading && user) {
      router.push("/admin");
    }
  }, [isLoading, user, router]);

  if (user) {
    return null;
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Please enter your email");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
      setStep("otp");
      toast.success("Check your email", {
        description: "If this address is on the team, a 6-digit code is on its way.",
      });
    } catch (err) {
      toast.error(errorMessage(err, "Could not send a code. Try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Asks who signed in, and goes on: the layout sends an admin to set up an authenticator. */
  const finish = async () => {
    await refresh();
    router.push("/admin");
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const result = await api.post<{ twoFactorRedirect?: boolean }>(
        "/api/auth/sign-in/email-otp",
        {
          email,
          otp,
        },
      );
      setOtp("");
      if (result.twoFactorRedirect === true) {
        setStep("authenticator");
        setIsSubmitting(false);
        return;
      }
      await finish();
    } catch (err) {
      setIsSubmitting(false);
      toast.error(errorMessage(err, "That code did not work. Request a new one if it expired."));
    }
  };

  const handleAuthenticator = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (step === "backup") {
        await api.post("/api/auth/two-factor/verify-backup-code", { code: backupCode.trim() });
      } else {
        await api.post("/api/auth/two-factor/verify-totp", { code: otp });
      }
      await finish();
    } catch (err) {
      setIsSubmitting(false);
      toast.error(errorMessage(err, "That code did not work."));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo and Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3">
            {/* biome-ignore lint/performance/noImgElement: a small static SVG; image optimisation is off (next.config.mjs) */}
            <img src={LOGO_SRC} alt="" className="size-12" />
            <h1 className="text-2xl font-bold text-foreground">HashiFi</h1>
          </div>
          <p className="text-muted-foreground">Staff sign-in</p>
        </div>

        {/* Login Card */}
        <Card className="border-border shadow-lg">
          <CardHeader className="text-center">
            <CardTitle>{TITLES[step]}</CardTitle>
            <CardDescription>
              {step === "otp" ? `Enter the code sent to ${email}` : DESCRIPTIONS[step]}
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
                    placeholder="admin@example.com"
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
            ) : step === "backup" ? (
              <form onSubmit={handleAuthenticator} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="backupCode">Backup code</Label>
                  <Input
                    id="backupCode"
                    autoComplete="off"
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting || !backupCode.trim()}
                >
                  {isSubmitting ? <Loader className="size-4 animate-spin" /> : "Sign In"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStep("authenticator")}
                >
                  Use the authenticator app
                </Button>
              </form>
            ) : (
              <form
                onSubmit={step === "otp" ? handleCode : handleAuthenticator}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>{step === "otp" ? "Email code" : "Authenticator code"}</Label>
                  <div className="flex justify-center">
                    <InputOTP
                      autoFocus
                      maxLength={6}
                      value={otp}
                      onChange={setOtp}
                      disabled={isSubmitting}
                    >
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
                {step === "authenticator" && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setStep("backup")}
                  >
                    Use a backup code
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setStep("email");
                    setOtp("");
                  }}
                >
                  Start again
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
