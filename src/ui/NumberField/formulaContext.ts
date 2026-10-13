import { createContext } from 'react';
import type { Binding } from '../../scene/types';

/**
 * Formule dell'oggetto mostrato nel pannello Proprietà: i campi che dichiarano un `path` (ad esempio "size.2") le
 * leggono da qui e le scrivono con `bind`, senza che ogni campo debba conoscere lo store. Fuori dal pannello
 * (Impostazioni, strumenti) non c'è contesto e i campi restano puramente numerici.
 */
export interface FormulaApi {
  /** Formule dei campi dell'oggetto, per percorso. */
  exprs: Record<string, Binding> | undefined;
  /** Valore di ogni parametro valido, per nome. */
  values: Record<string, number>;
  /** Lega il campo a una formula, o la scioglie con null. */
  bind: (path: string, binding: Binding | null) => void;
}

export const FormulaContext = createContext<FormulaApi | null>(null);
