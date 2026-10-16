import type { Scene, SceneNode } from './types';

/** Punte delle vecchie forme "Stella 5 punte" e "Stella 6 punte", diventate un'unica Stella con il numero di punte. */
const LEGACY_STAR_POINTS: Record<string, number> = { star5: 5, star6: 6 };

/**
 * Porta le forme dei progetti delle versioni precedenti a quelle attuali: `star5` e `star6` diventano `star` con `points`
 * (raggio interno, misure e formule restano quelle). Una scena senza forme vecchie si restituisce com'è.
 */
export function migrateLegacyShapes(scene: Scene): Scene {
  // `kind` dei file vecchi non è più nel tipo: si legge come testo
  const kindOf = (node: SceneNode) => (node.type === 'shape2d' ? (node.kind as string) : '');
  const legacy = Object.values(scene.nodes).filter((node) => kindOf(node) in LEGACY_STAR_POINTS);
  if (legacy.length === 0) return scene;
  const nodes = { ...scene.nodes };
  for (const node of legacy) nodes[node.id] = { ...node, kind: 'star', points: LEGACY_STAR_POINTS[kindOf(node)] } as typeof node;
  return { ...scene, nodes };
}
