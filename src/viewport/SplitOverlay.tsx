import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CONNECTOR_SEGMENTS, connectorLayout } from '../scene/splitTool';
import { useSplitTool } from '../ui/Split/splitToolStore';
import type { Vec3 } from '../scene/types';
import { useViewportPalette } from './palette';

/** Colore dei connettori che escono dal pezzo (lo stesso rosso di errori e operandi). */
const OUTSIDE_COLOR = '#ff5d5d';
const DEG = Math.PI / 180;

/**
 * Piano di taglio di Dividi: una lastra semitrasparente che copre l'ingombro del pezzo, come il piano di Specchia, e
 * le sagome dei connettori (perno più sede, con la tolleranza): rosse se escono dal pezzo.
 */
export function SplitOverlay() {
  const active = useSplitTool((s) => s.active);
  const axis = useSplitTool((s) => s.axis);
  const offset = useSplitTool((s) => s.offset);
  const angle = useSplitTool((s) => s.angle);
  const tiltAxis = useSplitTool((s) => s.tiltAxis);
  const bounds = useSplitTool((s) => s.bounds);
  const connectors = useSplitTool((s) => s.connectors);
  const outside = useSplitTool((s) => s.outside);
  const palette = useViewportPalette();
  const invalidate = useThree((s) => s.invalidate);

  // Il rendering è "a richiesta": a ogni cambio del piano bisogna chiedere un nuovo fotogramma
  useEffect(() => {
    invalidate();
  }, [active, axis, offset, angle, tiltAxis, bounds, connectors, outside, invalidate]);

  // Posizione dei connettori nel mondo: la stessa funzione che costruisce le metà
  const slots = useMemo(() => (active && bounds ? connectorLayout(axis, offset, bounds, { axis: tiltAxis, angle }, connectors) : []), [active, axis, offset, angle, tiltAxis, bounds, connectors]);

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
    <>
      <mesh position={center} rotation={rotation} renderOrder={4} raycast={() => null}>
        <boxGeometry args={size} />
        <meshBasicMaterial color={palette.faceHover} transparent opacity={0.28} depthWrite={false} depthTest={false} />
      </mesh>
      {slots.map((slot, i) => (
        // L'ordine ZYX è quello delle rotazioni dell'app (prima X, poi Y, poi Z); l'asse del connettore è la Z locale
        <group key={i} position={slot.fit.center} rotation={new THREE.Euler(slot.fit.rotation[0] * DEG, slot.fit.rotation[1] * DEG, slot.fit.rotation[2] * DEG, 'ZYX')}>
          <mesh renderOrder={5} raycast={() => null} rotation={connectors.shape === 'round' ? [Math.PI / 2, 0, 0] : undefined}>
            {connectors.shape === 'round' ? <cylinderGeometry args={[slot.fit.width / 2, slot.fit.width / 2, slot.fit.length, CONNECTOR_SEGMENTS]} /> : <boxGeometry args={[slot.fit.width, slot.fit.width, slot.fit.length]} />}
            <meshBasicMaterial color={outside.includes(i) ? OUTSIDE_COLOR : palette.facePick} transparent opacity={0.45} depthWrite={false} depthTest={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}
