// Controlli di stampabilità (punto 8 di da-fare.md): leggono le mesh già calcolate dal kernel e la scena, senza toccarle.
// Funzioni pure: gli avvisi li mostra la sezione Avvisi (src/ui/Warnings).

import type { NodeMesh } from '../kernel/evaluate';
import { evalFormula, resolveParams } from './params';
import { round } from './math';
import type { Scene, Vec3 } from './types';

export type IssueLevel = 'error' | 'warning';
export type IssueKind = 'formula' | 'invalid' | 'empty' | 'below' | 'outside' | 'floating' | 'overhang' | 'thin' | 'detached' | 'partial';

export interface PrintIssue {
  /** Chiave stabile (tipo e oggetto): serve all'elenco e a ricordare l'avviso in evidenza. */
  id: string;
  kind: IssueKind;
  level: IssueLevel;
  /** Frase per l'utente, con il nome dell'oggetto tra «». */
  text: string;
  /** Oggetto alla radice a cui si riferisce (si seleziona con un clic sull'avviso). */
  rootId?: string;
  /** Triangoli da evidenziare nella vista (xyz non indicizzati, in coordinate mondo). */
  triangles?: Float32Array;
  /** Scatole da evidenziare nella vista (min x, y, z, max x, y, z per ognuna, in coordinate mondo). */
  boxes?: Float32Array;
}

export interface PrintOptions {
  /** Piano di stampa centrato sull'origine: larghezza su X, profondità su Y, altezza utile su Z (mm). */
  bedWidth: number;
  bedDepth: number;
  bedHeight: number;
  /** Angolo massimo dalla verticale oltre cui una superficie rivolta in basso è uno sbalzo (gradi). */
  overhangAngle: number;
}

/** Tolleranza sulle quote (mm): sotto questa distanza un oggetto "tocca" il piano o un altro oggetto. */
const TOUCH = 0.05;
/** Area minima degli sbalzi da segnalare (mm²): sotto, sono briciole del calcolo. */
const OVERHANG_MIN_AREA = 1;

/** Numero per i messaggi: un decimale, virgola decimale italiana. */
const fmt = (v: number) => String(round(v, 1)).replace('.', ',');
const signed = (v: number) => `${v < 0 ? '−' : '+'}${fmt(Math.abs(v))}`;

interface Box {
  min: Vec3;
  max: Vec3;
}

/** Ingombro nel mondo di ogni oggetto alla radice (unione delle sue mesh piene e non vuote). */
function boundsByRoot(meshes: readonly NodeMesh[]): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const m of meshes) {
    if (m.isHole || m.empty) continue;
    const b = out.get(m.rootId);
    if (!b) out.set(m.rootId, { min: [...m.bbox.min], max: [...m.bbox.max] });
    else for (let i = 0; i < 3; i++) {
      b.min[i] = Math.min(b.min[i], m.bbox.min[i]);
      b.max[i] = Math.max(b.max[i], m.bbox.max[i]);
    }
  }
  return out;
}

/** Superficie rivolta in basso oltre l'angolo dato: area totale e triangoli (esclusi quelli appoggiati sul piano o sulla cima di un altro oggetto). */
function overhangs(mesh: NodeMesh, angle: number, supports: readonly Box[]): { area: number; triangles: number[] } {
  // Un triangolo è in sbalzo se la sua inclinazione rispetto alla verticale supera l'angolo: -nz > sin(angolo)
  const limit = Math.sin((angle * Math.PI) / 180);
  const p = mesh.positions;
  const idx = mesh.indices;
  const triangles: number[] = [];
  let area = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    // Sul piano di stampa la faccia è già sostenuta dal piatto
    if (Math.max(p[a + 2], p[b + 2], p[c + 2]) <= TOUCH) continue;
    const [ux, uy, uz] = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const [vx, vy, vz] = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    // Normale (non normalizzata) di un triangolo antiorario: punta fuori dal solido
    const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || -nz / len <= limit) continue;
    // Una faccia piatta appoggiata sulla cima di un altro oggetto è sostenuta da quello
    const [zMin, zMax] = [Math.min(p[a + 2], p[b + 2], p[c + 2]), Math.max(p[a + 2], p[b + 2], p[c + 2])];
    if (zMax - zMin <= TOUCH) {
      const [cx, cy] = [(p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3];
      if (supports.some((s) => Math.abs(zMax - s.max[2]) <= TOUCH && cx >= s.min[0] && cx <= s.max[0] && cy >= s.min[1] && cy <= s.max[1])) continue;
    }
    area += len / 2;
    triangles.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
  }
  return { area, triangles };
}

