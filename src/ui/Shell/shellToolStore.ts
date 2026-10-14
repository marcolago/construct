import { create } from 'zustand';
import type { NodeMesh } from '../../kernel/evaluate';
import { useResultStore } from '../../kernel/useKernel';
import { faceMap } from '../../scene/edgeTool';
import { lastToolNumber, rememberTool } from '../../scene/lastValues';
import { round } from '../../scene/math';
import { worldToLocal } from '../../scene/patternTool';
import { localBounds, snapOpenDirection } from '../../scene/shell';
import { buildShell } from '../../scene/shellTool';
import { isCutter } from '../../scene/treatment';
import { isLocked, labelled, useSceneStore, worldTransform } from '../../scene/store';
import type { Scene, ShellParams, Vec3 } from '../../scene/types';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { useMeasure } from '../Measure/measureStore';
import { useLayFlat } from '../LayFlat/layFlatStore';
import { useArrayTool } from '../Array/arrayToolStore';
import { usePatternTool } from '../Pattern/patternToolStore';
import { useSplitTool } from '../Split/splitToolStore';

/** Faccia sotto il puntatore mentre si sceglie la faccia da lasciare aperta. */
export interface ShellHover {
  mesh: NodeMesh;
  face: number;
}

/**
 * Strumento Guscio: svuota il solido selezionato. Stesso schema dello strumento Raccordo/Smusso: mentre il pannello è
 * aperto la cronologia è in pausa e l'anteprima vive nella scena; OK registra un solo passo di Annulla.
 * La faccia aperta parte dalla cima; "Scegli faccia" mostra il solido intero e un clic su una sua faccia la sceglie.
 */

interface ShellToolState {
  active: boolean;
  /** Solido da svuotare. */
  targetId: string | null;
  /** Spessore delle pareti laterali, in mm. */
  wall: number;
  /** Spessore del fondo, in mm: la parete opposta alla faccia aperta. */
  bottom: number;
  /** Faccia lasciata aperta (normale locale lungo un asse). */
  open: Vec3;
  /** Scelta della faccia con i clic sull'oggetto in corso (la vista mostra il solido intero), e faccia sotto il puntatore. */
  picking: boolean;
  hover: ShellHover | null;
  /** Ingombro del solido nel suo sistema locale, per la cavità scalata (calcolato una volta all'avvio). */
  bounds: ShellParams['bounds'] | null;
  /** Motivo per cui gli spessori scelti non sono applicabili (es. pareti più spesse del solido). */
  error: string | null;

  /** Scena prima dell'anteprima: serve a ripristinarla e a registrare un solo passo di Annulla. */
  base: Scene | null;
  /** Gruppo Guscio creato dall'anteprima. */
  groupId: string | null;

  start: () => void;
  cancel: () => void;
  commit: () => void;
  setOption: (patch: Partial<Pick<ShellToolState, 'wall' | 'bottom'>>) => void;
  setPicking: (picking: boolean) => void;
  setHover: (hover: ShellHover | null) => void;
  /** Sceglie come faccia aperta la faccia piana cliccata, se è perpendicolare a un asse dell'oggetto. */
  pickFace: (mesh: NodeMesh, face: number) => void;
}

const TOP: Vec3 = [0, 0, 1];
const INITIAL = { active: false, targetId: null, wall: 2, bottom: 2, open: TOP, picking: false, hover: null, bounds: null, error: null, base: null, groupId: null };

const sceneStore = useSceneStore;

/** Vero se la selezione è un solo oggetto che si può svuotare: solido, non bloccato, né raccordo né smusso. */
export function canShell(scene: Scene, selection: string[]): boolean {
  const node = selection.length === 1 ? scene.nodes[selection[0]] : undefined;
  return node !== undefined && node.mode === 'solid' && !isCutter(node) && !isLocked(scene, node.id);
}

/** Apre il Guscio sulla selezione (chiudendo Raccordo o Smusso); se è già aperto lo annulla. Usata da barra e tasto G. */
export function toggleShell(): void {
  const shell = useShellTool.getState();
  if (shell.active) return shell.cancel();
  const { scene, selection } = sceneStore.getState();
  if (!canShell(scene, selection)) return;
  // Un solo strumento alla volta
  useEdgeTool.getState().cancel();
  useMeasure.getState().cancel();
  useLayFlat.getState().cancel();
  useArrayTool.getState().cancel();
  usePatternTool.getState().cancel();
  useSplitTool.getState().cancel();
  shell.start();
}

