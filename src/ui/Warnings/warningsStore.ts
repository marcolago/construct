import { create } from 'zustand';
import { useResultStore } from '../../kernel/useKernel';
import { getKernel } from '../../kernel/client';
import { analyzePrintability, deepIssues, mergeIssues, type PrintIssue } from '../../scene/printability';
import { useSceneStore } from '../../scene/store';
import { useUiStore } from '../uiStore';

interface WarningsState {
  /** Avvisi di stampabilità del piatto attivo da mostrare, errori per primi: quelli veloci e quelli del kernel insieme. */
  issues: PrintIssue[];
  /** Avvisi trovati che l'utente ha scelto di ignorare (vedi `Scene.ignoredWarnings`): non contano né si evidenziano. */
  ignored: PrintIssue[];
  /** Avvisi dei controlli veloci (dalle mesh) e di quelli del kernel (pareti sottili, parti sospese), tenuti a parte. */
  fast: PrintIssue[];
  deep: PrintIssue[];
  /** Avviso messo in evidenza nella vista 3D (clic sull'elenco). */
  focusId: string | null;
  /** Sezione Avvisi aperta: parte chiusa, la apre l'utente (anche dal contatore nella barra di stato). */
  open: boolean;
  setFocus: (id: string | null) => void;
  setOpen: (open: boolean) => void;
}

export const useWarnings = create<WarningsState>((set) => ({
  issues: [],
  ignored: [],
  fast: [],
  deep: [],
  focusId: null,
  open: false,
  setFocus: (focusId) => set({ focusId }),
  setOpen: (open) => set({ open }),
}));

/** Attesa prima di rianalizzare: durante il trascinamento di uno slider non si ricalcola a ogni passo. */
const DEBOUNCE_MS = 400;

/** Attesa prima delle analisi del kernel, più lunghe: dopo una modifica si aspetta che la mano si fermi. */
const DEEP_DEBOUNCE_MS = 1200;

/** Aggiorna l'elenco unico e toglie l'evidenziazione che non ha più un avviso. Gli avvisi di oggetti spariti non restano. */
function publish(fast: PrintIssue[], deep: PrintIssue[]): void {
  const { rootIds } = useSceneStore.getState().scene;
  const liveDeep = deep.filter((i) => !i.rootId || rootIds.includes(i.rootId));
  const all = mergeIssues(fast, liveDeep);
  const skip = new Set(useSceneStore.getState().scene.ignoredWarnings);
  const issues = all.filter((i) => !skip.has(i.id));
  const { focusId } = useWarnings.getState();
  useWarnings.setState({ fast, deep: liveDeep, issues, ignored: all.filter((i) => skip.has(i.id)), focusId: focusId && issues.some((i) => i.id === focusId) ? focusId : null });
}

/** Ricalcola gli avvisi veloci dallo stato attuale (mesh del kernel, scena, impostazioni). */
function run(): void {
  const { printChecks, overhangAngle, bedHeight, bedSize } = useUiStore.getState();
  const { meshes, busy } = useResultStore.getState();
  // Con un calcolo in corso le mesh sono indietro rispetto alla scena: si aspetta il risultato
  if (busy) return;
  publish(printChecks ? analyzePrintability(meshes, useSceneStore.getState().scene, { bedWidth: bedSize.width, bedDepth: bedSize.depth, bedHeight, overhangAngle }) : [], useWarnings.getState().deep);
}

/** Numero dell'ultima richiesta di analisi al kernel: una risposta arrivata dopo una richiesta più recente si scarta. */
let deepRequest = 0;

/** Chiede al kernel le pareti sottili e le parti sospese (nel worker, dopo il calcolo della scena). */
async function runDeep(): Promise<void> {
  const request = ++deepRequest;
  const { printChecks, minWall } = useUiStore.getState();
  if (!printChecks) {
    publish(useWarnings.getState().fast, []);
    return;
  }
  const scene = useSceneStore.getState().scene;
  try {
    const result = await (await getKernel()).analyze(scene, { minWall });
    if (request === deepRequest) publish(useWarnings.getState().fast, deepIssues(result, scene, minWall));
  } catch {
    // Il kernel segnala già i suoi errori (barra di stato): qui basta non avere avvisi di questo tipo
    if (request === deepRequest) publish(useWarnings.getState().fast, []);
  }
}

/** Collega i controlli di stampabilità ai cambi di mesh, scena e impostazioni (da chiamare una volta, all'avvio). */
export function startPrintChecks(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deepTimer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
    // Le analisi del kernel partono più tardi e solo a calcolo finito (scene e mesh coerenti)
    clearTimeout(deepTimer);
    deepTimer = setTimeout(() => {
      if (!useResultStore.getState().busy) void runDeep();
      else schedule();
    }, DEEP_DEBOUNCE_MS);
  };
  useResultStore.subscribe((s, prev) => {
    if (s.meshes !== prev.meshes || s.busy !== prev.busy) schedule();
  });
  useSceneStore.subscribe((s, prev) => {
    if (s.scene === prev.scene) return;
    // Ignorare o ripristinare un avviso si vede subito, senza aspettare la pausa del ricalcolo
    if (s.scene.ignoredWarnings !== prev.scene.ignoredWarnings) publish(useWarnings.getState().fast, useWarnings.getState().deep);
    schedule();
  });
  useUiStore.subscribe((s, prev) => {
    if (s.printChecks !== prev.printChecks || s.overhangAngle !== prev.overhangAngle || s.bedHeight !== prev.bedHeight || s.bedSize !== prev.bedSize || s.minWall !== prev.minWall) schedule();
  });
  schedule();
}
