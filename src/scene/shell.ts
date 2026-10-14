import { composeTransform, eulerToMatrix } from './math';
import type { Mirror, Transform } from './math';
import { polygonMaxRadius } from './polyhedra';
import { isProfileShape } from './profiles';
import type { ProfileShape } from './profiles';
import type { PrimitiveNode, Scene, SceneNode, Shape2DNode, ShellParams, Vec3 } from './types';

/**
 * Guscio (shell): svuota un solido lasciando pareti di spessore costante e un fondo, con la cima sempre aperta.
 * Il kernel e il generatore OpenSCAD calcolano `figlio − cavità`: qui si decide solo QUALE è la cavità.
 * Funzioni pure, senza stato e senza dipendenze dallo store, così le può usare anche il worker del kernel.
 *
 * Quattro strategie, dalla più precisa alla più approssimata:
 *  - cavità ESATTA: la stessa forma con le misure ridotte (cubo, cilindro, cono, cerchio e quadrato 2D estrusi
 *    dritti). Lo spessore delle pareti è esatto e il codice OpenSCAD resta leggibile.
 *  - cavità a PRISMA (poligono): unioni, gruppi o differenze di prismi verticali che hanno tutti la stessa altezza
 *    (per esempio due cubi affiancati). La cavità è la sezione del solido ristretta di w (`offset` 2D) ed estrusa:
 *    pareti uniformi anche ai giunti e attorno ai fori, nessuna parete interna tra i solidi uniti.
 *  - cavità per FIGLIO ("parts"): unioni di forme con cavità esatta ma altezze diverse o pareti inclinate (cono). Pareti
 *    esterne esatte; tra due solidi uniti resta una parete interna, perché ogni figlio ha la sua cavità.
 *  - cavità SCALATA (ripiego per tutto il resto: sfera, toro, solidi dei dadi, mesh, forme 2D con torsione): il solido
 *    stesso, rimpicciolito attorno al centro della base. Lo spessore è esatto solo nei punti estremi e le forme
 *    concave (toro, "L", mesh complesse) possono dare risultati scorretti.
 *
 * Quando il poligono è semplice: se le pareti sono verticali e la sezione non cambia con la quota, svuotare è un
 * `offset` 2D più un'estrusione. Con altezze diverse, pareti inclinate o curve servirebbe un'erosione 3D (soffitti e
 * pavimenti a gradini), che con manifold costa da decine di millisecondi a decine di secondi: lì si passa ai figli.
 *
 * La faccia aperta la sceglie l'utente (`ShellParams.open`, uno dei sei assi locali; di default la cima). Con la cima
 * aperta valgono tutte le strategie; con un'altra faccia la cavità è esatta per il cubo (ogni asse) e per le forme
 * estruse lungo Z aperte in cima o sul fondo, e scalata per tutto il resto (unioni comprese).
 */

/** Quanto la cavità sporge oltre la faccia aperta del solido, in mm: garantisce che il guscio resti aperto. */
export const SHELL_OPEN_MARGIN = 1;

/** Misura minima accettata per una cavità: sotto questa soglia le pareti hanno mangiato tutto il solido. */
const MIN_SIZE = 0.01;

/** Faccia aperta come asse locale (0 = X, 1 = Y, 2 = Z) e verso lungo quell'asse. */
export interface OpenSide {
  axis: 0 | 1 | 2;
  sign: 1 | -1;
}

/** La cima (+Z), la faccia aperta quando `ShellParams.open` manca. */
const TOP: OpenSide = { axis: 2, sign: 1 };

/** Faccia aperta di un guscio: la cima se non è stata scelta. */
export function openSide(open?: Vec3): OpenSide {
  if (!open) return TOP;
  const axis = open.reduce((best, v, i) => (Math.abs(v) > Math.abs(open[best]) ? i : best), 0) as 0 | 1 | 2;
  return { axis, sign: open[axis] < 0 ? -1 : 1 };
}

