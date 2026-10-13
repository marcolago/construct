import { produce } from 'immer';
import { composeTransform, round, toLocalTransform } from './math';
import type { Bounds } from './placement';
import { isLocked, newId, uniqueName } from './store';
import { isCutter, treatmentFrame, wrapInGroup } from './treatment';
import type { GroupNode, PrimitiveNode, Scene, SceneNode, Vec3 } from './types';

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

/**
 * Connettori sul piano di taglio, in fila lungo una delle due direzioni del piano.
 * - `peg` (Perno): il maschio è unito a una metà e la sede, più larga della tolleranza, è scavata nell'altra.
 * - `dowel` (Spine): un foro uguale in ciascuna metà e le spine sciolte in un oggetto a parte, da stampare sdraiate.
 * Sono primitive normali (cilindri o cubi) dentro un gruppo Unione per metà: kernel e codice OpenSCAD non cambiano.
 */
export interface ConnectorOptions {
  type: 'none' | 'peg' | 'dowel';
  shape: 'round' | 'square';
  /** Solo Perno: la metà (0 = prima, 1 = seconda) che porta il perno. */
  pegHalf: 0 | 1;
  /** Diametro (tondo) o lato (quadrato) del perno e della spina, in mm. */
  size: number;
  /** Quanto il connettore entra in ogni metà, in mm. */
  depth: number;
  /** Gioco per lato (e sul fondo) di sedi e fori rispetto al perno o alla spina, in mm. */
  tolerance: number;
  /** Numero di connettori della fila. */
  count: number;
  /** Distanza tra i centri, in mm. */
  spacing: number;
  /** Asse del mondo lungo cui corre la fila: uno dei due paralleli al piano, cioè diverso da quello del piano. */
  row: 0 | 1 | 2;
  /** Spostamento del centro della fila rispetto al centro del taglio, lungo gli assi `(piano + 1) % 3` e `(piano + 2) % 3`, in mm. */
  shiftA: number;
  shiftB: number;
}

export const DEFAULT_CONNECTORS: ConnectorOptions = { type: 'none', shape: 'round', pegHalf: 0, size: 5, depth: 6, tolerance: 0.2, count: 2, spacing: 20, row: 1, shiftA: 0, shiftB: 0 };

/** Un cilindro o un cubo con l'asse lungo la normale del piano: misure e posizione nel mondo. */
export interface ConnectorPart {
  /** Diametro o lato, in mm. */
  width: number;
  /** Lunghezza lungo la normale, in mm. */
  length: number;
  center: Vec3;
  rotation: Vec3;
}

/** Un connettore della fila: le parti da creare (per metà) e la zona che deve stare dentro il pezzo. */
export interface ConnectorSlot {
  /** Perno (maschio) del solo tipo Perno. */
  pin?: { half: 0 | 1; part: ConnectorPart };
  /** Fori delle due metà: la sede del Perno (solo nell'altra metà) o i due fori delle Spine. */
  holes: { half: 0 | 1; part: ConnectorPart }[];
  /** Spina sciolta (solo Spine), sdraiata sul piatto accanto al pezzo. */
  dowel?: ConnectorPart;
  /** Ingombro di perno e sede (con il gioco, senza lo sforo): deve stare tutto dentro il pezzo. */
  fit: ConnectorPart;
}

/** Quanto il perno affonda nella propria metà (così l'unione non ha facce coincidenti) e quanto la sede esce oltre il piano (niente pellicola) in mm. */
const EMBED = 0.5;
const OVERSHOOT = 0.5;
/** Lati di cilindri e cerchi dei connettori. */
export const CONNECTOR_SEGMENTS = 48;
/** Distanza tra il pezzo e le spine, e tra due spine, oltre l'ingombro (mm). */
const DOWEL_GAP = 10;

/** Le due direzioni del piano perpendicolare all'asse `axis`: i due assi del mondo diversi da quello. */
export const planeAxes = (axis: 0 | 1 | 2): [0 | 1 | 2, 0 | 1 | 2] => [((axis + 1) % 3) as 0 | 1 | 2, ((axis + 2) % 3) as 0 | 1 | 2];

/** Estremi ordinati di un intervallo. */
const span = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

/**
 * Posizione dei connettori sul piano: una funzione pura che usano la costruzione delle metà, l'anteprima nella vista
 * e il controllo del kernel, così non possono divergere. Il sistema del piano ha l'origine nel punto di taglio e la
 * normale sull'asse del piano (ruotato dall'inclinazione): lungo la normale la prima metà sta dal lato negativo.
 */