export const useShellTool = create<ShellToolState>()((set, get) => {
  /** Ricrea l'anteprima sulla scena di partenza, con gli spessori e la faccia aperta correnti (non durante la scelta della faccia). */
  const rebuild = () => {
    const { targetId, wall, bottom, open, bounds, picking } = get();
    if (!targetId || picking) return;
    let base = get().base;
    if (!base) {
      // Prima anteprima: si ricorda la scena di partenza e si mette in pausa la cronologia
      base = sceneStore.getState().scene;
      sceneStore.temporal.getState().pause();
      set({ base });
    }
    // La cima è la faccia aperta di default: si scrive nel guscio solo se l'utente ne ha scelta un'altra
    const result = buildShell(base, targetId, { wall, bottom, ...(open[2] === 1 ? {} : { open }), ...(bounds ? { bounds } : {}) });
    if (!result.ok) {
      // Spessori non applicabili: si torna alla scena di partenza e si mostra il motivo
      sceneStore.setState({ scene: base });
      set({ error: result.error, groupId: null });
      return;
    }
    sceneStore.setState({ scene: result.scene, selection: [result.groupId] });
    set({ groupId: result.groupId, error: null });
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
      const target = targetId ? scene.nodes[targetId] : undefined;
      if (!targetId || !target) return;

      // Ingombro locale dal calcolo del kernel: le mesh del solido (più d'una se è un Raggruppa) sono in coordinate mondo
      const meshes = useResultStore.getState().meshes.filter((m) => !m.empty && m.path.includes(targetId));
      const bounds = meshes.length ? localBounds(meshes, worldTransform(scene, targetId)) : null;
      // Spessori iniziali ragionevoli: 2 mm, ma al massimo un quarto del lato più piccolo
      const smallest = bounds ? Math.min(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) : 8;
      const thickness = round(Math.max(0.1, Math.min(2, smallest / 4)), 1);
      // Gli spessori dell'ultimo Guscio, se ci sono, non oltre un terzo del lato (laterale) o dell'altezza (fondo)
      const height = bounds ? bounds.max[2] - bounds.min[2] : smallest;
      const lastWall = lastToolNumber('shell', 'wall');
      const lastBottom = lastToolNumber('shell', 'bottom');
      const wall = lastWall === undefined ? thickness : round(Math.max(0.1, Math.min(lastWall, smallest / 3)), 1);
      const bottom = lastBottom === undefined ? thickness : round(Math.max(0, Math.min(lastBottom, height / 3)), 1);

      set({ ...INITIAL, active: true, targetId, bounds, wall, bottom });
      rebuild();
    },

    cancel: () => {
      const { targetId } = get();
      restore();
      // Il gruppo dell'anteprima non esiste più: la selezione torna al solido di partenza
      if (targetId) sceneStore.setState({ selection: [targetId] });
      set({ ...INITIAL });
    },

    commit: () => {
      const { groupId, base, picking } = get();
      // Durante la scelta della faccia non c'è ancora un risultato da confermare: Invio non fa nulla
      if (picking) return;
      if (!groupId || !base) return get().cancel();
      // La cronologia è in pausa dall'anteprima: si torna alla scena di partenza e si applica il risultato in un solo passo
      const after = sceneStore.getState().scene;
      sceneStore.setState({ scene: base });
      sceneStore.temporal.getState().resume();
      labelled('Guscio', () => sceneStore.setState({ scene: after, selection: [groupId] }));
      set({ ...INITIAL });
    },

    setOption: (patch) => {
      set(patch);
      rememberTool('shell', patch);
      rebuild();
    },

    setPicking: (picking) => {
      const { targetId, base } = get();
      if (!get().active || !targetId || !base) return;
      set({ picking, hover: null, error: null });
      if (picking) {
        // Durante la scelta la vista mostra il solido intero: si cliccano le sue facce, non le pareti della cavità
        sceneStore.setState({ scene: base, selection: [targetId] });
        set({ groupId: null });
      } else {
        rebuild();
      }
    },

    setHover: (hover) => {
      const current = get().hover;
      // Stessa faccia: niente aggiornamento (il puntatore si muove di continuo)
      if (current?.mesh === hover?.mesh && current?.face === hover?.face) return;
      set({ hover });
    },

    pickFace: (mesh, face) => {
      const { targetId, base } = get();
      const info = faceMap(mesh).faces[face];
      if (!info || !targetId || !base || !mesh.path.includes(targetId)) return;
      // Normale uscente dal mondo al sistema locale del solido, poi agganciata all'asse più vicino
      const open = snapOpenDirection(worldToLocal(worldTransform(base, targetId), info.normal, false));
      if (!info.planar || !open) {
        set({ error: 'Scegli una faccia piana perpendicolare a un asse dell\'oggetto.' });
        return;
      }
      set({ open, picking: false, hover: null, error: null });
      rebuild();
    },
  };
});
