import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { shape2dDefaults } from '../scene/defaults';
import { sceneToOpenScad } from '../codegen/openscad';
import { DEFAULT_PLAN } from '../scene/planShape';
import type { PlanDraft } from '../scene/planShape';
import { planSolid } from '../scene/planSolid';
import type { PathContour, Scene, Shape2DNode, Vec2 } from '../scene/types';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Bicchiere disegnato a destra dell'asse: parete di 2 mm, fondo di 3 mm, alto 50. */
const CUP: PathContour = { closed: true, nodes: ([[0, 0], [30, 0], [30, 50], [28, 50], [28, 3], [0, 3]] as Vec2[]).map((p) => ({ p, kind: 'corner' as const })) };
const squircle: PlanDraft = { ...DEFAULT_PLAN, kind: 'rect', base: 'rect', cornerR: 14, cornerType: 'smooth', smooth: 1 };

const cup = (patch: Partial<Shape2DNode> = {}): Shape2DNode =>
  ({ ...shape2dDefaults('path'), id: 'p', name: 'Bicchiere', position: [0, 0, 0], paths: [CUP], width: 30, depth: 50, extrusion: 'rotate', ...patch }) as Shape2DNode;
const sceneOf = (node: Shape2DNode): Scene => ({ nodes: { [node.id]: node }, rootIds: [node.id] });
const mesh = (node: Shape2DNode) => {
  const [m] = new Evaluator(wasm).evaluate(sceneOf(node)).meshes;
  return m;
};

describe('rotazione lungo una sagoma nel kernel', () => {
  it('lo squircle dà un solido valido, più grande del bicchiere circolare e uguale alla mesh ad anelli', () => {
    const round = mesh(cup());
    const square = mesh(cup({ plan: squircle } as Partial<Shape2DNode>));
    expect(square.status).toBe('NoError');
    expect(square.volume).toBeGreaterThan(round.volume * 1.05);
    expect(square.volume).toBeCloseTo(planSolid(cup({ plan: squircle } as Partial<Shape2DNode>))!.mesh.volume, -1);
  });

  it('il cerchio come sagoma è la rotazione di sempre', () => {
    expect(planSolid(cup({ plan: DEFAULT_PLAN } as Partial<Shape2DNode>))).toBeNull();
  });

  it('angolo parziale: 180° è metà, 90° un quarto, come per il cerchio', () => {
    const full = mesh(cup({ plan: squircle } as Partial<Shape2DNode>)).volume;
    const half = mesh(cup({ plan: squircle, revolveAngle: 180 } as Partial<Shape2DNode>));
    const quarter = mesh(cup({ plan: squircle, revolveAngle: 90 } as Partial<Shape2DNode>));
    expect(half.status).toBe('NoError');
    expect(half.volume / full).toBeCloseTo(0.5, 2);
    expect(quarter.volume / full).toBeCloseTo(0.25, 2);
    // Il primo quarto sta tutto tra gli assi X e Y positivi
    expect(quarter.bbox.min[0]).toBeGreaterThan(-1e-6);
    expect(quarter.bbox.min[1]).toBeGreaterThan(-1e-6);
  });

  it('una sagoma con forma diversa a destra e sinistra si taglia secondo gli angoli polari', () => {
    // Stella a 5 punte, non simmetrica rispetto all'asse X: con 180° resta la metà da 0° a 180°, sopra l'asse X
    const star: PlanDraft = { ...DEFAULT_PLAN, kind: 'star', base: 'star', cornerR: 2, innerR: 2 };
    const half = mesh(cup({ plan: star, revolveAngle: 180 } as Partial<Shape2DNode>));
    expect(half.status).toBe('NoError');
    expect(half.bbox.min[1]).toBeGreaterThan(-1e-6);
  });

  it('dati non fidati nel file: la sagoma si ripulisce e il calcolo resta rapido', () => {
    const bad = { ...squircle, kind: 'star', base: 'star', n: 1e9, cornerR: -5, sx: 1e6 } as unknown as PlanDraft;
    const t = performance.now();
    const m = mesh(cup({ plan: bad } as Partial<Shape2DNode>));
    expect(performance.now() - t).toBeLessThan(5000);
    expect(m.status).toBe('NoError');
  });
});

describe('codice OpenSCAD della sagoma', () => {
  it('scrive un poliedro con la sagoma in un commento e, con angolo parziale, il settore', () => {
    const code = sceneToOpenScad(sceneOf(cup({ plan: squircle } as Partial<Shape2DNode>)));
    expect(code).toContain('// construct:plan');
    expect(code).toContain('polyhedron(');
    expect(code).not.toContain('rotate_extrude');
    const half = sceneToOpenScad(sceneOf(cup({ plan: squircle, revolveAngle: 180 } as Partial<Shape2DNode>)));
    expect(half).toContain('intersection() {');
    expect(half).toContain('linear_extrude(');
  });

  it('i punti del codice sono quelli della mesh del kernel', () => {
    const node = cup({ plan: squircle } as Partial<Shape2DNode>);
    const solid = planSolid(node)!;
    const code = sceneToOpenScad(sceneOf(node));
    const block = code.slice(code.indexOf('points = ['), code.indexOf('faces = ['));
    expect((block.match(/\[/g) ?? []).length - 1).toBe(solid.mesh.positions.length / 3);
  });
});