/** Normale unitaria della faccia aperta (versore dell'asse con il suo verso). */
export function openNormal({ axis, sign }: OpenSide): Vec3 {
  const normal: Vec3 = [0, 0, 0];
  normal[axis] = sign;
  return normal;
}

/** Quanto una normale può scostarsi da un asse per contare come allineata (cos ≈ 1,8°). */
const AXIS_ALIGNED = 0.9995;

/** Normale locale di una faccia scelta come faccia aperta: il versore dell'asse più vicino, o null se la faccia è obliqua. */
export function snapOpenDirection(normal: Vec3): Vec3 | null {
  const length = Math.hypot(...normal);
  if (!(length > 0)) return null;
  const side = openSide(normal);
  return Math.abs(normal[side.axis]) / length >= AXIS_ALIGNED ? openNormal(side) : null;
}

/** Nome della faccia aperta per i pannelli (cima e fondo, poi gli assi locali). */
export function openName(open?: Vec3): string {
  const { axis, sign } = openSide(open);
  if (axis === 2) return sign > 0 ? 'cima (+Z)' : 'fondo (−Z)';
  return `lato ${sign > 0 ? '+' : '−'}${axis === 0 ? 'X' : 'Y'}`;
}

/** Cavità del guscio, nel sistema locale del figlio (lo stesso in cui il figlio ha posizione e rotazione proprie). */
export type Cavity =
  /** Forma derivata (posizione e rotazione nulle) da spostare di `offset` (lungo l'asse della faccia aperta). */
  | { kind: 'exact'; node: PrimitiveNode | Shape2DNode; offset: Vec3 }
  /** Il figlio centrato nell'origine: si sposta il perno nell'origine, si scala, si riporta il perno e si sposta di `lift`. */
  | { kind: 'scaled'; scale: Vec3; pivot: Vec3; lift: Vec3 }
  /**
   * Prisma: sezione del solido alla quota `zMid` (sistema del guscio), ristretta di `wall` ed estrusa da `z0 + fondo`
   * a `z1` più il margine di apertura. `z0` e `z1` sono la base e la cima comuni a tutti i solidi.
   */
  | { kind: 'prism'; z0: number; z1: number; zMid: number }
  /** Unione di cavità esatte, una per solido, ciascuna con la sua posizione e rotazione nel sistema del guscio. */
  | { kind: 'parts'; parts: ShellPart[] }
  | { kind: 'error'; error: string };

/** Cavità esatta di un solido di un'unione: forma derivata, spostamento in Z locale e posizione del solido. */
export interface ShellPart {
  node: PrimitiveNode | Shape2DNode;
  offset: Vec3;
  position: Vec3;
  rotation: Vec3;
  mirror?: Mirror;
}

const fail = (error: string): Cavity => ({ kind: 'error', error });
const TOO_THICK = 'Le pareti sono troppo spesse per questo oggetto.';
const BOTTOM_TOO_THICK = 'Lo spessore del fondo supera la misura dell\'oggetto.';

/** Forma derivata: stessi parametri del solido, origine e orientamento azzerati (li rimette chi la usa) e senza formule (i valori non sono più quelli del campo). */
const derived = <T extends PrimitiveNode | Shape2DNode>(node: T, patch: Record<string, unknown>): T =>
  ({ ...node, ...patch, position: [0, 0, 0], rotation: [0, 0, 0], exprs: undefined }) as T;

/**
 * Altezza e posizione verticale (centro) della cavità di un solido alto `h` e centrato nell'origine.
 * La cavità parte dal fondo (a `bottom` dalla base) e sale fino a `margin` oltre la cima.
 */
function verticalSpan(h: number, bottom: number, margin: number): { height: number; centerZ: number } | null {
  if (h - bottom <= MIN_SIZE) return null;
  const low = -h / 2 + bottom;
  const high = h / 2 + margin;
  return { height: high - low, centerZ: (low + high) / 2 };
}

