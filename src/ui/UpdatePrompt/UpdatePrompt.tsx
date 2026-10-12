import { useState } from 'react';
import { RefreshCw, Save, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { saveProject } from '../fileActions';
import { Modal } from '../Modal/Modal';
import './UpdatePrompt.scss';

// Intervallo di controllo di una nuova versione mentre l'app resta aperta
const CHECK_EVERY_MS = 60 * 60 * 1000;
// Dopo questo tempo senza ricarico automatico la pagina si ricarica da sola
const RELOAD_FALLBACK_MS = 4000;

/**
 * Nuova versione: modale bloccante con il solo "Aggiorna" (l'aggiornamento è obbligatorio).
 * Resta il banner discreto per l'avviso "pronto per l'uso offline".
 */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Controllo periodico: senza, l'aggiornamento verrebbe rilevato solo al ricaricamento della pagina
      setInterval(() => void registration.update(), CHECK_EVERY_MS);
      // E uno ogni volta che la scheda torna visibile (app PWA lasciata aperta per giorni)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
  });

  const [updating, setUpdating] = useState(false);

  /**
   * Attiva il service worker nuovo e ricarica la pagina. Il ricarico automatico del plugin scatta solo se la pagina era
   * già controllata da un service worker all'apertura: alla prima visita o dopo una ricarica forzata (Ctrl+F5) non
   * scatta mai e il pulsante sembrava morto. Per questo si ascolta direttamente `controllerchange`, con un ricarico di
   * riserva se l'evento non arriva.
   */
  const update = () => {
    setUpdating(true);
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
    void updateServiceWorker(true);
  };

  return (
    <>
      <Modal open={needRefresh} title="Aggiornamento disponibile" dismissable={false} onClose={() => undefined}>
        <p>
          È disponibile una nuova versione di Construct (in uso v{__APP_VERSION__}). Per continuare è necessario aggiornare.
          Se hai lavoro non salvato, salvalo prima: la pagina si ricaricherà.
        </p>
        <div className="modal__actions">
          <button type="button" className="modal__button" onClick={saveProject} disabled={updating}>
            <Save size={14} />
            Salva progetto
          </button>
          <button type="button" className="modal__button modal__button--primary" onClick={update} disabled={updating}>
            <RefreshCw size={14} />
            {updating ? 'Aggiornamento in corso…' : 'Aggiorna ora'}
          </button>
        </div>
      </Modal>

      {offlineReady && !needRefresh && (
        <div className="update-prompt" role="status" aria-live="polite">
          <p className="update-prompt__text">Construct è pronto per l’uso offline.</p>
          <button type="button" className="update-prompt__button" onClick={() => setOfflineReady(false)} aria-label="Chiudi">
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
