import { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import { round } from '../../scene/math';
import { resolveParams, usageCount } from '../../scene/params';
import { selectUsers } from './paramActions';
import { useSceneStore } from '../../scene/store';
import { useUiStore } from '../uiStore';
import './ParamsView.scss';

/**
 * Elenco di sola lettura dei parametri (scheda Parametri della barra destra). Per aggiungerli, modificarli o
 * eliminarli c'è la finestra Parametri, che si apre dal pulsante.
 */
export function ParamsView() {
  const scene = useSceneStore((s) => s.scene);
  const params = scene.params ?? [];
  const resolved = useMemo(() => resolveParams(scene.params), [scene.params]);
  const usage = useMemo(() => usageCount(scene), [scene]);
  const manage = () => useUiStore.getState().setAppPanel('params');

  return (
    <div className="params-view">
      {params.length === 0 ? (
        <p className="params-view__empty">Nessun parametro. Un parametro è una misura con un nome (<code>spessore = 2</code>) da usare nei campi delle proprietà con un doppio clic sul loro nome.</p>
      ) : (
        <ul className="params-view__list" aria-label="Parametri del progetto">
          {params.map((p) => {
            const error = resolved.errors[p.id];
            const value = resolved.values[p.name];
            return (
              <li key={p.id} className={`params-view__row${error ? ' params-view__row--error' : ''}`} data-param={p.name} title={p.note || undefined}>
                <button type="button" className="params-view__name" title="Seleziona gli oggetti che usano questo parametro" onClick={() => selectUsers(p.name)}>
                  {p.name}
                </button>
                <span className="params-view__expr">{p.expr}</span>
                <span className="params-view__value">{value === undefined ? '—' : round(value, 3)}</span>
                {error && <span className="params-view__error" role="alert">{error}</span>}
                {!error && (usage[p.name] ?? 0) > 0 && <span className="params-view__used">usato {usage[p.name]} {usage[p.name] === 1 ? 'volta' : 'volte'}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="params-view__manage" onClick={manage}>
        <Pencil size={13} />
        Gestisci parametri…
      </button>
    </div>
  );
}
