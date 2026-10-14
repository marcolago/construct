import * as THREE from 'three';
import type { NodeMesh } from '../kernel/evaluate';
import { boundsByRoot } from '../kernel/placement';
import { useResultStore } from '../kernel/useKernel';
import type { Bounds } from '../scene/placement';
import { useSceneStore } from '../scene/store';
import type { Scene, Vec3 } from '../scene/types';
import { useUiStore } from '../ui/uiStore';
import type { BedSize, Theme } from '../ui/uiStore';
import { boundingSphere, PRESET_DIRECTIONS, PRESET_LABELS, viewBounds } from './cameraControl';
import type { ViewPreset } from './cameraControl';
import { LIGHTS } from './lights';
import { PALETTES } from './palette';
import type { ViewportPalette } from './palette';

/**
 * Immagine con le 4 viste (alto, fronte, lato, isometrica) del piatto in vista, in un solo PNG 2×2.
 * Non tocca la vista 3D: costruisce una scena a parte con le mesh calcolate dal kernel (senza contorni di selezione,
 * gizmo, quote o altri overlay) e la disegna con un renderer fuori schermo, con le stesse luci e lo stesso tone mapping.
 */

/** Sfondo dell'immagine: quello del tema attuale, bianco (per documenti e stampa) oppure trasparente. */
export type ImageBackground = 'theme' | 'white' | 'transparent';

/** Viste nell'ordine della griglia: riga sopra Alto e Fronte, riga sotto Lato e Isometrica. */
export const SNAPSHOT_VIEWS: ViewPreset[] = ['top', 'front', 'side', 'iso'];

/** Lato di ogni vista, in pixel: l'immagine è un quadrato diviso esattamente in 4 sezioni uguali, senza spazi in mezzo. */
export const CELL = 800;

/** Angolo in alto a sinistra della vista `index` (0-3) nell'immagine 2×2. */
export function cellOrigin(index: number, cell = CELL): { x: number; y: number } {
  return { x: (index % 2) * cell, y: Math.floor(index / 2) * cell };
}

/** Lato dell'immagine intera (due viste). */
export const sheetSize = (cell = CELL): number => cell * 2;

/** Spessore (px) delle linee che segnano la divisione in 4 sezioni: stanno a cavallo del confine, senza toglierle spazio. */
export const DIVIDER = 2;

/** Dove sta la camera ortografica di una vista e quanto vede. Tutte le viste hanno la stessa scala. */
export interface ViewFrame {
  position: Vec3;
  target: Vec3;
  /** Metà del lato visibile, in mm. */
  halfSize: number;
  near: number;
  far: number;
}

/**
 * Inquadratura di una vista: il centro è quello della sfera che contiene l'ingombro, la camera sta lungo la direzione del
 * preset (le stesse di `cameraControl`) e il lato visibile è il raggio con un po' di margine. La distanza e i piani di
 * taglio lasciano dentro anche il piano di stampa (`reach` = lato maggiore del piano).
 */
export function viewFrame(preset: ViewPreset, bounds: Bounds, reach = 0): ViewFrame {
  const { center, radius } = boundingSphere(bounds);
  const r = Math.max(radius, 1);
  const distance = r * 2 + reach + 50;
  const direction = PRESET_DIRECTIONS[preset];
  return {
    position: center.map((c, i) => c + direction[i] * distance) as Vec3,
    target: center,
    halfSize: r * 1.15,
    near: 0.1,
    far: distance * 2 + reach * 2 + 100,
  };
}

/** Aspetto dell'immagine: i colori seguono il tema, tranne con lo sfondo bianco (tema chiaro) e trasparente (etichette scure, leggibili su qualunque fondo). */
type Look = Theme | 'transparent';

/** Colori dell'etichetta di ogni vista: sfondo semitrasparente e testo. */
const LABEL_COLORS: Record<Look, { fill: string; text: string }> = {
  dark: { fill: 'rgba(20, 23, 28, 0.78)', text: '#e6e9ee' },
  light: { fill: 'rgba(255, 255, 255, 0.82)', text: '#1e2433' },
  transparent: { fill: 'rgba(20, 23, 28, 0.78)', text: '#e6e9ee' },
};

