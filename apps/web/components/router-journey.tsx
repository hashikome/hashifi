"use client";

import type { RouterJourney, RouterRecord, RouterSetupPhase, RouterStage } from "@hashifi/types";
import { AlertTriangle, Check, Circle, Loader, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";
import { ReadinessChecklist, type ReadinessReport } from "@/components/readiness-checklist";
import { RouterBootstrapDialog } from "@/components/router-bootstrap-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const STAGES: { id: RouterStage; title: string }[] = [
  { id: "connect", title: "Connect the router" },
  { id: "set-up", title: "Set up the hotspot" },
  { id: "serving", title: "Serving guests" },
];

const POLL_RUNNING_MS = 2_000;
const POLL_WAITING_MS = 15_000;

const finished = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
});

function StageMark({ state }: { state: "done" | "current" | "waiting" }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full",
        state === "done" && "bg-accent text-accent-foreground",
        state === "current" && "bg-primary text-primary-foreground",
        state === "waiting" && "border border-input text-muted-foreground",
      )}
      aria-hidden
    >
      {state === "done" ? (
        <Check className="size-3.5" />
      ) : (
        <Circle className="size-2 fill-current" />
      )}
    </span>
  );
}

function PhaseMark({ status }: { status: RouterSetupPhase["status"] }) {
  if (status === "running") return <Loader className="size-4 animate-spin text-primary" />;
  if (status === "pass") return <Check className="size-4 text-primary" />;
  if (status === "warn") return <AlertTriangle className="size-4 text-warning" />;
  if (status === "fail") return <X className="size-4 text-destructive" />;
  return <Circle className="size-2 text-muted-foreground" />;
}

function SetupPhases({ phases }: { phases: RouterSetupPhase[] }) {
  return (
    <ul className="space-y-2" aria-live="polite">
      {phases.map((phase) => (
        <li key={phase.id} className="flex items-start gap-3 text-sm">
          <span className="flex size-5 shrink-0 items-center justify-center">
            <PhaseMark status={phase.status} />
          </span>
          <span>
            <span className={cn(phase.status === "pending" && "text-muted-foreground")}>
              {phase.title}
            </span>
            {phase.detail && phase.status !== "pass" && (
              <span className="block text-muted-foreground">{phase.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SetupProblem({ journey }: { journey: RouterJourney }) {
  return (
    <div className="space-y-2 rounded-md bg-destructive/10 p-4 text-sm" role="alert">
      <p className="font-medium">
        {journey.interrupted ? "Setup was interrupted" : "Setup stopped"}
      </p>
      {journey.interrupted && (
        <p className="text-muted-foreground">
          HashiFi restarted during the run. Setup is safe to run again.
        </p>
      )}
      {journey.blockers.map((blocker) => (
        <div key={blocker.reason}>
          <p>{blocker.reason}</p>
          {blocker.fix && <p className="text-muted-foreground">{blocker.fix}</p>}
        </div>
      ))}
    </div>
  );
}

/** The router's path from reset to serving guests. The API decides; this renders it. */
export function RouterJourneyPanel({
  router,
  canManage,
}: {
  router: RouterRecord;
  canManage: boolean;
}) {
  const [journey, setJourney] = useState<RouterJourney | null>(null);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ReadinessReport | null>(null);

  const load = useCallback(async () => {
    try {
      setJourney(await api.get<RouterJourney>(`/api/routers/${router.id}/journey`));
    } catch (err) {
      toast.error(errorMessage(err, "Could not load this router"));
    }
  }, [router.id]);

  const running = journey?.running ?? false;
  useEffect(() => {
    void load();
    const timer = setInterval(load, running ? POLL_RUNNING_MS : POLL_WAITING_MS);
    return () => clearInterval(timer);
  }, [load, running]);

  const start = async (force: boolean) => {
    setStarting(true);
    setCheck(null);
    try {
      setJourney(
        await api.post<RouterJourney>(`/api/routers/${router.id}/setup${force ? "?force=1" : ""}`),
      );
    } catch (err) {
      toast.error(errorMessage(err, "Could not start setup"));
    } finally {
      setStarting(false);
      setConfirmForce(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await api.post<ReadinessReport>(`/api/routers/${router.id}/verify`));
    } catch (err) {
      toast.error(errorMessage(err, "Could not reach the router"));
    } finally {
      setChecking(false);
    }
  };

  if (journey === null) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  const currentIndex = STAGES.findIndex((stage) => stage.id === journey.stage);
  const readinessFailed = journey.phases.some(
    (phase) => phase.id === "readiness" && phase.status === "fail",
  );
  const failed = journey.ok === false || journey.interrupted;

  return (
    <>
      <ol className="space-y-6">
        {STAGES.map((stage, index) => {
          const state =
            index < currentIndex ? "done" : index === currentIndex ? "current" : "waiting";
          return (
            <li key={stage.id} className="flex gap-4">
              <StageMark state={state} />
              <div className="min-w-0 flex-1 space-y-4">
                <h2
                  className={cn(
                    "text-[18px] font-semibold leading-6",
                    state === "waiting" && "text-muted-foreground",
                  )}
                >
                  {stage.title}
                </h2>

                {state === "current" && stage.id === "connect" && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Reset the router, then paste the setup script into its terminal. It connects
                      the router to HashiFi, so nothing has to be opened at the venue.
                    </p>
                    {canManage && (
                      <Button onClick={() => setScriptOpen(true)}>Get setup script</Button>
                    )}
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader className="size-4 animate-spin" />
                      Waiting for the router to connect
                    </p>
                  </>
                )}

                {state === "current" && stage.id === "set-up" && !running && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      The router is connected. HashiFi checks it, applies the hotspot and confirms
                      it works. It takes a few minutes, and you can leave this page.
                    </p>
                    {failed && <SetupProblem journey={journey} />}
                    {journey.ok === false && <SetupPhases phases={journey.phases} />}
                    {canManage && (
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => start(false)} disabled={starting}>
                          {starting && <Loader className="size-4 animate-spin" />}
                          {failed ? "Try again" : "Set up router"}
                        </Button>
                        {readinessFailed && (
                          <Button variant="outline" onClick={() => setConfirmForce(true)}>
                            Set up anyway
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => setScriptOpen(true)}>
                          Get setup script
                        </Button>
                      </div>
                    )}
                  </>
                )}

                {stage.id === "set-up" && running && <SetupPhases phases={journey.phases} />}

                {state === "current" && stage.id === "serving" && !running && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Set up and confirmed
                      {journey.finishedAt && ` on ${finished.format(new Date(journey.finishedAt))}`}
                      . Guests can join this router's hotspot.
                    </p>
                    {canManage && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={runCheck} disabled={checking}>
                          {checking && <Loader className="size-4 animate-spin" />}
                          Check it's serving
                        </Button>
                        <Button variant="ghost" onClick={() => start(false)} disabled={starting}>
                          Run setup again
                        </Button>
                      </div>
                    )}
                    {check && <ReadinessChecklist report={check} />}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <RouterBootstrapDialog
        open={scriptOpen}
        onOpenChange={setScriptOpen}
        routerId={router.id}
        defaults={{
          routerName: router.name,
          ipAddress: router.ipAddress,
          apiUsername: router.apiUsername ?? "",
          ssid: router.ssid ?? "",
        }}
      />
      <ConfirmModal
        isOpen={confirmForce}
        onClose={() => setConfirmForce(false)}
        onConfirm={() => start(true)}
        title="Set up despite the failed checks?"
        description="The router may not serve guests until those checks pass. Use this only if you know why they failed."
        confirmText="Set up anyway"
      />
    </>
  );
}
