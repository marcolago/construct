import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from '../scene/defaults';
import { defaultPatternParams, faceFromBounds, thicknessAlong } from '../scene/pattern';
import type { GroupNode, PatternParams, PrimitiveNode, Scene, Vec3 } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Un pannello 80 × 60 × 5 all'origine del gruppo (centrato) dentro un gruppo pattern con i parametri dati. */
function scene(patch: Partial<PatternParams>, size: Vec3 = [80, 60, 5]): Scene {
  const cube = { ...primitiveDefaults('box'), id: 'c', name: 'Pannello', position: [0, 0, 0], size } as PrimitiveNode;
  const bounds = { min: size.map((v) => -v / 2) as Vec3, max: size.map((v) => v / 2) as Vec3 };
  const g: GroupNode = {
    id: 'g', name: 'Pattern', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
    pattern: { ...defaultPatternParams(bounds, 7), ...patch },
  };
  return { nodes: { c: cube, g }, rootIds: ['g'] };
}
const run = (s: Scene) => new Evaluator(wasm).evaluate(s).meshes[0];
const FULL = 80 * 60 * 5;

describe('Pattern nel kernel', () => {
  it('Voronoi passante: toglie volume, lascia la cornice e dà un solo solido valido', () => {
    const m = run(scene({ kind: 'voronoi', cells: 30, margin: 5 }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeLessThan(FULL * 0.9);
    expect(m.volume).toBeGreaterThan(FULL * 0.2);
    // L'ingombro resta quello del pannello (la cornice è intatta)
    expect(m.bbox.min[0]).toBeCloseTo(-40, 2);
    expect(m.bbox.max[1]).toBeCloseTo(30, 2);
  });

  it('è deterministico con lo stesso seme e cambia con un altro', () => {
    const a = run(scene({ cells: 25, seed: 3 }));
    expect(run(scene({ cells: 25, seed: 3 })).volume).toBeCloseTo(a.volume, 6);
    expect(run(scene({ cells: 25, seed: 4 })).volume).not.toBeCloseTo(a.volume, 2);
  });

  it('con più parete resta più materiale', () => {
    const thin = run(scene({ cells: 30, wall: 1.2 }));
    const thick = run(scene({ cells: 30, wall: 3 }));
    expect(thick.volume).toBeGreaterThan(thin.volume);
  });

  it('Solchi: resta più materiale dei Fori con le stesse celle quando le celle sono grandi', () => {
    const holes = run(scene({ cells: 20, mode: 'holes', wall: 2 }));
    const grooves = run(scene({ cells: 20, mode: 'grooves', wall: 2 }));
    expect(grooves.status).toBe('NoError');
    expect(grooves.volume).toBeGreaterThan(holes.volume);
  });

  it('profondità parziale: tasca che non buca, e da due lati toglie di più', () => {
    const through = run(scene({ cells: 20 }));
    const pocket = run(scene({ cells: 20, depth: 2 }));
    const both = run(scene({ cells: 20, depth: 2, sides: 'both' }));
    expect(pocket.volume).toBeGreaterThan(through.volume);
    expect(pocket.volume).toBeLessThan(FULL);
    expect(both.volume).toBeLessThan(pocket.volume);
    // Con 2 mm da ciascun lato su 5 di spessore resta un'anima da 1 mm: il pezzo non si divide
    expect(both.status).toBe('NoError');
  });

  it('esagoni e cerchi: forano il pannello', () => {
    const hex = run(scene({ kind: 'hexagon', size: 12, wall: 2, rounding: 0 }));
    const circles = run(scene({ kind: 'circle', size: 12 }));
    expect(hex.volume).toBeLessThan(FULL * 0.8);
    expect(circles.volume).toBeLessThan(FULL * 0.9);
    expect(hex.status).toBe('NoError');
  });

  it('da una faccia laterale (x+) la direzione del taglio cambia', () => {
    const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
    const top = run(scene({ cells: 12, margin: 3 }));
    const side = run(scene({ cells: 12, margin: 1, faces: [faceFromBounds(bounds, 'x+')] }));
    expect(side.status).toBe('NoError');
    expect(side.volume).toBeLessThan(FULL);
    expect(side.volume).not.toBeCloseTo(top.volume, 0);
  });

  it('rombi e triangoli forano il pannello', () => {
    const diamonds = run(scene({ kind: 'diamond', size: 12, wall: 2, rounding: 0 }));
    const triangles = run(scene({ kind: 'triangle', size: 14, wall: 2, rounding: 0 }));
    for (const m of [diamonds, triangles]) {
      expect(m.status).toBe('NoError');
      expect(m.volume).toBeLessThan(FULL * 0.85);
      expect(m.volume).toBeGreaterThan(FULL * 0.2);
    }
  });

  it('più facce: forare da due lati toglie più materiale che da uno solo', () => {
    const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
    const one = run(scene({ kind: 'hexagon', size: 10, margin: 1, depth: 2 }));
    const two = run(scene({ kind: 'hexagon', size: 10, margin: 1, depth: 2, faces: [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')] }));
    expect(two.status).toBe('NoError');
    expect(two.volume).toBeLessThan(one.volume);
    expect(two.volume).toBeGreaterThan(0);
  });

  it('anteprima semplificata: volume simile a quello a qualità piena', () => {
    const full = run(scene({ cells: 25, rounding: 2 }));
    const simple = run(scene({ cells: 25, rounding: 2, preview: true }));
    expect(simple.status).toBe('NoError');
    expect(Math.abs(simple.volume - full.volume) / full.volume).toBeLessThan(0.05);
  });

  it('un margine che occupa tutto il pezzo lo lascia invariato', () => {
    const m = run(scene({ margin: 100 }));
    expect(m.volume).toBeCloseTo(FULL, 2);
  });
});

describe('Pattern su una faccia inclinata', () => {
  // Piramide a base quadrata (cono a 4 segmenti): le facce laterali sono inclinate, quella verso (1, 1) ha normale (1, 1, 1) / √3
  const pyramid = (patch: Partial<PatternParams>): Scene => {
    const cone = { ...primitiveDefaults('cone'), id: 'c', name: 'Piramide', position: [0, 0, 0], radiusBottom: 20, radiusTop: 0, height: 20, segments: 4 } as PrimitiveNode;
    const bounds = { min: [-20, -20, -10] as Vec3, max: [20, 20, 10] as Vec3 };
    const normal: Vec3 = [1, 1, 1].map((v) => v / Math.sqrt(3)) as Vec3;
    const face = { origin: [10 / 3, 10 / 3, 10 / 3] as Vec3, normal, thickness: thicknessAlong(bounds, normal) };
    const g: GroupNode = {
      id: 'g', name: 'Pattern', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
      pattern: { ...defaultPatternParams(bounds, 7), kind: 'hexagon', size: 6, wall: 1, rounding: 0, margin: 1, faces: [face], ...patch },
    };
    return { nodes: { c: cone, g }, rootIds: ['g'] };
  };
  const PYRAMID = (800 * 20) / 3;
  /** Area della faccia inclinata: triangolo (20, 0, -10), (0, 20, -10), (0, 0, 10). */
  const FACE_AREA = 0.5 * Math.hypot(400, 400, 400);

  it('la tasca resta dentro il contorno della faccia scelta', () => {
    const m = run(pyramid({ depth: 1 }));
    expect(m.status).toBe('NoError');
    const removed = PYRAMID - m.volume;
    expect(removed).toBeGreaterThan(0);
    // Al più la faccia per la profondità: la silhouette lungo la normale sarebbe molto più larga della faccia
    expect(removed).toBeLessThanOrEqual(FACE_AREA * 1.001);
  });

  it('passante: il pezzo resta valido e le altre facce non sono forate più che dalla tasca', () => {
    const m = run(pyramid({ depth: 0 }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeLessThan(PYRAMID);
    expect(m.volume).toBeGreaterThan(PYRAMID * 0.5);
  });

  it('"Entrambe" non ha effetto: il taglio parte solo dalla faccia inclinata', () => {
    const one = run(pyramid({ depth: 1, sides: 'one' }));
    const both = run(pyramid({ depth: 1, sides: 'both' }));
    expect(both.volume).toBeCloseTo(one.volume, 6);
  });

  it('il codice OpenSCAD usa la sezione sotto la faccia e un solo taglio', () => {
    const code = sceneToOpenScad(pyramid({ depth: 1, sides: 'both' }));
    expect(code).toContain('projection(cut = true) translate([0, 0, 0.01])');
    expect(code).not.toContain('for (z = [');
    const through = sceneToOpenScad(pyramid({ depth: 0 }));
    expect(through).toContain('projection(cut = true) translate([0, 0, 0.01])');
    expect(through).not.toContain('projection() rotate(');
  });
});

describe('Pattern applicato più volte', () => {
  it('un Pattern dentro l\'altro fora due facce diverse e la mesh resta valida', () => {
    const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
    const base = scene({ kind: 'hexagon', size: 10, margin: 1, depth: 2 });
    const inner = base.nodes.g as GroupNode;
    // Secondo Pattern: avvolge il primo e fora il lato opposto (z-)
    const outer: GroupNode = { ...inner, id: 'g2', children: ['g'], pattern: { ...inner.pattern!, faces: [faceFromBounds(bounds, 'z-')] } };
    const nested: Scene = { nodes: { ...base.nodes, g2: outer }, rootIds: ['g2'] };
    const one = run(base);
    const two = run(nested);
    expect(two.status).toBe('NoError');
    expect(two.volume).toBeLessThan(one.volume);
    expect(two.volume).toBeGreaterThan(0);
    const code = sceneToOpenScad(nested);
    // Un elenco di celle per ogni Pattern; il pezzo interno compare due volte (nel corpo e nella regione del taglio esterno)
    expect(code.match(/\/\/ Pattern hexagon, seme/g)).toHaveLength(3);
    expect(code.split('{').length).toBe(code.split('}').length);
  });
});

describe('Pattern nel codice OpenSCAD', () => {
  it('Voronoi passante: celle, parete, margine e proiezione del pezzo', () => {
    const code = sceneToOpenScad(scene({ cells: 6, margin: 4, wall: 2, rounding: 1 }));
    expect(code).toContain('cells = [');
    expect(code.match(/^\s+\[\[/gm)).toHaveLength(6);
    expect(code).toContain('for (c = cells) offset(r = 1, $fn = 32) offset(delta = -2) polygon(c);');
    expect(code).toContain('offset(delta = -4) projection() rotate(');
    expect(code).toContain('linear_extrude(height =');
    expect(code).toContain('difference() {');
    expect(code).not.toContain('NaN');
    // Le graffe sono bilanciate
    expect(code.split('{').length).toBe(code.split('}').length);
  });

  it('Solchi, tasca da due lati ed esagoni', () => {
    const grooves = sceneToOpenScad(scene({ mode: 'grooves', cells: 5, depth: 2, sides: 'both' }));
    expect(grooves).toContain('projection(cut = true) translate([0, 0, 0.01])');
    expect(grooves).toContain('for (z = [-2, -6]) translate([0, 0, z]) linear_extrude(height = 3)');
    expect(grooves.indexOf('difference() {', grooves.indexOf('linear_extrude'))).toBeGreaterThan(0);
    const hex = sceneToOpenScad(scene({ kind: 'hexagon', size: 20, rounding: 0 }));
    expect(hex).not.toContain('offset(r =');
    expect(hex).toContain('offset(delta = -0.8) polygon(c);');
  });

  it('più facce: un elenco di celle e un taglio per faccia', () => {
    const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
    const code = sceneToOpenScad(scene({ kind: 'diamond', size: 20, faces: [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'x+')] }));
    expect(code).toContain('cells_1 = [');
    expect(code).toContain('cells_2 = [');
    expect(code).toContain('for (c = cells_2)');
    expect(code.split('{').length).toBe(code.split('}').length);
    expect(code).not.toContain('preview');
  });
});
