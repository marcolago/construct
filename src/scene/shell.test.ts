import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from '../kernel/evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults, shape2dDefaults } from './defaults';
import { edgeProfile } from './edgeProfile';
import { cavityOf, localBounds, openName, openSide, SHELL_OPEN_MARGIN, shellQuality, snapOpenDirection } from './shell';
import { buildShell } from './shellTool';
import type { GroupNode, PrimitiveNode, ProfileKind, Scene, SceneNode, Shape2DNode, Vec3 } from './types';
import { PROFILE_KINDS, profileArea, type ProfileShape } from './profiles';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const prim = (kind: PrimitiveNode['kind'], extra: Record<string, unknown> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults(kind), id: 'p', name: 'p', position: [0, 0, 0], ...extra }) as PrimitiveNode;
const sceneOf = (nodes: SceneNode[], rootIds: string[]): Scene => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds });
/** Cavità di un solido da solo nella scena (la scena serve a scendere nei figli dei gruppi). */
const cavityFor = (node: SceneNode, shell: Parameters<typeof cavityOf>[2]) => cavityOf(sceneOf([node], [node.id]), node, shell);

/** Volume (mm³) del primo oggetto della scena. */
const volumeOf = (scene: Scene) => new Evaluator(wasm).evaluate(scene).meshes[0].volume;

/** Applica il Guscio al nodo `p` e restituisce la scena risultante. */
function shelled(node: SceneNode, wall: number, bottom: number): Scene {
  const result = buildShell(sceneOf([node], [node.id]), node.id, { wall, bottom });
  if (!result.ok) throw new Error(result.error);
  return result.scene;
}

describe('cavità esatta', () => {
  it('cubo: il volume è esterno meno interno (pareti e fondo, cima aperta)', () => {
    // Cubo 20 mm, parete 2, fondo 3: la cavità è 16 × 16 × 17 (da 3 mm dal fondo fino alla cima)
    const scene = shelled(prim('box'), 2, 3);
    expect(volumeOf(scene)).toBeCloseTo(20 ** 3 - 16 * 16 * 17, 3);
  });

  it('cubo con spigoli arrotondati: il raggio interno cala dello spessore', () => {
    const cavity = cavityFor(prim('box', { cornerRadius: 5 }), { wall: 2, bottom: 2 });
    expect(cavity.kind).toBe('exact');
    if (cavity.kind === 'exact') expect((cavity.node as Extract<PrimitiveNode, { kind: 'box' }>).cornerRadius).toBe(3);
  });

  it('cilindro tondo: stessa sottrazione di un cilindro con raggio ridotto', () => {
    const cyl = prim('cylinder', { radius: 10, height: 20, segments: 256 });
    const volume = volumeOf(shelled(cyl, 2, 2));
    // Poligono a 256 lati: l'area è n/2·r²·sin(2π/n); la cavità ha raggio 10 − 2/cos(π/256)
    const area = (r: number) => (256 / 2) * r * r * Math.sin((2 * Math.PI) / 256);
    const inner = 10 - 2 / Math.cos(Math.PI / 256);
    expect(volume).toBeCloseTo(area(10) * 20 - area(inner) * 18, 1);
  });

  it('cilindro esagonale: lo spessore è misurato sulle facce piane (apotema)', () => {
    const hex = prim('cylinder', { radius: 10, height: 20, segments: 6 });
    const cavity = cavityFor(hex, { wall: 1, bottom: 1 });
    expect(cavity.kind).toBe('exact');
    if (cavity.kind !== 'exact') return;
    const inner = (cavity.node as Extract<PrimitiveNode, { kind: 'cylinder' }>).radius;
    // Apotema esterna 10·cos30°; l'interna deve essere più piccola esattamente di 1 mm
    expect(10 * Math.cos(Math.PI / 6) - inner * Math.cos(Math.PI / 6)).toBeCloseTo(1, 9);
  });

  it('cono: lo spessore è perpendicolare alla parete inclinata', () => {
    const cone = prim('cone', { radiusBottom: 10, radiusTop: 5, height: 20, segments: 256 });
    const cavity = cavityFor(cone, { wall: 1, bottom: 0 });
    expect(cavity.kind).toBe('exact');
    if (cavity.kind !== 'exact') return;
    const node = cavity.node as Extract<PrimitiveNode, { kind: 'cone' }>;
    // Pendenza 5/20: la distanza radiale tra le due pareti vale 1·√(1 + 0,25²) / cos(π/256)
    const dr = Math.sqrt(1 + 0.25 ** 2) / Math.cos(Math.PI / 256);
    expect(node.radiusBottom).toBeCloseTo(10 - dr, 6);
  });

  it('cono a punta: la cavità si ferma dove si annulla, la punta resta chiusa', () => {
    const cone = prim('cone', { radiusBottom: 10, radiusTop: 0, height: 20, segments: 64 });
    const result = new Evaluator(wasm).evaluate(shelled(cone, 1, 1)).meshes[0];
    // Il volume è tra quello del cono pieno e quello del guscio puro, e la mesh è valida
    expect(result.status).toBe('NoError');
    expect(result.volume).toBeGreaterThan(0);
    expect(result.volume).toBeLessThan((Math.PI * 100 * 20) / 3);
  });

  it('forma 2D dritta: quadrato estruso come il cubo, con angoli arrotondati ridotti', () => {
    const square = { ...shape2dDefaults('square'), id: 'p', name: 'p', position: [0, 0, 0] as Vec3, width: 20, depth: 20, cornerRadius: 4, height: 10 } as Shape2DNode;
    const cavity = cavityFor(square, { wall: 1, bottom: 1 });
    expect(cavity.kind).toBe('exact');
    if (cavity.kind !== 'exact') return;
    const node = cavity.node as Extract<Shape2DNode, { kind: 'square' }>;
    expect([node.width, node.depth, node.cornerRadius]).toEqual([18, 18, 3]);
  });
});

