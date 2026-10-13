import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { nameProblem, resolveParams, usageCount } from '../../scene/params';
import { round } from '../../scene/math';
import { useSceneStore } from '../../scene/store';
import type { Param } from '../../scene/types';
import { createParam, deleteParam, editParam } from './paramActions';
import './ParamsPanel.scss';

/** Un campo di testo che salva all'uscita o con Invio (Esc annulla): ogni modifica è un solo passo di Annulla. */
function TextCell({ label, value, onSave, mono, placeholder }: { label: string; value: string; onSave: (v: string) => void; mono?: boolean; placeholder?: string }) {
  const [text, setText] = useState<string | null>(null);
  const finish = (save: boolean) => {
    if (save && text !== null && text !== value) onSave(text);
    setText(null);
  };
  return (
    <input
      className={`params__input${mono ? ' params__input--mono' : ''}`}
      aria-label={label}
      placeholder={placeholder}
      value={text ?? value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        // Le scorciatoie dell'editor (Canc, lettere degli strumenti) non devono scattare mentre si scrive
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setText(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function ParamRow({ param, value, error, used }: { param: Param; value: number | undefined; error?: string; used: number }) {
  // Messaggio di un nome rifiutato (non valido o già usato)
  const [nameError, setNameError] = useState<string | null>(null);
  const saveName = (name: string) => {
    const trimmed = name.trim();
    const problem = nameProblem(trimmed);
    if (problem) return setNameError(problem);
    setNameError(editParam(param.id, { name: trimmed }) ? null : `Esiste già un parametro «${trimmed}»`);
  };
  const message = nameError ?? error;
  return (
    <li className={`params__row${message ? ' params__row--error' : ''}`} data-param={param.name}>
      <div className="params__line">
        <TextCell label={`Nome del parametro ${param.name}`} value={param.name} onSave={saveName} mono />
        <span className="params__eq" aria-hidden="true">=</span>
        <TextCell label={`Formula di ${param.name}`} value={param.expr} onSave={(expr) => editParam(param.id, { expr })} mono />
        <span className="params__value" title="Valore calcolato" aria-label={`Valore di ${param.name}`}>
          {value === undefined ? '—' : round(value, 3)}
        </span>
        <button type="button" className="params__icon" aria-label={`Elimina ${param.name}`} title="Elimina il parametro" onClick={() => void deleteParam(param.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="params__line">
        <TextCell label={`Nota di ${param.name}`} value={param.note ?? ''} onSave={(note) => editParam(param.id, { note })} placeholder="Nota (diventa un commento nel codice)" />
        {used > 0 && <span className="params__used" title="Campi e parametri che usano questo parametro">usato {used} {used === 1 ? 'volta' : 'volte'}</span>}
      </div>
      {message && <p className="params__error" role="alert">{message}</p>}
    </li>
  );
}

/**
 * Parametri del progetto (scheda "Parametri" accanto a "Oggetti" e "Piatti"): variabili con nome e formula, come in
 * OpenSCAD (`altezza = 2 * spessore`), usabili in qualunque campo numerico del pannello Proprietà.
 */
export function ParamsPanel() {
  const scene = useSceneStore((s) => s.scene);
  const params = scene.params ?? [];
  const resolved = useMemo(() => resolveParams(scene.params), [scene.params]);
  const usage = useMemo(() => usageCount(scene), [scene]);
  return (
    <div className="params">
      {params.length === 0 ? (
        <p className="params__hint">
          Un parametro è una misura con un nome, per esempio <code>spessore = 2</code>. Nei campi numerici scrivi poi una formula come <code>2 * spessore</code>: cambiando il parametro si ridimensionano tutti i campi legati, e il codice OpenSCAD esportato usa le stesse variabili.
        </p>
      ) : (
        <ul className="params__list" aria-label="Parametri">
          {params.map((p) => (
            <ParamRow key={p.id} param={p} value={resolved.values[p.name]} error={resolved.errors[p.id]} used={usage[p.name] ?? 0} />
          ))}
        </ul>
      )}
      <button type="button" className="params__add" onClick={createParam}>
        <Plus size={14} />
        Aggiungi parametro
      </button>
    </div>
  );
}