/**
 * Controlli sulle mesh del piatto attivo e sulle formule della scena. Un oggetto alla radice dà al massimo un avviso per
 * tipo. Gli avvisi sono ordinati: prima gli errori, poi le attenzioni.
 */
export function analyzePrintability(meshes: readonly NodeMesh[], scene: Scene, opts: PrintOptions): PrintIssue[] {
  const issues: PrintIssue[] = [];
  const nameOf = (rootId: string) => scene.nodes[rootId]?.name ?? rootId;
  const add = (issue: Omit<PrintIssue, 'id'>) => issues.push({ ...issue, id: `${issue.kind}:${issue.rootId ?? issue.text}` });

  // Formule: un parametro che non si calcola, o un campo la cui formula non si calcola
  const { values, errors } = resolveParams(scene.params);
  for (const p of scene.params ?? []) if (errors[p.id]) add({ kind: 'formula', level: 'error', text: `Il parametro «${p.name}» non si calcola: ${errors[p.id]}` });
  for (const node of Object.values(scene.nodes)) {
    for (const b of Object.values(node.exprs ?? {})) {
      const r = evalFormula(b.expr, values);
      if (!r.ok) add({ kind: 'formula', level: 'error', text: `La formula «${b.expr}» di «${node.name}» non si calcola: ${r.error}`, rootId: scene.rootIds.includes(node.id) ? node.id : undefined });
    }
  }

  // Solo gli oggetti ancora nel piatto attivo: i risultati del kernel possono essere indietro di un passo
  const live = meshes.filter((m) => scene.rootIds.includes(m.rootId));
  const solids = live.filter((m) => !m.isHole);

  // Mesh non valide o vuote
  const seenInvalid = new Set<string>();
  for (const m of solids) {
    if (m.status !== 'NoError' && !seenInvalid.has(m.rootId)) {
      seenInvalid.add(m.rootId);
      add({ kind: 'invalid', level: 'error', text: `«${nameOf(m.rootId)}» non è un solido valido (${m.status})`, rootId: m.rootId });
    }
  }
  const bounds = boundsByRoot(live);
  for (const rootId of new Set(solids.map((m) => m.rootId))) {
    if (!bounds.has(rootId)) add({ kind: 'empty', level: 'warning', text: `«${nameOf(rootId)}» non ha geometria (è vuoto)`, rootId });
  }

  // Posizione rispetto al piano di stampa
  const halfW = opts.bedWidth / 2;
  const halfD = opts.bedDepth / 2;
  for (const [rootId, b] of bounds) {
    const name = nameOf(rootId);
    if (b.min[2] < -TOUCH) add({ kind: 'below', level: 'error', text: `«${name}» affonda sotto il piano di stampa di ${fmt(-b.min[2])} mm`, rootId });
    // Eccessi oltre i bordi del piano, per asse: X e Y su entrambi i lati, Z solo in alto
    const over: string[] = [];
    if (b.max[0] - halfW > TOUCH) over.push(`X ${signed(b.max[0] - halfW)}`);
    if (-halfW - b.min[0] > TOUCH) over.push(`X ${signed(b.min[0] + halfW)}`);
    if (b.max[1] - halfD > TOUCH) over.push(`Y ${signed(b.max[1] - halfD)}`);
    if (-halfD - b.min[1] > TOUCH) over.push(`Y ${signed(b.min[1] + halfD)}`);
    if (b.max[2] - opts.bedHeight > TOUCH) over.push(`Z ${signed(b.max[2] - opts.bedHeight)}`);
    if (over.length) add({ kind: 'outside', level: 'error', text: `«${name}» esce dal volume di stampa (${over.join(', ')} mm)`, rootId });
    // Sospeso: non tocca il piano e sotto di lui non c'è un altro oggetto che lo regge
    if (b.min[2] > TOUCH) {
      const supported = [...bounds].some(
        ([other, o]) => other !== rootId && o.max[2] >= b.min[2] - TOUCH && o.min[2] < b.min[2] && o.max[0] > b.min[0] && o.min[0] < b.max[0] && o.max[1] > b.min[1] && o.min[1] < b.max[1],
      );
      if (!supported) add({ kind: 'floating', level: 'warning', text: `«${name}» non è appoggiato al piano: è sospeso di ${fmt(b.min[2])} mm`, rootId });
    }
  }

  // Sbalzi: un avviso per oggetto, con i triangoli di tutte le sue mesh
  const byRoot = new Map<string, { area: number; triangles: number[] }>();
  for (const m of solids) {
    if (m.empty) continue;
    const o = overhangs(m, opts.overhangAngle, [...bounds].filter(([id]) => id !== m.rootId).map(([, box]) => box));
    const acc = byRoot.get(m.rootId) ?? { area: 0, triangles: [] };
    acc.area += o.area;
    for (const v of o.triangles) acc.triangles.push(v);
    byRoot.set(m.rootId, acc);
  }
  for (const [rootId, o] of byRoot) {
    if (o.area >= OVERHANG_MIN_AREA) {
      add({ kind: 'overhang', level: 'warning', text: `Sbalzi oltre ${fmt(opts.overhangAngle)}° su «${nameOf(rootId)}» (${fmt(o.area)} mm²)`, rootId, triangles: new Float32Array(o.triangles) });
    }
  }

  // Ordine: errori prima, poi attenzioni, a parità l'ordine di scoperta
  return issues.sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error'));
}