describe('Guscio sui profilati: cavità esatta', () => {
  const profile = (kind: ProfileKind, patch: Record<string, unknown> = {}): Shape2DNode =>
    ({ ...shape2dDefaults(kind), id: 'p', name: 'p', position: [0, 0, 20] as Vec3, ...patch }) as Shape2DNode;

  it.each(PROFILE_KINDS)('%s: qualità esatta, volume = pieno − sezione interna × altezza della cavità', (kind) => {
    const node = profile(kind, { width: 30, depth: 24, flange: 4, web: 4, wall: 4, radius: 12, height: 40 });
    expect(shellQuality(sceneOf([node], ['p']), node)).toBe('exact');
    const cavity = cavityFor(node, { wall: 1, bottom: 2 });
    expect(cavity.kind).toBe('exact');
    if (cavity.kind !== 'exact') return;
    // La cavità va da 2 mm sopra la base fino a 1 mm oltre la cima: 40 − 2 + 1
    const inner = cavity.node as ProfileShape;
    expect(inner.height).toBeCloseTo(39, 6);
    const full = volumeOf(sceneOf([node], ['p']));
    const hollow = volumeOf(shelled(node, 1, 2));
    // La parte tolta è la cavità per i 38 mm dentro il pezzo (il margine di 1 mm sopra la cima non toglie nulla)
    const removed = volumeOf(sceneOf([{ ...inner, id: 'c', name: 'c', position: [0, 0, 0] as Vec3, height: 38 } as Shape2DNode], ['c']));
    expect(hollow).toBeCloseTo(full - removed, 3);
    // Ogni parete è ristretta di 1 mm per lato: la sezione interna è più piccola di quella del pezzo
    expect(profileArea(inner)).toBeLessThan(profileArea(node as ProfileShape));
    // Con un raccordo interno il volume cambia poco ma la mesh resta valida (la cavità ha raccordo + w)
    const rounded = profile(kind, { width: 30, depth: 24, flange: 4, web: 4, wall: 4, radius: 12, height: 40, rootRadius: 2, tipSize: 1.5 });
    const mesh = new Evaluator(wasm).evaluate(shelled(rounded, 1, 2)).meshes[0];
    expect(mesh.status).toBe('NoError');
    expect(mesh.volume).toBeLessThan(volumeOf(sceneOf([rounded], ['p'])));
  });

  it('pareti più sottili del doppio dello spessore: errore, non una cavità degenere', () => {
    const thin = profile('profileH', { flange: 3, web: 3 });
    expect(cavityFor(thin, { wall: 1.6, bottom: 1 }).kind).toBe('error');
    expect(cavityFor(profile('tubeRound', { wall: 2 }), { wall: 1.1, bottom: 1 }).kind).toBe('error');
    expect(cavityFor(profile('tubeRect', { wall: 2 }), { wall: 0.9, bottom: 1 }).kind).toBe('exact');
  });

  it('con torsione o estrusione rotazionale resta la cavità scalata', () => {
    const twisted = profile('profileL', { twist: 30 });
    expect(shellQuality(sceneOf([twisted], ['p']), twisted)).toBe('scaled');
  });
});

