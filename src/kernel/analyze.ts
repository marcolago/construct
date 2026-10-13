// Analisi geometriche del kernel per i controlli di stampabilità: pareti troppo sottili e parti staccate.
// Girano nel worker sui Manifold già calcolati (vedi `Evaluator.analyze`).

import type { Manifold } from 'manifold-3d';
import type { Vec3 } from '../scene/types';

/** Sezioni per asse: abbastanza fitte da trovare una parete lunga, abbastanza poche da costare pochi secondi. */
export const SECTIONS_PER_AXIS = 24;
/** Area (mm²) sotto la quale ciò che l'apertura toglie da una sezione sono briciole numeriche o punte, non una parete. */
const MIN_LOST_AREA = 0.5;
/** Un pezzo di parete sottile più piccolo di così (mm²) non si disegna. */
const MIN_PIECE_AREA = 0.2;
/** Massimo di scatole da restituire per oggetto (la vista non ne ha bisogno di più). */
const MAX_BOXES = 200;
/** Volume (mm³) sotto il quale una parte staccata è un residuo del calcolo e non si segnala. */
const MIN_PART_VOLUME = 1;

/** Rotazione che porta l'asse X o Y sullo Z, così `slice` (che taglia solo orizzontalmente) vede le sezioni su quell'asse. */
const TO_Z: Record<0 | 1, Vec3> = { 0: [0, -90, 0], 1: [90, 0, 0] };

export interface ThinZones {
  /** Scatole delle zone sottili in coordinate mondo: min x, y, z, max x, y, z per ogni zona. */
  boxes: number[];
  /** Sezioni in cui è stata trovata almeno una zona sottile. */
  slices: number;
  /** Quote Z minima e massima delle zone trovate. */
  zMin: number;
  zMax: number;
  /** Vero se si è smesso prima di finire per il tempo a disposizione. */
  partial: boolean;
}

/** Scatola nel mondo di un rettangolo di una sezione, a seconda dell'asse su cui si è tagliato (`half` = mezzo passo). */
function worldBox(axis: 0 | 1 | 2, at: number, half: number, min: readonly number[], max: readonly number[]): number[] {
  // Con la rotazione [0,-90,0] (X) x'=-z, z'=x; con [90,0,0] (Y) y'=-z, z'=y: si torna al mondo invertendo
  if (axis === 2) return [min[0], min[1], at - half, max[0], max[1], at + half];
  if (axis === 0) return [at - half, min[1], -max[0], at + half, max[1], -min[0]];
  return [min[0], at - half, -max[1], max[0], at + half, -min[1]];
}

/**
 * Cerca le pareti più sottili di `minWall`: su sezioni dei tre assi toglie al contorno ciò che sparisce con un'apertura
 * morfologica (erosione di metà parete, poi dilatazione), cioè le parti più strette di `minWall`. Ciò che resta tolto è
 * una parete sottile. Si ferma a `deadline` (performance.now) restituendo ciò che ha trovato.
 */
export function thinWalls(solid: Manifold, minWall: number, deadline: number): ThinZones {
  const out: ThinZones = { boxes: [], slices: 0, zMin: Infinity, zMax: -Infinity, partial: false };
  // Un piccolo scarto sotto la metà: una parete spessa esattamente `minWall` è accettabile
  const r = minWall / 2 - 0.001;
  for (const axis of [2, 0, 1] as const) {
    const turned = axis === 2 ? solid : solid.rotate(TO_Z[axis]);
    try {
      const box = turned.boundingBox();
      const height = box.max[2] - box.min[2];
      if (height <= 0) continue;
      const step = height / SECTIONS_PER_AXIS;
      for (let i = 0; i < SECTIONS_PER_AXIS; i++) {
        if (performance.now() > deadline) {
          out.partial = true;
          return out;
        }
        const at = box.min[2] + (i + 0.5) * step;
        const section = turned.slice(at);
        const eroded = section.offset(-r, 'Miter', 2);
        const opened = eroded.offset(r, 'Miter', 2);
        const lost = section.subtract(opened);
        let found = false;
        if (lost.area() > MIN_LOST_AREA) {
          for (const piece of lost.decompose()) {
            if (piece.area() > MIN_PIECE_AREA && out.boxes.length < MAX_BOXES * 6) {
              const b = piece.bounds();
              const w = worldBox(axis, at, step / 2, b.min, b.max);
              out.boxes.push(...w);
              out.zMin = Math.min(out.zMin, w[2]);
              out.zMax = Math.max(out.zMax, w[5]);
              found = true;
            }
            piece.delete();
          }
        }
        if (found) out.slices++;
        for (const cs of [section, eroded, opened, lost]) cs.delete();
      }
    } finally {
      if (turned !== solid) turned.delete();
    }
  }
  return out;
}

export interface PartBox {
  min: Vec3;
  max: Vec3;
}

/** Parti separate (non connesse) di un solido, con il loro ingombro nel mondo; le più piccole di 1 mm³ si scartano. */
export function separateParts(solid: Manifold): PartBox[] {
  const parts: PartBox[] = [];
  for (const piece of solid.decompose()) {
    if (!piece.isEmpty() && piece.volume() >= MIN_PART_VOLUME) {
      const b = piece.boundingBox();
      parts.push({ min: [...b.min] as Vec3, max: [...b.max] as Vec3 });
    }
    piece.delete();
  }
  return parts;
}
