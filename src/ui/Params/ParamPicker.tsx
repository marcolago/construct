import { useMemo, useState } from 'react';
import { round } from '../../scene/math';
import { evalFormula, formulaDeps, nameProblem, resolveParams } from '../../scene/params';
import { useSceneStore } from '../../scene/store';
import { Modal } from '../Modal/Modal';
import { bindFieldKeepingBase } from './paramActions';
import { useParamPicker, type PickerTarget } from './paramPickerStore';
import './ParamPicker.scss';

function PickerBody({ target }: { target: PickerTarget }) {
  const close = useParamPicker((s) => s.close);
  const scene = useSceneStore((s) => s.scene);
  const current = scene.nodes[target.nodeId]?.exprs?.[target.path];
  const { values } = useMemo(() => resolveParams(scene.params), [scene.params]);
  const names = Object.keys(values);
  // Parte dalla formula attuale (se il campo è già legato)
  const [text, setText] = useState(current?.expr ?? '');

  // Nuovo parametro creato al volo, senza aprire la finestra Parametri
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const newValid = evalFormula(newValue, values);
  const newProblem = nameProblem(newName.trim()) ?? (names.includes(newName.trim()) ? `Esiste già un parametro «${newName.trim()}»` : null) ?? (newValid.ok ? null : newValid.error);
  const create = () => {
    if (newProblem) return;
    useSceneStore.getState().addParam(newName.trim(), newValue.trim());
    setText(newName.trim());
    setCreating(false);
    setNewName('');
    setNewValue('');
  };

  const result = text.trim() ? evalFormula(text, values) : null;
  const usesParam = text.trim() !== '' && formulaDeps(text).length > 0;
  const canApply = !!result?.ok && usesParam;
  const hint = !text.trim() ? 'Scegli un parametro o scrivi una formula, per esempio 2 * spessore.' : !result?.ok ? result?.error : !usesParam ? 'La formula deve usare almeno un parametro.' : null;

  const apply = () => {
    if (!canApply) return;
    bindFieldKeepingBase(target.nodeId, target.path, {
      expr: text.trim(),
      ...(target.min !== undefined && { min: target.min }),
      ...(target.max !== undefined && { max: target.max }),
      ...(target.int && { int: true }),
    });
    close();
  };
  const remove = () => {
    bindFieldKeepingBase(target.nodeId, target.path, null);
    close();
  };

  return (
    <div className="param-picker">
      {names.length === 0 ? (
        <p className="param-picker__empty">
          Il progetto non ha ancora parametri.{' '}
          <button type="button" className="param-picker__link" onClick={() => setCreating(true)}>
            Crea un parametro
          </button>
        </p>
      ) : (
        <ul className="param-picker__list" aria-label="Parametri del progetto">
          {names.map((name) => (
            <li key={name}>
              <button type="button" className={`param-picker__item${text.trim() === name ? ' param-picker__item--active' : ''}`} aria-pressed={text.trim() === name} onClick={() => setText(name)}>
                <span>{name}</span>
                <span className="param-picker__value">{round(values[name], 3)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <div className="param-picker__new">
          <input className="param-picker__input" aria-label="Nome del nuovo parametro" placeholder="nome (es. spessore)" value={newName} autoFocus spellCheck={false} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') create(); }} />
          <input className="param-picker__input" aria-label="Valore del nuovo parametro" placeholder="valore (es. 2)" value={newValue} spellCheck={false} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') create(); }} />
          <button type="button" className="modal__button" disabled={!!newProblem} title={newProblem ?? undefined} onClick={create}>Crea</button>
          <button type="button" className="modal__button" onClick={() => setCreating(false)}>Annulla</button>
        </div>
      ) : (
        names.length > 0 && (
          <button type="button" className="param-picker__link param-picker__newlink" onClick={() => setCreating(true)}>
            Nuovo parametro…
          </button>
        )
      )}
      <label className="param-picker__formula">
        <span>Formula</span>
        <input
          className="param-picker__input"
          value={text}
          autoFocus={names.length === 0}
          placeholder="2 * spessore"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Le scorciatoie dell'editor non devono scattare mentre si scrive
            e.stopPropagation();
            if (e.key === 'Enter') apply();
          }}
        />
      </label>
      <p className={`param-picker__preview${result && !result.ok ? ' param-picker__preview--error' : ''}`} role="status">
        {canApply && result?.ok ? `Valore: ${round(result.value, 3)}` : hint}
      </p>
      {creating && newProblem && (newName.trim() !== '' || newValue.trim() !== '') && <p className="param-picker__preview param-picker__preview--error">{newProblem}</p>}
      <div className="param-picker__actions">
        {current && (
          <button type="button" className="modal__button param-picker__remove" onClick={remove}>
            Togli parametro
          </button>
        )}
        <span className="param-picker__spacer" />
        <button type="button" className="modal__button" onClick={close}>
          Annulla
        </button>
        <button type="button" className="modal__button modal__button--primary" disabled={!canApply} onClick={apply}>
          Applica
        </button>
      </div>
    </div>
  );
}

/**
 * Selettore del parametro di un campo, aperto con un doppio clic sul nome del campo nel pannello Proprietà: sceglie un
 * parametro (o una formula che ne usa) e lega il campo; per un campo già legato permette anche di toglierlo.
 */
export function ParamPicker() {
  const target = useParamPicker((s) => s.target);
  const close = useParamPicker((s) => s.close);
  // Se l'oggetto sparisce (Annulla) mentre il selettore è aperto, si chiude
  const exists = useSceneStore((s) => !!target && !!s.scene.nodes[target.nodeId]);
  const open = !!target && exists;
  return (
    <Modal open={open} title={target ? `Parametro per «${target.label}»` : ''} onClose={close}>
      {target && <PickerBody key={`${target.nodeId}:${target.path}`} target={target} />}
    </Modal>
  );
}
