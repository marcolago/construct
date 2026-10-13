import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import type { GroupNode, PrimitiveNode, Scene } from '../scene/types';
import { primitiveDefaults } from '../scene/defaults';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const box = (id: string, size: [number, number, number], position: [number, number, number]): PrimitiveNode =>
  ({ ...primitiveDefaults('box'), id, name: id, size, position }) as PrimitiveNode;

const group = (id: string, children: string[], op: GroupNode['op'] = 'union'): GroupNode => ({
  id, name: id, type: 'group', op, children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#fff',
});

const sceneOf = (nodes: (PrimitiveNode | GroupNode)[], rootIds: string[]): Scene => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds });

/** Scatole delle zone sottili come terne [min, max] raggruppate. */
const boxesOf = (boxes: number[]) => Array.from({ length: boxes.length / 6 }, (_, i) => boxes.slice(i * 6, i * 6 + 6));

describe('Evaluator.analyze: pareti sottili', () => {
  it('un blocco pieno non ha pareti sottili', () => {
    const r = new Evaluator(wasm).analyze(sceneOf([box('a', [20, 20, 20], [0, 0, 10])], ['a']), { minWall: 0.8 });
    expect(r.thin).toEqual([]);
    expect(r.partial).toBe(false);
  });

  it('una lastra spessa 0,4 mm in X è una parete sottile, e le scatole stanno sulla lastra', () => {
    // Lastra 0,4 x 20 x 20 appoggiata sul piano: la sezione Z (e quella Y) la vedono stretta, quella X no
    const ev = new Evaluator(wasm);
    const r = ev.analyze(sceneOf([box('lastra', [0.4, 20, 20], [0, 0, 10])], ['lastra']), { minWall: 0.8 });
    expect(r.thin).toHaveLength(1);
    const t = r.thin[0];
    expect(t.rootId).toBe('lastra');
    expect(t.slices).toBeGreaterThan(0);
    // Tutte le scatole stanno dentro la lastra (con il passo di sezione di tolleranza su X e Z)
    for (const [x0, y0, z0, x1, y1, z1] of boxesOf(t.boxes)) {
      expect(x0).toBeGreaterThanOrEqual(-0.2 - 1);
      expect(x1).toBeLessThanOrEqual(0.2 + 1);
      expect(y0).toBeGreaterThanOrEqual(-10 - 1e-3);
      expect(y1).toBeLessThanOrEqual(10 + 1e-3);
      expect(z0).toBeGreaterThanOrEqual(-1);
      expect(z1).toBeLessThanOrEqual(21);
    }
    expect(t.zMin).toBeGreaterThanOrEqual(-1);
    expect(t.zMax).toBeLessThanOrEqual(21);
  });

  it('una lastra sottile in Z (un fondo di 0,4 mm) si vede dalle sezioni sugli altri assi, con la quota giusta', () => {
    const r = new Evaluator(wasm).analyze(sceneOf([box('fondo', [30, 30, 0.4], [0, 0, 0.2])], ['fondo']), { minWall: 0.8 });
    expect(r.thin).toHaveLength(1);
    // La zona sottile sta alla quota del fondo (0 - 0,4 mm), non altrove
    expect(r.thin[0].zMin).toBeGreaterThanOrEqual(-1e-3);
    expect(r.thin[0].zMax).toBeLessThanOrEqual(0.4 + 1e-3);
  });

  it('una parete spessa quanto il minimo va bene, una più sottile no', () => {
    const ok = new Evaluator(wasm).analyze(sceneOf([box('a', [0.8, 20, 20], [0, 0, 10])], ['a']), { minWall: 0.8 });
    expect(ok.thin).toEqual([]);
    const thin = new Evaluator(wasm).analyze(sceneOf([box('a', [0.6, 20, 20], [0, 0, 10])], ['a']), { minWall: 0.8 });
    expect(thin.thin).toHaveLength(1);
  });

  it('una scatola con pareti di 2 mm e una con pareti di 0,5 mm (guscio): solo la seconda è segnalata', () => {
    const shelled = (wall: number) => {
      const base = box('b', [30, 30, 30], [0, 0, 15]);
      const g = { ...group('g', ['b'], 'shell'), shell: { wall, bottom: wall } } as GroupNode;
      return sceneOf([base, g], ['g']);
    };
    expect(new Evaluator(wasm).analyze(shelled(2), { minWall: 0.8 }).thin).toEqual([]);
    const r = new Evaluator(wasm).analyze(shelled(0.5), { minWall: 0.8 });
    expect(r.thin).toHaveLength(1);
    expect(r.thin[0].rootId).toBe('g');
  });

  it('ricorda l\'esito per un oggetto non modificato e lo ricalcola quando cambia', () => {
    const ev = new Evaluator(wasm);
    const spy = { calls: 0 };
    const visit = (ev as unknown as { visit: (...a: unknown[]) => void }).visit.bind(ev);
    (ev as unknown as { visit: (...a: unknown[]) => void }).visit = (...a: unknown[]) => {
      spy.calls++;
      visit(...a);
    };
    const scene = sceneOf([box('a', [0.4, 20, 20], [0, 0, 10])], ['a']);
    ev.analyze(scene, { minWall: 0.8 });
    ev.analyze(scene, { minWall: 0.8 });
    expect(spy.calls).toBe(1);
    ev.analyze(scene, { minWall: 0.6 });
    expect(spy.calls).toBe(2);
  });
});

describe('Evaluator.analyze: parti staccate', () => {
  it('un pezzo sospeso in un oggetto altrimenti appoggiato è segnalato; uno sopra la base no', () => {
    // Base sul piano e, nello stesso Raggruppa, un cubetto a mezz'aria
    const floating = sceneOf([box('base', [20, 20, 10], [0, 0, 5]), box('aria', [5, 5, 5], [0, 0, 30]), group('g', ['base', 'aria'], 'group')], ['g']);
    const r = new Evaluator(wasm).analyze(floating, { minWall: 0.8 });
    expect(r.detached).toEqual([{ rootId: 'g', count: 1, lowestZ: 27.5 }]);

    // Lo stesso cubetto appoggiato sopra la base è sostenuto
    const stacked = sceneOf([box('base', [20, 20, 10], [0, 0, 5]), box('sopra', [5, 5, 5], [0, 0, 12.5]), group('g', ['base', 'sopra'], 'group')], ['g']);
    expect(new Evaluator(wasm).analyze(stacked, { minWall: 0.8 }).detached).toEqual([]);
  });

  it('un oggetto intero sollevato non è una "parte staccata": se ne occupa il controllo del sospeso', () => {
    const r = new Evaluator(wasm).analyze(sceneOf([box('a', [10, 10, 10], [0, 0, 30])], ['a']), { minWall: 0.8 });
    expect(r.detached).toEqual([]);
  });
});
