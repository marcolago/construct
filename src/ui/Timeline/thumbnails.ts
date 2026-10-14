import { create } from 'zustand';
import { getKernel } from '../../kernel/client';
import type { NodeMesh } from '../../kernel/evaluate';
import { useResultStore } from '../../kernel/useKernel';
import { useSceneStore } from '../../scene/store';
import type { Scene } from '../../scene/types';
import { renderThumbnail } from '../../viewport/thumbnail';

/**
 * Miniature isometriche dei passi della timeline. La chiave è la scena stessa: la cronologia (zundo) conserva i
 * riferimenti e Immer li mantiene identici se non cambia nulla, quindi un passo ritrova sempre la sua miniatura, anche
 * dopo Annulla e Ripeti. Il valore è il data URL, oppure `null` se la scena non ha nulla da mostrare.
 */
let cache = new WeakMap<Scene, string | null>();
/** Scene la cui miniatura non si è riusciti a produrre (WebGL assente o contesto perso): non si riprova di continuo. */
let failed = new WeakSet<Scene>();
/** Scena la cui miniatura è in calcolo: se ne calcola una alla volta, per non rubare tempo al kernel. */
let inflight: Scene | null = null;

/** Contatore che cambia a ogni miniatura nuova: fa ridisegnare i tooltip aperti. */
export const useThumbnails = create<{ version: number }>(() => ({ version: 0 }));
const touch = () => useThumbnails.setState((s) => ({ version: s.version + 1 }));

/** Stato della miniatura di una scena: pronta (data URL o null se vuota), in attesa o non disponibile. */
export type ThumbState = { status: 'ready'; url: string | null } | { status: 'pending' } | { status: 'failed' };

export function thumbnailOf(scene: Scene): ThumbState {
  if (cache.has(scene)) return { status: 'ready', url: cache.get(scene) ?? null };
  return failed.has(scene) ? { status: 'failed' } : { status: 'pending' };
}

/** Dimentica tutte le miniature (per i test: la miniatura di un passo si ricalcola al passaggio del mouse). */
export function resetThumbnails(): void {
  cache = new WeakMap();
  failed = new WeakSet();
  touch();
}

/** Con uno strumento aperto (Raccordo, Guscio, Pattern...) la cronologia è in pausa e la scena è un'anteprima. */
const toolOpen = () => !useSceneStore.temporal.getState().isTracking;

/** Fotografa le mesh già calcolate della scena corrente. */
function capture(scene: Scene, meshes: NodeMesh[]): void {
  try {
    cache.set(scene, renderThumbnail(meshes, scene));
  } catch {
    failed.add(scene);
  }
  touch();
}

/**
 * Chiede la miniatura di una scena (un passo della timeline). Se è la scena in vista si usano le mesh già calcolate;
 * altrimenti il worker valuta quella scena senza toccare la cache della scena corrente. Non parte con il kernel
 * occupato, con uno strumento aperto o con un'altra richiesta in corso: chi chiama riprova quando lo stato cambia.
 */
export async function requestThumbnail(scene: Scene): Promise<void> {
  if (cache.has(scene) || failed.has(scene) || inflight) return;
  const result = useResultStore.getState();
  if (result.busy || toolOpen()) return;
  if (result.scene === scene) return capture(scene, result.meshes);

  inflight = scene;
  try {
    const { meshes } = await getKernel().evaluateDetached(scene);
    capture(scene, meshes);
  } catch {
    failed.add(scene);
    touch();
  } finally {
    inflight = null;
  }
}

/**
 * Fotografa ogni stato nuovo della scena quando il kernel finisce il calcolo, così le miniature dei passi sono già
 * pronte quando servono. Salta i calcoli in corso (anteprima di uno slider), le anteprime degli strumenti e le mesh di
 * una scena che nel frattempo è cambiata.
 */
export function startThumbnailCapture(): void {
  let scheduled = false;
  useResultStore.subscribe((state) => {
    if (state.busy || !state.scene || scheduled || cache.has(state.scene) || failed.has(state.scene)) return;
    if (state.scene !== useSceneStore.getState().scene || toolOpen()) return;
    scheduled = true;
    // Quando il browser è libero: il disegno non deve rallentare l'interazione
    const run = () => {
      scheduled = false;
      const now = useResultStore.getState();
      if (now.busy || !now.scene || now.scene !== useSceneStore.getState().scene || toolOpen()) return;
      if (!cache.has(now.scene) && !failed.has(now.scene)) capture(now.scene, now.meshes);
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 1000 });
    else window.setTimeout(run, 50);
  });
}
