import { useState } from 'react';
import { Check, Video } from 'lucide-react';
import { CAMERA_PRESET_NAMES, useCameraCommands } from '@/components/canvas/three/cameraPresets';
import { useQualityStore, type QualityMode } from '@/components/canvas/three/quality/qualityStore';

/**
 * The phone's camera menu: the 3D view's presets and its render quality, which
 * the desktop draws as a row of buttons along the bottom of the view. On a phone
 * that row would sit where the panel sheet is, so they fold into one button.
 * Framing is a VIEW choice (useCameraCommands); nothing in the world reads it.
 */
const MODES: { mode: QualityMode; label: string }[] = [
  { mode: 'auto', label: 'Auto' }, { mode: 'high', label: 'High' }, { mode: 'medium', label: 'Med' }, { mode: 'low', label: 'Low' },
];

export function PhoneCameraMenu() {
  const [open, setOpen] = useState(false);
  const frame = useCameraCommands((s) => s.frame);
  const mode = useQualityStore((s) => s.mode);
  const tier = useQualityStore((s) => s.tier);
  const setMode = useQualityStore((s) => s.setMode);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Camera and quality"
        className="h-11 w-11 inline-flex items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur active:bg-white/15"
      >
        <Video size={18} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* two columns: all eight presets and the quality modes fit a 390 px-tall landscape screen */}
          <div className="absolute right-0 top-12 z-50 w-64 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-lg border border-white/10 bg-canvas-panel/95 backdrop-blur p-1.5 shadow-xl">
            <div className="px-2 pt-1 pb-1 font-display text-[9px] uppercase tracking-[0.1em] text-ink-faint">Camera</div>
            <div className="grid grid-cols-2 gap-1 p-1">
              {CAMERA_PRESET_NAMES.map((name) => (
                <button key={name} onClick={() => { frame(name); setOpen(false); }}
                  className="min-h-10 px-2 rounded-md border border-white/[0.06] text-left text-[12px] text-ink active:bg-white/10">
                  {name}
                </button>
              ))}
            </div>
            <div className="mt-1 px-2 pt-2 pb-1 border-t border-white/[0.06] font-display text-[9px] uppercase tracking-[0.1em] text-ink-faint">
              Quality · drawing {tier}
            </div>
            <div className="grid grid-cols-4 gap-1 p-1">
              {MODES.map((m) => (
                <button key={m.mode} onClick={() => setMode(m.mode)}
                  className={`min-h-10 rounded-md border text-[12px] inline-flex items-center justify-center gap-1 ${
                    mode === m.mode ? 'border-brand-red bg-brand-red/15 text-white' : 'border-white/10 text-ink-dim active:bg-white/10'
                  }`}>
                  {mode === m.mode && <Check size={12} />}{m.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
