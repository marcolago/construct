import { create } from 'zustand';
import { getKernel } from '../../kernel/client';
import { boundsByRoot } from '../../kernel/placement';
import { lastTool, rememberTool } from '../../scene/lastValues';
import { round } from '../../scene/math';
import type { Bounds } from '../../scene/placement';
import { buildSplit, canSplit, connectorLayout, connectorPrimitive, DEFAULT_CONNECTORS, planeAxes } from '../../scene/splitTool';
import type { ConnectorOptions } from '../../scene/splitTool';
import { labelled, useSceneStore } from '../../scene/store';
import type { Scene } from '../../scene/types';

/**
 * Strumento Dividi: taglia l'oggetto selezionato in due con un piano perpendicolare a un asse, che si può inclinare di un
 * angolo (per esempio 45°) attorno a un altro asse, e può aggiungere connettori (perni e sedi, oppure fori e spine) per
 * rimontare le due metà. Stesso schema del
 * Guscio: mentre il pannello è aperto la cronologia è in pausa e l'anteprima (le due metà) vive nella scena; OK
 * registra un solo passo di Annulla, Esc rimette tutto com'era.
 */

export type SplitAxis = 0 | 1 | 2;

interface SplitToolState {
  active: boolean;
  /** Oggetto da dividere. */
  targetId: string | null;
  /** Asse perpendicolare al piano (0 = X, 1 = Y, 2 = Z). */
  axis: SplitAxis;
  /** Quota del piano lungo l'asse, nel mondo (mm). */
  offset: number;
  /** Inclinazione del piano: angolo in gradi (0 = perpendicolare all'asse) e asse attorno a cui ruota (diverso da `axis`). */
  angle: number;
  tiltAxis: SplitAxis;
  /** Connettori sul piano di taglio (tipo `none` = nessuno). */
  connectors: ConnectorOptions;
  /** Indici (da 0) dei connettori che escono dal pezzo, secondo il kernel: per l'avviso nel pannello e il colore dei contorni. */
  outside: number[];
  /** Ingombro del pezzo nel mondo, dal kernel: limiti dello slider e misura del cubo di taglio. */
  bounds: Bounds | null;
  /** Motivo per cui il taglio non si applica (piano fuori dal pezzo). */
  error: string | null;
  /** Scena prima dell'anteprima: serve a ripristinarla e a registrare un solo passo di Annulla. */
  base: Scene | null;
  /** Le due metà create dall'anteprima. */
  ids: [string, string] | null;
  /** L'oggetto con le spine sciolte, solo con i connettori di tipo Spine. */
  dowelsId: string | null;

  start: () => void;
  cancel: () => void;
  commit: () => void;
  setOption: (patch: Partial<Pick<SplitToolState, 'axis' | 'offset' | 'angle' | 'tiltAxis'>>) => void;
  setConnectors: (patch: Partial<ConnectorOptions>) => void;
}

const INITIAL = { active: false, targetId: null, axis: 0 as SplitAxis, offset: 0, angle: 0, tiltAxis: 1 as SplitAxis, connectors: DEFAULT_CONNECTORS, outside: [] as number[], bounds: null, error: null, base: null, ids: null, dowelsId: null };

const sceneStore = useSceneStore;

// Lo store non importa gli altri strumenti (che importano lui per annullarlo): l'apertura sta in toggleSplit.ts
export { canSplit };

/** Quota centrale dell'ingombro lungo l'asse. */
const middle = (bounds: Bounds, axis: SplitAxis) => round((bounds.min[axis] + bounds.max[axis]) / 2, 2);

/** Soglia sotto cui un connettore si considera fuori dal pezzo (frazione del suo volume dentro il pezzo). */
const FIT_LIMIT = 0.999;

/** Numero dell'ultimo controllo richiesto al kernel: una risposta vecchia, arrivata dopo una modifica, si scarta. */
let fitRequest = 0;

/** Impostazioni dei connettori da usare all'apertura: le ultime ricordate, con tipo Nessuno. */
const initialConnectors = (): ConnectorOptions => {
  const last = lastTool('split');
  const pick = <K extends keyof ConnectorOptions>(key: K): Partial<ConnectorOptions> => (last[key] !== undefined ? { [key]: last[key] } : {});
  return { ...DEFAULT_CONNECTORS, ...pick('shape'), ...pick('size'), ...pick('depth'), ...pick('tolerance'), ...pick('count'), ...pick('spacing') };
};

