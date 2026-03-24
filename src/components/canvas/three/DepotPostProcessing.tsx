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
    ao: { intensity: 4, aoRadius: 0.8, distanceFalloff: 0.6, halfRes: true, quality: 'medium' },
    bloom: { intensity: 0.4, luminanceThreshold: 0.9, luminanceSmoothing: 0.2, kernelSize: KernelSize.LARGE },
    vignette: { offset: 0.3, darkness: 0.5 },
  },
  hero: {
    ao: { intensity: 6, aoRadius: 1.2, distanceFalloff: 0.8, halfRes: false, quality: 'ultra' },
    bloom: { intensity: 0.5, luminanceThreshold: 0.85, luminanceSmoothing: 0.15, kernelSize: KernelSize.HUGE },
    vignette: { offset: 0.25, darkness: 0.6 },
  },
  night: {
    ao: { intensity: 3, aoRadius: 0.6, distanceFalloff: 0.5, halfRes: true, quality: 'medium' },
    bloom: { intensity: 0.8, luminanceThreshold: 0.6, luminanceSmoothing: 0.3, kernelSize: KernelSize.LARGE },
    vignette: { offset: 0.2, darkness: 0.7 },
  },
};

interface Props {
  mode?: PPMode;
  enabled?: boolean;
}

export function DepotPostProcessing({ mode = 'interactive', enabled = true }: Props) {
  if (!enabled) return null;
  const c = CONFIGS[mode];

  return (
    <EffectComposer multisampling={0}>
      <N8AO intensity={c.ao.intensity} aoRadius={c.ao.aoRadius}
        distanceFalloff={c.ao.distanceFalloff} halfRes={c.ao.halfRes}
        quality={c.ao.quality} color="#000011" />
      <Bloom intensity={c.bloom.intensity} luminanceThreshold={c.bloom.luminanceThreshold}
        luminanceSmoothing={c.bloom.luminanceSmoothing} mipmapBlur
        kernelSize={c.bloom.kernelSize} blendFunction={BlendFunction.ADD} />
      <Vignette offset={c.vignette.offset} darkness={c.vignette.darkness}
        blendFunction={BlendFunction.NORMAL} />
      <SMAA />
    </EffectComposer>
  );
}
