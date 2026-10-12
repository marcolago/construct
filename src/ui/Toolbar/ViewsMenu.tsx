import { Box, Focus, Maximize, PanelRight, PanelTop, Square } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { fitView, PRESET_LABELS, setViewPreset } from '../../viewport/cameraControl';
import type { ViewPreset } from '../../viewport/cameraControl';

/** Preset di vista con icona e tasto che li richiama (gli stessi di useShortcuts). */
const PRESETS: [ViewPreset, string, LucideIcon][] = [
  ['top', '7', PanelTop],
  ['front', '1', Square],
  ['side', '3', PanelRight],
  ['iso', '0', Box],
];

/**
 * Contenuto della tendina Viste, una voce sotto l'altra: i quattro preset (alto, fronte, lato, isometrica) e Inquadra
 * la selezione o tutto. I preset tengono il centro inquadrato e la distanza; Inquadra sposta il centro sulla selezione
 * (o sulla scena).
 */
export function ViewsMenu({ close }: { close: () => void }) {
  const entry = (label: string, key: string, Icon: LucideIcon, title: string, action: () => void) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      aria-label={label}
      aria-keyshortcuts={key}
      className="toolbar__dropdown-entry"
      title={title}
      onClick={() => {
        action();
        close();
      }}
    >
      <Icon size={16} aria-hidden="true" />
      <span className="toolbar__dropdown-entry-name">{label}</span>
      <kbd className="toolbar__dropdown-key">{key}</kbd>
    </button>
  );

  return (
    <div className="toolbar__dropdown-list">
      {PRESETS.map(([preset, key, Icon]) => entry(PRESET_LABELS[preset], key, Icon, `Vista ${PRESET_LABELS[preset].toLowerCase()} (tasto ${key})`, () => setViewPreset(preset)))}
      <div className="toolbar__dropdown-separator" role="separator" />
      {entry('Inquadra selezione', '.', Focus, 'Inquadra gli oggetti selezionati, o tutta la scena se non c\'è selezione (tasto .)', () => fitView(true))}
      {entry('Inquadra tutto', 'Home', Maximize, 'Inquadra tutta la scena, o il piatto se è vuota (tasto Home)', () => fitView(false))}
    </div>
  );
}
