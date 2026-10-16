import type { DieFaces, Scene, SceneNode } from './types';

/** Punte delle vecchie forme "Stella 5 punte" e "Stella 6 punte", diventate un'unica Stella con il numero di punte. */
const LEGACY_STAR_POINTS: Record<string, number> = { star5: 5, star6: 6 };

/** Facce dei vecchi solidi dei dadi, diventati un solo Dado con il numero di facce. */
const LEGACY_DIE_FACES: Record<string, DieFaces> = { octahedron: 8, decahedron: 10, dodecahedron: 12, icosahedron: 20 };

/**
 * Porta le forme dei progetti delle versioni precedenti a quelle attuali: `star5` e `star6` diventano `star` con `points`,
 * e Ottaedro, Decaedro, Dodecaedro e Icosaedro diventano `die` con `faces` (misure, raccordo e formule restano quelle).
 * Una scena senza forme vecchie si restituisce com'è.
 */
export function migrateLegacyShapes(scene: Scene): Scene {
  // `kind` dei file vecchi non è più nel tipo: si legge come testo
  const kindOf = (node: SceneNode) => (node.type === 'shape2d' || node.type === 'primitive' ? (node.kind as string) : '');
  const legacy = Object.values(scene.nodes).filter((node) => kindOf(node) in LEGACY_STAR_POINTS || kindOf(node) in LEGACY_DIE_FACES);
  if (legacy.length === 0) return scene;
  const nodes = { ...scene.nodes };
  for (const node of legacy) {
    const kind = kindOf(node);
    nodes[node.id] = (kind in LEGACY_STAR_POINTS ? { ...node, kind: 'star', points: LEGACY_STAR_POINTS[kind] } : { ...node, kind: 'die', faces: LEGACY_DIE_FACES[kind] }) as typeof node;
  }
  return { ...scene, nodes };
}
