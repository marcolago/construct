import { create } from 'zustand';
import { useResultStore } from '../../kernel/useKernel';
import { analyzePrintability, type PrintIssue } from '../../scene/printability';
import { useSceneStore } from '../../scene/store';
import { useUiStore } from '../uiStore';

interface WarningsState {
  /** Avvisi di stampabilità del piatto attivo, errori per primi. */
  issues: PrintIssue[];
  /** Avviso messo in evidenza nella vista 3D (clic sull'elenco). */
  focusId: string | null;
  /** Sezione Avvisi aperta. */
  open: boolean;
  setFocus: (id: string | null) => void;
  setOpen: (open: boolean) => void;
}

export const useWarnings = create<WarningsState>((set) => ({
  issues: [],
  focusId: null,
  open: true,
  setFocus: (focusId) => set({ focusId }),
  setOpen: (open) => set({ open }),
}));

/** Attesa prima di rianalizzare: durante il trascinamento di uno slider non si ricalcola a ogni passo. */
const DEBOUNCE_MS = 400;

/** Ricalcola gli avvisi dallo stato attuale (mesh del kernel, scena, impostazioni). */
function run(): void {
  const { printChecks, overhangAngle, bedHeight, bedSize } = useUiStore.getState();
  const { meshes, busy } = useResultStore.getState();
  // Con un calcolo in corso le mesh sono indietro rispetto alla scena: si aspetta il risultato
  if (busy) return;
  const issues = printChecks ? analyzePrintability(meshes, useSceneStore.getState().scene, { bedWidth: bedSize.width, bedDepth: bedSize.depth, bedHeight, overhangAngle }) : [];
  const { focusId } = useWarnings.getState();
  // L'evidenziazione sparisce con l'avviso che la causava
  useWarnings.setState({ issues, focusId: focusId && issues.some((i) => i.id === focusId) ? focusId : null });
}

/** Collega i controlli di stampabilità ai cambi di mesh, scena e impostazioni (da chiamare una volta, all'avvio). */
export function startPrintChecks(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  };
  useResultStore.subscribe((s, prev) => {
    if (s.meshes !== prev.meshes || s.busy !== prev.busy) schedule();
  });
  useSceneStore.subscribe((s, prev) => {
    if (s.scene !== prev.scene) schedule();
  });
  useUiStore.subscribe((s, prev) => {
    if (s.printChecks !== prev.printChecks || s.overhangAngle !== prev.overhangAngle || s.bedHeight !== prev.bedHeight || s.bedSize !== prev.bedSize) schedule();
  });
  schedule();
}