export function connectorLayout(axis: 0 | 1 | 2, offset: number, bounds: Bounds, tilt: SplitTilt | undefined, o: ConnectorOptions): ConnectorSlot[] {
  if (o.type === 'none') return [];
  const [axA] = planeAxes(axis);
  // Punto di taglio (centro dell'ingombro alla quota del piano) e inclinazione: sono il sistema del piano
  const pivot = [0, 1, 2].map((i) => (i === axis ? offset : (bounds.min[i] + bounds.max[i]) / 2)) as Vec3;
  const tiltRot: Vec3 = [0, 0, 0];
  if (tilt && tilt.angle !== 0) tiltRot[tilt.axis] = tilt.angle;
  const plane = { position: pivot, rotation: tiltRot };
  // La Z locale di un cilindro o di un cubo si porta sull'asse del piano
  const align: Vec3 = axis === 0 ? [0, 90, 0] : axis === 1 ? [-90, 0, 0] : [0, 0, 0];
  // Verso del perno lungo la normale: dalla prima metà sporge verso la seconda (+1), dalla seconda verso la prima (-1)
  const pegSide = o.pegHalf === 0 ? 1 : -1;
  const wide = o.size + 2 * o.tolerance;
  const reach = o.depth + o.tolerance;

  return Array.from({ length: o.count }, (_, k) => {
    // Posizione nel piano: il centro della fila spostato, più l'indice della fila lungo la sua direzione
    const along = (k - (o.count - 1) / 2) * o.spacing;
    const a = o.shiftA + (o.row === axA ? along : 0);
    const b = o.shiftB + (o.row === axA ? 0 : along);
    /** Parte di diametro `width` che va da `from` a `to` lungo la normale. */
    const part = (width: number, from: number, to: number): ConnectorPart => {
      const local: Vec3 = [0, 0, 0];
      local[axis] = (from + to) / 2;
      local[(axis + 1) % 3] = a;
      local[(axis + 2) % 3] = b;
      const world = composeTransform(plane, { position: local, rotation: align });
      return { width, length: to - from, center: world.position.map((v) => round(v, 4)) as Vec3, rotation: world.rotation.map((v) => round(v, 4)) as Vec3 };
    };
    if (o.type === 'peg') {
      // Il perno parte dentro la sua metà e sporge nell'altra; la sede è nell'altra metà e sfora il piano
      return {
        pin: { half: o.pegHalf, part: part(o.size, ...span(-pegSide * EMBED, pegSide * o.depth)) },
        holes: [{ half: (1 - o.pegHalf) as 0 | 1, part: part(wide, ...span(-pegSide * OVERSHOOT, pegSide * reach)) }],
        fit: part(wide, ...span(-pegSide * EMBED, pegSide * reach)),
      };
    }
    // Spine: un foro per metà (la prima dal lato negativo, la seconda dal positivo) e una spina lunga il doppio
    const dowelX = bounds.max[0] + DOWEL_GAP + o.depth;
    const dowelY = (bounds.min[1] + bounds.max[1]) / 2 + (k - (o.count - 1) / 2) * (o.size + DOWEL_GAP / 2);
    return {
      holes: [
        { half: 0 as const, part: part(wide, -reach, OVERSHOOT) },
        { half: 1 as const, part: part(wide, -OVERSHOOT, reach) },
      ],
      dowel: { width: o.size, length: 2 * o.depth, center: [dowelX, dowelY, o.size / 2] as Vec3, rotation: [0, 90, 0] as Vec3 },
      fit: part(wide, -reach, reach),
    };
  });
}

/** Primitiva (cilindro o cubo) di una parte del connettore, con la trasformazione data (nel mondo o nel sistema di un gruppo). */
export function connectorPrimitive(shape: ConnectorOptions['shape'], part: ConnectorPart, name: string, mode: 'solid' | 'hole', color: string, transform?: { position: Vec3; rotation: Vec3; mirror?: [boolean, boolean, boolean] }): PrimitiveNode {
  const base = {
    id: newId(),
    type: 'primitive' as const,
    name,
    position: (transform?.position ?? part.center) as Vec3,
    rotation: (transform?.rotation ?? part.rotation) as Vec3,
    ...(transform?.mirror ? { mirror: transform.mirror } : {}),
    mode,
    color,
  };
  return shape === 'round'
    ? { ...base, kind: 'cylinder', radius: part.width / 2, height: part.length, segments: CONNECTOR_SEGMENTS }
    : { ...base, kind: 'box', size: [part.width, part.width, part.length], cornerRadius: 0 };
}

