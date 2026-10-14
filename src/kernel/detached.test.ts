import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { primitiveDefaults } from '../scene/defaults';
import { meshBounds, visibleParts } from '../viewport/snapshot';
import type { PrimitiveNode, Scene } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Una scena con un cubo di lato `side` e un cilindro, per avere più voci in cache. */
function sceneOf(side: number): Scene {
  const box = { ...primitiveDefaults('box'), id: 'b', name: 'Cubo', position: [0, 0, 0], size: [side, side, side] } as PrimitiveNode;
  const cyl = { ...primitiveDefaults('cylinder'), id: 'c', name: 'Cilindro', position: [50, 0, 0], radius: side / 4, height: side } as PrimitiveNode;
  return { nodes: { b: box, c: cyl }, rootIds: ['b', 'c'] };
}

/** Chiavi della cache del kernel (campo privato: qui interessa solo che non cambi). */
const cacheKeys = (ev: Evaluator) => [...(ev as unknown as { cache: Map<string, unknown> }).cache.keys()].sort();

describe('valutazione staccata (miniature della timeline)', () => {
  it('calcola le mesh di un\'altra scena e lascia la cache della scena in vista com\'era', () => {
    const ev = new Evaluator(wasm);
    ev.evaluate(sceneOf(10));
    const before = cacheKeys(ev);
    expect(before.length).toBeGreaterThan(0);

    const other = ev.evaluateDetached(sceneOf(30));
    // Volume del cubo di lato 30 (il primo oggetto)
    expect(other.meshes[0].volume).toBeCloseTo(30 ** 3, 3);
    expect(cacheKeys(ev)).toEqual(before);

    // La scena in vista si ricalcola dalla cache senza problemi
    expect(ev.evaluate(sceneOf(10)).meshes[0].volume).toBeCloseTo(10 ** 3, 3);
    expect(cacheKeys(ev)).toEqual(before);
  });

  it('con la cache vuota non lascia nulla dopo la valutazione', () => {
    const ev = new Evaluator(wasm);
    ev.evaluateDetached(sceneOf(10));
    expect(cacheKeys(ev)).toEqual([]);
  });
});

describe('mesh da fotografare', () => {
  it('visibleParts salta gli oggetti nascosti e i fori; meshBounds unisce gli ingombri', () => {
    const ev = new Evaluator(wasm);
    const scene = sceneOf(10);
    const { meshes } = ev.evaluate(scene);
    expect(visibleParts(scene, meshes)).toHaveLength(2);
    const hidden: Scene = { ...scene, nodes: { ...scene.nodes, c: { ...scene.nodes.c, hidden: true } } };
    expect(visibleParts(hidden, meshes).map((m) => m.id)).toEqual(['b']);
    // Un foro alla radice è una mesh con `isHole` (lo decide il kernel): non si fotografa
    const holeScene: Scene = { ...scene, nodes: { ...scene.nodes, b: { ...scene.nodes.b, mode: 'hole' } } };
    expect(visibleParts(holeScene, ev.evaluate(holeScene).meshes).map((m) => m.id)).toEqual(['c']);

    // Cubo di lato 10 in [-5, 5] e cilindro di raggio 2,5 a x = 50: l'ingombro va da −5 a 52,5
    const bounds = meshBounds(visibleParts(scene, meshes))!;
    expect(bounds.min[0]).toBeCloseTo(-5, 3);
    expect(bounds.max[0]).toBeCloseTo(52.5, 3);
    expect(meshBounds([])).toBeNull();
  });
});