describe('Guscio sulle nuove forme 2D', () => {
  it.each(['ring', 'heart', 'star', 'egg', 'cross'] as const)('%s: usa la cavità scalata e il solido resta valido', (kind) => {
    const node = { ...shape2dDefaults(kind), id: 'p', name: 'p', position: [0, 0, 5] as Vec3, width: 40, depth: 40, height: 12 } as Shape2DNode;
    expect(shellQuality(sceneOf([node], ['p']), node)).not.toBe('exact');
    const full = volumeOf(sceneOf([node], ['p']));
    // La cavità scalata ha bisogno dell'ingombro del pezzo (nel sistema locale), che nell'app arriva dal kernel
    const bounds = { min: [-20, -20, -6] as Vec3, max: [20, 20, 6] as Vec3 };
    const result = buildShell(sceneOf([node], ['p']), 'p', { wall: 1.5, bottom: 1.5, bounds });
    if (!result.ok) throw new Error(result.error);
    const hollow = volumeOf(result.scene);
    expect(hollow).toBeGreaterThan(0);
    expect(hollow).toBeLessThan(full);
  });
});

describe('cavità scalata e limiti', () => {
  it('sfera: ripiego scalato, aperta in cima e con il volume tra 0 e quello pieno', () => {
    const sphere = prim('sphere', { radius: 10, segments: 64 });
    expect(shellQuality(sceneOf([sphere], ['p']), sphere)).toBe('scaled');
    // L'ingombro locale arriva dalle mesh; qui lo si ricava dalla sfera stessa
    const bounds = { min: [-10, -10, -10] as Vec3, max: [10, 10, 10] as Vec3 };
    const result = buildShell(sceneOf([sphere], ['p']), 'p', { wall: 1, bottom: 1, bounds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mesh = new Evaluator(wasm).evaluate(result.scene).meshes[0];
    expect(mesh.status).toBe('NoError');
    expect(mesh.volume).toBeGreaterThan(0);
    expect(mesh.volume).toBeLessThan((4 / 3) * Math.PI * 1000);
  });

  it('senza ingombro la cavità scalata dà un errore leggibile', () => {
    const cavity = cavityFor(prim('sphere'), { wall: 1, bottom: 1 });
    expect(cavity.kind).toBe('error');
  });

  it('pareti troppo spesse e fondo troppo alto sono rifiutati con un messaggio', () => {
    expect(buildShell(sceneOf([prim('box')], ['p']), 'p', { wall: 10, bottom: 1 })).toMatchObject({ ok: false, error: expect.stringContaining('troppo spesse') });
    expect(buildShell(sceneOf([prim('box')], ['p']), 'p', { wall: 1, bottom: 20 })).toMatchObject({ ok: false, error: expect.stringContaining('fondo') });
  });

  it('un foro e un oggetto bloccato non si svuotano', () => {
    expect(buildShell(sceneOf([prim('box', { mode: 'hole' })], ['p']), 'p', { wall: 1, bottom: 1 }).ok).toBe(false);
    expect(buildShell(sceneOf([prim('box', { locked: true })], ['p']), 'p', { wall: 1, bottom: 1 }).ok).toBe(false);
  });

  it('localBounds riporta l\'ingombro nel sistema locale del nodo ruotato', () => {
    // Un segmento lungo 10 lungo X nel mondo, con nodo ruotato di 90° attorno a Z, è lungo 10 lungo −Y in locale
    const positions = new Float32Array([0, 0, 0, 10, 0, 0]);
    const b = localBounds([{ positions }], { position: [0, 0, 0], rotation: [0, 0, 90] });
    expect(b.min[1]).toBeCloseTo(-10, 6);
    expect(b.max[1]).toBeCloseTo(0, 6);
    expect(b.max[0] - b.min[0]).toBeCloseTo(0, 6);
  });
});

describe('faccia aperta scelta dall\'utente', () => {
  const X: Vec3 = [1, 0, 0];
  const NEG_X: Vec3 = [-1, 0, 0];
  const NEG_Y: Vec3 = [0, -1, 0];
  const NEG_Z: Vec3 = [0, 0, -1];

  /** Applica il Guscio con la faccia `open` aperta e restituisce la scena risultante. */
  function shelledOpen(node: SceneNode, wall: number, bottom: number, open: Vec3, bounds?: { min: Vec3; max: Vec3 }): Scene {
    const result = buildShell(sceneOf([node], [node.id]), node.id, { wall, bottom, open, ...(bounds ? { bounds } : {}) });
    if (!result.ok) throw new Error(result.error);
    return result.scene;
  }

  it('senza scelta la faccia aperta è la cima', () => {
    expect(openSide()).toEqual({ axis: 2, sign: 1 });
    expect(openSide([0, 0, 1])).toEqual({ axis: 2, sign: 1 });
    expect(openName()).toBe('cima (+Z)');
    expect(openName(NEG_Z)).toBe('fondo (−Z)');
    expect(openName(NEG_Y)).toBe('lato −Y');
  });

  it('la normale scelta si aggancia all\'asse più vicino e le facce oblique sono rifiutate', () => {
    expect(snapOpenDirection([0.9999, 0.001, -0.001])).toEqual([1, 0, 0]);
    expect(snapOpenDirection([0, -2, 0])).toEqual([0, -1, 0]);
    expect(snapOpenDirection([Math.SQRT1_2, 0, Math.SQRT1_2])).toBeNull();
    expect(snapOpenDirection([0, 0, 0])).toBeNull();
  });

  it('cubo aperto su un lato: stessa cavità della cima, ruotata sull\'asse scelto', () => {
    // Cubo 20 mm, pareti 2, fondo 3: la cavità è lunga 17 lungo X e 16 × 16 nel resto
    expect(shellQuality(sceneOf([prim('box')], ['p']), prim('box'), X)).toBe('exact');
    expect(volumeOf(shelledOpen(prim('box'), 2, 3, X))).toBeCloseTo(20 ** 3 - 17 * 16 * 16, 3);
    expect(volumeOf(shelledOpen(prim('box'), 2, 3, NEG_X))).toBeCloseTo(20 ** 3 - 17 * 16 * 16, 3);
    // Il centro della cavità è verso la faccia aperta: (−7 + 11) / 2 = 2 mm dal centro, con il segno della faccia
    const offsetX = (open: Vec3) => {
      const cavity = cavityFor(prim('box'), { wall: 2, bottom: 3, open });
      return cavity.kind === 'exact' ? cavity.offset : null;
    };
    expect(offsetX(X)).toEqual([2, 0, 0]);
    expect(offsetX(NEG_X)).toEqual([-2, 0, 0]);
  });

  it('cubo non cubico aperto su Y: le misure si distribuiscono sugli assi giusti', () => {
    const box = prim('box', { size: [30, 20, 10] });
    const cavity = cavityFor(box, { wall: 2, bottom: 4, open: NEG_Y });
    expect(cavity.kind).toBe('exact');
    if (cavity.kind !== 'exact') return;
    // X e Z ridotti di 2·2; lungo Y da 4 mm dal lato opposto fino a 1 mm oltre la faccia aperta: 20 − 4 + 1
    expect((cavity.node as Extract<PrimitiveNode, { kind: 'box' }>).size).toEqual([26, 17, 6]);
    expect(volumeOf(shelledOpen(box, 2, 4, NEG_Y))).toBeCloseTo(30 * 20 * 10 - 26 * 16 * 6, 3);
  });

  it('cilindro aperto sul fondo: stessa cavità della cima, specchiata', () => {
    const cyl = prim('cylinder', { radius: 10, height: 20, segments: 256 });
    const up = cavityFor(cyl, { wall: 2, bottom: 2 });
    const down = cavityFor(cyl, { wall: 2, bottom: 2, open: NEG_Z });
    expect(up.kind === 'exact' && down.kind === 'exact').toBe(true);
    if (up.kind !== 'exact' || down.kind !== 'exact') return;
    expect(down.offset).toEqual([0, 0, -up.offset[2]]);
    expect(volumeOf(shelledOpen(cyl, 2, 2, NEG_Z))).toBeCloseTo(volumeOf(shelled(cyl, 2, 2)), 6);
  });

  it('cono aperto sul fondo: stesso volume del cono capovolto aperto in cima', () => {
    const cone = prim('cone', { radiusBottom: 10, radiusTop: 5, height: 20, segments: 128 });
    const flipped = prim('cone', { radiusBottom: 5, radiusTop: 10, height: 20, segments: 128 });
    expect(volumeOf(shelledOpen(cone, 1, 2, NEG_Z))).toBeCloseTo(volumeOf(shelled(flipped, 1, 2)), 6);
    // Cono a punta aperto dalla base: la cavità finisce dove si annulla e la mesh resta valida
    const spike = prim('cone', { radiusBottom: 10, radiusTop: 0, height: 20, segments: 64 });
    const mesh = new Evaluator(wasm).evaluate(shelledOpen(spike, 1, 1, NEG_Z)).meshes[0];
    expect(mesh.status).toBe('NoError');
    expect(mesh.volume).toBeLessThan((Math.PI * 100 * 20) / 3);
  });

  it('forme senza cavità esatta sul lato scelto: ripiego scalato attorno alla faccia opposta', () => {
    // Un cilindro aperto di lato non ha cavità esatta
    const cyl = prim('cylinder', { radius: 10, height: 20 });
    expect(shellQuality(sceneOf([cyl], ['p']), cyl, X)).toBe('scaled');
    const bounds = { min: [-10, -10, -10] as Vec3, max: [10, 10, 10] as Vec3 };
    const sphere = prim('sphere', { radius: 10, segments: 64 });
    const cavity = cavityFor(sphere, { wall: 1, bottom: 2, open: NEG_Y, bounds });
    expect(cavity.kind).toBe('scaled');
    if (cavity.kind !== 'scaled') return;
    // Perno al centro della faccia opposta (+Y); la cavità si estende verso −Y, oltre la faccia aperta di 1 mm
    expect(cavity.pivot).toEqual([0, 10, 0]);
    expect(cavity.lift).toEqual([0, -2, 0]);
    expect(cavity.scale[0]).toBeCloseTo(0.9, 9);
    expect(cavity.scale[1]).toBeCloseTo((20 - 2 + SHELL_OPEN_MARGIN) / 20, 9);
    const mesh = new Evaluator(wasm).evaluate(shelledOpen(sphere, 1, 2, NEG_Y, bounds)).meshes[0];
    expect(mesh.status).toBe('NoError');
    expect(mesh.volume).toBeGreaterThan(0);
    expect(mesh.volume).toBeLessThan((4 / 3) * Math.PI * 1000);
  });

  it('un\'unione con una faccia diversa dalla cima ripiega sulla cavità scalata', () => {
    const a = prim('box', { id: 'a', name: 'a', position: [-10, 0, 0] });
    const b = prim('box', { id: 'b', name: 'b', position: [10, 0, 0] });
    const union: GroupNode = { id: 'u', name: 'u', type: 'group', op: 'union', children: ['a', 'b'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#ffffff' };
    const scene = sceneOf([a, b, union], ['u']);
    expect(shellQuality(scene, scene.nodes.u)).toBe('prism');
    expect(shellQuality(scene, scene.nodes.u, [0, 0, -1])).toBe('scaled');
    expect(shellQuality(scene, scene.nodes.u, [1, 0, 0])).toBe('scaled');
  });

  it('i limiti si misurano sull\'asse aperto: fondo troppo spesso e pareti troppo spesse', () => {
    const box = prim('box', { size: [40, 40, 10] });
    // Aperto su X il fondo può essere spesso fino a 40 mm, ma le pareti non possono superare metà di Z (10 mm)
    expect(buildShell(sceneOf([box], ['p']), 'p', { wall: 2, bottom: 30, open: X }).ok).toBe(true);
    expect(buildShell(sceneOf([box], ['p']), 'p', { wall: 6, bottom: 1, open: X })).toMatchObject({ ok: false, error: expect.stringContaining('troppo spesse') });
    expect(buildShell(sceneOf([box], ['p']), 'p', { wall: 2, bottom: 45, open: X })).toMatchObject({ ok: false, error: expect.stringContaining('fondo') });
  });

  it('il codice OpenSCAD dichiara la faccia aperta e coincide con il kernel', () => {
    const scene = shelledOpen(prim('box'), 2, 3, X);
    const code = sceneToOpenScad(scene);
    expect(code).toContain('aperto su lato +X');
    // Cavità 18 × 16 × 16 (17 mm dentro il cubo più il margine di apertura) spostata di 2 mm lungo X
    expect(code).toContain('cube([18, 16, 16], center = true);');
    expect(code).toContain('translate([2, 0, 0])');
    expect(sceneToOpenScad(shelled(prim('box'), 2, 3))).toContain('aperto su cima (+Z)');
  });
});

describe('Guscio nella scena', () => {
  it('il gruppo prende il posto del solido, senza spostarlo', () => {
    const scene = shelled(prim('box', { position: [5, 6, 7] }), 2, 2);
    const group = Object.values(scene.nodes).find((n): n is GroupNode => n.type === 'group')!;
    expect(group.op).toBe('shell');
    expect(group.children).toEqual(['p']);
    expect(scene.rootIds).toEqual([group.id]);
    // Il gruppo prende la posizione del solido (il gizmo di Sposta compare sull'oggetto), il solido resta all'origine
    expect(group.position).toEqual([5, 6, 7]);
    expect(scene.nodes.p.position).toEqual([0, 0, 0]);
  });

  it('la cavità sporge sopra la cima: il guscio è aperto', () => {
    const mesh = new Evaluator(wasm).evaluate(shelled(prim('box', { position: [0, 0, 10] }), 2, 2)).meshes[0];
    // Una scatola chiusa avrebbe 12 triangoli per la sola cima; aperta ha la bocca: la mesh ha più di 12 triangoli
    expect(mesh.indices.length / 3).toBeGreaterThan(12);
    expect(SHELL_OPEN_MARGIN).toBeGreaterThan(0);
  });

  it('un cubo ruotato e spostato si svuota nel suo sistema locale', () => {
    const rotated = prim('box', { position: [10, 0, 10], rotation: [0, 0, 45] });
    expect(volumeOf(shelled(rotated, 2, 3))).toBeCloseTo(20 ** 3 - 16 * 16 * 17, 3);
  });

  it('il codice OpenSCAD contiene la differenza con la cavità', () => {
    const code = sceneToOpenScad(shelled(prim('box'), 2, 3));
    expect(code).toContain('difference() {');
    expect(code).toContain('cavità del guscio');
    // Cavità: 16 × 16 × 17 alzata di (3 + 1) / 2 = 2 mm
    expect(code).toContain('cube([16, 16, 18], center = true);');
    expect(code).toContain('translate([0, 0, 2])');
  });
});

describe('segmenti del raccordo', () => {
  const fillet = { treatment: 'fillet' as const, angle: 90, radius: 2, distance1: 2, distance2: 2 };

  it('il profilo usa i segmenti richiesti (predefinito 64) con un minimo di 3', () => {
    expect(edgeProfile(fillet).circle?.segments).toBe(64);
    expect(edgeProfile({ ...fillet, segments: 16 }).circle?.segments).toBe(16);
    expect(edgeProfile({ ...fillet, segments: 1 }).circle?.segments).toBe(3);
  });

  it('con meno segmenti il cerchio inscritto è più piccolo e il taglierino toglie più materiale', () => {
    // Il cerchio sottratto dal taglierino è inscritto: con meno lati ha area minore, quindi il taglierino è più grande
    const area = (segments: number) => {
      const c = edgeProfile({ ...fillet, segments }).circle!;
      return (c.segments / 2) * c.radius ** 2 * Math.sin((2 * Math.PI) / c.segments);
    };
    expect(area(8)).toBeLessThan(area(64));
  });
});

describe('Guscio su solidi uniti', () => {
  const group = (id: string, op: GroupNode['op'], children: string[], extra: Partial<GroupNode> = {}): GroupNode => ({
    id, name: id, type: 'group', op, children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#ffffff', ...extra,
  });
  const cube = (id: string, position: Vec3, size: Vec3): PrimitiveNode => prim('box', { id, name: id, position, size });

  /** Guscio dell'oggetto alla radice `rootId` della scena `scene` (spessore laterale e inferiore). */
  function shellOf(scene: Scene, rootId: string, wall: number, bottom: number): Scene {
    const result = buildShell(scene, rootId, { wall, bottom });
    if (!result.ok) throw new Error(result.error);
    return result.scene;
  }
  /** Area (mm²) di un quadrato della sezione: serve a calcolare i volumi di riferimento. */
  const square = (x: number, y: number, w: number, d: number) => wasm.CrossSection.square([w, d]).translate([x - w / 2, y - d / 2]);

  it('due cubi affiancati e sovrapposti: pareti uniformi, nessuna parete interna', () => {
    // Cubo A 20 × 20 centrato in (-5, 0), cubo B 20 × 20 centrato in (5, 5): sovrapposti, stessa altezza
    const scene = sceneOf([cube('a', [-5, 0, 10], [20, 20, 20]), cube('b', [5, 5, 10], [20, 20, 20]), group('u', 'union', ['a', 'b'])], ['u']);
    expect(shellQuality(scene, scene.nodes.u)).toBe('prism');
    const union = square(-5, 0, 20, 20).add(square(5, 5, 20, 20));
    const eroded = union.offset(-2, 'Miter', 2);
    // Volume = area dell'unione × 20 − area della sezione ristretta × (20 − fondo 3)
    expect(volumeOf(shellOf(scene, 'u', 2, 3))).toBeCloseTo(union.area() * 20 - eroded.area() * 17, 2);
  });

  it('due cubi che si toccano su una faccia: una sola cavità che attraversa il giunto', () => {
    const scene = sceneOf([cube('a', [-10, 0, 10], [20, 20, 20]), cube('b', [10, 0, 10], [20, 20, 20]), group('u', 'union', ['a', 'b'])], ['u']);
    // L'unione è un blocco 40 × 20: la cavità è 36 × 16 per 17 di altezza, senza parete tra i due cubi
    expect(volumeOf(shellOf(scene, 'u', 2, 3))).toBeCloseTo(40 * 20 * 20 - 36 * 16 * 17, 2);
  });

  it('cubo con un foro cilindrico passante: pareti uniformi anche attorno al foro', () => {
    const hole = prim('cylinder', { id: 'h', name: 'h', position: [0, 0, 10], radius: 4, height: 30, segments: 256, mode: 'hole' });
    const scene = sceneOf([cube('a', [0, 0, 10], [30, 30, 20]), hole, group('d', 'difference', ['a', 'h'])], ['d']);
    expect(shellQuality(scene, scene.nodes.d)).toBe('prism');
    const base = square(0, 0, 30, 30).subtract(wasm.CrossSection.circle(4, 256));
    const eroded = base.offset(-2, 'Miter', 2);
    expect(volumeOf(shellOf(scene, 'd', 2, 3))).toBeCloseTo(base.area() * 20 - eroded.area() * 17, 1);
  });

  it('gruppo ruotato attorno a Z: le pareti restano verticali e uniformi', () => {
    const scene = sceneOf([cube('a', [-10, 0, 10], [20, 20, 20]), cube('b', [10, 0, 10], [20, 20, 20]), group('u', 'union', ['a', 'b'], { rotation: [0, 0, 35], position: [5, 5, 0] })], ['u']);
    expect(shellQuality(scene, scene.nodes.u)).toBe('prism');
    expect(volumeOf(shellOf(scene, 'u', 2, 3))).toBeCloseTo(40 * 20 * 20 - 36 * 16 * 17, 2);
  });

  it('altezze diverse: cavità per figlio, pareti esterne esatte e una parete interna al giunto', () => {
    const scene = sceneOf([cube('a', [-10, 0, 10], [20, 20, 20]), cube('b', [10, 0, 6], [20, 20, 12]), group('u', 'union', ['a', 'b'])], ['u']);
    expect(shellQuality(scene, scene.nodes.u)).toBe('parts');
    // Riferimento: unione dei due cubi meno l'unione delle due cavità, ciascuna 16 × 16 dal fondo (3 mm) alla cima
    const solid = wasm.Manifold.union([wasm.Manifold.cube([20, 20, 20]).translate([-20, -10, 0]), wasm.Manifold.cube([20, 20, 12]).translate([0, -10, 0])]);
    const cavityA = wasm.Manifold.cube([16, 16, 18]).translate([-18, -8, 3]);
    const cavityB = wasm.Manifold.cube([16, 16, 10]).translate([2, -8, 3]);
    const expected = wasm.Manifold.difference([solid, wasm.Manifold.union([cavityA, cavityB])]);
    const mesh = new Evaluator(wasm).evaluate(shellOf(scene, 'u', 2, 3)).meshes[0];
    expect(mesh.status).toBe('NoError');
    expect(mesh.volume).toBeCloseTo(expected.volume(), 2);
  });

  it('cono unito a un cubo: cavità per figlio con lo spessore perpendicolare al lato inclinato', () => {
    const cone = prim('cone', { id: 'k', name: 'k', position: [20, 0, 10], radiusBottom: 10, radiusTop: 5, height: 20, segments: 64 });
    const scene = sceneOf([cube('a', [-10, 0, 10], [20, 20, 20]), cone, group('u', 'union', ['a', 'k'])], ['u']);
    expect(shellQuality(scene, scene.nodes.u)).toBe('parts');
    const mesh = new Evaluator(wasm).evaluate(shellOf(scene, 'u', 1.5, 2)).meshes[0];
    expect(mesh.status).toBe('NoError');
    expect(mesh.volume).toBeGreaterThan(0);
  });

  it('un guscio con una mesh o una sfera nell\'unione ripiega sulla cavità scalata', () => {
    const scene = sceneOf([cube('a', [-10, 0, 10], [20, 20, 20]), prim('sphere', { id: 's', name: 's', position: [15, 0, 10], radius: 8 }), group('u', 'union', ['a', 's'])], ['u']);
    expect(shellQuality(scene, scene.nodes.u)).toBe('scaled');
  });

  it('il codice OpenSCAD del prisma usa projection, offset e linear_extrude; quello per figlio un union di cavità', () => {
    const prism = sceneOf([cube('a', [-10, 0, 10], [20, 20, 20]), cube('b', [10, 0, 10], [20, 20, 20]), group('u', 'union', ['a', 'b'])], ['u']);
    const code = sceneToOpenScad(shellOf(prism, 'u', 2, 3));
    expect(code).toContain('projection(cut = true)');
    expect(code).toContain('offset(delta = -2)');
    expect(code).toContain('linear_extrude(height = 18)');
    expect(code).toContain('translate([0, 0, 3])');

    const parts = sceneOf([cube('a', [-10, 0, 10], [20, 20, 20]), cube('b', [10, 0, 6], [20, 20, 12]), group('u', 'union', ['a', 'b'])], ['u']);
    const partsCode = sceneToOpenScad(shellOf(parts, 'u', 2, 3));
    expect(partsCode).toContain('una per solido');
    expect(partsCode.match(/cube\(\[16, 16,/g)).toHaveLength(2);
  });

  it('pareti troppo spesse per un\'unione sono rifiutate con un messaggio', () => {
    const scene = sceneOf([cube('a', [-10, 0, 10], [20, 20, 20]), cube('b', [10, 0, 10], [20, 20, 20]), group('u', 'union', ['a', 'b'])], ['u']);
    const result = buildShell(scene, 'u', { wall: 12, bottom: 2, bounds: { min: [-20, -10, 0], max: [20, 10, 20] } });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('troppo spesse') });
  });
});
