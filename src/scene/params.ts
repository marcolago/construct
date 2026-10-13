// Parametri di progetto e formule dei campi numerici (punto 8 di da-fare.md).
// Le formule usano la sintassi delle espressioni OpenSCAD (stesso parser dell'import), così lo stesso testo vale
// anche nel codice esportato. Le funzioni sono pure e non toccano lo store.

import { parseExpression, type Expr } from '../import/scad/parse';
import { round } from './math';
import type { Binding, Param, Scene } from './types';

/** Funzioni matematiche ammesse nelle formule (stesse semantiche di OpenSCAD: angoli in gradi, `round` lontano da zero). */
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  sin: (x) => Math.sin(rad(x)),
  cos: (x) => Math.cos(rad(x)),
  tan: (x) => Math.tan(rad(x)),
  asin: (x) => deg(Math.asin(x)),
  acos: (x) => deg(Math.acos(x)),
  atan: (x) => deg(Math.atan(x)),
  atan2: (y, x) => deg(Math.atan2(y, x)),
  abs: Math.abs,
  sqrt: Math.sqrt,
  pow: Math.pow,
  exp: Math.exp,
  ln: Math.log,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x) => Math.sign(x) * Math.round(Math.abs(x)),
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
};

/** Nomi che un parametro non può avere: parole riservate di OpenSCAD, costanti e funzioni delle formule. */
const RESERVED = new Set([
  'module', 'function', 'if', 'else', 'for', 'let', 'each', 'true', 'false', 'undef', 'include', 'use', 'assign', 'intersection_for',
  'PI',
  ...Object.keys(FUNCTIONS),
]);

/** Nome valido come variabile OpenSCAD: lettere ASCII, cifre e trattino basso, senza cominciare per cifra. */
export function validName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name);
}

/** Spiegazione in italiano del perché un nome non va bene (null se va bene). */
export function nameProblem(name: string): string | null {
  if (name === '') return 'Il nome è vuoto';
  if (RESERVED.has(name)) return `«${name}» è una parola riservata`;
  if (/[^\x00-\x7F]/.test(name)) return 'Il nome non può avere lettere accentate (OpenSCAD le rifiuta): scrivi per esempio «profondita»';
  if (!validName(name)) return 'Il nome può avere solo lettere, cifre e trattino basso, e non iniziare con una cifra';
  return null;
}

/** Variabili usate da una formula, senza ripetizioni (PI è una costante, non una variabile). */
export function identifiersOf(e: Expr): string[] {
  const found = new Set<string>();
  const walk = (x: Expr): void => {
    switch (x.t) {
      case 'id': if (x.name !== 'PI') found.add(x.name); return;
      case 'un': return walk(x.e);
      case 'bin': walk(x.l); return walk(x.r);
      case 'tern': walk(x.c); walk(x.a); return walk(x.b);
      case 'call': return x.args.forEach((a) => walk(a.e));
      default: return;
    }
  };
  walk(e);
  return [...found];
}

/** Valuta un'espressione a un numero (le condizioni valgono 1 o 0). Lancia un Error in italiano se non si può. */
function evalExpr(e: Expr, vars: Readonly<Record<string, number>>): number {
  switch (e.t) {
    case 'num': return e.v;
    case 'bool': return e.v ? 1 : 0;
    case 'id': {
      if (e.name === 'PI') return Math.PI;
      if (!(e.name in vars)) throw new Error(`Parametro sconosciuto: ${e.name}`);
      return vars[e.name];
    }
    case 'un': {
      const v = evalExpr(e.e, vars);
      return e.op === '-' ? -v : e.op === '!' ? Number(v === 0) : v;
    }
    case 'bin': {
      // && e || valutano il secondo operando solo se serve, come in OpenSCAD
      if (e.op === '&&') return Number(evalExpr(e.l, vars) !== 0 && evalExpr(e.r, vars) !== 0);
      if (e.op === '||') return Number(evalExpr(e.l, vars) !== 0 || evalExpr(e.r, vars) !== 0);
      const [a, b] = [evalExpr(e.l, vars), evalExpr(e.r, vars)];
      switch (e.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
        case '^': return Math.pow(a, b);
        case '<': return Number(a < b);
        case '>': return Number(a > b);
        case '<=': return Number(a <= b);
        case '>=': return Number(a >= b);
        case '==': return Number(a === b);
        case '!=': return Number(a !== b);
      }
      throw new Error(`Operatore non supportato: ${e.op}`);
    }
    case 'tern': return evalExpr(e.c, vars) !== 0 ? evalExpr(e.a, vars) : evalExpr(e.b, vars);
    case 'call': {
      const fn = FUNCTIONS[e.name];
      if (!fn) throw new Error(`Funzione non supportata: ${e.name}()`);
      if (e.args.some((a) => a.name)) throw new Error(`${e.name}() non accetta argomenti con nome`);
      return fn(...e.args.map((a) => evalExpr(a.e, vars)));
    }
    default: throw new Error('Nelle formule si usano solo numeri, parametri, operatori e funzioni matematiche');
  }
}

