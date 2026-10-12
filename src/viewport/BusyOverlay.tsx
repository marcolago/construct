import { useEffect, useState } from 'react';
import { useResultStore } from '../kernel/useKernel';

/** Attesa (ms) prima di mostrare l'indicatore: i calcoli brevi (un passo di slider dura una decina di ms) non lo fanno lampeggiare. */
export const BUSY_DELAY_MS = 300;

/**
 * Indicatore di calcolo sopra l'area 3D: compare solo se il kernel resta occupato oltre `BUSY_DELAY_MS`.
 * Non cattura i clic (non è un modale vero): durante il trascinamento di uno slider ogni passo avvia un calcolo e
 * un blocco dell'interfaccia renderebbe lo slider inutilizzabile.
 */
export function BusyOverlay() {
  const busy = useResultStore((s) => s.busy);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Calcolo finito: l'indicatore sparisce subito
    if (!busy) {
      setVisible(false);
      return;
    }
    // Calcolo in corso: si mostra solo se dura abbastanza; se finisce prima il timer viene annullato
    const timer = setTimeout(() => setVisible(true), BUSY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  if (!visible) return null;
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-overlay__card">
        <span className="busy-overlay__spinner" aria-hidden="true" />
        <span>Calcolo in corso…</span>
      </div>
    </div>
  );
}
