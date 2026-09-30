import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useSimulationStore } from '@/store/simulationStore';
import { isPhoneViewport } from '@/components/phone/phoneLayout';

// Loaded only on a phone: a desktop never downloads the phone cockpit.
const PhoneCockpit = lazy(() => import('@/components/phone/PhoneCockpit'));

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

  // A PHONE gets the phone cockpit (phoneLayout.isPhoneViewport: a touch-first
  // screen whose short side is under 600 px, in either orientation, or any window
  // narrower than 900 px; ?phone=1 forces it on a desktop for testing). Every
  // other screen gets `children` — the desktop cockpit, exactly as before.
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  const forced = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('phone') === '1';
  if (isPhoneViewport({ width, height, coarse, forced })) {
    return (
      <Suspense fallback={<div className="fixed inset-0 bg-canvas-base" />}>
        <PhoneCockpit />
      </Suspense>
    );
  }

  return <>{children}</>;
};
