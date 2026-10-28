"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  Loader,
  Search,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ReadinessChecklist, type ReadinessReport } from "@/components/readiness-checklist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/**
 * A labelled group inside the dialog.
 *
 * The two checklists render identical-looking rows, so without a heading saying what question each
 * one answers they read as a single list — the reason a "site is not ready" row and an "is it
 * serving" row could sit adjacent with no way to tell them apart.
 */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
        {title}
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

type StepState = "satisfied" | "applied" | "would-apply" | "skipped" | "failed";

interface StepResult {
  id: string;
  title: string;
  state: StepState;
  critical: boolean;
  durationMs: number;
  message?: string;
}

interface RouterProfile {
  boardName: string | null;
  architecture: string | null;
  rosVersion: { raw: string };
  identity: string | null;
  wirelessStack: string;
  capabilities: Record<string, boolean>;
  compatibility: { ok: boolean; reasons: string[]; warnings: string[] };
}

type SetupPhaseId = "probe" | "readiness" | "dry-run" | "provision" | "verify" | "self-test";
type SetupPhaseStatus = "pass" | "warn" | "fail" | "skipped";

interface SetupPhase {
  id: SetupPhaseId;
  title: string;
  status: SetupPhaseStatus;
  detail: string;
  durationMs: number;
}

interface VerifyReport {
  ok: boolean;
  checks: ReadinessReport["checks"];
  manual: string[];
  summary: ReadinessReport["summary"];
}

interface SetupReport {
  ok: boolean;
  stoppedAt: SetupPhaseId | null;
  forced: boolean;
  phases: SetupPhase[];
  blockers: { reason: string; fix?: string }[];
  profile: RouterProfile | null;
  plan: HotspotPlan | null;
  readiness: ReadinessReport | null;
  provision: ProvisionReport | null;
  verify: ProvisionReport | null;
  selfTest: VerifyReport | null;
}

interface HotspotPlan {
  interface: string;
  interfaceIsRadio: boolean;
  ssid: string | null;
  network: string;
  gatewayIp: string;
  poolRange: string;
}

interface ProvisionReport {
  ok: boolean;
  aborted: boolean;
  dryRun: boolean;
  profile: RouterProfile | null;
  steps: StepResult[];
  summary: {
    total: number;
    satisfied: number;
    applied: number;
    wouldApply: number;
    skipped: number;
    failed: number;
  };
  blockingReasons: string[];
}

interface LogLine {
  seq: number;
  message: string;
  command?: string;
  params?: string[];
  durationMs?: number;
  outcome?: string;
  level: string;
}

const STATE_STYLES: Record<StepState, string> = {
  satisfied: "text-muted-foreground",
  applied: "text-emerald-600 dark:text-emerald-400",
  "would-apply": "text-amber-600 dark:text-amber-400",
  skipped: "text-muted-foreground/60",
  failed: "text-destructive",
};

const STATE_LABEL: Record<StepState, string> = {
  satisfied: "already correct",
  applied: "applied",
  "would-apply": "would apply",
  skipped: "skipped",
  failed: "failed",
};

