export function DriveAisles() {
  return (
    <group>
      {[[-110,0.03,0],[110,0.03,0]].map((pos,i)=>(
        <mesh key={i} rotation-x={-Math.PI/2} position={pos as any}>
          <planeGeometry args={[20,180]} />
          <meshStandardMaterial color='#1e1e1e' roughness={0.95} />
        </mesh>
      ))}
      {[-110,110].map((x,i)=>(
        Array.from({length:5},(_,j)=>(
          <mesh key={`a${i}${j}`} rotation-x={-Math.PI/2}
            position={[x,0.06,-60+j*30]}
            rotation-z={i===0?0:Math.PI}>
            <circleGeometry args={[1.5,3]} />
            <meshStandardMaterial color='#333' emissive='#444'
              emissiveIntensity={0.3} />
          </mesh>
        ))
      ))}
      {/* Gates */}
      {[[-110,-95,'#00B4A6'],[110,-95,'#C00000']].map(([x,z,col],i)=>(
        <group key={i} position={[x as number,0,z as number]}>
          {[-4,4].map((px,j)=>(
            <mesh key={j} position={[px,2,0]} castShadow>
              <boxGeometry args={[0.5,4,0.5]} />
              <meshStandardMaterial color={col as string} />
            </mesh>
          ))}
          <pointLight position={[0,3,0]} color={col as string}
            intensity={0.4} distance={10} />
        </group>
      ))}
    </group>
  );
}
