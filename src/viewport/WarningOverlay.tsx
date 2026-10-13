import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useWarnings } from '../ui/Warnings/warningsStore';
import { useViewportPalette } from './palette';

/** Dodici triangoli (non indicizzati) per ogni scatola min x, y, z, max x, y, z. */
function boxTriangles(boxes: Float32Array): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < boxes.length; i += 6) {
    const [x0, y0, z0, x1, y1, z1] = [boxes[i], boxes[i + 1], boxes[i + 2], boxes[i + 3], boxes[i + 4], boxes[i + 5]];
    // Gli angoli sono numerati con un bit per asse (x = 1, y = 2, z = 4); ogni faccia è un quadrato di due triangoli
    const corner = (n: number) => [n & 1 ? x1 : x0, n & 2 ? y1 : y0, n & 4 ? z1 : z0];
    for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
      out.push(...corner(a), ...corner(b), ...corner(c), ...corner(a), ...corner(c), ...corner(d));
    }
  }
  return new Float32Array(out);
}

/** Geometria da un elenco di triangoli non indicizzati (liberata quando cambia). */
function useTriangles(triangles: Float32Array | undefined): THREE.BufferGeometry | null {
  const geometry = useMemo(() => {
    if (!triangles) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(triangles, 3));
    return g;
  }, [triangles]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry;
}

/**
 * Zone di un avviso messo in evidenza con un clic sull'elenco: le superfici in sbalzo, disegnate appena sopra la
 * superficie con lo stesso materiale delle facce evidenziate da Raccordo e Smusso, e le pareti sottili, come scatole
 * traslucide sempre visibili (stanno dentro il solido).
 */
export function WarningOverlay() {
  const focused = useWarnings((s) => (s.focusId ? s.issues.find((i) => i.id === s.focusId) : undefined));
  const palette = useViewportPalette();
  const surface = useTriangles(focused?.triangles);
  const zones = useTriangles(useMemo(() => (focused?.boxes ? boxTriangles(focused.boxes) : undefined), [focused?.boxes]));

  return (
    <>
      {surface && (
        <mesh geometry={surface} renderOrder={2} raycast={() => null}>
          <meshBasicMaterial color={palette.warning} transparent opacity={0.7} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} side={THREE.DoubleSide} />
        </mesh>
      )}
      {zones && (
        <mesh geometry={zones} renderOrder={3} raycast={() => null}>
          <meshBasicMaterial color={palette.warning} transparent opacity={0.55} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );
}
