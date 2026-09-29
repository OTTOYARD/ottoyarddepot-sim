import {
  EffectComposer, Bloom, N8AO, Vignette, SMAA,
} from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';

type PPMode = 'interactive' | 'hero' | 'night';

const CONFIGS: Record<PPMode, {
  ao: { intensity: number; aoRadius: number; distanceFalloff: number; halfRes: boolean; quality: 'low' | 'medium' | 'ultra' };
  bloom: { intensity: number; luminanceThreshold: number; luminanceSmoothing: number; kernelSize: KernelSize };
  vignette: { offset: number; darkness: number };
}> = {
  interactive: {
    ao: { intensity: 1.0, aoRadius: 0.4, distanceFalloff: 0.4, halfRes: true, quality: 'low' },
    bloom: { intensity: 0.25, luminanceThreshold: 0.92, luminanceSmoothing: 0.2, kernelSize: KernelSize.MEDIUM },
    vignette: { offset: 0.3, darkness: 0.15 },
  },
  hero: {
    ao: { intensity: 2.0, aoRadius: 0.6, distanceFalloff: 0.6, halfRes: true, quality: 'medium' },
    bloom: { intensity: 0.35, luminanceThreshold: 0.88, luminanceSmoothing: 0.15, kernelSize: KernelSize.LARGE },
    vignette: { offset: 0.25, darkness: 0.2 },
  },
  night: {
    ao: { intensity: 1.0, aoRadius: 0.4, distanceFalloff: 0.4, halfRes: true, quality: 'low' },
    bloom: { intensity: 0.5, luminanceThreshold: 0.7, luminanceSmoothing: 0.25, kernelSize: KernelSize.MEDIUM },
    vignette: { offset: 0.2, darkness: 0.25 },
  },
};

/** Which passes the render tier can afford (quality/tiers.ts). High runs all four. */
export interface PostBudget { ao: boolean; bloom: boolean; vignette: boolean; smaa: boolean }
const ALL: PostBudget = { ao: true, bloom: true, vignette: true, smaa: true };

interface Props {
  mode?: PPMode;
  enabled?: boolean;
  budget?: PostBudget;
}

export function DepotPostProcessing({ mode = 'interactive', enabled = true, budget = ALL }: Props) {
  if (!enabled || !(budget.ao || budget.bloom || budget.vignette || budget.smaa)) return null;
  const c = CONFIGS[mode];

  // The composer takes its passes as children; a pass the tier cannot afford is
  // simply not mounted (and costs nothing), rather than mounted at zero strength.
  const passes = [
    budget.ao && (
      <N8AO key="ao" intensity={c.ao.intensity} aoRadius={c.ao.aoRadius}
        distanceFalloff={c.ao.distanceFalloff} halfRes={c.ao.halfRes}
        quality={c.ao.quality} color="#000011" />
    ),
    budget.bloom && (
      <Bloom key="bloom" intensity={c.bloom.intensity} luminanceThreshold={c.bloom.luminanceThreshold}
        luminanceSmoothing={c.bloom.luminanceSmoothing} mipmapBlur
        kernelSize={c.bloom.kernelSize} blendFunction={BlendFunction.ADD} />
    ),
    budget.vignette && (
      <Vignette key="vignette" offset={c.vignette.offset} darkness={c.vignette.darkness}
        blendFunction={BlendFunction.NORMAL} />
    ),
    budget.smaa && <SMAA key="smaa" />,
  ].filter(Boolean) as JSX.Element[];

  return (
    <EffectComposer multisampling={0} key={passes.map((p) => p.key).join('+')}>
      {passes}
    </EffectComposer>
  );
}