/** Colore delle linee di divisione. */
const DIVIDER_COLORS: Record<Look, string> = { dark: '#3a4452', light: '#aab6c8', transparent: 'rgba(128, 128, 128, 0.55)' };

/** Segmenti della griglia del piano (celle da 10 mm; le righe ogni 50 mm dall'origine sono le principali). */
function gridPoints(bed: BedSize): { cell: number[]; section: number[] } {
  const cell: number[] = [];
  const section: number[] = [];
  const z = 0.02;
  const pushX = (x: number) => (x % 50 === 0 ? section : cell).push(x, -bed.depth / 2, z, x, bed.depth / 2, z);
  const pushY = (y: number) => (y % 50 === 0 ? section : cell).push(-bed.width / 2, y, z, bed.width / 2, y, z);
  for (let x = Math.ceil(-bed.width / 20) * 10; x <= bed.width / 2; x += 10) pushX(x);
  for (let y = Math.ceil(-bed.depth / 20) * 10; y <= bed.depth / 2; y += 10) pushY(y);
  return { cell, section };
}

/** Aggiunge alla scena il piano di stampa (base, griglia e bordo) con i colori del tema. */
function addBed(scene: THREE.Scene, bed: BedSize, palette: ViewportPalette, disposables: { dispose: () => void }[]): void {
  const plateGeometry = new THREE.PlaneGeometry(bed.width, bed.depth);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: palette.bedPlate, roughness: 1 });
  const plate = new THREE.Mesh(plateGeometry, plateMaterial);
  // Leggermente sotto lo zero, come nella vista, per non sovrapporsi alla griglia
  plate.position.z = -0.05;
  scene.add(plate);
  disposables.push(plateGeometry, plateMaterial);

  const lines = (points: number[], color: string, loop = false) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color });
    scene.add(loop ? new THREE.LineLoop(geometry, material) : new THREE.LineSegments(geometry, material));
    disposables.push(geometry, material);
  };
  const { cell, section } = gridPoints(bed);
  lines(cell, palette.gridCell);
  lines(section, palette.gridSection);
  const hx = bed.width / 2;
  const hy = bed.depth / 2;
  lines([-hx, -hy, 0.03, hx, -hy, 0.03, hx, hy, 0.03, -hx, hy, 0.03], palette.bedBorder, true);
}

