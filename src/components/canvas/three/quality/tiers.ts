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

/** Where auto starts, how high it may climb, and why. */
export interface TierVerdict {
  tier: Tier;
  ceiling: Tier;
  reason: string;
}

/**
 * The starting tier and the ceiling auto may climb to.
 *
 * Phones START at Medium but may CLIMB to High (2026-09-30: High held ~60 fps
 * on the founder's phone on the busiest presets). Starting a phone at High would
 * make every phone that cannot hold it stutter through its first seconds; a
 * phone that can is moved up by the governor within a few seconds of holding
 * 60 at Medium, and remembers it (rememberTier) so the next visit starts there.
 */
export function detectTier(h: DeviceHints): TierVerdict {
  const gpu = h.gpu ?? '';
  const flat = (tier: Tier, reason: string): TierVerdict => ({ tier, ceiling: tier, reason });
  if (WEAK_GPU.test(gpu)) return flat('low', `weak GPU (${gpu})`);
  if (h.memoryGB !== undefined && h.memoryGB <= 2) return flat('low', `${h.memoryGB} GB device memory`);
  if (h.benchMs !== undefined && h.benchMs > 40) return flat('low', `warm-up ${h.benchMs.toFixed(0)} ms/frame`);
  if (h.mobile) {
    if (h.benchMs !== undefined && h.benchMs > 22) return flat('low', `phone, warm-up ${h.benchMs.toFixed(0)} ms/frame`);
    return { tier: 'medium', ceiling: 'high', reason: 'phone or tablet: starts Medium, may climb to High' };
  }
  if (h.benchMs !== undefined && h.benchMs > 25) return flat('medium', `warm-up ${h.benchMs.toFixed(0)} ms/frame`);
  if (DISCRETE_GPU.test(gpu)) return flat('high', `desktop GPU (${gpu})`);
  return flat('high', 'desktop');
}

const REMEMBER_KEY = 'ottoq_quality_auto_tier';

/**
 * The tier auto last HELD on this device (20 s at it without a decline), so a
 * phone that proved it can run High starts there next time instead of climbing
 * again. Per browser, a convenience only: storage may be unavailable, and the
 * governor still steps down if the device no longer holds it.
 */
export function rememberedTier(): Tier | null {
  try {
    const v = window.localStorage.getItem(REMEMBER_KEY);
    return v === 'high' || v === 'medium' || v === 'low' ? v : null;
  } catch { return null; }
}
export function rememberTier(t: Tier): void {
  try { window.localStorage.setItem(REMEMBER_KEY, t); } catch { /* per-device convenience only */ }
}

const CAP_KEY = 'ottoq_quality_auto_cap';
const CAP_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * A tier auto TRIED here and could not hold (a step up that failed its
 * probation) caps auto on this device for a week, so a phone that cannot run
 * High is not made to stutter through the same try on every visit. A manual
 * pick is never capped.
 */
export function rememberedCap(now = Date.now()): Tier | null {
  try {
    const raw = window.localStorage.getItem(CAP_KEY);
    if (!raw) return null;
    const { tier, at } = JSON.parse(raw) as { tier?: string; at?: number };
    if (typeof at !== 'number' || now - at > CAP_TTL_MS) return null;
    return tier === 'high' || tier === 'medium' || tier === 'low' ? tier : null;
  } catch { return null; }
}
export function rememberCap(t: Tier, now = Date.now()): void {
  try { window.localStorage.setItem(CAP_KEY, JSON.stringify({ tier: t, at: now })); } catch { /* convenience only */ }
}

/** The lower of two tiers. */
export function minTier(a: Tier, b: Tier): Tier {
  return TIERS.indexOf(a) <= TIERS.indexOf(b) ? a : b;
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

/**
 * Probe-only verdict, before any GL context of ours exists (a throwaway one reads
 * the GPU). The start is the tier this device last held, if it held one, never
 * above the probe's ceiling or a cap a failed climb left here.
 */
export function initialTier(): TierVerdict {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const c = document.createElement('canvas');
    gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    const probed = detectTier(readDeviceHints(gl));
    const cap = rememberedCap();
    const v = cap ? { ...probed, ceiling: minTier(cap, probed.ceiling), tier: minTier(cap, probed.tier) } : probed;
    const held = rememberedTier();
    return held ? { ...v, tier: minTier(held, v.ceiling), reason: `${v.reason}; last held ${held} here` } : v;
  } catch {
    return { tier: 'medium', ceiling: 'medium', reason: 'probe failed' };
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