/** Vero se la forma ha una cavità esatta da sola (cubo, cilindro, cono, forme 2D dritte, profilati). */
function isExactShape(node: SceneNode): node is PrimitiveNode | Shape2DNode {
  // Le altre forme 2D (anello, cuore, testo, ...) usano la cavità scalata: non hanno una formula esatta
  if (node.type === 'shape2d') return (node.kind === 'circle' || node.kind === 'square' || isProfileShape(node)) && node.twist === 0 && node.scaleTop === 1 && node.extrusion !== 'rotate' && !node.offset;
  return node.type === 'primitive' && (node.kind === 'box' || node.kind === 'cylinder' || node.kind === 'cone');
}

type Frame = Transform;

/** Solido di un'unione con la sua trasformazione nel sistema del guscio. */
interface Leaf {
  node: PrimitiveNode | Shape2DNode;
  frame: Frame;
}

/**
 * Foglie (cubi, cilindri, forme 2D...) di un figlio del guscio, ciascuna con la trasformazione composta di tutti i gruppi
 * che la contengono. `solids` aggiungono materiale, `holes` ne tolgono. Restituisce null se la struttura non è un'unione
 * (o una differenza) di forme semplici: intersezioni, gusci annidati, taglierini, mesh non si analizzano.
 */
function collectLeaves(scene: Scene, id: string, parent: Frame, asHole: boolean, out: { solids: Leaf[]; holes: Leaf[] }): boolean {
  const node = scene.nodes[id];
  if (!node) return false;
  const frame = composeTransform(parent, node);
  if (node.type === 'primitive' || node.type === 'shape2d') {
    (asHole || node.mode === 'hole' ? out.holes : out.solids).push({ node, frame });
    return true;
  }
  if (node.type !== 'group' || (node.op !== 'union' && node.op !== 'group' && node.op !== 'difference')) return false;
  // Differenza: il primo figlio è la base, gli altri si sottraggono; Unione e Raggruppa: i fori (modo hole) si sottraggono
  return node.children.every((childId, i) => collectLeaves(scene, childId, frame, asHole || (node.op === 'difference' && i > 0), out));
}

/** Intervallo di quota [z0, z1] di una foglia con pareti verticali, o null se non lo è (inclinata, arrotondata, torsione). */
function verticalRange({ node, frame }: Leaf): [number, number] | null {
  // Solo rotazioni attorno a Z: con X o Y diversi da zero le pareti non sono più verticali
  if (Math.abs(frame.rotation[0]) > 1e-6 || Math.abs(frame.rotation[1]) > 1e-6) return null;
  let height: number;
  if (node.type === 'shape2d') {
    // Un'estrusione rotazionale non è un prisma: niente pareti verticali da misurare
    if (node.twist !== 0 || node.scaleTop !== 1 || node.extrusion === 'rotate' || node.offset) return null;
    height = node.height;
  } else if (node.kind === 'box') {
    // Spigoli arrotondati: le pareti restano verticali ma cima e fondo no, la sezione cambia con la quota
    if ((node.cornerRadius ?? 0) > 0) return null;
    height = node.size[2];
  } else if (node.kind === 'cylinder') {
    height = node.height;
  } else {
    return null;
  }
  return [frame.position[2] - height / 2, frame.position[2] + height / 2];
}

/** Come si svuota il figlio: serve a scegliere la cavità e a dire all'utente quanto è precisa. */
export type ShellQuality = 'exact' | 'prism' | 'parts' | 'scaled';

type Plan =
  | { quality: 'exact' }
  | { quality: 'prism'; z0: number; z1: number }
  | { quality: 'parts'; leaves: Leaf[] }
  | { quality: 'scaled' };

/** Tolleranza (mm) per dire che due quote coincidono. */
const SAME_LEVEL = 1e-3;

