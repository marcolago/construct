import { produce } from 'immer';
import { round, toLocalTransform } from './math';
import type { Bounds } from './placement';
import { isLocked, newId, uniqueName } from './store';
import { isCutter, treatmentFrame, wrapInGroup } from './treatment';
import type { PrimitiveNode, Scene, SceneNode, Vec3 } from './types';

/**
 * Dividi con un piano: l'oggetto alla radice viene sostituito da due gruppi Intersezione, ciascuno con una copia
 * dell'oggetto e un cubo "Taglio" che copre un lato del piano (perpendicolare a un asse, alla quota `offset` nel
 * mondo). Il piano si può anche inclinare (`tilt`): ruota di un angolo attorno a un secondo asse passando dallo stesso
 * punto, per esempio a 45° per un taglio diagonale. Le due metà restano parametriche: spostando o ruotando il cubo si
 * sposta il taglio, e il codice OpenSCAD è un `intersection()` con un `cube` (ruotato, se il taglio è inclinato).
 * Restituisce la nuova scena senza toccare quella ricevuta.
 */

/** Quanto il cubo di taglio sporge oltre l'ingombro del pezzo, per lato (mm). */
const CUTTER_MARGIN = 10;
/** Distanza minima del piano dai bordi dell'ingombro: più vicino una metà sarebbe vuota (mm). */
const MIN_SLICE = 0.1;

/** Inclinazione del piano: ruota di `angle` gradi attorno a `axis` (diverso dall'asse del piano), passando dal punto di taglio. */
export interface SplitTilt {
  axis: 0 | 1 | 2;
  angle: number;
}

/** Ruota un vettore di `angle` gradi attorno a un asse (0 = X, 1 = Y, 2 = Z), con la regola della mano destra come le rotazioni dell'app. */
function rotateAbout(v: Vec3, axis: 0 | 1 | 2, angle: number): Vec3 {
  const b = (axis + 1) % 3;
  const c = (axis + 2) % 3;
  const rad = (angle * Math.PI) / 180;
  const out: Vec3 = [...v];
  out[b] = v[b] * Math.cos(rad) - v[c] * Math.sin(rad);
  out[c] = v[b] * Math.sin(rad) + v[c] * Math.cos(rad);
  return out;
}

/** Vero se la selezione è un solo oggetto alla radice che si può dividere: solido, non bloccato, né raccordo né smusso. */
export function canSplit(scene: Scene, selection: string[]): boolean {
  const node = selection.length === 1 ? scene.nodes[selection[0]] : undefined;
  return node !== undefined && scene.rootIds.includes(node.id) && node.mode === 'solid' && !isCutter(node) && !isLocked(scene, node.id);
}

export function buildSplit(
  scene: Scene,
  targetId: string,
  axis: 0 | 1 | 2,
  offset: number,
  bounds: Bounds,
  tilt?: SplitTilt,
): { ok: true; scene: Scene; ids: [string, string] } | { ok: false; error: string } {
  const target = scene.nodes[targetId];
  if (!target) return { ok: false, error: 'L\'oggetto non esiste più.' };
  if (!scene.rootIds.includes(targetId)) return { ok: false, error: 'Si divide solo un oggetto alla radice.' };
  if (isLocked(scene, targetId)) return { ok: false, error: 'L\'oggetto è bloccato: sbloccalo per dividerlo.' };
  if (target.mode === 'hole') return { ok: false, error: 'Un foro non si può dividere.' };
  if (isCutter(target)) return { ok: false, error: 'Un raccordo o uno smusso non si può dividere.' };
  if (!(offset > bounds.min[axis] + MIN_SLICE && offset < bounds.max[axis] - MIN_SLICE)) return { ok: false, error: 'Il piano non taglia l\'oggetto: spostalo dentro il suo ingombro.' };

  const angle = tilt && Number.isFinite(tilt.angle) ? tilt.angle : 0;
  if (angle !== 0 && tilt!.axis === axis) return { ok: false, error: 'Il piano si inclina attorno a un asse diverso dal suo.' };
  const tilted = angle !== 0;

  const center = [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2) as Vec3;
  // Il cubo di taglio copre tutto l'ingombro sugli altri assi e, sull'asse del piano, un lato del piano. Se il piano è
  // inclinato non si sa quali assi copra: il cubo è così grande (il doppio della diagonale) da contenere il pezzo
  // comunque sia ruotato attorno al punto di taglio
  const diagonal = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
  const extent = (tilted ? [0, 1, 2].map(() => 2 * diagonal + 2 * CUTTER_MARGIN) : [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i] + 2 * CUTTER_MARGIN)) as Vec3;
  // Punto del piano da cui passa il taglio (e attorno a cui ruota): il centro dell'ingombro, alla quota scelta sull'asse
  const pivot: Vec3 = [...center];
  pivot[axis] = offset;
  const rotation: Vec3 = [0, 0, 0];
  if (tilted) rotation[tilt!.axis] = angle;
  // Sistema del gruppo che prenderà il posto del pezzo (e del suo clone, che ha la stessa trasformazione)
  const { groupWorld } = treatmentFrame(scene, targetId);
  const ids: [string, string] = [newId(), newId()];

  const next = produce(scene, (draft) => {
    // Copia ricorsiva del pezzo (come Duplica): sarà la seconda metà
    const clone = (id: string): string => {
      const src = draft.nodes[id];
      const copy = JSON.parse(JSON.stringify(src)) as SceneNode;
      copy.id = newId();
      copy.locked = false;
      copy.name = uniqueName(draft, src.name.replace(/ \d+$/, ''));
      if (copy.type === 'group') copy.children = copy.children.map(clone);
      draft.nodes[copy.id] = copy;
      return copy.id;
    };
    const cloneId = clone(targetId);
    draft.rootIds.splice(draft.rootIds.indexOf(targetId) + 1, 0, cloneId);

    // Metà 1: dal lato minore del piano; metà 2: dal lato maggiore
    [targetId, cloneId].forEach((pieceId, half) => {
      const cutterId = newId();
      // Il centro del cubo sta mezza misura oltre il piano, dal lato della sua metà; con l'inclinazione si ruota attorno al punto di taglio
      const toCenter: Vec3 = [0, 0, 0];
      toCenter[axis] = (half === 0 ? -extent[axis] : extent[axis]) / 2;
      const turned = tilted ? rotateAbout(toCenter, tilt!.axis, angle) : toCenter;
      const cutterCenter = pivot.map((v, i) => v + turned[i]) as Vec3;
      const local = toLocalTransform(groupWorld, { position: cutterCenter, rotation });
      const cutter: PrimitiveNode = {
        id: cutterId,
        type: 'primitive',
        kind: 'box',
        name: uniqueName(draft, 'Taglio'),
        position: local.position.map((v) => round(v, 4)) as Vec3,
        rotation: local.rotation.map((v) => round(v, 4)) as Vec3,
        // Con il pezzo specchiato il gruppo porta lo specchio: il cubo lo annulla, così resta dov'è nel mondo
        ...(local.mirror ? { mirror: local.mirror } : {}),
        mode: 'solid',
        color: target.color,
        size: [...extent],
        cornerRadius: 0,
      };
      draft.nodes[cutterId] = cutter;
      wrapInGroup(draft, pieceId, {
        id: ids[half],
        name: uniqueName(draft, `${target.name} (${half + 1})`),
        mode: 'solid',
        color: target.color,
        op: 'intersection',
        children: [pieceId, cutterId],
      });
    });
  });
  return { ok: true, scene: next, ids };
}
