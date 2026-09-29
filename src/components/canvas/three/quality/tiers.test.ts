import { describe, it, expect } from 'vitest';
import { BUDGETS, detectTier, stepDown, stepUp } from './tiers';

describe('render tiers', () => {
  it('HIGH is the desktop look exactly as it was before tiers existed', () => {
    // DepotScene3D / DayNightLighting / DepotPostProcessing before the phone lane:
    // antialias on, dpr min(devicePixelRatio, 1.5), PCFSoft 2048² sun shadow,
    // N8AO + Bloom + Vignette + SMAA, clear-coated paint, full weather.
    expect(BUDGETS.high).toMatchObject({
      antialias: true, dprMax: 1.5, shadows: true, shadowMapSize: 2048, softShadows: true,
      ao: true, bloom: true, vignette: true, smaa: true, clearcoat: true, weatherShare: 1,
    });
    expect(BUDGETS.high.dprMin).toBeGreaterThanOrEqual(1);
  });

  it('each tier below takes away, never adds', () => {
    const cost = (b: typeof BUDGETS.high) =>
      [b.antialias, b.shadows, b.softShadows, b.ao, b.bloom, b.smaa, b.vignette, b.clearcoat].filter(Boolean).length
      + b.shadowMapSize / 1024 + b.dprMax + b.weatherShare;
    expect(cost(BUDGETS.medium)).toBeLessThan(cost(BUDGETS.high));
    expect(cost(BUDGETS.low)).toBeLessThan(cost(BUDGETS.medium));
    for (const t of ['medium', 'low'] as const) {
      expect(BUDGETS[t].dprMin).toBeLessThanOrEqual(BUDGETS[t].dprMax);
      expect(BUDGETS[t].dprMax).toBeLessThanOrEqual(BUDGETS.high.dprMax);
    }
  });

  it('desktops start High, phones Medium, weak or slow devices Low', () => {
    expect(detectTier({ mobile: false, gpu: 'ANGLE (NVIDIA, GeForce RTX 4070)' }).tier).toBe('high');
    expect(detectTier({ mobile: false }).tier).toBe('high');
    expect(detectTier({ mobile: true, gpu: 'Apple GPU' }).tier).toBe('medium');
    expect(detectTier({ mobile: true, memoryGB: 2 }).tier).toBe('low');
    expect(detectTier({ mobile: false, gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' }).tier).toBe('low');
    expect(detectTier({ mobile: true, gpu: 'Mali-G52' }).tier).toBe('low');
  });

  it('the warm-up benchmark can only lower the start', () => {
    expect(detectTier({ mobile: false, benchMs: 30 }).tier).toBe('medium');
    expect(detectTier({ mobile: false, benchMs: 50 }).tier).toBe('low');
    expect(detectTier({ mobile: true, benchMs: 25 }).tier).toBe('low');
    expect(detectTier({ mobile: true, benchMs: 12 }).tier).toBe('medium');
  });

  it('stepping is bounded: never below Low, never above the ceiling', () => {
    expect(stepDown('high')).toBe('medium');
    expect(stepDown('low')).toBe('low');
    expect(stepUp('low', 'medium')).toBe('medium');
    expect(stepUp('medium', 'medium')).toBe('medium');
    expect(stepUp('medium', 'high')).toBe('high');
  });
});