function planOf(scene: Scene, child: SceneNode, side: OpenSide): Plan {
  // Cubo: la cavità esatta vale su ogni faccia; le forme estruse lungo Z solo aperte in cima o sul fondo
  if (isExactShape(child) && (side.axis === 2 || (child.type === 'primitive' && child.kind === 'box'))) return { quality: 'exact' };
  // Prisma e per figlio sono costruite per la cima aperta: con un'altra faccia si ripiega sulla cavità scalata
  if (side.axis !== 2 || side.sign < 0) return { quality: 'scaled' };
  const leaves = { solids: [] as Leaf[], holes: [] as Leaf[] };
  const identity: Frame = { position: [0, 0, 0], rotation: [0, 0, 0] };
  // `child.id` è nella scena: la trasformazione del figlio entra nella composizione
  if (child.type !== 'group' || !collectLeaves(scene, child.id, identity, false, leaves) || leaves.solids.length === 0) return { quality: 'scaled' };

  // Prisma: tutti i solidi con pareti verticali e la stessa base e cima; i fori attraversano l'intera altezza
  const ranges = leaves.solids.map(verticalRange);
  if (ranges.every((r): r is [number, number] => r !== null)) {
    const [z0, z1] = ranges[0];
    const sameLevels = ranges.every(([lo, hi]) => Math.abs(lo - z0) < SAME_LEVEL && Math.abs(hi - z1) < SAME_LEVEL);
    const throughHoles = leaves.holes.every((hole) => {
      const range = verticalRange(hole);
      return range !== null && range[0] <= z0 + SAME_LEVEL && range[1] >= z1 - SAME_LEVEL;
    });
    if (sameLevels && throughHoles) return { quality: 'prism', z0, z1 };
  }
  // Per figlio: solo unioni senza fori di forme che hanno ciascuna una cavità esatta
  if (leaves.holes.length === 0 && leaves.solids.every((l) => isExactShape(l.node))) return { quality: 'parts', leaves: leaves.solids };
  return { quality: 'scaled' };
}

/** Quanto è precisa la cavità del figlio con la faccia `open` aperta (per il messaggio nel pannello): esatta, a prisma, per figlio o scalata. */
export function shellQuality(scene: Scene, child: SceneNode, open?: Vec3): ShellQuality {
  return planOf(scene, child, openSide(open)).quality;
}

/**
 * Cavità del guscio di `child`. `shell.bounds` (ingombro nel sistema locale del figlio) serve solo al ripiego scalato.
 * La scena serve a scendere nei figli di unioni e differenze.
 */
export function cavityOf(scene: Scene, child: SceneNode, shell: ShellParams): Cavity {
  const { wall, bottom } = shell;
  if (!(wall > 0)) return fail('Lo spessore laterale deve essere maggiore di zero.');
  if (!(bottom >= 0)) return fail('Lo spessore del fondo non può essere negativo.');
  const side = openSide(shell.open);
  const plan = planOf(scene, child, side);

  if (plan.quality === 'exact') return exactCavity(child as PrimitiveNode | Shape2DNode, wall, bottom, side) ?? scaledCavity(shell);

  if (plan.quality === 'prism') {
    // Sezione ristretta di w su ogni lato e fondo a `bottom` dalla base: servono almeno w sul lato minore dell'ingombro
    const { bounds } = shell;
    if (bounds && Math.min(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) - 2 * wall < MIN_SIZE) return fail(TOO_THICK);
    if (plan.z1 - plan.z0 - bottom <= MIN_SIZE) return fail(BOTTOM_TOO_THICK);
    return { kind: 'prism', z0: plan.z0, z1: plan.z1, zMid: (plan.z0 + plan.z1) / 2 };
  }

  if (plan.quality === 'parts') {
    const parts: ShellPart[] = [];
    for (const { node, frame } of plan.leaves) {
      // Ogni solido ha la sua cavità esatta, con spessori misurati dalla sua base e dalle sue pareti
      const cavity = exactCavity(node, wall, bottom, TOP);
      if (!cavity || cavity.kind === 'error') return cavity ?? scaledCavity(shell);
      if (cavity.kind !== 'exact') return fail(TOO_THICK);
      parts.push({ node: cavity.node, offset: cavity.offset, position: frame.position, rotation: frame.rotation, mirror: frame.mirror });
    }
    return { kind: 'parts', parts };
  }
  return scaledCavity(shell);
}