/** Pareti sottili di un oggetto alla radice, trovate dal kernel (vedi `thinWalls` in kernel/analyze.ts). */
export interface ThinFinding {
  rootId: string;
  /** Scatole delle zone sottili: min x, y, z, max x, y, z per zona. */
  boxes: number[];
  /** Sezioni in cui compare una zona sottile, e quote Z minima e massima. */
  slices: number;
  zMin: number;
  zMax: number;
}

/** Parti separate e sospese dentro un oggetto alla radice che per il resto sta sul piano. */
export interface DetachedFinding {
  rootId: string;
  count: number;
  /** Quota più bassa tra le parti sospese (mm dal piano). */
  lowestZ: number;
}

/** Esito delle analisi del kernel: le pareti sottili e le parti sospese. */
export interface DeepResult {
  thin: ThinFinding[];
  detached: DetachedFinding[];
  /** Vero se il kernel si è fermato per il tempo a disposizione (modello molto complesso). */
  partial: boolean;
}

/** Avvisi delle analisi del kernel, con il nome dell'oggetto preso dalla scena (quelli di oggetti spariti non entrano). */
export function deepIssues(result: DeepResult, scene: Scene, minWall: number): PrintIssue[] {
  const issues: PrintIssue[] = [];
  const nameOf = (rootId: string) => scene.nodes[rootId]?.name;
  for (const t of result.thin) {
    const name = nameOf(t.rootId);
    if (!name || !scene.rootIds.includes(t.rootId)) continue;
    const quota = t.zMax - t.zMin < 0.05 ? `quota Z ${fmt(t.zMin)} mm` : `quota Z ${fmt(t.zMin)}–${fmt(t.zMax)} mm`;
    issues.push({
      id: `thin:${t.rootId}`, kind: 'thin', level: 'warning', rootId: t.rootId, boxes: new Float32Array(t.boxes),
      text: `Pareti sotto ${fmt(minWall)} mm su «${name}» (${quota}, ${t.slices === 1 ? '1 sezione' : `${t.slices} sezioni`})`,
    });
  }
  for (const d of result.detached) {
    const name = nameOf(d.rootId);
    if (!name || !scene.rootIds.includes(d.rootId)) continue;
    issues.push({
      id: `detached:${d.rootId}`, kind: 'detached', level: 'warning', rootId: d.rootId,
      text: `${d.count === 1 ? 'Una parte staccata e sospesa' : `${d.count} parti staccate e sospese`} in «${name}» (la più bassa a ${fmt(d.lowestZ)} mm dal piano)`,
    });
  }
  if (result.partial) issues.push({ id: 'partial:deep', kind: 'partial', level: 'warning', text: 'Il controllo delle pareti sottili è incompleto: il modello è molto complesso' });
  return issues;
}

/** Unisce gli avvisi veloci e quelli del kernel, errori prima. */
export function mergeIssues(fast: readonly PrintIssue[], deep: readonly PrintIssue[]): PrintIssue[] {
  return [...fast, ...deep].sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error'));
}
