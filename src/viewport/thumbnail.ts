import * as THREE from 'three';
import type { NodeMesh } from '../kernel/evaluate';
import type { Scene } from '../scene/types';
import { useUiStore } from '../ui/uiStore';
import { PALETTES } from './palette';
import { addLights, addParts, meshBounds, viewFrame, visibleParts } from './snapshot';

/** Lato della miniatura, in pixel. */
export const THUMB_SIZE = 192;

/**
 * Un solo renderer fuori schermo per tutte le miniature, creato alla prima richiesta: i contesti WebGL sono pochi e
 * costosi da creare. `preserveDrawingBuffer` serve a leggere l'immagine dopo il rendering.
 */
let renderer: THREE.WebGLRenderer | null = null;

function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  const created = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  created.setClearColor(0x000000, 0);
  created.setPixelRatio(1);
  created.setSize(THUMB_SIZE, THUMB_SIZE, false);
  // Stesso tone mapping e spazio colore della vista (default di R3F)
  created.toneMapping = THREE.ACESFilmicToneMapping;
  created.outputColorSpace = THREE.SRGBColorSpace;
  renderer = created;
  return created;
}

/**
 * Miniatura isometrica (data URL WebP con sfondo trasparente) delle mesh di `scene`, o `null` se non c'è nulla da
 * mostrare (scena vuota o tutta nascosta); se il rendering fallisce lancia l'errore. Non tocca la vista 3D: usa una
 * scena a parte e le stesse luci.
 */
export function renderThumbnail(meshes: NodeMesh[], scene: Scene): string | null {
  const parts = visibleParts(scene, meshes);
  const bounds = meshBounds(parts);
  if (!bounds) return null;

  const stage = new THREE.Scene();
  addLights(stage, PALETTES[useUiStore.getState().theme]);
  const disposables: { dispose: () => void }[] = [];
  addParts(stage, parts, disposables);
  try {
    const gl = getRenderer();
    // Vista isometrica con la stessa inquadratura dell'immagine con le 4 viste
    const frame = viewFrame('iso', bounds);
    const camera = new THREE.OrthographicCamera(-frame.halfSize, frame.halfSize, frame.halfSize, -frame.halfSize, frame.near, frame.far);
    camera.up.set(0, 0, 1);
    camera.position.set(...frame.position);
    camera.lookAt(...frame.target);
    gl.render(stage, camera);
    // Si legge subito dopo il rendering, prima che il buffer venga ripulito
    return gl.domElement.toDataURL('image/webp', 0.85);
  } catch (err) {
    // WebGL non disponibile o contesto perso: si riparte con un renderer nuovo alla prossima richiesta
    renderer?.dispose();
    renderer = null;
    throw err;
  } finally {
    // Si liberano solo le risorse create qui (geometrie e materiali sono copie: i buffer dei dati restano a chi li ha calcolati)
    for (const d of disposables) d.dispose();
  }
}