/**
 * Cavità esatta per cubo, cilindro, cono e forme 2D estruse dritte; null per tutte le altre forme.
 * `side` è la faccia aperta: il cubo la accetta su ogni asse, le altre forme solo in cima o sul fondo (±Z), dove
 * la cavità è la stessa della cima specchiata (offset cambiato di segno, nel cono raggi scambiati).
 */
function exactCavity(p: PrimitiveNode | Shape2DNode, w: number, b: number, side: OpenSide): Cavity | null {
  const margin = SHELL_OPEN_MARGIN;
  const { sign } = side;

  if (p.type === 'shape2d') {
    // Con torsione o scala della cima le pareti non sono più parallele all'asse: si usa il ripiego
    if (p.twist !== 0 || p.scaleTop !== 1 || p.extrusion === 'rotate' || p.offset) return null;
    const span = verticalSpan(p.height, b, margin);
    if (!span) return fail(BOTTOM_TOO_THICK);
    const offset: Vec3 = [0, 0, sign * span.centerZ];
    if (p.kind === 'square') {
      const [iw, id] = [p.width - 2 * w, p.depth - 2 * w];
      if (iw < MIN_SIZE || id < MIN_SIZE) return fail(TOO_THICK);
      // Il raggio degli angoli si riduce dello spessore (offset verso l'interno), senza scendere sotto zero
      const outer = Math.min(Math.max(0, p.cornerRadius), (Math.min(p.width, p.depth) - 0.01) / 2);
      return { kind: 'exact', offset, node: derived(p, { width: iw, depth: id, cornerRadius: Math.max(0, outer - w), height: span.height }) };
    }
    if (isProfileShape(p)) {
      // Profilato: la stessa sezione con ogni parete ristretta di w per lato (il raccordo interno cresce di w, le
      // punte e gli angoli esterni calano di w, così lo spessore resta costante anche in curva)
      const inner = profileCavity(p, w);
      if (!inner) return fail(TOO_THICK);
      return { kind: 'exact', offset, node: derived(p, { ...inner, height: span.height }) };
    }
    if (p.kind !== 'circle') return null;
    // Poligono regolare: lo spessore si misura sull'apotema, il raggio di circoscrizione cala di w / cos(π / lati)
    const k = w / Math.cos(Math.PI / Math.max(3, p.segments));
    const radius = p.radius - k;
    const radiusY = p.radiusY === undefined ? undefined : p.radiusY - k;
    if (radius < MIN_SIZE || (radiusY !== undefined && radiusY < MIN_SIZE)) return fail(TOO_THICK);
    const outer = Math.min(Math.max(0, p.cornerRadius ?? 0), polygonMaxRadius(p.radius, p.segments));
    return { kind: 'exact', offset, node: derived(p, { radius, radiusY, cornerRadius: Math.max(0, outer - w), height: span.height }) };
  }

  switch (p.kind) {
    case 'box': {
      // L'asse della faccia aperta prende fondo e margine di apertura, gli altri due si restringono di 2w per lato
      const { axis } = side;
      const span = verticalSpan(p.size[axis], b, margin);
      if (!span) return fail(BOTTOM_TOO_THICK);
      const inner = p.size.map((s, i) => (i === axis ? span.height : s - 2 * w)) as Vec3;
      if (inner.some((s, i) => i !== axis && s < MIN_SIZE)) return fail(TOO_THICK);
      // Spigoli arrotondati: il raggio interno è quello esterno meno lo spessore (pareti di spessore costante)
      const outer = Math.min(Math.max(0, p.cornerRadius ?? 0), (Math.min(...p.size) - 0.01) / 2);
      const offset: Vec3 = [0, 0, 0];
      offset[axis] = sign * span.centerZ;
      return { kind: 'exact', offset, node: derived(p, { size: inner, cornerRadius: Math.max(0, outer - w) }) };
    }
    case 'cylinder': {
      const span = verticalSpan(p.height, b, margin);
      if (!span) return fail(BOTTOM_TOO_THICK);
      const k = w / Math.cos(Math.PI / Math.max(3, p.segments));
      const radius = p.radius - k;
      const radiusY = p.radiusY === undefined ? undefined : p.radiusY - k;
      if (radius < MIN_SIZE || (radiusY !== undefined && radiusY < MIN_SIZE)) return fail(TOO_THICK);
      return { kind: 'exact', offset: [0, 0, sign * span.centerZ], node: derived(p, { radius, radiusY, height: span.height }) };
    }
    case 'cone': {
      const h = p.height;
      if (h - b <= MIN_SIZE) return fail(BOTTOM_TOO_THICK);
      // Aperto sul fondo: si calcola la cavità del cono capovolto (aperto in cima) e poi si ribalta il risultato
      const [radiusBottom, radiusTop] = sign > 0 ? [p.radiusBottom, p.radiusTop] : [p.radiusTop, p.radiusBottom];
      // Parete inclinata: lo spessore w è perpendicolare alla parete, quindi in orizzontale vale w·√(1 + pendenza²)
      const slope = (radiusBottom - radiusTop) / h;
      const dr = (w * Math.sqrt(1 + slope * slope)) / Math.cos(Math.PI / Math.max(3, p.segments));
      // Raggio della parete esterna alla quota z (anche oltre la cima, per estrapolazione)
      const radiusAt = (z: number) => radiusBottom + ((radiusTop - radiusBottom) * (z + h / 2)) / h;
      let low = -h / 2 + b;
      let high = h / 2 + margin;
      let radiusLow = radiusAt(low) - dr;
      let radiusHigh = radiusAt(high) - dr;
      if (radiusLow < MIN_SIZE) {
        // Estremità chiusa troppo stretta: se il cono si allarga verso l'apertura (punta dal lato chiuso, per esempio
        // la base aperta di un cono a punta) la cavità comincia dove il suo raggio si annulla e la punta resta piena
        if (radiusHigh <= MIN_SIZE) return fail(TOO_THICK);
        low += ((high - low) * Math.max(0, -radiusLow)) / (radiusHigh - radiusLow);
        radiusLow = 0;
      }
      if (radiusHigh < 0) {
        // Cono che si stringe fino alla punta: la cavità finisce dove il suo raggio si annulla, la punta resta chiusa
        high = low + ((high - low) * radiusLow) / (radiusLow - radiusHigh);
        radiusHigh = 0;
      }
      // Cono ellittico: l'estremità più larga mantiene il rapporto Y/X dell'originale
      const wide = Math.max(p.radiusBottom, p.radiusTop);
      const radiusY = p.radiusY !== undefined && wide > 0 ? (p.radiusY / wide) * Math.max(radiusLow, radiusHigh) : undefined;
      // Capovolto: l'estremità chiusa (radiusLow) è la cima del cono vero e quella aperta (radiusHigh) il suo fondo
      const [cavityBottom, cavityTop] = sign > 0 ? [radiusLow, radiusHigh] : [radiusHigh, radiusLow];
      return {
        kind: 'exact',
        offset: [0, 0, (sign * (low + high)) / 2],
        node: derived(p, { radiusBottom: cavityBottom, radiusTop: cavityTop, radiusY, height: high - low }),
      };
    }
    default:
      return null;
  }
}

