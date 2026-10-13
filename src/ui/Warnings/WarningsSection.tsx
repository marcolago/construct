import { AlertTriangle, ChevronDown, ChevronRight, CircleAlert } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import type { PrintIssue } from '../../scene/printability';
import { useUiStore } from '../uiStore';
import { useWarnings } from './warningsStore';
import './WarningsSection.scss';

/** Un clic su un avviso seleziona l'oggetto e mette in evidenza nella vista le zone che lo hanno causato. */
function pick(issue: PrintIssue): void {
  if (issue.rootId) useSceneStore.getState().select([issue.rootId]);
  const { focusId, setFocus } = useWarnings.getState();
  setFocus(issue.triangles && focusId !== issue.id ? issue.id : null);
}

/**
 * Sezione Avvisi in fondo alla colonna destra: i problemi di stampa trovati dai controlli (oggetti sospesi o fuori dal
 * piano, sbalzi, mesh non valide, formule che non si calcolano), con un clic che porta all'oggetto.
 */
export function WarningsSection() {
  const enabled = useUiStore((s) => s.printChecks);
  const issues = useWarnings((s) => s.issues);
  const focusId = useWarnings((s) => s.focusId);
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
            <p className="warnings__empty">Nessun problema rilevato.</p>
          ) : (
            <ul className="warnings__list">
              {issues.map((issue) => {
                const Icon = issue.level === 'error' ? CircleAlert : AlertTriangle;
                return (
                  <li key={issue.id}>
                    <button
                      type="button"
                      className={`warnings__item warnings__item--${issue.level}${focusId === issue.id ? ' warnings__item--focus' : ''}`}
                      data-kind={issue.kind}
                      aria-pressed={issue.triangles ? focusId === issue.id : undefined}
                      title={issue.rootId ? (issue.triangles ? 'Seleziona l\'oggetto e mostra le zone nella vista' : 'Seleziona l\'oggetto') : undefined}
                      onClick={() => pick(issue)}
                    >
                      <Icon size={14} aria-hidden="true" />
                      <span>{issue.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
