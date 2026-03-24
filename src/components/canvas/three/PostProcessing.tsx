import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

export function PostProcessing() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        luminanceThreshold={0.9}
        luminanceSmoothing={0.4}
        intensity={0.35}
        mipmapBlur
      />
      <Vignette offset={0.4} darkness={0.25} />
    </EffectComposer>
  );
}
