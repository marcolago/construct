import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useWarnings } from '../ui/Warnings/warningsStore';
import { useViewportPalette } from './palette';

/**
 * Zone di un avviso messo in evidenza con un clic sull'elenco (ad esempio le superfici in sbalzo), disegnate appena
 * sopra la superficie con lo stesso materiale delle facce evidenziate da Raccordo e Smusso.
 */
export function WarningOverlay() {
  const triangles = useWarnings((s) => (s.focusId ? s.issues.find((i) => i.id === s.focusId)?.triangles : undefined));
  const palette = useViewportPalette();
  const geometry = useMemo(() => {
    if (!triangles) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(triangles, 3));
    return g;
  }, [triangles]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;

  return (
    <mesh geometry={geometry} renderOrder={2} raycast={() => null}>
      <meshBasicMaterial color={palette.warning} transparent opacity={0.7} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} side={THREE.DoubleSide} />
    </mesh>
  );
}
