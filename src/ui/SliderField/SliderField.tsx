import { useContext, useRef } from 'react';
import { useSceneStore } from '../../scene/store';
import { BoundValue } from '../NumberField/BoundValue';
import { FormulaContext } from '../NumberField/formulaContext';
import { NumberField } from '../NumberField/NumberField';
import './SliderField.scss';

interface Props {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  /** Spiegazione di cosa è e cosa fa il controllo: tooltip sulla riga e descrizione accessibile. */
  tooltip: string;
  /** Estremi dello slider. Il campo numerico accetta anche valori fuori range, entro min/max assoluti. */
  min: number;
  max: number;
  step?: number;
  /** Limiti assoluti del campo numerico (oltre gli estremi dello slider), se esistono. */
  hardMin?: number;
  hardMax?: number;
  unit?: string;
  disabled?: boolean;
  /** Falso quando la cronologia di Annulla è già gestita da chi usa lo slider (anteprime di Raccordo e Smusso): niente pausa né ripresa. */
  history?: boolean;
  /** Percorso del campo nel nodo per i parametri (vedi NumberField): un doppio clic sul nome apre il selettore. */
  path?: string;
  /** Nome del campo per il selettore dei parametri, se l'etichetta da sola non basta ("X" diventa "Posizione X"). */
  pickLabel?: string;
  integer?: boolean;
}

/**
 * Slider con campo numerico accanto. Trascinando lo slider la scena si aggiorna dal vivo,
 * ma tutto il trascinamento vale un solo passo di Annulla (Ctrl+Z). Se il campo è legato a un parametro, slider e
 * campo si sostituiscono con l'icona fx e il valore, non modificabili.
 */
export function SliderField({ label, value, onCommit, tooltip, min, max, step = 1, hardMin, hardMax, unit, disabled, history: trackHistory = true, path, pickLabel, integer }: Props) {
  // Valore prima del trascinamento e ultimo valore raggiunto (null = nessun trascinamento in corso)
  const drag = useRef<{ start: number; last: number } | null>(null);
  const formulas = useContext(FormulaContext);
  const formula = path ? formulas?.exprs?.[path]?.expr : undefined;
  const pickable = !!path && !!formulas && !disabled;

  /** Chiude il trascinamento: la cronologia registra un solo passo, dal valore iniziale a quello finale. */
  const finish = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const history = useSceneStore.temporal.getState();
    if (d.last !== d.start) {
      // Ancora in pausa: si torna al valore iniziale senza registrare, poi si riprende e si applica il finale
      onCommit(d.start);
      history.resume();
      onCommit(d.last);
    } else {
      history.resume();
    }
  };

  const labelProps = pickable
    ? {
        onDoubleClick: () => formulas.pick(path, pickLabel ?? label, { ...(hardMin !== undefined && { min: hardMin }), ...(hardMax !== undefined && { max: hardMax }), ...(integer && { int: true }) }),
        title: 'Doppio clic: usa un parametro',
        'data-pickable': true,
      }
    : {};

  return (
    <div className={`slider-field${formula ? ' slider-field--bound' : ''}`} title={tooltip}>
      <span className="slider-field__label" {...labelProps}>{label}</span>
      {formula ? (
        <>
          <BoundValue value={value} formula={formula} />
          {unit && <span className="slider-field__unit">{unit}</span>}
        </>
      ) : (
        <>
          <input
            className="slider-field__range"
            type="range"
            aria-label={label}
            aria-description={tooltip}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            // Fuori range lo slider resta al limite più vicino
            value={Math.min(max, Math.max(min, value))}
            onPointerDown={() => {
              if (!trackHistory) return;
              drag.current = { start: value, last: value };
              useSceneStore.temporal.getState().pause();
            }}
            // Dopo il trascinamento il fuoco torna alla pagina: le scorciatoie (Ctrl+Z) ignorano i campi in primo piano
            onPointerUp={(e) => {
              finish();
              e.currentTarget.blur();
            }}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (drag.current) drag.current.last = v;
              onCommit(v);
            }}
          />
          <NumberField label="" unit={unit} step={step} min={hardMin} max={hardMax} disabled={disabled} value={value} onCommit={onCommit} integer={integer} />
        </>
      )}
    </div>
  );
}
