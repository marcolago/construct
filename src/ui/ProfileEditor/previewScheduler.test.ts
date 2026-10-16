import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeMesh } from '../../kernel/evaluate';
import type { Scene } from '../../scene/types';
import { createPreviewScheduler, MIN_INTERVAL, type PreviewResult } from './previewScheduler';

/** Scena e mesh di comodo: lo scheduler le tratta come valori opachi. */
const sceneOf = (): Scene => ({ nodes: {}, rootIds: [] });
const meshOf = (id: string) => ({ rootId: id, isHole: false }) as unknown as NodeMesh;

/** Kernel finto: ogni richiesta resta in sospeso finché il test non la risolve. */
function fakeKernel() {
  const calls: { scene: Scene; resolve: (mesh: NodeMesh) => void; reject: () => void }[] = [];
  const evaluate = vi.fn(
    (scene: Scene) =>
      new Promise<{ meshes: NodeMesh[] }>((resolve, reject) => {
        calls.push({ scene, resolve: (mesh) => resolve({ meshes: [mesh] }), reject: () => reject(new Error('kernel')) });
      }),
  );
  return { calls, evaluate };
}

function setup() {
  const kernel = fakeKernel();
  const states: PreviewResult[] = [];
  const scheduler = createPreviewScheduler({ evaluate: kernel.evaluate, onChange: (r) => states.push(r), now: () => Date.now() });
  /** Lascia correre i timer e le promesse in coda. */
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
  return { kernel, states, scheduler, tick, last: () => states[states.length - 1] };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('scheduler dell\'anteprima', () => {
  it('la prima scena parte subito e la mesh arrivata porta lo stato a pronto', async () => {
    const { kernel, scheduler, tick, last } = setup();
    const a = sceneOf();
    scheduler.update(a, false);
    await tick();
    expect(kernel.evaluate).toHaveBeenCalledTimes(1);
    kernel.calls[0].resolve(meshOf('a'));
    await tick();
    expect(last()).toMatchObject({ state: 'ready', mesh: { rootId: 'a' } });
  });

  it('a gesto concluso con la stessa scena già calcolata non si ricalcola', async () => {
    const { kernel, scheduler, tick, states } = setup();
    const a = sceneOf();
    scheduler.update(a, false);
    await tick();
    kernel.calls[0].resolve(meshOf('a'));
    await tick();
    const changes = states.length;
    // Il gesto finisce: `immediate` passa a vero ma la scena è la stessa
    scheduler.update(a, true);
    await tick(MIN_INTERVAL * 3);
    expect(kernel.evaluate).toHaveBeenCalledTimes(1);
    expect(states).toHaveLength(changes);
  });

  it('a gesto concluso con la stessa scena ancora in volo non ne parte una seconda', async () => {
    const { kernel, scheduler, tick } = setup();
    const a = sceneOf();
    scheduler.update(a, false);
    await tick();
    scheduler.update(a, true);
    await tick(MIN_INTERVAL * 3);
    expect(kernel.evaluate).toHaveBeenCalledTimes(1);
  });

  it('due calcoli distano almeno MIN_INTERVAL, e a gesto concluso l\'ultima scena in attesa parte subito', async () => {
    const { kernel, scheduler, tick } = setup();
    const [a, b] = [sceneOf(), sceneOf()];
    scheduler.update(a, false);
    await tick();
    scheduler.update(b, false);
    kernel.calls[0].resolve(meshOf('a'));
    await tick();
    // B aspetta il ritmo dei calcoli
    expect(kernel.evaluate).toHaveBeenCalledTimes(1);
    await tick(MIN_INTERVAL - 1);
    // Il gesto finisce: B parte senza attendere il resto dell'intervallo
    scheduler.update(b, true);
    await tick();
    expect(kernel.evaluate).toHaveBeenCalledTimes(2);
    expect(kernel.calls[1].scene).toBe(b);
  });

  it('di più scene arrivate durante un calcolo conta solo l\'ultima', async () => {
    const { kernel, scheduler, tick } = setup();
    const [a, b, c] = [sceneOf(), sceneOf(), sceneOf()];
    scheduler.update(a, false);
    await tick();
    scheduler.update(b, false);
    scheduler.update(c, false);
    kernel.calls[0].resolve(meshOf('a'));
    await tick(MIN_INTERVAL);
    expect(kernel.evaluate).toHaveBeenCalledTimes(2);
    expect(kernel.calls[1].scene).toBe(c);
  });

  it('senza disegno valido la mesh si toglie e la risposta in ritardo di un calcolo già partito non la rimette', async () => {
    const { kernel, scheduler, tick, last } = setup();
    scheduler.update(sceneOf(), false);
    await tick();
    // L'ultimo contorno valido sparisce mentre il calcolo è in volo
    scheduler.update(null, false);
    expect(last()).toEqual({ state: 'ready', mesh: null });
    kernel.calls[0].resolve(meshOf('vecchia'));
    await tick();
    expect(last()).toEqual({ state: 'ready', mesh: null });
  });

  it('dopo uno scarto un disegno nuovo si calcola comunque, anche se la risposta vecchia arriva dopo', async () => {
    const { kernel, scheduler, tick, last } = setup();
    scheduler.update(sceneOf(), false);
    await tick();
    scheduler.update(null, false);
    const nuova = sceneOf();
    scheduler.update(nuova, false);
    // La risposta vecchia si scarta ma libera lo scheduler: parte la scena nuova
    kernel.calls[0].resolve(meshOf('vecchia'));
    await tick(MIN_INTERVAL);
    expect(kernel.evaluate).toHaveBeenCalledTimes(2);
    expect(kernel.calls[1].scene).toBe(nuova);
    kernel.calls[1].resolve(meshOf('nuova'));
    await tick();
    expect(last()).toMatchObject({ state: 'ready', mesh: { rootId: 'nuova' } });
  });

  it('un errore del kernel lascia l\'ultima mesh e segna l\'errore; il disegno successivo riparte', async () => {
    const { kernel, scheduler, tick, last } = setup();
    scheduler.update(sceneOf(), false);
    await tick();
    kernel.calls[0].resolve(meshOf('a'));
    await tick();
    scheduler.update(sceneOf(), false);
    await tick(MIN_INTERVAL);
    kernel.calls[1].reject();
    await tick();
    expect(last()).toMatchObject({ state: 'error', mesh: { rootId: 'a' } });
    scheduler.update(sceneOf(), false);
    await tick(MIN_INTERVAL);
    expect(kernel.evaluate).toHaveBeenCalledTimes(3);
  });

  it('dopo dispose nessuna risposta cambia lo stato', async () => {
    const { kernel, scheduler, tick, states } = setup();
    scheduler.update(sceneOf(), false);
    await tick();
    scheduler.dispose();
    const changes = states.length;
    kernel.calls[0].resolve(meshOf('a'));
    await tick();
    expect(states).toHaveLength(changes);
  });
});
