import { Box, Check, Code, Grid3x3, Hash, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useUiStore } from '../uiStore';

/**
 * Contenuto della tendina Altro, una voce sotto l'altra. Con la finestra stretta raccoglie i comandi di vista che nella
 * barra larga hanno un pulsante ciascuno: proiezione, operandi delle booleane, piatto, tema e codice OpenSCAD. Ogni
 * voce ha il suo tasto (le scorciatoie funzionano comunque) e, per gli interruttori, il segno di spunta se è attivo.
 */
export function MoreMenu({ close }: { close: () => void }) {
  const { projection, toggleProjection, ghostOps, toggleGhostOps, bedMode, toggleBed, theme, toggleTheme, codeOpen, toggleCode } = useUiStore();

  const entry = (label: string, key: string, Icon: LucideIcon, on: boolean | undefined, title: string, action: () => void) => (
    <button
      key={label}
      type="button"
      role={on === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={on}
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
      {on && <Check size={14} aria-hidden="true" />}
      <kbd className="toolbar__dropdown-key">{key}</kbd>
    </button>
  );

  return (
    <div className="toolbar__dropdown-list">
      {entry('Ortografica', '5', Box, projection === 'orthographic', 'Vista ortografica, senza prospettiva (tasto 5)', toggleProjection)}
      {entry('Operandi', 'X', Hash, ghostOps, 'Mostra in trasparenza gli operandi delle booleane (tasto X)', toggleGhostOps)}
      {entry(bedMode === 'full' ? 'Nascondi piatto' : 'Mostra piatto', 'P', Grid3x3, undefined, 'Mostra o nasconde il piatto di stampa (tasto P)', toggleBed)}
      {entry(theme === 'light' ? 'Tema scuro' : 'Tema chiaro', 'D', theme === 'light' ? Moon : Sun, undefined, 'Cambia tema (tasto D)', toggleTheme)}
      {entry('Codice OpenSCAD', 'C', Code, codeOpen, 'Apre o chiude il codice OpenSCAD (tasto C)', toggleCode)}
    </div>
  );
}