/** Controlla le misure dei connettori: il motivo per cui non si possono costruire, oppure null. */
export function connectorError(axis: 0 | 1 | 2, o: ConnectorOptions): string | null {
  if (o.type === 'none') return null;
  if (!(o.size > 0 && o.depth > 0)) return 'Diametro e profondità dei connettori devono essere maggiori di zero.';
  if (!(o.tolerance >= 0)) return 'La tolleranza non può essere negativa.';
  if (!(Number.isInteger(o.count) && o.count >= 1)) return 'Serve almeno un connettore.';
  if (o.count > 1 && !(o.spacing > 0)) return 'La distanza tra i connettori deve essere maggiore di zero.';
  if (!planeAxes(axis).includes(o.row)) return 'La fila dei connettori corre lungo un asse del piano, diverso da quello del piano.';
  return null;
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
  connectors?: ConnectorOptions,
): { ok: true; scene: Scene; ids: [string, string]; dowelsId?: string } | { ok: false; error: string } {
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
  const withConnectors = connectors !== undefined && connectors.type !== 'none';
  if (withConnectors) {
    const bad = connectorError(axis, connectors);
    if (bad) return { ok: false, error: bad };
  }
  // Posizione dei connettori nel mondo (vuoto senza connettori)
  const slots = withConnectors ? connectorLayout(axis, offset, bounds, tilt, connectors) : [];
  const dowelsId = newId();

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
      if (!withConnectors) {
        wrapInGroup(draft, pieceId, {
          id: ids[half],
          name: uniqueName(draft, `${target.name} (${half + 1})`),
          mode: 'solid',
          color: target.color,
          op: 'intersection',
          children: [pieceId, cutterId],
        });
        return;
      }
      // Con i connettori la metà è un'Unione: [pezzo ∩ taglio, perni] meno le sedi. L'Unione prende il posto e la
      // trasformazione del pezzo (come ogni gruppo di trattamento); l'Intersezione sta all'origine dell'Unione, quindi
      // il cubo di taglio resta nel sistema di prima
      wrapInGroup(draft, pieceId, {
        id: ids[half],
        name: uniqueName(draft, `${target.name} (${half + 1})`),
        mode: 'solid',
        color: target.color,
        op: 'union',
        children: [pieceId],
      });
      const cutId = newId();
      draft.nodes[cutId] = {
        id: cutId,
        type: 'group',
        name: uniqueName(draft, `${target.name} (${half + 1}) taglio`),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        mode: 'solid',
        color: target.color,
        op: 'intersection',
        children: [pieceId, cutterId],
      };
      const union = draft.nodes[ids[half]] as GroupNode;
      union.children = [cutId];
      // Perni e sedi: dal sistema del mondo a quello dell'Unione (con l'eventuale specchio annullato, come il cubo di taglio)
      slots.forEach((slot, k) => {
        const parts = [...(slot.pin && slot.pin.half === half ? [{ part: slot.pin.part, mode: 'solid' as const, name: `Perno ${k + 1}` }] : []), ...slot.holes.filter((h) => h.half === half).map((h) => ({ part: h.part, mode: 'hole' as const, name: connectors!.type === 'peg' ? `Sede ${k + 1}` : `Foro ${k + 1}` }))];
        for (const { part, mode, name } of parts) {
          const local = toLocalTransform(groupWorld, { position: part.center, rotation: part.rotation });
          const prim = connectorPrimitive(connectors!.shape, part, uniqueName(draft, name), mode, target.color, {
            position: local.position.map((v) => round(v, 4)) as Vec3,
            rotation: local.rotation.map((v) => round(v, 4)) as Vec3,
            mirror: local.mirror,
          });
          draft.nodes[prim.id] = prim;
          union.children.push(prim.id);
        }
      });
    });

    // Spine: un solo oggetto con le spine sciolte, sdraiate sul piatto accanto al pezzo
    if (withConnectors && connectors.type === 'dowel') {
      const children = slots.map((slot, k) => {
        const prim = connectorPrimitive(connectors.shape, slot.dowel!, uniqueName(draft, `Spina ${k + 1}`), 'solid', target.color);
        draft.nodes[prim.id] = prim;
        return prim.id;
      });
      draft.nodes[dowelsId] = { id: dowelsId, type: 'group', name: uniqueName(draft, 'Spine'), position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: target.color, op: 'group', children };
      // Subito dopo la seconda metà (che ha preso il posto della copia)
      draft.rootIds.splice(draft.rootIds.indexOf(ids[1]) + 1, 0, dowelsId);
    }
  });
  return { ok: true, scene: next, ids, ...(withConnectors && connectors.type === 'dowel' ? { dowelsId } : {}) };
}
