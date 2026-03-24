import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

export function PostProcessing() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        luminanceThreshold={0.75}
        luminanceSmoothing={0.4}
        intensity={0.25}
        mipmapBlur
      />
      <Vignette offset={0.5} darkness={0.15} />
    </EffectComposer>
  );
}