export type FormulaResult = { ok: true; value: number } | { ok: false; error: string };

/** Valuta il testo di una formula con i valori dei parametri. Mai eccezioni: l'esito dice se è andata bene. */
export function evalFormula(text: string, values: Readonly<Record<string, number>>): FormulaResult {
  try {
    const value = evalExpr(parseExpression(text), values);
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: 'Il risultato non è un numero finito (divisione per zero?)' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Formula non valida' };
  }
}

/** Parametri usati da una formula (lista vuota se il testo non si legge: l'errore lo dà `evalFormula`). */
export function formulaDeps(text: string): string[] {
  try {
    return identifiersOf(parseExpression(text));
  } catch {
    return [];
  }
}

export interface ResolvedParams {
  /** Valore di ogni parametro calcolato con successo, per nome. */
  values: Record<string, number>;
  /** Messaggio d'errore per id del parametro (nome non valido o doppio, formula errata, riferimento mancante o circolare). */
  errors: Record<string, string>;
}

/** Calcola tutti i parametri in ordine di dipendenza, rilevando nomi doppi, riferimenti mancanti e cicli. */
export function resolveParams(params: readonly Param[] = []): ResolvedParams {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const byName = new Map<string, Param>();
  for (const p of params) {
    const problem = nameProblem(p.name) ?? (byName.has(p.name) ? `Esiste già un parametro «${p.name}»` : null);
    if (problem) errors[p.id] = problem;
    else byName.set(p.name, p);
  }

  // Visita in profondità: 'doing' individua i cicli, 'done' evita di ricalcolare
  const state = new Map<string, 'doing' | 'done'>();
  const visit = (p: Param): void => {
    if (state.get(p.id) === 'done') return;
    if (state.get(p.id) === 'doing') {
      errors[p.id] = 'Riferimento circolare';
      return;
    }
    state.set(p.id, 'doing');
    for (const dep of formulaDeps(p.expr)) {
      const target = byName.get(dep);
      if (target) visit(target);
    }
    state.set(p.id, 'done');
    // Chi è già in errore (anche per un ciclo scoperto durante la visita) non ha valore
    if (errors[p.id]) return;
    const result = evalFormula(p.expr, values);
    if (result.ok) values[p.name] = result.value;
    else errors[p.id] = result.error;
  };
  for (const p of byName.values()) visit(p);
  return { values, errors };
}

/** Sostituisce nel testo di una formula il parametro `from` con `to`, senza toccare numeri, funzioni o altri nomi. */
export function renameInExpr(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Non deve essere parte di un nome più lungo, di un numero (1e2), di un membro (v.x) o il nome di una funzione
  return text.replace(new RegExp(`(?<![A-Za-z0-9_$.])${escaped}(?![A-Za-z0-9_$]|\\s*\\()`, 'g'), to);
}

