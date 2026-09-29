import { useEffect, useState, type ReactNode } from 'react';
import { useSimulationStore } from '@/store/simulationStore';
import { PhoneTwin } from '@/components/canvas/PhoneTwin';

export const ResponsiveGuard = ({ children }: { children: ReactNode }) => {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1400);
  const [height, setHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 900);
  const togglePanel = useSimulationStore((s) => s.togglePanel);
  const isPanelOpen = useSimulationStore((s) => s.isPanelOpen);

  useEffect(() => {
    const onResize = () => { setWidth(window.innerWidth); setHeight(window.innerHeight); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Auto-collapse panel on narrow screens
  useEffect(() => {
    if (width < 1200 && isPanelOpen) {
      togglePanel();
    }
  }, [width < 1200]); // eslint-disable-line react-hooks/exhaustive-deps

  // A PHONE gets the full-screen 3D twin (PhoneTwin) — in either orientation,
  // including a landscape Pro Max that is 932 px wide and would otherwise get a
  // cramped desktop cockpit. A phone is a touch-first screen whose short side is
  // under 600 px; anything narrower than 900 px gets it too. ?phone=1 forces it
  // on a desktop for testing. (Phase 2 of the phone lane replaces this with the
  // phone cockpit layout.)
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const forced = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('phone') === '1';
  if (forced || width < 900 || (coarse && Math.min(width, height) < 600)) {
    return <PhoneTwin />;
  }

  return <>{children}</>;
};
