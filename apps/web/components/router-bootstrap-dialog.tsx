"use client";

import type { BootstrapScriptResponse } from "@hashifi/types";
import { AlertTriangle, Check, Copy, Download, Loader, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

export interface BootstrapDefaults {
  routerName: string;
  ipAddress: string;
  apiUsername: string;
  /** Usually the venue name — what customers will see in their WiFi list. */
  ssid: string;
}

/**
 * Generates the one-off script that prepares a new or freshly reset MikroTik.
 *
 * The script is produced server-side (`POST /api/routers/:id/bootstrap-script`) because it
 * encodes provisioning's own conventions — the bridge name, the API port, and the run-time
 * detection of which wireless stack the board has.
 */
export function RouterBootstrapDialog({
  open,
  onOpenChange,
  routerId,
  defaults,
  onSsidChosen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved router: the script carries its tunnel and stored credentials. */
  routerId: string;
  defaults: BootstrapDefaults;
  /**
   * Push the SSID back onto the router form.
   *
   * Without this the script sets the network name on the radio but the row saves `ssid = NULL`,
   * and `hotspot-radio-ssid` is skipped whenever the column is null — so no future Set up ever
   * re-asserts the name. Nothing errors; the network just silently keeps whatever the radio
   * happens to be broadcasting, and the only hint is Test connection still reporting
   * "SSID left as-is". Hit for real while onboarding on 2026-08-12.
   */
  onSsidChosen?: (ssid: string) => void;
}) {
  const [gatewayIp, setGatewayIp] = useState("");
  const [ssid, setSsid] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [lanPrefix, setLanPrefix] = useState("24");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BootstrapScriptResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-seed each time it opens so edits to the form behind it are picked up.
  useEffect(() => {
    if (!open) return;
    setSsid(defaults.ssid || defaults.routerName);
    setResult(null);
    setCopied(false);
  }, [open, defaults.ssid, defaults.routerName]);

  const generate = useCallback(async () => {
    setBusy(true);
    setCopied(false);
    try {
      const data = await api.post<BootstrapScriptResponse>(
        `/api/routers/${routerId}/bootstrap-script`,
        {
          lanPrefix: Number(lanPrefix) || 24,
          ...(gatewayIp.trim() ? { gatewayIp: gatewayIp.trim() } : {}),
          ...(adminPassword.trim() ? { adminPassword: adminPassword.trim() } : {}),
          ...(ssid.trim() ? { ssid: ssid.trim() } : {}),
        },
      );
      setResult(data);
      if (!gatewayIp.trim() && data.resolved.gatewayIp) setGatewayIp(data.resolved.gatewayIp);
      // The API stored the SSID on the router; the form behind this must not overwrite it.
      onSsidChosen?.(data.resolved.ssid);
    } catch (err) {
      toast.error(errorMessage(err, "Could not generate the script"));
    } finally {
      setBusy(false);
    }
  }, [routerId, gatewayIp, adminPassword, ssid, lanPrefix, onSsidChosen]);

  const copy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.script);
      setCopied(true);
      toast.success("Script copied — paste it into WinBox → New Terminal");
    } catch {
      toast.error("Could not access the clipboard. Select the text and copy it manually.");
    }
  }, [result]);

  const download = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.script], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bootstrap-${defaults.routerName.replace(/[^A-Za-z0-9_-]+/g, "-") || "router"}.rsc`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, defaults.routerName]);

  const missing: string[] = [];
  if (!defaults.routerName.trim()) missing.push("Router Name");
  if (!defaults.ipAddress.trim()) missing.push("Router IP Address");
  if (!defaults.apiUsername.trim()) missing.push("API Username");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
       * `overflow-y-auto` on the DialogContent itself scrolls the header away with everything else,
       * taking the close button (absolute top-4) off screen — so a long generated script left the
       * dialog with no visible title and no way out but Esc. Scroll the body only, and the header
       * stays pinned. Same shape as ProvisionDialog.
       */}
      <DialogContent className="max-h-[90vh] max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="size-5" />
            Bootstrap script
          </DialogTitle>
          <DialogDescription>
            Prepares a new or freshly reset MikroTik with the four things provisioning connects
            through and so cannot create for itself: the LAN address, the API service and its user,
            the bridge, and the radio. It works out which wireless stack your board has by itself —
            you do not need to know.
          </DialogDescription>
        </DialogHeader>

        {/* space-y-4 replaces the grid `gap-4` these children used to get individually. */}
        <div className="space-y-4 overflow-y-auto pr-1">
          {missing.length > 0 ? (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
              <p className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                Fill in {missing.join(", ")} on the form first — the script is built from those
                values.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bs-gateway">ISP router / upstream gateway</Label>
                  <Input
                    id="bs-gateway"
                    value={gatewayIp}
                    onChange={(e) => setGatewayIp(e.target.value)}
                    placeholder="Derived from the router's IP"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Where the router sends internet-bound traffic. Left blank, the first address in
                    its subnet is assumed.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bs-ssid">SSID</Label>
                  <Input
                    id="bs-ssid"
                    value={ssid}
                    onChange={(e) => setSsid(e.target.value)}
                    placeholder="Network name customers will see"
                    maxLength={32}
                  />
                  <p className="text-xs text-muted-foreground">
                    What appears in the customer&apos;s WiFi list. Usually the venue name.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bs-admin">New admin password (optional)</Label>
                  <Input
                    id="bs-admin"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Leave blank to not change it"
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-muted-foreground">
                    A reset MikroTik has a blank admin password. Set one here or the board goes into
                    service wide open.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bs-prefix">LAN prefix length</Label>
                  <Input
                    id="bs-prefix"
                    value={lanPrefix}
                    onChange={(e) => setLanPrefix(e.target.value)}
                    placeholder="24"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    The mask on the router&apos;s LAN address. Almost always 24.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={generate} disabled={busy}>
                  {busy ? (
                    <Loader className="size-4 animate-spin" />
                  ) : (
                    <Terminal className="size-4" />
                  )}
                  {result ? "Regenerate" : "Generate script"}
                </Button>
                {result && (
                  <>
                    <Button type="button" variant="outline" onClick={copy}>
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button type="button" variant="outline" onClick={download}>
                      <Download className="size-4" />
                      Download .rsc
                    </Button>
                  </>
                )}
              </div>
            </>
          )}

          {result?.resolved.apiPasswordGenerated && (
            <p className="text-xs text-muted-foreground">
              A strong API password was generated and saved on this router. Generating the script
              again gives the same one.
            </p>
          )}

          {result?.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-800 dark:text-amber-400">
              {w}
            </p>
          ))}

          {result && (
            <>
              <div className="rounded-md bg-zinc-950 p-3 max-h-80 overflow-auto">
                <pre className="font-mono text-xs text-zinc-100 whitespace-pre">
                  {result.script}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground">
                Reset the router first with{" "}
                <span className="font-mono">
                  /system reset-configuration no-defaults=yes skip-backup=yes
                </span>
                , reconnect over MAC-WinBox, then paste this. It is safe to paste more than once.
                The script contains the API password in clear text — do not forward it.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