/**
 * Misure della sezione interna di un profilato svuotato con pareti di spessore `w`, oppure null se una parete del
 * profilato è più sottile di 2w (la cavità mangerebbe tutto). I raccordi li limita poi `clampProfile` nel kernel.
 */
function profileCavity(p: ProfileShape, w: number): Record<string, number> | null {
  if (p.kind === 'tubeRound') {
    const k = w / Math.cos(Math.PI / Math.max(3, p.segments));
    const [radius, wall] = [p.radius - k, p.wall - 2 * k];
    return radius < MIN_SIZE || wall < MIN_SIZE ? null : { radius, wall };
  }
  const [width, depth] = [p.width - 2 * w, p.depth - 2 * w];
  if (width < MIN_SIZE || depth < MIN_SIZE) return null;
  if (p.kind === 'tubeRect') {
    const wall = p.wall - 2 * w;
    return wall < MIN_SIZE ? null : { width, depth, wall, cornerRadius: Math.max(0, (p.cornerRadius ?? 0) - w) };
  }
  const [flange, web] = [p.flange - 2 * w, p.web - 2 * w];
  if (flange < MIN_SIZE || web < MIN_SIZE) return null;
  return { width, depth, flange, web, rootRadius: (p.rootRadius ?? 0) + w, tipSize: Math.max(0, (p.tipSize ?? 0) - w) };
}

