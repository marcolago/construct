import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { DEFAULT_LIBRARY_SHARE, LIBRARY_SHARE_LIMITS, useUiStore } from '../uiStore';
import './Splitter.scss';

/** Passo (frazione dell'altezza) delle frecce della tastiera. */
const KEY_STEP = 0.02;

/**
 * Maniglia tra la libreria e la sezione Oggetti/Piatti della barra sinistra: trascinandola in verticale si cambiano le
 * altezze delle due sezioni (la misura si ricorda). Doppio clic: altezze di partenza. Con il fuoco, le frecce su e giù.
 */
export function Splitter() {
  const share = useUiStore((s) => s.librarySplit);
  const setShare = useUiStore((s) => s.setLibrarySplit);
  const dragging = useRef(false);

  /** Altezza della libreria come frazione dell'altezza della barra, dal puntatore. */
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const bar = e.currentTarget.closest('.app__left');
    // La libreria sta sotto il marchio: la sua altezza è la distanza dal suo bordo alto, in frazione dell'altezza della barra
    const library = e.currentTarget.previousElementSibling;
    if (!bar || !library) return;
    const height = bar.getBoundingClientRect().height;
    if (height > 0) setShare((e.clientY - library.getBoundingClientRect().top) / height);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setShare(share + (e.key === 'ArrowDown' ? KEY_STEP : -KEY_STEP));
    } else if (e.key === 'Home') setShare(LIBRARY_SHARE_LIMITS.min);
    else if (e.key === 'End') setShare(LIBRARY_SHARE_LIMITS.max);
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Altezza di libreria e oggetti"
      aria-valuemin={Math.round(LIBRARY_SHARE_LIMITS.min * 100)}
      aria-valuemax={Math.round(LIBRARY_SHARE_LIMITS.max * 100)}
      aria-valuenow={Math.round(share * 100)}
      tabIndex={0}
      title="Trascina per cambiare l'altezza delle due sezioni (doppio clic: misura iniziale)"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        fromPointer(e);
      }}
      onPointerMove={(e) => dragging.current && fromPointer(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onDoubleClick={() => setShare(DEFAULT_LIBRARY_SHARE)}
      onKeyDown={onKeyDown}
    />
  );
}
