import { useContext, useEffect, useRef, useState } from 'react';
import { round } from '../../scene/math';
import { evalFormula, formulaDeps } from '../../scene/params';
import { notify } from '../notify/notifyStore';
import { FormulaContext } from './formulaContext';
import './NumberField.scss';

interface Props {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  /** Percorso del campo nel nodo ("size.2"): se c'è, il campo accetta formule con i parametri del progetto (vedi formulaContext). */
  path?: string;
  /** Il campo vuole un numero intero (conteggi): il risultato di una formula si arrotonda. */
  integer?: boolean;
}

/**
 * Campo numerico che modifica la scena solo alla conferma (Invio o uscita dal campo):
 * ogni modifica è così una singola voce di undo e non si ricalcola la geometria a ogni tasto.
 * Accetta anche un calcolo ("10 / 2") e, nel pannello Proprietà, una formula con i parametri ("2 * spessore"), che
 * resta legata al campo (chip fx) e si ricalcola quando il parametro cambia.
 */
export function NumberField({ label, value, onCommit, min = -Infinity, max = Infinity, step = 1, unit, disabled, path, integer }: Props) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const formulas = useContext(FormulaContext);
  // Formula legata a questo campo (solo dentro il pannello Proprietà e con un percorso)
  const formula = path ? formulas?.exprs?.[path]?.expr : undefined;

  // Allinea il testo al valore esterno (es. dopo un trascinamento del gizmo) quando non si sta scrivendo
  useEffect(() => {
    if (!focused) setText(String(round(value, 3)));
  }, [value, focused]);

  /** Applica un numero già calcolato: se il campo era legato a una formula, scriverne il valore la scioglie. */
  const commitNumber = (parsed: number) => {
    const clamped = Math.min(max, Math.max(min, parsed));
    const next = integer ? Math.round(clamped) : round(clamped, 3);
    setText(String(next));
    if (next !== value) onCommit(next);
    else if (formula && path) formulas?.bind(path, null);
  };

  const commit = (raw: string) => {
    // Con la formula legata, lasciarla com'è (focus e uscita senza modifiche) non cambia nulla
    if (formula && raw.trim() === formula) return setText(String(round(value, 3)));
    // Accetta la virgola decimale italiana
    const parsed = Number(raw.replace(',', '.'));
    if (raw.trim() === '') return setText(String(round(value, 3)));
    if (Number.isFinite(parsed)) return commitNumber(parsed);
    // Non è un numero semplice: è un calcolo o una formula con i parametri
    const result = evalFormula(raw, formulas?.values ?? {});
    if (!result.ok) {
      notify.error(`Formula non valida: ${result.error}`);
      return setText(String(round(value, 3)));
    }
    if (formulaDeps(raw).length === 0) return commitNumber(result.value);
    if (!path || !formulas) {
      notify.error('In questo campo non si possono usare i parametri');
      return setText(String(round(value, 3)));
    }
    formulas.bind(path, { expr: raw.trim(), ...(min > -Infinity && { min }), ...(max < Infinity && { max }), ...(integer && { int: true }) });
  };

  return (
    <label className={`number-field${formula ? ' number-field--bound' : ''}`}>
      <span className="number-field__label">{label}</span>
      {formula && <span className="number-field__fx" aria-hidden="true">fx</span>}
      <input
        ref={input}
        className="number-field__input"
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        title={formula ? `= ${formula}` : path ? 'Numero, calcolo o formula con i parametri (es. 2 * spessore). Nelle formule la virgola separa gli argomenti: i decimali vanno col punto' : undefined}
        aria-description={formula ? `Formula: ${formula}` : undefined}
        onFocus={(e) => {
          setFocused(true);
          // Con una formula si modifica il suo testo, non il valore
          if (formula) {
            setText(formula);
            requestAnimationFrame(() => input.current?.select());
          } else e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          setFocused(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(String(round(value, 3)));
            e.currentTarget.blur();
          }
          // Frecce su/giù incrementano di uno step (Shift: dieci step)
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            const current = Number(text.replace(',', '.'));
            commit(String((Number.isFinite(current) ? current : value) + dir * step * (e.shiftKey ? 10 : 1)));
          }
        }}
      />
      {unit && <span className="number-field__unit">{unit}</span>}
    </label>
  );
}
