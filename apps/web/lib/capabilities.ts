import type { Capabilities } from "@hashifi/types";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** What this installation can offer; null until known, so nothing appears and then vanishes. */
export function useCapabilities(): Capabilities | null {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  useEffect(() => {
    api
      .get<Capabilities>("/api/capabilities")
      .then(setCapabilities)
      .catch(() => {
        // Stay on the safe side: anything held stays hidden.
      });
  }, []);
  return capabilities;
}