export const useSplitTool = create<SplitToolState>()((set, get) => {
  /** Chiede al kernel quali connettori escono dal pezzo (sulla scena di partenza, con il pezzo intero) e aggiorna l'avviso. */
  const checkFit = () => {
    const { targetId, base, bounds, axis, offset, angle, tiltAxis, connectors } = get();
    const request = ++fitRequest;
    if (!targetId || !base || !bounds || connectors.type === 'none') {
      if (get().outside.length) set({ outside: [] });
      return;
    }
    const slots = connectorLayout(axis, offset, bounds, { axis: tiltAxis, angle }, connectors);
    const parts = slots.map((slot) => connectorPrimitive(connectors.shape, slot.fit, 'fit', 'solid', '#ffffff'));
    void getKernel()
      .connectorFit(base, targetId, parts)
      .then((ratios) => {
        // Solo l'ultima richiesta conta, e solo se lo strumento è ancora aperto
        if (request !== fitRequest || !get().active) return;
        set({ outside: ratios.flatMap((r, i) => (r < FIT_LIMIT ? [i] : [])) });
      })
      .catch(() => undefined);
  };

  /** Ricrea l'anteprima sulla scena di partenza, con asse e quota correnti. */
  const rebuild = () => {
    const { targetId, axis, offset, angle, tiltAxis, bounds, connectors } = get();
    if (!targetId || !bounds) return;
    let base = get().base;
    if (!base) {
      // Prima anteprima: si ricorda la scena di partenza e si mette in pausa la cronologia
      base = sceneStore.getState().scene;
      sceneStore.temporal.getState().pause();
      set({ base });
    }
    const result = buildSplit(base, targetId, axis, offset, bounds, { axis: tiltAxis, angle }, connectors);
    if (!result.ok) {
      sceneStore.setState({ scene: base, selection: [targetId] });
      set({ error: result.error, ids: null, dowelsId: null });
      return;
    }
    sceneStore.setState({ scene: result.scene, selection: result.dowelsId ? [...result.ids, result.dowelsId] : [...result.ids] });
    set({ ids: result.ids, dowelsId: result.dowelsId ?? null, error: null });
    checkFit();
  };

  /** Rimette la scena com'era prima dell'anteprima e riattiva la cronologia. */
  const restore = () => {
    const { base } = get();
    if (!base) return;
    sceneStore.setState({ scene: base });
    sceneStore.temporal.getState().resume();
  };

  return {
    ...INITIAL,

    start: () => {
      if (get().active) get().cancel();
      const { scene, selection } = sceneStore.getState();
      const targetId = selection.length === 1 ? selection[0] : null;
      if (!targetId || !scene.nodes[targetId]) return;
      const bounds = boundsByRoot()[targetId];
      if (!bounds) return;
      // Si parte dal piano a metà dell'ingombro lungo X, con i connettori spenti e le ultime misure usate
      set({ ...INITIAL, active: true, targetId, bounds, axis: 0, offset: middle(bounds, 0), connectors: initialConnectors() });
      rebuild();
    },

    cancel: () => {
      const { targetId } = get();
      fitRequest++;
      restore();
      // Le metà dell'anteprima non esistono più: la selezione torna al pezzo di partenza
      if (targetId) sceneStore.setState({ selection: [targetId] });
      set({ ...INITIAL });
    },

    commit: () => {
      const { ids, dowelsId, base } = get();
      if (!ids || !base) return get().cancel();
      fitRequest++;
      // La cronologia è in pausa dall'anteprima: si torna alla scena di partenza e si applica il risultato in un solo passo
      const after = sceneStore.getState().scene;
      sceneStore.setState({ scene: base });
      sceneStore.temporal.getState().resume();
      labelled('Dividi', () => sceneStore.setState({ scene: after, selection: dowelsId ? [...ids, dowelsId] : [...ids] }));
      set({ ...INITIAL });
    },

    setOption: (patch) => {
      const { bounds, axis, tiltAxis, connectors } = get();
      // Cambiando asse il piano torna a metà dell'ingombro su quell'asse
      let next: Partial<SplitToolState> = patch.axis !== undefined && patch.axis !== axis && bounds ? { ...patch, offset: middle(bounds, patch.axis) } : patch;
      // L'asse di inclinazione deve restare diverso da quello del piano: se coincide passa al successivo
      const newAxis = next.axis ?? axis;
      const newTilt = next.tiltAxis ?? tiltAxis;
      if (newTilt === newAxis) next = { ...next, tiltAxis: ((newAxis + 1) % 3) as SplitAxis };
      // I due assi del piano cambiano con l'asse: la fila torna alla prima direzione e il centro al centro del taglio
      if (newAxis !== axis) next = { ...next, connectors: { ...connectors, row: planeAxes(newAxis)[0], shiftA: 0, shiftB: 0 } };
      set(next);
      rebuild();
    },

    setConnectors: (patch) => {
      set({ connectors: { ...get().connectors, ...patch } });
      // Misure, forma e numero si ricordano per la prossima volta (non il tipo: si riparte da Nessuno)
      rememberTool('split', patch);
      rebuild();
    },
  };
});