/** Scritta della vista in alto a sinistra della sua cella, su un riquadro semitrasparente. */
function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, look: Look): void {
  const size = Math.round(CELL * 0.04);
  ctx.font = `600 ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  const pad = size * 0.5;
  const width = ctx.measureText(text).width + pad * 2;
  const height = size + pad;
  const left = x + size * 0.6;
  const top = y + size * 0.6;
  ctx.fillStyle = LABEL_COLORS[look].fill;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, top, width, height, height / 3);
  else ctx.rect(left, top, width, height);
  ctx.fill();
  ctx.fillStyle = LABEL_COLORS[look].text;
  ctx.fillText(text, left + pad, top + height / 2);
}

/**
 * Mesh da fotografare: quelle delle radici visibili di `scene`, senza mesh vuote né fori sciolti (traslucidi, non si
 * stampano). `meshes` sono le mesh calcolate per quella scena.
 */
export function visibleParts(scene: Scene, meshes: NodeMesh[]): NodeMesh[] {
  const visibleRoots = scene.rootIds.filter((id) => !scene.nodes[id]?.hidden);
  return meshes.filter((m) => !m.empty && !m.isHole && visibleRoots.includes(m.rootId));
}

/** Ingombro che contiene tutte le mesh (null se la lista è vuota). */
export function meshBounds(parts: NodeMesh[]): Bounds | null {
  if (parts.length === 0) return null;
  return parts.reduce<Bounds>(
    (b, m) => ({ min: b.min.map((v, i) => Math.min(v, m.bbox.min[i])) as Vec3, max: b.max.map((v, i) => Math.max(v, m.bbox.max[i])) as Vec3 }),
    { min: [...parts[0].bbox.min], max: [...parts[0].bbox.max] },
  );
}

/** Aggiunge alla scena le luci della vista 3D (le stesse in ogni immagine). */
export function addLights(scene: THREE.Scene, palette: ViewportPalette): void {
  scene.add(new THREE.HemisphereLight(palette.skyLight, palette.groundLight, LIGHTS.hemisphere));
  for (const light of [LIGHTS.key, LIGHTS.fill]) {
    const lamp = new THREE.DirectionalLight(0xffffff, light.intensity);
    lamp.position.set(...light.position);
    scene.add(lamp);
  }
}

/** Aggiunge alla scena una mesh per ogni parte, con il suo colore; geometrie e materiali creati vanno in `disposables`. */
export function addParts(scene: THREE.Scene, parts: NodeMesh[], disposables: { dispose: () => void }[]): void {
  for (const m of parts) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: m.color, flatShading: true, roughness: 0.55, metalness: 0.05 });
    scene.add(new THREE.Mesh(geometry, material));
    disposables.push(geometry, material);
  }
}

/**
 * PNG con le 4 viste del piatto in vista, o `null` se non c'è nulla da fotografare. Gli oggetti nascosti e i fori sciolti
 * (traslucidi, non si stampano) non compaiono; il piano di stampa sì, se è visibile. Lo sfondo è quello del tema, bianco
 * o trasparente (`background`).
 */
export async function captureViews(background: ImageBackground = 'theme'): Promise<Blob | null> {
  const sceneState = useSceneStore.getState().scene;
  const ui = useUiStore.getState();
  const visibleRoots = sceneState.rootIds.filter((id) => !sceneState.nodes[id]?.hidden);
  const parts = visibleParts(sceneState, useResultStore.getState().meshes);
  if (parts.length === 0) return null;

  // Con lo sfondo bianco i colori sono quelli del tema chiaro (piano e griglia compresi), con la base bianca
  const look: Look = background === 'white' ? 'light' : background === 'transparent' ? 'transparent' : ui.theme;
  const palette: ViewportPalette = background === 'white' ? { ...PALETTES.light, background: '#ffffff' } : PALETTES[ui.theme];
  const bounds = viewBounds({ selection: [], rootIds: visibleRoots, boundsByRoot: boundsByRoot(), bed: ui.bedSize }, false);
  const reach = ui.bedMode === 'full' ? Math.max(ui.bedSize.width, ui.bedSize.depth) : 0;

  // Scena a parte: sfondo, luci della vista, oggetti e (se visibile) piano di stampa
  const scene = new THREE.Scene();
  // Trasparente: nessun colore di sfondo, il canvas parte con alpha 0
  scene.background = background === 'transparent' ? null : new THREE.Color(palette.background);
  addLights(scene, palette);
  const disposables: { dispose: () => void }[] = [];
  addParts(scene, parts, disposables);
  if (ui.bedMode === 'full') addBed(scene, ui.bedSize, palette, disposables);

  // Renderer fuori schermo con lo stesso tone mapping e spazio colore della vista (default di R3F)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: background === 'transparent' });
  if (background === 'transparent') renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.setSize(CELL, CELL, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const sheet = document.createElement('canvas');
  sheet.width = sheet.height = sheetSize();
  const ctx = sheet.getContext('2d');
  try {
    if (!ctx) throw new Error('Canvas 2D non disponibile.');
    SNAPSHOT_VIEWS.forEach((preset, i) => {
      const frame = viewFrame(preset, bounds, reach);
      const camera = new THREE.OrthographicCamera(-frame.halfSize, frame.halfSize, frame.halfSize, -frame.halfSize, frame.near, frame.far);
      camera.up.set(0, 0, 1);
      camera.position.set(...frame.position);
      camera.lookAt(...frame.target);
      renderer.render(scene, camera);
      const { x, y } = cellOrigin(i);
      ctx.drawImage(renderer.domElement, x, y);
    });
    // Le linee di divisione e poi le etichette (così nessuna vista le copre)
    ctx.fillStyle = DIVIDER_COLORS[look];
    ctx.fillRect(CELL - DIVIDER / 2, 0, DIVIDER, sheet.height);
    ctx.fillRect(0, CELL - DIVIDER / 2, sheet.width, DIVIDER);
    SNAPSHOT_VIEWS.forEach((preset, i) => {
      const { x, y } = cellOrigin(i);
      drawLabel(ctx, PRESET_LABELS[preset], x, y, look);
    });
    return await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, 'image/png'));
  } finally {
    // Si liberano solo le risorse create qui (geometrie e materiali sono copie: i buffer dei dati restano del kernel)
    for (const d of disposables) d.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
