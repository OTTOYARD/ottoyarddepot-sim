// ============================================================================
// useResearchFeed — reads the research wing's findings (otto-q-core 0793, public.ottoq_research_feed) for the
// Research tab.
//
// One read-only RPC, granted to anon. It reads when the tab opens (the side panel mounts only the open tab) and again
// every minute while the tab stays open, and stops when it closes. A failed read keeps the last good reading beside
// the error, so a dropped request never blanks the tab; an answer that comes back after a newer read started is
// dropped, so an old reading never replaces a new one.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { NASHVILLE_DEPOT, twin, type ResearchFeed } from '@/lib/ottoTwin';
import { readResearchFeed } from '@/lib/research';

export const RESEARCH_POLL_MS = 60_000;

export interface ResearchFeedState {
  /** The last good reading, or null before the first one. */
  feed: ResearchFeed | null;
  /** Why the last read failed, or null when it answered. */
  error: string | null;
  /** True until the first read answers or fails. */
  loading: boolean;
  /** True while a read is in flight. */
  refreshing: boolean;
  /** Read again now. */
  refresh: () => void;
}

export function useResearchFeed(depotId: string = NASHVILLE_DEPOT): ResearchFeedState {
  const [feed, setFeed] = useState<ResearchFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);
  const mounted = useRef(false);

  const read = useCallback(async () => {
    const mine = ++latest.current;
    setRefreshing(true);
    try {
      const next = readResearchFeed(await twin.researchFeed(depotId));
      if (!mounted.current || mine !== latest.current) return;
      setFeed(next);
      setError(null);
    } catch (e: unknown) {
      if (!mounted.current || mine !== latest.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current && mine === latest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [depotId]);

  useEffect(() => {
    mounted.current = true;
    void read();
    const timer = setInterval(() => void read(), RESEARCH_POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [read]);

  const refresh = useCallback(() => void read(), [read]);
  return { feed, error, loading, refreshing, refresh };
}
