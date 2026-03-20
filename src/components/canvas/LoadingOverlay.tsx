import { useEffect, useState } from 'react';
import { useDemoStore } from '@/store/demoStore';

const HexLogo = () => (
  <svg viewBox="0 0 100 100" fill="#C00000" className="w-16 h-16 animate-[logo-pulse_1.5s_ease-in-out_infinite]">
    <path d="M50 5 L93 27.5 L93 72.5 L50 95 L7 72.5 L7 27.5 Z" />
    <path d="M50 20 L78 35 L78 65 L50 80 L22 65 L22 35 Z" fill="none" stroke="white" strokeWidth="3" />
  </svg>
);

export const LoadingOverlay = () => {
  const isLoading = useDemoStore((s) => s.isLoading);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isLoading) {
      setVisible(true);
    } else {
      const t = setTimeout(() => setVisible(false), 500);
      return () => clearTimeout(t);
    }
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div
      className={`absolute inset-0 z-30 flex flex-col items-center justify-center bg-otto-dark/95 transition-opacity duration-500 ${
        isLoading ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <HexLogo />
      <p className="mt-4 text-sm text-white/80 tracking-widest font-medium">
        Initializing Fleet Command...
      </p>
    </div>
  );
};
