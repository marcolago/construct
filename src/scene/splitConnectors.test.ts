import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from '../kernel/evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from './defaults';
import { buildSplit, connectorError, connectorLayout, connectorPrimitive, DEFAULT_CONNECTORS } from './splitTool';
import type { ConnectorOptions } from './splitTool';
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

/** Area di un poligono regolare a 48 lati inscritto in un cerchio di raggio r: quella dei cilindri dei connettori. */
const disc = (r: number) => 0.5 * 48 * r * r * Math.sin((2 * Math.PI) / 48);

const conn = (extra: Partial<ConnectorOptions>): ConnectorOptions => ({ ...DEFAULT_CONNECTORS, count: 1, ...extra });

/** Volume di ogni radice, nell'ordine di `rootIds`. */
const rootVolumes = (scene: Scene) => {
  const all = volumes(scene);
  return scene.rootIds.map((id) => all.find((m) => m.rootId === id)!.volume);
};

describe('Dividi con i connettori', () => {
  it('tipo Nessuno: la scena è quella di prima (due intersezioni, nessuna spina)', () => {
    const plain = buildSplit(sceneOf(box()), 'b', 0, 10, BOUNDS);
    const none = buildSplit(sceneOf(box()), 'b', 0, 10, BOUNDS, undefined, conn({ type: 'none' }));
    expect(plain.ok && none.ok).toBe(true);
    if (!plain.ok || !none.ok) return;
    expect(Object.keys(none.scene.nodes)).toHaveLength(Object.keys(plain.scene.nodes).length);
    expect(none.dowelsId).toBeUndefined();
    expect((none.scene.nodes[none.ids[0]] as GroupNode).op).toBe('intersection');
  });

  it('Perno tondo (5 mm, profondità 6, gioco 0,2): il perno sporge dalla prima metà e la sede scava la seconda', () => {
    const result = buildSplit(sceneOf(box()), 'b', 0, 10, BOUNDS, undefined, conn({ type: 'peg' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { scene, ids } = result;
    expect(scene.rootIds).toEqual(ids);
    const [first, second] = ids.map((id) => scene.nodes[id] as GroupNode);
    expect(first.op).toBe('union');
    // Prima metà: intersezione e perno; seconda: intersezione e sede (un foro)
    expect(first.children.map((c) => scene.nodes[c].name)).toEqual(['Cubo (1) taglio', 'Perno 1']);
    expect(second.children.map((c) => [scene.nodes[c].name, scene.nodes[c].mode])).toEqual([
      ['Cubo (2) taglio', 'solid'],
      ['Sede 1', 'hole'],
    ]);
    expect(volumes(scene).every((m) => m.status === 'NoError')).toBe(true);
    const [v1, v2] = rootVolumes(scene);
    // Il perno sporge 6 mm oltre il piano; la sede è larga 5,4 mm e profonda 6,2 mm nella seconda metà
    expect(v1).toBeCloseTo(4000 + disc(2.5) * 6, 1);
    expect(v2).toBeCloseTo(4000 - disc(2.7) * 6.2, 1);
  });

  it('Perno sulla seconda metà: i volumi si scambiano', () => {
    const result = buildSplit(sceneOf(box()), 'b', 0, 10, BOUNDS, undefined, conn({ type: 'peg', pegHalf: 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [v1, v2] = rootVolumes(result.scene);
    expect(v1).toBeCloseTo(4000 - disc(2.7) * 6.2, 1);
    expect(v2).toBeCloseTo(4000 + disc(2.5) * 6, 1);
  });

  it('Perno quadrato: sporge un prisma di 5 × 5 × 6 e la sede è 5,4 × 5,4 × 6,2', () => {
    const result = buildSplit(sceneOf(box()), 'b', 0, 10, BOUNDS, undefined, conn({ type: 'peg', shape: 'square' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [v1, v2] = rootVolumes(result.scene);
    expect(v1).toBeCloseTo(4000 + 25 * 6, 1);
    expect(v2).toBeCloseTo(4000 - 5.4 * 5.4 * 6.2, 1);
    expect(sceneToOpenScad(result.scene)).toContain('cube([5, 5, 6.5], center = true);');
  });

  it('Spine: un foro per metà e una radice "Spine" con le spine sdraiate sul piatto', () => {
    const result = buildSplit(sceneOf(box()), 'b', 0, 10, BOUNDS, undefined, conn({ type: 'dowel', shape: 'square', count: 2, spacing: 8 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { scene, ids, dowelsId } = result;
    expect(dowelsId).toBeDefined();
    expect(scene.rootIds).toEqual([...ids, dowelsId]);
    const [v1, v2, vd] = rootVolumes(scene);
    // Due fori da 5,4 × 5,4 × 6,2 per metà
    expect(v1).toBeCloseTo(4000 - 2 * 5.4 * 5.4 * 6.2, 1);
    expect(v2).toBeCloseTo(4000 - 2 * 5.4 * 5.4 * 6.2, 1);
    // Le due spine sono due cubi 5 × 5 × 12 separati (una mesh ciascuna: il volume della radice è quello dell'ultima)
    expect(vd).toBeCloseTo(5 * 5 * 12, 3);
    const dowels = scene.nodes[dowelsId!] as GroupNode;
    expect(dowels.children).toHaveLength(2);
    for (const id of dowels.children) {
      const d = scene.nodes[id] as PrimitiveNode;
      expect(d).toMatchObject({ kind: 'box', size: [5, 5, 12], rotation: [0, 90, 0] });
      // Sdraiate sul piatto, oltre l'ingombro del pezzo
      expect(d.position[2]).toBeCloseTo(2.5, 6);
      expect(d.position[0]).toBeGreaterThan(BOUNDS.max[0]);
    }
  });

  it('i connettori della fila: tre in fila lungo Y a 8 mm, centro spostato di 2 mm in Z', () => {
    const slots = connectorLayout(0, 10, BOUNDS, undefined, conn({ type: 'peg', count: 3, spacing: 8, shiftB: 2 }));
    expect(slots).toHaveLength(3);
    // Centro del perno: metà tra −0,5 e 6 lungo X dal piano a x = 10, Y in fila, Z = 10 + 2
    expect(slots.map((s) => s.pin!.part.center)).toEqual([
      [12.75, -8, 12],
      [12.75, 0, 12],
      [12.75, 8, 12],
    ]);
    // Fila lungo Z (secondo asse del piano) con lo spostamento A sull'altro
    const alongZ = connectorLayout(0, 10, BOUNDS, undefined, conn({ type: 'peg', count: 2, spacing: 6, row: 2, shiftA: 1 }));
    expect(alongZ.map((s) => s.pin!.part.center.slice(1))).toEqual([
      [1, 7],
      [1, 13],
    ]);
  });

  it('piano inclinato di 45° attorno a Y: il perno è perpendicolare al piano e sta dentro il pezzo', () => {
    const o = conn({ type: 'peg' });
    const slots = connectorLayout(2, 10, BOUNDS, { axis: 1, angle: 45 }, o);
    const part = slots[0].pin!.part;
    expect(part.rotation[1]).toBeCloseTo(45, 3);
    // Centro a 2,75 mm dal punto di taglio lungo la normale (sin 45°, 0, cos 45°)
    const d = 2.75 * Math.SQRT1_2;
    expect(part.center[0]).toBeCloseTo(10 + d, 3);
    expect(part.center[2]).toBeCloseTo(10 + d, 3);
    const result = buildSplit(sceneOf(box()), 'b', 2, 10, BOUNDS, { axis: 1, angle: 45 }, o);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [v1, v2] = rootVolumes(result.scene);
    // Il piano passa dal centro: due metà da 4000 mm³, una con il perno e l'altra con la sede
    expect(v1).toBeCloseTo(4000 + disc(2.5) * 6, 0);
    expect(v2).toBeCloseTo(4000 - disc(2.7) * 6.2, 0);
  });

  it('con il pezzo ruotato i connettori restano dove dice il mondo', () => {
    const r = Math.SQRT2 * 10;
    const bounds = { min: [10 - r, -r, 0] as Vec3, max: [10 + r, r, 20] as Vec3 };
    const result = buildSplit(sceneOf(box({ rotation: [0, 0, 45] })), 'b', 0, 10, bounds, undefined, conn({ type: 'peg', count: 2, spacing: 10 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [v1, v2] = rootVolumes(result.scene);
    expect(v1).toBeCloseTo(4000 + 2 * disc(2.5) * 6, 0);
    expect(v2).toBeCloseTo(4000 - 2 * disc(2.7) * 6.2, 0);
  });

  it('il codice OpenSCAD ha la differenza con le sedi e i cilindri', () => {
    const result = buildSplit(sceneOf(box()), 'b', 0, 10, BOUNDS, undefined, conn({ type: 'peg' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const code = sceneToOpenScad(result.scene);
    expect(code).toContain('difference() {');
    expect(code).toContain('cylinder(');
    expect(code).toContain('// Sede 1 (foro)');
  });

  it('misure non valide: errore e scena intatta', () => {
    const scene = sceneOf(box());
    expect(buildSplit(scene, 'b', 0, 10, BOUNDS, undefined, conn({ type: 'peg', size: 0 })).ok).toBe(false);
    expect(buildSplit(scene, 'b', 0, 10, BOUNDS, undefined, conn({ type: 'peg', tolerance: -1 })).ok).toBe(false);
    expect(buildSplit(scene, 'b', 0, 10, BOUNDS, undefined, conn({ type: 'peg', count: 3, spacing: 0 })).ok).toBe(false);
    // La fila non può correre lungo l'asse del piano
    expect(connectorError(0, conn({ type: 'peg', row: 0 }))).toContain('asse del piano');
    expect(connectorError(0, conn({ type: 'peg', row: 2 }))).toBeNull();
    expect(scene.rootIds).toEqual(['b']);
  });
});

describe('Controllo dei connettori nel kernel (fitInside)', () => {
  /** Frazione dentro il cubo di ogni connettore, con l'ingombro di perno e sede (`fit`) come parte da controllare. */
  const fits = (axis: 0 | 1 | 2, offset: number, o: ConnectorOptions) => {
    const parts = connectorLayout(axis, offset, BOUNDS, undefined, o).map((slot) => connectorPrimitive(o.shape, slot.fit, 'fit', 'solid', '#fff'));
    return new Evaluator(wasm).fitInside(sceneOf(box()), 'b', parts);
  };

  it('un connettore tutto dentro vale 1', () => {
    expect(fits(0, 10, conn({ type: 'peg' }))[0]).toBeCloseTo(1, 6);
    expect(fits(0, 10, conn({ type: 'dowel', shape: 'square', count: 2, spacing: 8 }))).toEqual([expect.closeTo(1, 6), expect.closeTo(1, 6)]);
  });

  it('un connettore con il centro sul bordo del pezzo vale circa metà', () => {
    // Fila spostata di 10 mm in Y: il centro sta sulla faccia Y = 10
    expect(fits(0, 10, conn({ type: 'peg', shiftA: 10 }))[0]).toBeCloseTo(0.5, 2);
  });

  it('un connettore che sporge dal fondo vale meno di 1, ma non zero', () => {
    // Piano a x = 17: la sede arriva a 17 + 6,2 = 23,2 mm, oltre la faccia a 20
    const ratio = fits(0, 17, conn({ type: 'peg' }))[0];
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.99);
  });

  it('un connettore del tutto fuori vale 0', () => {
    expect(fits(0, 10, conn({ type: 'peg', shiftA: 30 }))[0]).toBe(0);
  });
});
