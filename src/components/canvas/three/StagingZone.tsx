import { Html } from '@react-three/drei';

export function StagingZone({ count }: { count: number }) {
  return (
    <group position={[-80, 0, 60]}>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[i * 5, 0.03, 0]}>
          <planeGeometry args={[4, 6]} />
          <meshStandardMaterial color="#F59E0B" opacity={0.15} transparent />
        </mesh>
      ))}
      <Html position={[((count - 1) * 5) / 2, 4, 0]} center>
        <span className="text-[9px] font-bold text-otto-amber/60 tracking-wider">
          STAGING / QUEUE
        </span>
      </Html>
    </group>
  );
}
