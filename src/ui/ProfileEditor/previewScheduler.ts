import type { NodeMesh } from '../../kernel/evaluate';
import type { Scene } from '../../scene/types';

/** Intervallo minimo tra l'inizio di due calcoli dell'anteprima (ms): durante un trascinamento il kernel non è sommerso. */
export const MIN_INTERVAL = 100;

/** Stato dell'anteprima: in calcolo, pronta o in errore. L'ultima mesh resta visibile mentre se ne calcola una nuova. */
export interface PreviewResult {
  state: 'busy' | 'ready' | 'error';
  mesh: NodeMesh | null;
}

interface Options {
  /** Calcola la mesh di una scena (nel kernel vero: `evaluateDetached`). */
  evaluate: (scene: Scene) => Promise<{ meshes: NodeMesh[] }>;
  /** Chiamata a ogni cambio di stato dell'anteprima. */
  onChange: (result: PreviewResult) => void;
  /** Orologio in ms (di prova nei test). */
  now?: () => number;
}

export interface PreviewScheduler {
  /** Nuova scena da mostrare (`null` = nessun disegno valido); `immediate` dice che il gesto è concluso e il calcolo parte subito. */
  update: (scene: Scene | null, immediate: boolean) => void;
  /** Ferma timer e risposte in arrivo (smontaggio della modale). */
  dispose: () => void;
}

/**
 * Scheduler dell'anteprima 3D: una sola richiesta alla volta e non più di una ogni `MIN_INTERVAL`; se nel frattempo il
 * disegno cambia vince l'ultimo. Non conosce React: lo stato esce da `onChange`, così si prova con i timer finti.
 */
export function createPreviewScheduler({ evaluate, onChange, now = () => performance.now() }: Options): PreviewScheduler {
  let alive = true;
  let inflight = false;
  let last = -Infinity;
  // Scena in attesa (l'ultima richiesta) e ultima scena mandata al kernel
  let pending: Scene | null = null;
  let sent: Scene | null = null;
  // Cresce quando il disegno non è più valido: la risposta di un calcolo di prima si scarta
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: PreviewResult = { state: 'busy', mesh: null };

  const emit = (next: PreviewResult) => {
    result = next;
    onChange(next);
  };

  /** Pianifica l'avvio della richiesta in attesa; se una è già in volo parte alla sua risposta. */
  const schedule = (immediately: boolean) => {
    if (inflight) return;
    clearTimeout(timer);
    const wait = immediately ? 0 : Math.max(0, MIN_INTERVAL - (now() - last));
    timer = setTimeout(() => {
      const next = pending;
      pending = null;
      if (!next) return;
      inflight = true;
      last = now();
      sent = next;
      const mine = generation;
      evaluate(next)
        .then((res) => {
          if (!alive) return;
          inflight = false;
          // Una risposta di un disegno ormai scartato non rimette la sua mesh
          if (mine === generation) {
            const mesh = res.meshes.find((m) => !m.isHole) ?? null;
            // Se è già arrivato un disegno più nuovo la mesh si mostra lo stesso (progressiva) e si resta in calcolo
            emit({ state: pending ? 'busy' : 'ready', mesh });
          }
          if (pending) schedule(false);
        })
        .catch(() => {
          if (!alive) return;
          inflight = false;
          if (mine === generation) emit({ ...result, state: 'error' });
          if (pending) schedule(false);
        });
    }, wait);
  };

  return {
    update(scene, immediate) {
      if (!scene) {
        pending = null;
        sent = null;
        generation += 1;
        clearTimeout(timer);
        emit({ state: 'ready', mesh: null });
        return;
      }
      // Gesto concluso con la stessa scena già mandata al kernel e nulla di più nuovo in attesa: non c'è niente da ricalcolare
      if (scene === sent && pending === null) return;
      pending = scene;
      if (result.state !== 'busy') emit({ ...result, state: 'busy' });
      schedule(immediate);
    },
    dispose() {
      alive = false;
      clearTimeout(timer);
    },
  };
}
