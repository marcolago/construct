import type { KeyboardEvent } from 'react';
import { PropertiesPanel } from '../PropertiesPanel/PropertiesPanel';
import { ParamsView } from '../Params/ParamsView';
import { WarningsSection } from '../Warnings/WarningsSection';
import { useSceneStore } from '../../scene/store';
import { useUiStore, type SidebarTab } from '../uiStore';
import './Sidebar.scss';

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'properties', label: 'Proprietà' },
  { id: 'params', label: 'Parametri' },
];

/**
 * Colonna destra: le proprietà dell'oggetto selezionato oppure l'elenco dei parametri (a schede) e, in fondo, gli
 * avvisi di stampabilità (il codice OpenSCAD sta in una modale).
 */
export function Sidebar() {
  const tab = useUiStore((s) => s.sidebarTab);
  const setTab = useUiStore((s) => s.setSidebarTab);
  const paramCount = useSceneStore((s) => s.scene.params?.length ?? 0);

  /** Frecce sinistra e destra passano da una scheda all'altra (schema ARIA delle tab). */
  const onKeys = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length].id;
    setTab(next);
    document.getElementById(`sidebar-tab-${next}`)?.focus();
  };

  return (
    <aside className="sidebar" aria-label="Proprietà e parametri">
      <div className="sidebar__tabs" role="tablist" aria-label="Proprietà e parametri" onKeyDown={onKeys}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`sidebar-tab-${t.id}`}
            type="button"
            role="tab"
            className={`sidebar__tab${t.id === tab ? ' sidebar__tab--active' : ''}`}
            aria-selected={t.id === tab}
            aria-controls="sidebar-panel"
            tabIndex={t.id === tab ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'params' && paramCount > 0 && <span className="sidebar__badge">{paramCount}</span>}
          </button>
        ))}
      </div>
      <div id="sidebar-panel" className="sidebar__body" role="tabpanel" aria-labelledby={`sidebar-tab-${tab}`}>
        {tab === 'properties' ? <PropertiesPanel /> : <ParamsView />}
      </div>
      <WarningsSection />
    </aside>
  );
}
