import { describe, expect, it } from 'vitest';
import type { NodeMesh } from '../kernel/evaluate';
import { analyzePrintability, type PrintOptions } from './printability';
import { primitiveDefaults } from './defaults';
import type { PrimitiveNode, Scene, Vec3 } from './types';

const OPTS: PrintOptions = { bedWidth: 256, bedDepth: 256, bedHeight: 256, overhangAngle: 45 };

/** Mesh di un parallelepipedo con le facce antiorarie verso l'esterno, come quelle del kernel. */
function boxMesh(rootId: string, min: Vec3, max: Vec3, extra: Partial<NodeMesh> = {}): NodeMesh {
  const c = (x: number, y: number, z: number): Vec3 => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]];
  // Ogni faccia è un quadrato dato dai suoi quattro angoli, in senso antiorario visto da fuori
  const quads: Vec3[][] = [
    [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
    [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
    [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
    [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
    [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  quads.forEach((q, i) => {
    q.forEach((v) => positions.push(...v));
    indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  return {
    id: rootId, rootId, path: [rootId], color: '#fff', isHole: false, positions: new Float32Array(positions), indices: new Uint32Array(indices),
    volume: 1, bbox: { min, max }, status: 'NoError', empty: false, ...extra,
  };
}

const sceneOf = (names: string[]): Scene => ({
  nodes: Object.fromEntries(names.map((n) => [n, { ...primitiveDefaults('box'), id: n, name: n, position: [0, 0, 0] } as PrimitiveNode])),
  rootIds: names,
});

const kinds = (issues: ReturnType<typeof analyzePrintability>) => issues.map((i) => `${i.kind}:${i.rootId ?? ''}`);

describe('controlli di stampabilità', () => {
  it('un cubo appoggiato sul piano non dà nessun avviso (la faccia sul piano non è uno sbalzo)', () => {
    expect(analyzePrintability([boxMesh('a', [-10, -10, 0], [10, 10, 20])], sceneOf(['a']), OPTS)).toEqual([]);
  });

  it('un cubo sospeso: avviso di sospensione e sbalzo con la sua area e i triangoli da evidenziare', () => {
    const issues = analyzePrintability([boxMesh('Mensola', [-10, -10, 10], [10, 10, 30])], sceneOf(['Mensola']), OPTS);
    expect(kinds(issues).sort()).toEqual(['floating:Mensola', 'overhang:Mensola']);
    const over = issues.find((i) => i.kind === 'overhang')!;
    expect(over.text).toBe('Sbalzi oltre 45° su «Mensola» (400 mm²)');
    // Due triangoli da tre vertici xyz
    expect(over.triangles).toHaveLength(2 * 9);
    expect(issues.find((i) => i.kind === 'floating')!.text).toContain('sospeso di 10 mm');
  });

  it('un oggetto sopra un altro è sostenuto: né sospeso né sbalzo', () => {
    const issues = analyzePrintability([boxMesh('a', [-10, -10, 0], [10, 10, 20]), boxMesh('b', [-5, -5, 20], [5, 5, 30])], sceneOf(['a', 'b']), OPTS);
    expect(issues).toEqual([]);
  });

  it('sotto il piano e fuori dal volume di stampa sono errori, con lo scarto in mm', () => {
    const below = analyzePrintability([boxMesh('a', [-10, -10, -5], [10, 10, 15])], sceneOf(['a']), OPTS);
    expect(below).toMatchObject([{ kind: 'below', level: 'error', text: '«a» affonda sotto il piano di stampa di 5 mm' }]);
    const out = analyzePrintability([boxMesh('a', [110, -10, 0], [140, 10, 20])], sceneOf(['a']), OPTS);
    expect(out).toMatchObject([{ kind: 'outside', level: 'error', text: '«a» esce dal volume di stampa (X +12 mm)' }]);
    const tall = analyzePrintability([boxMesh('a', [-10, -10, 0], [10, 10, 300])], sceneOf(['a']), OPTS);
    expect(tall[0].text).toContain('Z +44');
    const left = analyzePrintability([boxMesh('a', [-140, -10, 0], [-120, 10, 20])], sceneOf(['a']), OPTS);
    expect(left[0].text).toContain('X −12');
  });

  it('una mesh non valida o vuota si segnala; i fori e gli oggetti fuori dal piatto attivo no', () => {
    const bad = boxMesh('a', [-10, -10, 0], [10, 10, 20], { status: 'NotManifold' });
    expect(analyzePrintability([bad], sceneOf(['a']), OPTS)[0]).toMatchObject({ kind: 'invalid', level: 'error' });
    const empty = boxMesh('a', [0, 0, 0], [0, 0, 0], { empty: true });
    expect(kinds(analyzePrintability([empty], sceneOf(['a']), OPTS))).toEqual(['empty:a']);
    const hole = boxMesh('a', [-10, -10, 30], [10, 10, 50], { isHole: true });
    expect(analyzePrintability([hole], sceneOf(['a']), OPTS)).toEqual([]);
    expect(analyzePrintability([boxMesh('x', [-10, -10, 30], [10, 10, 50])], sceneOf(['a']), OPTS)).toEqual([]);
  });

  it('l\'angolo di sbalzo conta: un triangolo orizzontale è sempre sbalzo, una parete verticale mai', () => {
    // Triangolo orizzontale a z = 1, rivolto in basso (antiorario visto da sotto)
    const flat: NodeMesh = { ...boxMesh('a', [0, 0, 1], [10, 10, 2]), positions: new Float32Array([0, 0, 1, 0, 20, 1, 20, 0, 1]), indices: new Uint32Array([0, 1, 2]) };
    expect(kinds(analyzePrintability([flat], sceneOf(['a']), { ...OPTS, overhangAngle: 80 }))).toContain('overhang:a');
    const wall: NodeMesh = { ...flat, positions: new Float32Array([0, 0, 1, 20, 0, 1, 20, 0, 21]), indices: new Uint32Array([0, 1, 2]) };
    expect(kinds(analyzePrintability([wall], sceneOf(['a']), OPTS))).not.toContain('overhang:a');
  });

  it('le formule che non si calcolano sono errori, con il nome del parametro o dell\'oggetto', () => {
    const scene = sceneOf(['a']);
    scene.params = [{ id: 'p', name: 'spessore', expr: '1 / 0' }];
    (scene.nodes.a as PrimitiveNode).exprs = { 'size.2': { expr: 'spessore * 2' } };
    const issues = analyzePrintability([], scene, OPTS);
    expect(issues.map((i) => i.kind)).toEqual(['formula', 'formula']);
    expect(issues[0].text).toContain('«spessore»');
    expect(issues[1].text).toContain('«a»');
  });

  it('gli errori vengono prima delle attenzioni', () => {
    const issues = analyzePrintability([boxMesh('a', [-10, -10, 10], [10, 10, 30]), boxMesh('b', [200, 0, 0], [220, 10, 10])], sceneOf(['a', 'b']), OPTS);
    expect(issues[0].level).toBe('error');
    expect(issues.at(-1)!.level).toBe('warning');
  });
});