/** Legge o scrive un campo numerico di un nodo dal percorso puntato ("height", "size.0", "array.count"). */
export function getPath(node: unknown, path: string): number | undefined {
  let cur = node as Record<string, unknown> | undefined;
  for (const key of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[key] as Record<string, unknown> | undefined;
  return typeof cur === 'number' ? cur : undefined;
}

export function setPath(node: unknown, path: string, value: number): boolean {
  const keys = path.split('.');
  const last = keys.pop()!;
  let cur = node as Record<string, unknown>;
  for (const key of keys) {
    const next = cur?.[key];
    if (next === null || typeof next !== 'object') return false;
    cur = next as Record<string, unknown>;
  }
  // Un campo opzionale non ancora scritto (raggio Y, raccordo) si può legare: la formula lo crea
  if (cur?.[last] !== undefined && typeof cur[last] !== 'number') return false;
  cur[last] = value;
  return true;
}

/**
 * Patch di un nodo senza le modifiche ai campi legati a un parametro: quei campi tengono il valore che hanno (la formula
 * decide la misura, non il gizmo, le quote o il ridimensionamento proporzionale). `held` dice se qualche campo legato
 * doveva cambiare. La patch passata non si modifica.
 */
export function holdBound<P extends object>(node: { exprs?: Record<string, Binding> }, patch: P): { patch: P; held: boolean } {
  const paths = Object.keys(node.exprs ?? {});
  if (!paths.length) return { patch, held: false };
  const out = { ...patch } as Record<string, unknown>;
  let held = false;
  for (const path of paths) {
    const [top, ...rest] = path.split('.');
    if (!(top in out)) continue;
    const before = getPath(node, path);
    // Si lavora su una copia del campo della patch (vettore o oggetto) per non toccare l'originale
    if (rest.length) out[top] = structuredClone(out[top]);
    const probe = { [top]: out[top] };
    if (getPath(probe, path) === before) continue;
    held = true;
    if (before === undefined) {
      if (!rest.length) delete out[top];
    } else if (rest.length) setPath(probe, path, before);
    else out[top] = before;
  }
  return { patch: out as P, held };
}

/** Valore di un campo legato: risultato della formula, con i limiti del campo e i decimali del NumberField. */
export function boundValue(binding: Binding, values: Readonly<Record<string, number>>): FormulaResult {
  const result = evalFormula(binding.expr, values);
  if (!result.ok) return result;
  const clamped = Math.min(binding.max ?? Infinity, Math.max(binding.min ?? -Infinity, result.value));
  return { ok: true, value: binding.int ? Math.round(clamped) : round(clamped, 3) };
}

/**
 * Ricalcola i campi legati di tutti i nodi (anche dei piatti parcheggiati) e scrive i valori nella bozza della scena.
 * Un binding con formula errata lascia il valore com'è; uno con un percorso che non esiste più si elimina.
 */
export function applyBindings(scene: Scene): void {
  const { values } = resolveParams(scene.params);
  for (const node of Object.values(scene.nodes)) {
    if (!node.exprs) continue;
    for (const [path, binding] of Object.entries(node.exprs)) {
      const result = boundValue(binding, values);
      if (result.ok && !setPath(node, path, result.value)) delete node.exprs[path];
    }
    if (Object.keys(node.exprs).length === 0) delete node.exprs;
  }
}

/** Quanti campi usano ogni parametro (per nome), per avvisare prima di eliminarlo. */
export function usageCount(scene: Scene): Record<string, number> {
  const count: Record<string, number> = {};
  for (const node of Object.values(scene.nodes)) {
    for (const b of Object.values(node.exprs ?? {})) for (const dep of formulaDeps(b.expr)) count[dep] = (count[dep] ?? 0) + 1;
  }
  for (const p of scene.params ?? []) for (const dep of formulaDeps(p.expr)) count[dep] = (count[dep] ?? 0) + 1;
  return count;
}

/**
 * Copia della scena senza le formule che non si calcolano con i parametri validi (per il codice esportato: una formula con
 * un parametro rotto o mancante darebbe un file che OpenSCAD non legge). I nodi senza problemi restano gli stessi oggetti.
 */
export function dropBrokenBindings(scene: Scene, values: Readonly<Record<string, number>>): Scene {
  let nodes: Scene['nodes'] | null = null;
  for (const [id, node] of Object.entries(scene.nodes)) {
    const broken = Object.entries(node.exprs ?? {}).filter(([, b]) => !evalFormula(b.expr, values).ok);
    if (!broken.length) continue;
    const exprs = { ...node.exprs };
    for (const [path] of broken) delete exprs[path];
    nodes ??= { ...scene.nodes };
    nodes[id] = { ...node, exprs: Object.keys(exprs).length ? exprs : undefined } as typeof node;
  }
  return nodes ? { ...scene, nodes } : scene;
}
