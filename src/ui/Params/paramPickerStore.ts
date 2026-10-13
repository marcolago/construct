import { create } from 'zustand';
import type { FieldLimits } from '../NumberField/formulaContext';

/** Campo per cui è aperto il selettore dei parametri. */
export interface PickerTarget extends FieldLimits {
  nodeId: string;
  /** Percorso del campo nel nodo ("size.2"). */
  path: string;
  /** Nome del campo come lo vede l'utente ("Altezza", "Posizione X"). */
  label: string;
}

interface PickerState {
  target: PickerTarget | null;
  open: (target: PickerTarget) => void;
  close: () => void;
}

export const useParamPicker = create<PickerState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
