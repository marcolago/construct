import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useSplitTool } from '../ui/Split/splitToolStore';
import type { Vec3 } from '../scene/types';
import { useViewportPalette } from './palette';

/** Piano di taglio di Dividi: una lastra semitrasparente che copre l'ingombro del pezzo, come il piano di Specchia. */
export function SplitOverlay() {
  const active = useSplitTool((s) => s.active);
  const axis = useSplitTool((s) => s.axis);
  const offset = useSplitTool((s) => s.offset);
  const angle = useSplitTool((s) => s.angle);
  const tiltAxis = useSplitTool((s) => s.tiltAxis);
  const bounds = useSplitTool((s) => s.bounds);
  const palette = useViewportPalette();
  const invalidate = useThree((s) => s.invalidate);

  // Il rendering è "a richiesta": a ogni cambio del piano bisogna chiedere un nuovo fotogramma
  useEffect(() => {
    invalidate();
  }, [active, axis, offset, angle, tiltAxis, bounds, invalidate]);

  if (!active || !bounds) return null;
  const margin = 6;
  // Inclinata, la lastra deve coprire il pezzo in qualunque direzione: lato pari alla diagonale dell'ingombro
  const diagonal = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
  const size = [0, 1, 2].map((i) => (i === axis ? 0.2 : angle !== 0 ? Math.max(10, diagonal + 2 * margin) : Math.max(10, bounds.max[i] - bounds.min[i] + 2 * margin))) as Vec3;
  const center = [0, 1, 2].map((i) => (i === axis ? offset : (bounds.min[i] + bounds.max[i]) / 2)) as Vec3;
  // La lastra ruota attorno al proprio centro, che è il punto di taglio
  const rotation: Vec3 = [0, 0, 0];
  rotation[tiltAxis] = (angle * Math.PI) / 180;
  return (
    <mesh position={center} rotation={rotation} renderOrder={4} raycast={() => null}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={palette.faceHover} transparent opacity={0.28} depthWrite={false} depthTest={false} />
    </mesh>
  );
}
