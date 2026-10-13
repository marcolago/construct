import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, CircleAlert, EyeOff, Undo2 } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import type { PrintIssue } from '../../scene/printability';
import { useUiStore } from '../uiStore';
import { useWarnings } from './warningsStore';
import './WarningsSection.scss';

/** Un clic su un avviso seleziona l'oggetto e mette in evidenza nella vista le zone che lo hanno causato. */
function pick(issue: PrintIssue): void {
  if (issue.rootId) useSceneStore.getState().select([issue.rootId]);
  const { focusId, setFocus } = useWarnings.getState();
  setFocus((issue.triangles || issue.boxes) && focusId !== issue.id ? issue.id : null);
}

/**
 * Sezione Avvisi in fondo alla colonna destra: i problemi di stampa trovati dai controlli (oggetti sospesi o fuori dal
 * piano, sbalzi, mesh non valide, formule che non si calcolano), con un clic che porta all'oggetto.
 */
export function WarningsSection() {
  const enabled = useUiStore((s) => s.printChecks);
  const issues = useWarnings((s) => s.issues);
  const focusId = useWarnings((s) => s.focusId);
  const ignored = useWarnings((s) => s.ignored);
  const [showIgnored, setShowIgnored] = useState(false);
  // Senza avvisi ignorati l'elenco si richiude: alla prossima volta riparte chiuso
  useEffect(() => {
    if (ignored.length === 0) setShowIgnored(false);
  }, [ignored.length]);
  const open = useWarnings((s) => s.open);
  const setOpen = useWarnings((s) => s.setOpen);
  if (!enabled) return null;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <section className="warnings" aria-label="Avvisi di stampabilità">
      <button type="button" className="warnings__head" aria-expanded={open} aria-controls="warnings-list" onClick={() => setOpen(!open)}>
        <Chevron size={14} aria-hidden="true" />
        Avvisi
        {issues.length > 0 && <span className={`warnings__count${issues.some((i) => i.level === 'error') ? ' warnings__count--error' : ''}`}>{issues.length}</span>}
      </button>
      {open && (
        <div id="warnings-list" className="warnings__body">
          {issues.length === 0 ? (
            <p className="warnings__empty">Nessun problema rilevato{ignored.length > 0 ? ' (oltre a quelli ignorati)' : ''}.</p>
          ) : (
            <ul className="warnings__list">
              {issues.map((issue) => {
                const Icon = issue.level === 'error' ? CircleAlert : AlertTriangle;
                return (
                  <li key={issue.id} className="warnings__row">
                    <button
                      type="button"
                      className={`warnings__item warnings__item--${issue.level}${focusId === issue.id ? ' warnings__item--focus' : ''}`}
                      data-kind={issue.kind}
                      aria-pressed={issue.triangles || issue.boxes ? focusId === issue.id : undefined}
                      title={issue.rootId ? (issue.triangles || issue.boxes ? 'Seleziona l\'oggetto e mostra le zone nella vista' : 'Seleziona l\'oggetto') : undefined}
                      onClick={() => pick(issue)}
                    >
                      <Icon size={14} aria-hidden="true" />
                      <span>{issue.text}</span>
                    </button>
                    <button type="button" className="warnings__ignore" aria-label={`Ignora: ${issue.text}`} title="Ignora questo avviso (si ricorda nel progetto)" onClick={() => useSceneStore.getState().ignoreWarning(issue.id)}>
                      <EyeOff size={13} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {ignored.length > 0 && (
            <div className="warnings__ignored">
              <button type="button" className="warnings__ignored-head" aria-expanded={showIgnored} onClick={() => setShowIgnored(!showIgnored)}>
                {showIgnored ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                Ignorati ({ignored.length})
              </button>
              {showIgnored && (
                <>
                  <ul className="warnings__list">
                    {ignored.map((issue) => (
                      <li key={issue.id} className="warnings__row warnings__row--ignored">
                        <span className="warnings__text">{issue.text}</span>
                        <button type="button" className="warnings__ignore" aria-label={`Ripristina: ${issue.text}`} title="Ripristina questo avviso" onClick={() => useSceneStore.getState().restoreWarning(issue.id)}>
                          <Undo2 size={13} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="warnings__restore-all" onClick={() => useSceneStore.getState().restoreAllWarnings()}>
                    Ripristina tutti
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