export function ProvisionDialog({
  routerId,
  routerName,
  open,
  onOpenChange,
  onComplete,
}: {
  routerId: string;
  routerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}) {
  const [busy, setBusy] = useState<"setup" | "probe" | "dry" | "apply" | "verify" | null>(null);
  const [report, setReport] = useState<ProvisionReport | null>(null);
  const [profile, setProfile] = useState<RouterProfile | null>(null);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [plan, setPlan] = useState<HotspotPlan | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [confirmApply, setConfirmApply] = useState(false);
  const [setup, setSetup] = useState<SetupReport | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [confirmSetup, setConfirmSetup] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selfTest, setSelfTest] = useState<VerifyReport | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  /*
   * Follow the run: open the console while something is in flight so the commands can be watched
   * streaming, and close it when the run ends so the dialog settles on its findings instead of on
   * a wall of RouterOS commands. Manual toggling still wins until the next run starts.
   */
  useEffect(() => {
    setConsoleOpen(busy !== null);
  }, [busy]);

  // Live command transcript over the shared /ws/live socket.
  useEffect(() => {
    if (!open) return;

    const wsUrl = `${API_URL.replace(/^http/, "ws")}/ws/live`;
    let socket: WebSocket | null = null;

    try {
      socket = new WebSocket(wsUrl);
    } catch {
      return; // live log is a nicety; the final report still arrives over HTTP
    }

    socket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type !== "provision_log") return;
        setLines((prev) => [...prev, msg.event as LogLine]);
      } catch {
        /* ignore malformed frames */
      }
    };

    return () => socket?.close();
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the log as new lines arrive
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (!open) {
      setReport(null);
      setProfile(null);
      setReadiness(null);
      setPlan(null);
      setLines([]);
      setConfirmApply(false);
      setSetup(null);
      setConfirmSetup(false);
      setShowAdvanced(false);
      setSelfTest(null);
    }
  }, [open]);

  const runProbe = useCallback(async () => {
    setBusy("probe");
    setLines([]);
    setReport(null);
    try {
      const res = await fetch(`${API_URL}/api/routers/${routerId}/probe`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Probe failed");
      setProfile(data.profile);
      setReadiness(data.readiness ?? null);
      setPlan(data.plan ?? null);

      const failed = data.readiness?.summary?.fail ?? 0;
      if (!data.profile.compatibility.ok) toast.error("Router cannot run the hotspot");
      else if (failed > 0)
        toast.error(`${failed} problem${failed === 1 ? "" : "s"} would stop this working`);
      else toast.success("Router is ready to provision");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setBusy(null);
    }
  }, [routerId]);

  /**
   * The whole procedure. `force` proceeds past failing readiness checks — offered only after
   * a run has already reported them, never as the first thing the admin can click.
   */
  const runSetup = useCallback(
    async (force: boolean) => {
      setBusy("setup");
      setLines([]);
      setReport(null);
      setSetup(null);
      setSelfTest(null);
      try {
        const res = await fetch(
          `${API_URL}/api/routers/${routerId}/setup${force ? "?force=1" : ""}`,
          { method: "POST", credentials: "include" },
        );
        const data: SetupReport = await res.json();
        if (!res.ok)
          throw new Error((data as unknown as { error?: string }).error || "Setup failed");

        setSetup(data);
        setProfile(data.profile);
        setPlan(data.plan);
        setReadiness(data.readiness);
        setSelfTest(data.selfTest);
        // Show whichever run last touched steps, so the step list stays meaningful.
        setReport(data.verify ?? data.provision ?? null);

        if (data.ok) toast.success("Router is set up and verified");
        else if (data.stoppedAt === "readiness")
          toast.error("Stopped before writing anything — the site is not ready");
        else toast.error(`Stopped at: ${data.phases.find((p) => p.id === data.stoppedAt)?.title}`);

        if (data.provision) onComplete?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Setup failed");
      } finally {
        setBusy(null);
        setConfirmSetup(false);
      }
    },
    [routerId, onComplete],
  );

  /** Re-check an in-service router without changing its configuration. */
  const runVerify = useCallback(async () => {
    setBusy("verify");
    setLines([]);
    try {
      const res = await fetch(`${API_URL}/api/routers/${routerId}/verify`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not check the router");
      setSelfTest(data.verify);
      if (data.ok) toast.success("Hotspot is serving");
      else toast.error(`${data.verify.summary.fail} check(s) show it would not serve`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not check the router");
    } finally {
      setBusy(null);
    }
  }, [routerId]);

  const runProvision = useCallback(
    async (dryRun: boolean) => {
      setBusy(dryRun ? "dry" : "apply");
      setLines([]);
      setReport(null);
      try {
        const res = await fetch(
          `${API_URL}/api/routers/${routerId}/provision${dryRun ? "?dryRun=1" : ""}`,
          { method: "POST", credentials: "include" },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Provisioning failed");
        setReport(data);
        setProfile(data.profile);

        if (data.aborted) toast.error("Aborted — router is not compatible");
        else if (data.ok) toast.success(dryRun ? "Dry run complete" : "Router provisioned");
        else toast.error(`${data.summary.failed} step(s) failed`);

        if (!dryRun) onComplete?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Provisioning failed");
      } finally {
        setBusy(null);
        setConfirmApply(false);
      }
    },
    [routerId, onComplete],
  );

  const compat = profile?.compatibility;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
       * A finished setup run is tall — six phases, a readiness list, every step, and the console.
       * The dialog is centred with `translate-y-[-50%]`, so without a height cap it grows past the
       * viewport in BOTH directions and takes the close button (absolute top-4) off-screen with it;
       * the page scrolls, the dialog does not, and Esc becomes the only way out. Cap the height and
       * scroll the body, keeping the header — and therefore the X — pinned.
       */}
      <DialogContent className="max-h-[90vh] max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Set up “{routerName}”</DialogTitle>
          <DialogDescription>
            Identifies the board, checks the site is ready, previews every change, applies it, then
            re-checks that it stuck. Stops at the first problem and tells you how to fix it —
            nothing is written to a router that is not ready.
          </DialogDescription>
        </DialogHeader>

        {/* space-y-4 replaces the grid `gap-4` these children used to get individually. */}
        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              variant={confirmSetup ? "destructive" : "default"}
              disabled={busy !== null}
              onClick={() => (confirmSetup ? runSetup(false) : setConfirmSetup(true))}
            >
              {busy === "setup" ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {confirmSetup ? "Click again to configure the router" : "Set up router"}
            </Button>

            {/* Only offered once a run has actually reported what is being overridden. */}
            {setup?.stoppedAt === "readiness" && (
              <Button variant="outline" disabled={busy !== null} onClick={() => runSetup(true)}>
                <AlertTriangle className="h-4 w-4" />
                Set up anyway
              </Button>
            )}

            <Button variant="outline" disabled={busy !== null} onClick={runVerify}>
              {busy === "verify" ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Check it&apos;s serving
            </Button>

            <button
              type="button"
              className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide individual steps" : "Run steps individually"}
            </button>
          </div>

          {showAdvanced && (
            <div className="flex flex-wrap gap-2 rounded-md border border-dashed p-2">
              <Button size="sm" variant="outline" onClick={runProbe} disabled={busy !== null}>
                {busy === "probe" ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Probe
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => runProvision(true)}
                disabled={busy !== null}
              >
                {busy === "dry" ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <FlaskConical className="h-4 w-4" />
                )}
                Dry run
              </Button>
              <Button
                size="sm"
                variant={confirmApply ? "destructive" : "secondary"}
                disabled={busy !== null}
                onClick={() => (confirmApply ? runProvision(false) : setConfirmApply(true))}
              >
                {busy === "apply" ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {confirmApply ? "Click again to write" : "Provision only"}
              </Button>
            </div>
          )}

          {setup && (
            <div className="space-y-2">
              <div className="rounded-md border">
                {setup.phases.map((p, i) => (
                  <div
                    key={p.id}
                    className="flex items-start gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                  >
                    <span className="w-8 shrink-0 pt-0.5 text-xs text-muted-foreground">
                      {i + 1}/{setup.phases.length}
                    </span>
                    {p.status === "pass" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : p.status === "warn" ? (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : p.status === "fail" ? (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    ) : (
                      <span className="mt-0.5 size-4 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p
                        className={
                          p.status === "skipped"
                            ? "text-muted-foreground"
                            : "font-medium leading-snug"
                        }
                      >
                        {p.title}
                      </p>
                      <p className="text-xs text-muted-foreground">{p.detail}</p>
                    </div>
                    {p.durationMs > 0 && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {(p.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {setup.blockers.length > 0 && (
                <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">
                    Fix {setup.blockers.length === 1 ? "this" : "these, in order"}:
                  </p>
                  <ol className="space-y-2">
                    {setup.blockers.map((b, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: an ordered list replaced as a whole; reasons can repeat, so position is the identity
                      <li key={`${b.reason}-${i}`} className="text-xs">
                        <span className="font-medium">{b.reason}</span>
                        {b.fix && <span className="block text-muted-foreground">{b.fix}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {setup.ok && (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  Configured, verified, and confirmed serving. The remaining checks below need a
                  real phone.
                </p>
              )}
            </div>
          )}

          {profile && (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{profile.boardName ?? "Unknown board"}</span>
                <Badge variant="outline">RouterOS {profile.rosVersion.raw}</Badge>
                <Badge variant="outline">{profile.architecture}</Badge>
                <Badge variant="outline">{profile.wirelessStack}</Badge>
                {compat?.ok ? (
                  <Badge className="bg-emerald-600">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Compatible
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <AlertTriangle className="mr-1 h-3 w-3" /> Incompatible
                  </Badge>
                )}
              </div>

              {compat?.reasons.map((r) => (
                <p key={r} className="mt-2 text-destructive">
                  {r}
                </p>
              ))}
              {compat?.warnings.map((w) => (
                <p key={w} className="mt-2 text-amber-600 dark:text-amber-400">
                  {w}
                </p>
              ))}

              {plan && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Plan: </span>
                  hotspot on <span className="font-mono">{plan.interface}</span> ·{" "}
                  <span className="font-mono">{plan.network}</span> · gateway{" "}
                  <span className="font-mono">{plan.gatewayIp}</span>
                  {plan.interfaceIsRadio &&
                    (plan.ssid ? ` · radio enabled and named ${plan.ssid}` : " · radio enabled")}
                </p>
              )}
            </div>
          )}

          {/*
           * Both checklists render the same row component, so without a heading each they read as
           * one long undifferentiated list — which is how "the DHCP server is invalid" ended up
           * sitting next to "no conflicting hand-made config" with nothing saying they answer
           * different questions. No inner scroller either: the dialog body scrolls now, and nesting
           * one inside it hides findings behind a second scrollbar the eye does not expect.
           */}
          {readiness && (
            <Section title="Before writing anything" hint="Is the site ready?">
              <ReadinessChecklist report={readiness} />
            </Section>
          )}

          {selfTest && (
            <Section title="After writing" hint="Is the hotspot actually serving?">
              <ReadinessChecklist report={selfTest} />
              <div className="rounded-md border border-dashed p-3">
                <p className="text-sm font-medium">Still needs a phone</p>
                <ul className="mt-1 space-y-1">
                  {selfTest.manual.map((m) => (
                    <li key={m} className="text-xs text-muted-foreground">
                      · {m}
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          )}

          {/*
           * Collapsed by default. On a clean board this is ~19 rows of "already correct" — the signal
           * is the count in the header, and the rows only matter when something did not apply. The
           * summary lives up here rather than at the very bottom of the dialog, where it was below
           * the console and nobody scrolled that far.
           */}
          {report && report.steps.length > 0 && (
            <Collapsible defaultOpen={report.summary.failed > 0}>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent">
                <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                <span className="font-medium">Every step</span>
                <span className="text-xs text-muted-foreground">
                  {report.summary.satisfied} already correct ·{" "}
                  {report.dryRun
                    ? `${report.summary.wouldApply} would apply`
                    : `${report.summary.applied} applied`}{" "}
                  · {report.summary.skipped} skipped
                  {report.summary.failed > 0 && (
                    <span className="text-destructive"> · {report.summary.failed} failed</span>
                  )}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 rounded-md border">
                {report.steps.map((step) => (
                  <div
                    key={step.id}
                    className="flex items-baseline justify-between gap-3 border-b px-3 py-1.5 text-sm last:border-b-0"
                  >
                    <span className="truncate">{step.title}</span>
                    <span className={`shrink-0 text-xs ${STATE_STYLES[step.state]}`}>
                      {STATE_LABEL[step.state]}
                      {step.message ? ` — ${step.message}` : ""}
                    </span>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/*
           * Open while a run is in flight — watching commands stream is the point of /ws/live — and
           * collapsed once it finishes, so a completed run ends on its findings rather than on 60
           * lines of RouterOS commands. Keeps its own scroll cap: it is a live log, and auto-scrolls.
           */}
          {lines.length > 0 && (
            <Collapsible open={consoleOpen} onOpenChange={setConsoleOpen}>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent">
                <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                <span className="font-medium">Router console</span>
                <span className="text-xs text-muted-foreground">
                  {lines.length} line{lines.length === 1 ? "" : "s"}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent
                ref={logRef}
                className="mt-2 max-h-64 overflow-y-auto rounded-md bg-zinc-950 p-3 font-mono text-xs text-zinc-100"
              >
                {lines.map((line) => (
                  <div
                    key={line.seq}
                    className={
                      line.outcome === "failed" || line.level === "error"
                        ? "text-red-400"
                        : line.outcome === "unsupported" || line.level === "warn"
                          ? "text-amber-400"
                          : "text-zinc-300"
                    }
                  >
                    {line.command ? (
                      <>
                        <span className="text-zinc-500">{line.outcome === "ok" ? "→" : "✗"} </span>
                        {line.command}
                        {line.params?.length ? ` ${line.params.join(" ")}` : ""}
                        {line.durationMs !== undefined ? ` (${line.durationMs}ms)` : ""}
                      </>
                    ) : (
                      line.message
                    )}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
