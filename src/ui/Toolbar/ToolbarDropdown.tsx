import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useUiStore } from '../uiStore';
import type { ToolbarMenu } from '../uiStore';
import { ToolTip } from './ToolTip';
import { TOOLBAR_HELP } from './toolbarHelp';
import type { HelpKey } from './toolbarHelp';

interface Props {
  /** Identificatore della tendina: lo stato aperto/chiuso sta nello store, così si apre anche con la scorciatoia. */
  id: ToolbarMenu;
  /** Voce di aiuto: nome accessibile e tooltip dettagliato. */
  help: HelpKey;
  /** Scorciatoia da tastiera, mostrata in piccolo sopra l'icona. */
  shortcut?: string;
  /** Il pannello si allinea al bordo destro del pulsante invece che al sinistro (per le tendine vicine al bordo della finestra). */
  alignRight?: boolean;
  /** Tasti da mostrare nel tooltip al posto della scorciatoia (per le tendine che non hanno un solo tasto, come Viste). */
  tipKeys?: string;
  /** Icona del pulsante. */
  icon: ReactNode;
  disabled?: boolean;
  /** Contenuto della tendina; `close` la chiude dopo la scelta. */
  children: (close: () => void) => ReactNode;
}

/** Pulsante della toolbar che apre una piccola tendina; si chiude con un clic fuori o con Esc. */
export function ToolbarDropdown({ id, help, shortcut, tipKeys, alignRight, icon, disabled, children }: Props) {
  const open = useUiStore((s) => s.toolbarMenu === id);
  const setToolbarMenu = useUiStore((s) => s.setToolbarMenu);
  const setOpen = (value: boolean) => setToolbarMenu(value ? id : null);
  const ref = useRef<HTMLDivElement>(null);

  // Se il pulsante si disabilita (la selezione è cambiata) la tendina non deve restare aperta in attesa
  useEffect(() => {
    if (disabled && open) setToolbarMenu(null);
  }, [disabled, open, setToolbarMenu]);

  useEffect(() => {
    if (!open) return;
    // Clic fuori dalla tendina oppure Esc: si chiude
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setToolbarMenu]);

  const isOpen = open && !disabled;

  return (
    <div className="toolbar__dropdown" ref={ref}>
      <ToolTip help={help} keys={tipKeys ?? shortcut}>
        {(describedBy) => (
          <button
            type="button"
            className={`toolbar__button${isOpen ? ' toolbar__button--active' : ''}`}
            aria-label={TOOLBAR_HELP[help].name}
            aria-describedby={describedBy}
            aria-haspopup="true"
            aria-expanded={isOpen}
            disabled={disabled}
            onClick={() => setOpen(!open)}
          >
            {shortcut && <span className="toolbar__shortcut" aria-hidden="true">{shortcut}</span>}
            {icon}
          </button>
        )}
      </ToolTip>
      {isOpen && (
        <div className={`toolbar__dropdown-panel${alignRight ? ' toolbar__dropdown-panel--right' : ''}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