/**
 * Ripiego: il solido stesso rimpicciolito attorno al centro della faccia opposta a quella aperta (serve l'ingombro
 * locale in `shell.bounds`). Con la cima aperta la faccia opposta è la base.
 */
function scaledCavity(shell: ShellParams): Cavity {
  const { wall: w, bottom: b, bounds } = shell;
  if (!bounds) return fail('Mancano le misure d\'ingombro dell\'oggetto: ricrea il guscio.');
  const { axis, sign } = openSide(shell.open);
  const extent = [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]);
  if (extent.some((e, i) => i !== axis && e - 2 * w < MIN_SIZE)) return fail(TOO_THICK);
  // Lungo l'asse aperto la cavità parte dal fondo (faccia opposta + b) e sporge di SHELL_OPEN_MARGIN oltre la faccia aperta
  if (extent[axis] - b <= MIN_SIZE) return fail(BOTTOM_TOO_THICK);
  const lift: Vec3 = [0, 0, 0];
  lift[axis] = sign * b;
  return {
    kind: 'scaled',
    scale: extent.map((e, i) => (i === axis ? e - b + SHELL_OPEN_MARGIN : e - 2 * w) / e) as Vec3,
    // Perno al centro della faccia opposta a quella aperta: la scala la lascia ferma, poi `lift` la sposta dello spessore del fondo
    pivot: [0, 1, 2].map((i) => (i === axis ? (sign > 0 ? bounds.min[i] : bounds.max[i]) : (bounds.min[i] + bounds.max[i]) / 2)) as Vec3,
    lift,
  };
}

/**
 * Ingombro (minimo e massimo) di una o più mesh in coordinate mondo, riportato nel sistema locale del nodo la cui
 * trasformazione nel mondo è `world`: local = Rᵀ · (p − posizione), con R la rotazione del nodo.
 */
export function localBounds(
  meshes: { positions: Float32Array }[],
  world: Transform,
): { min: Vec3; max: Vec3 } {
  const R = eulerToMatrix(world.rotation);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of meshes) {
    for (let i = 0; i < positions.length; i += 3) {
      const d = [positions[i] - world.position[0], positions[i + 1] - world.position[1], positions[i + 2] - world.position[2]];
      for (let axis = 0; axis < 3; axis++) {
        // Colonna `axis` di R per il vettore: equivale alla matrice trasposta (inversa di una rotazione)
        // Con lo specchio del nodo (local = D · Rᵀ · d) l'asse specchiato cambia segno
        const v = (world.mirror?.[axis] ? -1 : 1) * (R[0][axis] * d[0] + R[1][axis] * d[1] + R[2][axis] * d[2]);
        if (v < min[axis]) min[axis] = v;
        if (v > max[axis]) max[axis] = v;
      }
    }
  }
  const r = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
  return { min: min.map(r) as Vec3, max: max.map(r) as Vec3 };
}
