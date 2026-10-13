import { PropertiesPanel } from '../PropertiesPanel/PropertiesPanel';
import { WarningsSection } from '../Warnings/WarningsSection';
import './Sidebar.scss';

/** Colonna destra con le proprietà dell'oggetto selezionato e, in fondo, gli avvisi di stampabilità (il codice OpenSCAD sta in una modale). */
export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Proprietà">
      <h2 className="sidebar__title">Proprietà</h2>
      <div className="sidebar__body">
        <PropertiesPanel />
      </div>
      <WarningsSection />
    </aside>
  );
}
