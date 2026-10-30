"use client";

import { Check, Copy, Loader, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/errors";

interface Enrollment {
  totpURI: string;
  backupCodes: string[];
}

/** Where an admin without an authenticator app lands: they can reach nothing else (ADR-0007). */
export default function SetupAuthenticatorPage() {
  const router = useRouter();
  const { user, isLoading, refresh } = useAuth();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/");
    } else if (user.twoFactorEnabled) {
      router.replace("/admin");
    } else if (!requested.current) {
      // Once: each request replaces the secret and the backup codes.
      requested.current = true;
      api
        .post<Enrollment>("/api/auth/two-factor/enable")
        .then(setEnrollment)
        .catch((err: unknown) => toast.error(errorMessage(err, "Could not start the setup.")));
    }
  }, [isLoading, user, router]);

  const secret = enrollment ? new URL(enrollment.totpURI).searchParams.get("secret") : null;

  const copyBackupCodes = async () => {
    if (!enrollment) return;
    await navigator.clipboard.writeText(enrollment.backupCodes.join("\n"));
    toast.success("Backup codes copied");
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post("/api/auth/two-factor/verify-totp", { code });
      await refresh();
      router.replace("/admin");
    } catch (err) {
      setIsSubmitting(false);
      setCode("");
      toast.error(errorMessage(err, "That code did not work. Check the time on your phone."));
    }
  };

  if (!enrollment) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            Set up your authenticator app
          </CardTitle>
          <CardDescription>
            Admins can change every venue and router, so signing in takes a code from an app on your
            phone as well as your email.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label>1. Scan this with your authenticator app</Label>
            <div className="flex justify-center rounded-lg bg-white p-4">
              <QRCodeSVG value={enrollment.totpURI} size={184} />
            </div>
            <p className="text-xs text-muted-foreground break-all">
              Or enter this key: <span className="font-mono">{secret}</span>
            </p>
          </div>

          <div className="space-y-3">
            <Label>2. Save your backup codes</Label>
            <p className="text-xs text-muted-foreground">
              Each works once if you lose your phone. They are shown only now.
            </p>
            <ul className="grid grid-cols-2 gap-1 rounded-lg border p-3 font-mono text-sm">
              {enrollment.backupCodes.map((backupCode) => (
                <li key={backupCode}>{backupCode}</li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copyBackupCodes}>
                <Copy className="size-4" />
                Copy
              </Button>
              <Button
                type="button"
                variant={saved ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSaved(true)}
              >
                {saved && <Check className="size-4" />}I saved them
              </Button>
            </div>
          </div>

          <form onSubmit={handleVerify} className="space-y-3">
            <Label>3. Enter the code from the app</Label>
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={code} onChange={setCode} disabled={isSubmitting}>
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
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || code.length !== 6 || !saved}
            >
              {isSubmitting ? <Loader className="size-4 animate-spin" /> : "Finish setup"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
