import { describe, expect, it } from 'vitest';
import { shape2dDefaults } from './defaults';
import { migrateLegacyShapes } from './legacyShapes';
import { sceneFromJson } from './persistence';
import { shapeContours, type PolygonShape } from './shapes2d';
import type { Scene, Shape2DNode, Vec3 } from './types';

/** Nodo come lo salvava la versione 0.65 e precedenti: `star5` e `star6` senza `points`. */
const legacyStar = (id: string, kind: 'star5' | 'star6', ratio: number, extra: Record<string, unknown> = {}): Shape2DNode => {
  const { points: _points, ...rest } = shape2dDefaults('star') as Record<string, unknown>;
  return { ...rest, kind, id, name: id, position: [0, 0, 0] as Vec3, ratio, width: 30, depth: 30, ...extra } as unknown as Shape2DNode;
};

const sceneOf = (nodes: Shape2DNode[]): Scene => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds: nodes.map((n) => n.id) });

describe('migrazione delle stelle a 5 e 6 punte', () => {
  it('star5 e star6 diventano star con points e lo stesso contorno di prima', () => {
    const scene = sceneOf([legacyStar('a', 'star5', 0.4), legacyStar('b', 'star6', 0.5, { exprs: { ratio: { expr: 'r' } } })]);
    const migrated = migrateLegacyShapes(scene);
    expect(migrated.nodes.a).toMatchObject({ kind: 'star', points: 5, ratio: 0.4, width: 30 });
    expect(migrated.nodes.b).toMatchObject({ kind: 'star', points: 6, ratio: 0.5, exprs: { ratio: { expr: 'r' } } });
    // Il contorno è quello delle vecchie forme (10 e 12 vertici, punta in alto)
    expect(shapeContours(migrated.nodes.a as unknown as PolygonShape)[0]).toHaveLength(10);
    expect(shapeContours(migrated.nodes.b as unknown as PolygonShape)[0]).toHaveLength(12);
    // La scena di partenza non si modifica
    expect((scene.nodes.a as { kind: string }).kind).toBe('star5');
  });

  it('una scena senza stelle vecchie si restituisce com\'è', () => {
    const scene = sceneOf([{ ...shape2dDefaults('star'), id: 'n', name: 'n', position: [0, 0, 0] as Vec3 } as Shape2DNode]);
    expect(migrateLegacyShapes(scene)).toBe(scene);
  });

  it('un progetto salvato con star6 si apre come Stella a 6 punte', () => {
    const file = JSON.stringify({ format: 'construct-scene', version: 5, scene: sceneOf([legacyStar('a', 'star6', 0.5)]), assets: {} });
    expect(sceneFromJson(file).scene.nodes.a).toMatchObject({ kind: 'star', points: 6, ratio: 0.5 });
  });
});
