export function DepotGround() {
  return (
    <group>
      <mesh rotation-x={-Math.PI/2} receiveShadow>
        <planeGeometry args={[300,220]} />
        <meshStandardMaterial color='#1a1a1a' roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI/2} position={[0,0.02,10]} receiveShadow>
        <planeGeometry args={[220,120]} />
        <meshStandardMaterial color='#222222' roughness={0.85} />
      </mesh>
      {[-145,145].map((x,i)=>(
        <mesh key={i} rotation-x={-Math.PI/2} position={[x,0.03,0]}>
          <planeGeometry args={[12,220]} />
          <meshStandardMaterial color='#1a3a1a' roughness={1} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI/2} position={[0,0.03,-105]}>
        <planeGeometry args={[300,12]} />
        <meshStandardMaterial color='#1a3a1a' roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI/2} position={[0,0.01,-115]}>
        <planeGeometry args={[320,14]} />
        <meshStandardMaterial color='#333333' roughness={0.95} />
      </mesh>
    </group>
  );
}
