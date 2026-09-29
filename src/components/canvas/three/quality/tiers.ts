/**
 * Render tiers for the 3D twin — what each class of device draws.
 *
 * HIGH is the desktop look, exactly as it was before tiers existed: the same
 * shadow map, the same post stack, the same paint. Nothing below may make High
 * look worse; the tiers only take things away from Medium and Low.
 *
 * The budgets are what the perf harness (scripts/perfHarness.mjs) measured to
 * pay on this scene, not a checklist: see the PR for the numbers.
 */

export type Tier = 'high' | 'medium' | 'low';
export const TIERS: readonly Tier[] = ['low', 'medium', 'high'];

export interface TierBudget {
  /** Device-pixel-ratio range the resolution governor moves within. */
  dprMin: number;
  dprMax: number;
  /** MSAA on the default framebuffer (the composer runs its own SMAA). */
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** PCFSoft (High) vs plain PCF: a quarter of the shadow taps. */
  softShadows: boolean;
  /** Post stack: ambient occlusion, bloom, SMAA, vignette. */
  ao: boolean;
  bloom: boolean;
  smaa: boolean;
  vignette: boolean;
  /** Car paint: clear-coated physical (High) or standard PBR. */
  clearcoat: boolean;
  /** Weather particle count, as a share of High's. */
  weatherShare: number;
}

export const BUDGETS: Record<Tier, TierBudget> = {
  high: {
    dprMin: 1, dprMax: 1.5, antialias: true,
    shadows: true, shadowMapSize: 2048, softShadows: true,
    ao: true, bloom: true, smaa: true, vignette: true,
    clearcoat: true, weatherShare: 1,
  },
  medium: {
    dprMin: 0.75, dprMax: 1.5, antialias: false,
    shadows: true, shadowMapSize: 2048, softShadows: false,
    ao: false, bloom: true, smaa: true, vignette: true,
    clearcoat: true, weatherShare: 0.5,
  },
  low: {
    dprMin: 0.6, dprMax: 1.25, antialias: false,
    shadows: true, shadowMapSize: 1024, softShadows: false,
    ao: false, bloom: false, smaa: true, vignette: false,
    clearcoat: false, weatherShare: 0.25,
  },
};

export function stepDown(t: Tier): Tier { return t === 'high' ? 'medium' : 'low'; }
export function stepUp(t: Tier, ceiling: Tier): Tier {
  const next: Tier = t === 'low' ? 'medium' : 'high';
  return TIERS.indexOf(next) <= TIERS.indexOf(ceiling) ? next : t;
}

/** What the browser tells us about the device (all optional: Safari hides most). */
export interface DeviceHints {
  /** navigator.deviceMemory, GB (Chromium only, capped at 8). */
  memoryGB?: number;
  cores?: number;
  /** A phone or tablet: coarse primary pointer, or a mobile user agent. */
  mobile: boolean;
  /** Unmasked WebGL renderer string, when exposed. */
  gpu?: string;
  /** Mean frame time (ms) of a short warm-up benchmark, when one ran. */
  benchMs?: number;
}

/** GPUs that are known to struggle with this scene at any setting above Low. */
const WEAK_GPU = /(mali-[gt]?[4-7]\d|adreno \(tm\) [3-5]\d\d|powervr|intel\(r\) (hd|uhd) graphics [2-6]\d\d|swiftshader|llvmpipe|software)/i;
const DISCRETE_GPU = /(nvidia|geforce|rtx|radeon rx|radeon pro|apple m\d (pro|max|ultra))/i;

/**
 * The starting tier and the ceiling auto may climb to. Conservative on phones,
 * because a phone that starts High and stutters for the governor's first
 * seconds has already made the worse first impression.
 */
export function detectTier(h: DeviceHints): { tier: Tier; reason: string } {
  const gpu = h.gpu ?? '';
  if (WEAK_GPU.test(gpu)) return { tier: 'low', reason: `weak GPU (${gpu})` };
  if (h.memoryGB !== undefined && h.memoryGB <= 2) return { tier: 'low', reason: `${h.memoryGB} GB device memory` };
  if (h.benchMs !== undefined && h.benchMs > 40) return { tier: 'low', reason: `warm-up ${h.benchMs.toFixed(0)} ms/frame` };
  if (h.mobile) {
    if (h.benchMs !== undefined && h.benchMs > 22) return { tier: 'low', reason: `phone, warm-up ${h.benchMs.toFixed(0)} ms/frame` };
    return { tier: 'medium', reason: 'phone or tablet' };
  }
  if (h.benchMs !== undefined && h.benchMs > 25) return { tier: 'medium', reason: `warm-up ${h.benchMs.toFixed(0)} ms/frame` };
  if (DISCRETE_GPU.test(gpu)) return { tier: 'high', reason: `desktop GPU (${gpu})` };
  return { tier: 'high', reason: 'desktop' };
}

/** Read the hints from the running browser and a live WebGL context. */
export function readDeviceHints(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  let gpu: string | undefined;
  try {
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : undefined;
  } catch { gpu = undefined; }
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const uaMobile = nav.userAgentData?.mobile ?? /iPhone|iPad|iPod|Android|Mobi/i.test(nav.userAgent);
  // iPadOS reports a desktop Safari UA; a touch-first Mac is an iPad.
  const iPad = /Macintosh/.test(nav.userAgent) && (navigator.maxTouchPoints ?? 0) > 1;
  return {
    memoryGB: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    mobile: !!(uaMobile || iPad || coarse),
    gpu,
  };
}

/** Probe-only tier, before any GL context of ours exists (a throwaway one reads the GPU). */
export function initialTier(): { tier: Tier; reason: string } {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const c = document.createElement('canvas');
    gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    const out = detectTier(readDeviceHints(gl));
    return out;
  } catch {
    return { tier: 'medium', reason: 'probe failed' };
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
