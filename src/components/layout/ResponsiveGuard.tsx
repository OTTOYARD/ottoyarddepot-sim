import { useEffect, useState, type ReactNode } from 'react';
import { useSimulationStore } from '@/store/simulationStore';

export const ResponsiveGuard = ({ children }: { children: ReactNode }) => {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1400);
  const togglePanel = useSimulationStore((s) => s.togglePanel);
  const isPanelOpen = useSimulationStore((s) => s.isPanelOpen);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Auto-collapse panel on narrow screens
  useEffect(() => {
    if (width < 1200 && isPanelOpen) {
      togglePanel();
    }
  }, [width < 1200]); // eslint-disable-line react-hooks/exhaustive-deps

  if (width < 900) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-otto-dark p-8">
        <div className="text-center max-w-md">
          <svg viewBox="0 0 100 100" fill="#C00000" className="w-12 h-12 mx-auto mb-4">
            <path d="M50 5 L93 27.5 L93 72.5 L50 95 L7 72.5 L7 27.5 Z" />
            <path d="M50 20 L78 35 L78 65 L50 80 L22 65 L22 35 Z" fill="none" stroke="white" strokeWidth="3" />
          </svg>
          <h2 className="text-white text-lg font-bold mb-2">OTTOYARD Depot Simulator</h2>
          <p className="text-otto-gray text-sm">
            For the best experience, use a desktop browser with a screen width of 1200px or greater.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
