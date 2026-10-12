import type { Vec3 } from '../scene/types';

/** Luci della scena, condivise dalla vista 3D e dall'immagine delle 4 viste: così gli oggetti hanno lo stesso aspetto. */
export const LIGHTS = {
  /** Luce emisferica (colori cielo e terreno dalla palette del tema). */
  hemisphere: 0.9,
  /** Luce principale e di riempimento: posizione nel mondo e intensità. */
  key: { position: [150, -200, 300] as Vec3, intensity: 1.6 },
  fill: { position: [-200, 150, 120] as Vec3, intensity: 0.5 },
};
