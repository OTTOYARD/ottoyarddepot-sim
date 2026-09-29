import { useEffect, useState } from 'react';
import { twin } from '@/lib/ottoTwin';
import { fleetOwnersFromCards, type FleetOwner } from '@/lib/cockpitLinks';

/** The depot's fleet owners, for OrchestrAV's "open as" picker. Re-read when the run changes. */
export function useFleetOwners(runId: string | null) {
  const [owners, setOwners] = useState<FleetOwner[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    twin.depotCards()
      .then((cards) => { if (!cancelled) { setOwners(fleetOwnersFromCards(cards)); setError(null); } })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, [runId]);
  return { owners, error };
}
