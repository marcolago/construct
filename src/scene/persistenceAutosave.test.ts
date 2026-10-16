import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrimitiveNode, Scene } from './types';

/**
 * Autosalvataggio in IndexedDB con versione: una build vecchia (PWA rimasta in cache) non deve aprire né sovrascrivere
 * un progetto scritto da una versione più recente. `idb-keyval` è simulato con una mappa in memoria.
 */

const db = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (key: string) => db.get(key),
  set: async (key: string, value: unknown) => {
    db.set(key, value);
  },
}));

const box: PrimitiveNode = { id: 'b', type: 'primitive', name: 'Cubo', kind: 'box', size: [10, 10, 10], cornerRadius: 0, position: [0, 0, 5], rotation: [0, 0, 0], mode: 'solid', color: '#ff0000' };
const savedScene: Scene = { nodes: { b: box }, rootIds: ['b'] };

/** Moduli nuovi a ogni prova: lo stato "salvataggio sospeso" di `persistence` è globale. */
async function load() {
  vi.resetModules();
  const [{ initPersistence }, { useSceneStore }, { notify }] = await Promise.all([import('./persistence'), import('./store'), import('../ui/notify/notifyStore')]);
  const error = vi.spyOn(notify, 'error');
  return { initPersistence, store: useSceneStore, error };
}

beforeEach(() => {
  db.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('autosalvataggio con versione', () => {
  it('una scena senza versione (salvata da una build precedente) si apre come sempre', async () => {
    db.set('construct:scene', savedScene);
    const { initPersistence, store, error } = await load();
    expect(await initPersistence()).toBe(true);
    expect(Object.keys(store.getState().scene.nodes)).toEqual(['b']);
    expect(error).not.toHaveBeenCalled();
  });

  it('una scena della stessa versione o di una precedente si apre', async () => {
    db.set('construct:scene', savedScene);
    db.set('construct:scene-version', 1);
    const { initPersistence, store } = await load();
    expect(await initPersistence()).toBe(true);
    expect(store.getState().scene.rootIds).toEqual(['b']);
  });

  it('a ogni modifica si scrivono la scena e la versione del formato', async () => {
    const { initPersistence, store } = await load();
    await initPersistence();
    store.getState().addPrimitive('sphere');
    await vi.advanceTimersByTimeAsync(500);
    expect((db.get('construct:scene') as Scene).rootIds).toHaveLength(1);
    expect(db.get('construct:scene-version')).toBeGreaterThanOrEqual(6);
  });

  it('un progetto scritto da una versione più recente non si apre, avvisa e non viene sovrascritto', async () => {
    db.set('construct:scene', savedScene);
    db.set('construct:scene-version', 999);
    const { initPersistence, store, error } = await load();
    expect(await initPersistence()).toBe(false);
    expect(store.getState().scene.rootIds).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('versione più recente'));
    // Lavorando nella sessione vuota nulla viene scritto sopra il progetto più nuovo
    store.getState().addPrimitive('cylinder');
    await vi.advanceTimersByTimeAsync(1000);
    expect(db.get('construct:scene')).toBe(savedScene);
    expect(db.get('construct:scene-version')).toBe(999);
  });
});
