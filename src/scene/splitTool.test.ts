import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from '../kernel/evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from './defaults';
import { buildSplit, canSplit } from './splitTool';
import type { GroupNode, PrimitiveNode, Scene, Vec3 } from './types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Cubo da 20 mm con il centro in (10, 0, 10): ingombro da 0 a 20 in X. */
const box = (extra: Partial<PrimitiveNode> = {}): PrimitiveNode => ({ ...primitiveDefaults('box'), id: 'b', name: 'Cubo', position: [10, 0, 10] as Vec3, ...extra }) as PrimitiveNode;
const sceneOf = (node: PrimitiveNode): Scene => ({ nodes: { [node.id]: node }, rootIds: [node.id] });
const BOUNDS = { min: [0, -10, 0] as Vec3, max: [20, 10, 20] as Vec3 };

const volumes = (scene: Scene) => new Evaluator(wasm).evaluate(scene).meshes.map((m) => ({ rootId: m.rootId, volume: m.volume, status: m.status }));

describe('Dividi con un piano', () => {
  it('cubo tagliato a X = 5: due gruppi Intersezione con i volumi 5·20·20 e 15·20·20, il taglio al posto giusto', () => {
    const result = buildSplit(sceneOf(box()), 'b', 0, 5, BOUNDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { scene, ids } = result;
    expect(scene.rootIds).toEqual(ids);
    for (const id of ids) {
      const g = scene.nodes[id] as GroupNode;
      expect(g.op).toBe('intersection');
      expect(g.children).toHaveLength(2);
      expect(scene.nodes[g.children[1]]).toMatchObject({ type: 'primitive', kind: 'box', name: expect.stringMatching(/^Taglio/) });
    }
    expect(scene.nodes[ids[0]].name).toBe('Cubo (1)');
    expect(scene.nodes[ids[1]].name).toBe('Cubo (2)');
    const v = volumes(scene);
    expect(v.every((m) => m.status === 'NoError')).toBe(true);
    expect(v.find((m) => m.rootId === ids[0])!.volume).toBeCloseTo(5 * 20 * 20, 3);
    expect(v.find((m) => m.rootId === ids[1])!.volume).toBeCloseTo(15 * 20 * 20, 3);
    // Il codice è un'intersezione con un cube per metà
    const code = sceneToOpenScad(scene);
    expect(code.split('intersection() {').length - 1).toBe(2);
    expect(code).toContain('cube([40, 40, 40], center = true);');
  });

  it('con il pezzo ruotato il cubo di taglio sta nel sistema del gruppo e il piano resta quello del mondo', () => {
    // Cubo ruotato di 45° attorno a Z: l'ingombro in X va da 10 − 14,14 a 10 + 14,14
    const r = Math.SQRT2 * 10;
    const bounds = { min: [10 - r, -r, 0] as Vec3, max: [10 + r, r, 20] as Vec3 };
    const result = buildSplit(sceneOf(box({ rotation: [0, 0, 45] })), 'b', 0, 10, bounds);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const v = volumes(result.scene);
    // Il piano passa dal centro: due metà uguali (posizione del taglio arrotondata a 4 decimali: scarto sotto 0,1 mm³)
    expect(v[0].volume).toBeCloseTo(4000, 1);
    expect(v[1].volume).toBeCloseTo(4000, 1);
    const cutter = result.scene.nodes[(result.scene.nodes[result.ids[0]] as GroupNode).children[1]] as PrimitiveNode;
    // Nel sistema del gruppo (ruotato di 45°) il cubo è ruotato di −45°
    expect(cutter.rotation[2]).toBeCloseTo(-45, 3);
  });

  it('piano fuori dall\'ingombro, oggetto bloccato, foro: errore e scena intatta', () => {
    const scene = sceneOf(box());
    expect(buildSplit(scene, 'b', 0, 25, BOUNDS)).toMatchObject({ ok: false, error: expect.stringContaining('non taglia') });
    expect(buildSplit(scene, 'b', 0, 0.05, BOUNDS).ok).toBe(false);
    expect(buildSplit(sceneOf(box({ locked: true })), 'b', 0, 5, BOUNDS)).toMatchObject({ ok: false, error: expect.stringContaining('bloccato') });
    expect(buildSplit(sceneOf(box({ mode: 'hole' })), 'b', 0, 5, BOUNDS).ok).toBe(false);
    expect(buildSplit(scene, 'x', 0, 5, BOUNDS).ok).toBe(false);
    expect(scene.rootIds).toEqual(['b']);
  });

  describe('piano inclinato', () => {
    const sortedVolumes = (scene: Scene) => volumes(scene).map((m) => m.volume).sort((a, b) => a - b);

    it('con angolo 0 il taglio è identico a quello senza inclinazione', () => {
      const plain = buildSplit(sceneOf(box()), 'b', 0, 5, BOUNDS);
      const flat = buildSplit(sceneOf(box()), 'b', 0, 5, BOUNDS, { axis: 1, angle: 0 });
      expect(plain.ok && flat.ok).toBe(true);
      if (!plain.ok || !flat.ok) return;
      const shape = (r: typeof plain) => r.ids.map((id) => {
        const cutter = r.scene.nodes[(r.scene.nodes[id] as GroupNode).children[1]] as PrimitiveNode;
        // Tutto il cubo di taglio tranne id e nome (casuali)
        const { id: _id, name: _name, ...rest } = cutter;
        return rest;
      });
      expect(shape(flat)).toEqual(shape(plain));
    });

    it('45° attorno a Y con il piano Z a 5 mm: il piano passa dal punto di taglio e le metà sono 2250 e 5750 mm³', () => {
      // Piano z = x − 5 (passa da (10, 0, 5) con pendenza 45°): sotto il piano resta un prisma di base 15 × 15 / 2 e lunghezza 20
      const result = buildSplit(sceneOf(box()), 'b', 2, 5, BOUNDS, { axis: 1, angle: 45 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const v = volumes(result.scene);
      expect(v.every((m) => m.status === 'NoError')).toBe(true);
      const [small, big] = sortedVolumes(result.scene);
      expect(small).toBeCloseTo(2250, 1);
      expect(big).toBeCloseTo(5750, 1);
      // Le due metà insieme sono il cubo intero
      expect(small + big).toBeCloseTo(8000, 1);
      // Il cubo di taglio è ruotato di 45° attorno a Y, e nel codice compare rotate
      const cutter = result.scene.nodes[(result.scene.nodes[result.ids[0]] as GroupNode).children[1]] as PrimitiveNode;
      expect(cutter.rotation[0]).toBeCloseTo(0, 6);
      expect(cutter.rotation[1]).toBeCloseTo(45, 6);
      expect(cutter.rotation[2]).toBeCloseTo(0, 6);
      expect(sceneToOpenScad(result.scene)).toContain('rotate([0, 45, 0])');
    });

    it('il verso dell\'angolo non cambia le metà quando il piano è al centro: 45° e −45° dal centro danno 4000 + 4000', () => {
      for (const angle of [45, -45, 30]) {
        const result = buildSplit(sceneOf(box()), 'b', 2, 10, BOUNDS, { axis: 0, angle });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const [a, b] = sortedVolumes(result.scene);
        expect(a).toBeCloseTo(4000, 1);
        expect(b).toBeCloseTo(4000, 1);
      }
    });

    it('90° è come un piano perpendicolare all\'altro asse: Z inclinato di 90° attorno a Y taglia in X', () => {
      const result = buildSplit(sceneOf(box()), 'b', 2, 10, BOUNDS, { axis: 1, angle: 90 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Passa dal centro (10, 0, 10): due metà da 4000 mm³
      const [a, b] = sortedVolumes(result.scene);
      expect(a).toBeCloseTo(4000, 1);
      expect(b).toBeCloseTo(4000, 1);
    });

    it('con il pezzo ruotato e il piano inclinato le metà conservano il volume', () => {
      const r = Math.SQRT2 * 10;
      const bounds = { min: [10 - r, -r, 0] as Vec3, max: [10 + r, r, 20] as Vec3 };
      const result = buildSplit(sceneOf(box({ rotation: [0, 0, 45] })), 'b', 0, 8, bounds, { axis: 2, angle: 30 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [a, b] = sortedVolumes(result.scene);
      expect(a + b).toBeCloseTo(8000, 0);
      expect(a).toBeGreaterThan(100);
    });

    it('l\'asse di inclinazione uguale a quello del piano è un errore (se l\'angolo non è 0)', () => {
      expect(buildSplit(sceneOf(box()), 'b', 0, 5, BOUNDS, { axis: 0, angle: 45 })).toMatchObject({ ok: false, error: expect.stringContaining('asse diverso') });
      expect(buildSplit(sceneOf(box()), 'b', 0, 5, BOUNDS, { axis: 0, angle: 0 }).ok).toBe(true);
    });
  });

  it('canSplit: un solo oggetto alla radice, solido e non bloccato', () => {
    expect(canSplit(sceneOf(box()), ['b'])).toBe(true);
    expect(canSplit(sceneOf(box({ locked: true })), ['b'])).toBe(false);
    expect(canSplit(sceneOf(box({ mode: 'hole' })), ['b'])).toBe(false);
    expect(canSplit(sceneOf(box()), [])).toBe(false);
    expect(canSplit(sceneOf(box()), ['b', 'b'])).toBe(false);
  });
});
