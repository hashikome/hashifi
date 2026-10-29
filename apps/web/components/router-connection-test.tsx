"use client";

import { AlertTriangle, CheckCircle2, Loader, PlugZap } from "lucide-react";
import { useCallback, useState } from "react";
import { ReadinessChecklist, type ReadinessReport } from "@/components/readiness-checklist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export interface RouterInterfaceInfo {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  isRadio: boolean;
  addresses: string[];
}

export interface RouterTestValues {
  /** Set on the edit form so a blank password means "use the stored one". */
  routerId?: string;
  ipAddress: string;
  apiUsername: string;
  apiPassword: string;
  hotspotInterface: string;
  ssid: string;
  networkRange: string;
  hotspotGatewayIp: string;
  hotspotName: string;
}

interface HotspotPlan {
  interface: string;
  interfaceIsRadio: boolean;
  ssid: string | null;
  network: string;
  gatewayIp: string;
  poolRange: string;
  serverName: string;
}

interface TestResult {
  ok: boolean;
  error?: string;
  hint?: string;
  board?: {
    name: string | null;
    identity: string | null;
    rosVersion: string;
    architecture: string | null;
  };
  wirelessStack?: string;
  compatibility?: { ok: boolean; reasons: string[]; warnings: string[] };
  interfaces?: RouterInterfaceInfo[];
  plan?: HotspotPlan | null;
  readiness?: ReadinessReport | null;
  planError?: string | null;
  managementError?: string | null;
}

/**
 * "Test connection" for the router create/edit forms.
 *
 * Reaches the router with the credentials currently typed in, before anything is saved,
 * and reports back what provisioning would find and decide — including the interfaces it
 * discovered, which the parent turns into pickable values for Hotspot Interface.
 */
export function RouterConnectionTest({
  values,
  onInterfacesFound,
}: {
  values: RouterTestValues;
  onInterfacesFound?: (interfaces: RouterInterfaceInfo[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const canTest =
    values.ipAddress.trim() !== "" &&
    (values.routerId
      ? values.apiUsername.trim() !== "" || values.apiPassword !== ""
      : values.apiUsername.trim() !== "" && values.apiPassword !== "");

  const runTest = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/routers/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, error: data.error || "Could not test the connection" });
        return;
      }
      setResult(data);
      if (data.ok && data.interfaces) onInterfacesFound?.(data.interfaces);
    } catch {
      setResult({
        ok: false,
        error: "Could not reach the billing backend to run the test.",
      });
    } finally {
      setBusy(false);
    }
  }, [values, onInterfacesFound]);

  const compat = result?.compatibility;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={runTest} disabled={busy || !canTest}>
          {busy ? <Loader className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Test connection
        </Button>
        <p className="text-xs text-muted-foreground">
          {canTest
            ? "Reads the board read-only. Nothing is saved or written to the router."
            : "Enter the IP address, API username and password to test."}
        </p>
      </div>

      {result && !result.ok && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm space-y-1">
          <p className="flex items-start gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            {result.error}
          </p>
          {result.hint && <p className="text-xs text-muted-foreground pl-6">{result.hint}</p>}
        </div>
      )}

      {result?.ok && (
        <div className="rounded-md border p-3 text-sm space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{result.board?.name ?? "Unknown board"}</span>
            <Badge variant="outline">RouterOS {result.board?.rosVersion}</Badge>
            {result.board?.architecture && (
              <Badge variant="outline">{result.board.architecture}</Badge>
            )}
            <Badge variant="outline">
              {result.wirelessStack === "none" ? "no radio" : result.wirelessStack}
            </Badge>
            {compat?.ok ? (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                <CheckCircle2 className="mr-1 size-3" /> Can run the hotspot
              </Badge>
            ) : (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 size-3" /> Cannot run the hotspot
              </Badge>
            )}
          </div>

          {compat?.reasons.map((r) => (
            <p key={r} className="text-xs text-destructive">
              {r}
            </p>
          ))}
          {compat?.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-600 dark:text-amber-400">
              {w}
            </p>
          ))}

          {result.planError ? (
            <p className="text-xs text-destructive">
              <span className="font-medium">Provisioning would refuse: </span>
              {result.planError}
            </p>
          ) : (
            result.plan && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Plan: </span>
                hotspot on <span className="font-mono">{result.plan.interface}</span> ·{" "}
                <span className="font-mono">{result.plan.network}</span> · gateway{" "}
                <span className="font-mono">{result.plan.gatewayIp}</span> · pool{" "}
                <span className="font-mono">{result.plan.poolRange}</span>
                {result.plan.interfaceIsRadio && (
                  <>
                    {" · radio enabled"}
                    {result.plan.ssid ? (
                      <>
                        {" and named "}
                        <span className="font-mono">{result.plan.ssid}</span>
                      </>
                    ) : (
                      ", SSID left as-is"
                    )}
                  </>
                )}
              </p>
            )
          )}

          {result.managementError && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{result.managementError}</p>
          )}

          {result.readiness && <ReadinessChecklist report={result.readiness} />}
        </div>
      )}
    </div>
  );
}

/**
 * The interfaces the last test found, offered as one-click values for Hotspot Interface.
 * Radios are marked, because those are the ones auto-detection would consider.
 */
export function HotspotInterfacePicker({
  interfaces,
  value,
  onChange,
}: {
  interfaces: RouterInterfaceInfo[];
  value: string;
  onChange: (name: string) => void;
}) {
  if (interfaces.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      <button
        type="button"
        onClick={() => onChange("")}
        className={`rounded-md border px-2 py-1 text-xs transition-colors ${
          value === "" ? "border-primary bg-primary/10 text-foreground" : "hover:bg-muted"
        }`}
      >
        Auto-detect
      </button>
      {interfaces.map((i) => (
        <button
          key={i.name}
          type="button"
          onClick={() => onChange(i.name)}
          disabled={i.disabled}
          title={[
            i.type,
            i.disabled ? "disabled" : i.running ? "running" : "not running",
            ...i.addresses,
          ].join(" · ")}
          className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors disabled:opacity-40 ${
            value === i.name ? "border-primary bg-primary/10" : "hover:bg-muted"
          }`}
        >
          {i.name}
          {i.isRadio && <span className="ml-1 font-sans text-muted-foreground">radio</span>}
          {i.addresses.length > 0 && (
            <span className="ml-1 font-sans text-muted-foreground">in use</span>
          )}
        </button>
      ))}
    </div>
  );
}
