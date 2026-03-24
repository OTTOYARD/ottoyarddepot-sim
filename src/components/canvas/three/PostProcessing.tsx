import { forwardRef } from 'react';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

export const PostProcessing = forwardRef<any, Record<string, never>>(function PostProcessing(_, ref) {
  return (
    <EffectComposer ref={ref} multisampling={0} enableNormalPass={false}>
      <Bloom
        luminanceThreshold={0.95}
        luminanceSmoothing={0.55}
        intensity={0.18}
        mipmapBlur
      />
      <Vignette offset={0.35} darkness={0.06} />
    </EffectComposer>
  );
});
