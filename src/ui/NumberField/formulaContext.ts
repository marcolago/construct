import { createContext } from 'react';
import type { Binding } from '../../scene/types';

/** Limiti del campo che si sta legando a un parametro: si ricordano nel legame per riapplicarli a ogni ricalcolo. */
export interface FieldLimits {
  min?: number;
  max?: number;
  /** Il campo vuole un numero intero (conteggi). */
  int?: boolean;
}

/**
 * Parametri dell'oggetto mostrato nel pannello Proprietà: i campi che dichiarano un `path` (ad esempio "size.2") leggono
 * da qui se sono legati a un parametro e, con un doppio clic sul nome, aprono il selettore dei parametri. Fuori dal
 * pannello (Impostazioni, strumenti) non c'è contesto e i campi restano puramente numerici.
 */
export interface FormulaApi {
  /** Formule dei campi dell'oggetto, per percorso. */
  exprs: Record<string, Binding> | undefined;
  /** Valore di ogni parametro valido, per nome. */
  values: Record<string, number>;
  /** Apre il selettore dei parametri per il campo `path`, chiamato `label`. */
  pick: (path: string, label: string, limits: FieldLimits) => void;
}

export const FormulaContext = createContext<FormulaApi | null>(null);
