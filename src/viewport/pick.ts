// Scelta dell'oggetto sotto il clic nella vista 3D: logica pura (senza three.js) più il poco stato che serve tra gli eventi.

/** Cosa si sa di una mesh colpita dal raggio (messo in `userData.pick` di ogni mesh della scena). */
export interface PickHit {
  /** Nodo della mesh. */
  id: string;
  /** Antenati dalla radice al nodo, nodo incluso: il primo è l'oggetto alla radice. */
  path: string[];
}

/** Distanza massima (px) tra due clic perché il secondo conti come "nello stesso punto". */
export const REPEAT_DISTANCE = 4;
/** Intervallo (ms) entro cui due clic sono un doppio clic (passa a Sposta) e non uno scorrimento della selezione. */
export const DOUBLE_CLICK_MS = 350;
/** Oltre questo intervallo (ms) un clic nello stesso punto è una scelta nuova, non una ripetizione. */
export const REPEAT_MAX_MS = 3000;

/**
 * Oggetto da selezionare per un clic. `hits` sono le mesh attraversate dal raggio, dalla più vicina; con Alt si sceglie
 * la singola parte e non l'oggetto intero. I bloccati vengono dopo gli altri: il clic li attraversa se dietro c'è
 * qualcosa di libero, ma un bloccato isolato si seleziona ancora (per poterlo sbloccare). Con `repeat` il clic
 * ripetuto nello stesso punto passa al candidato successivo a quello già selezionato, in modo circolare.
 * Restituisce `undefined` se il raggio non ha colpito nulla.
 */
export function pickTarget(options: { hits: PickHit[]; alt: boolean; selection: string[]; repeat: boolean; isLocked: (id: string) => boolean }): string | undefined {
  const { hits, alt, selection, repeat, isLocked } = options;
  // Un candidato per oggetto, nell'ordine del raggio
  const ids = [...new Set(hits.map((h) => (alt ? h.id : h.path[0])))];
  if (ids.length === 0) return undefined;
  const ordered = [...ids.filter((id) => !isLocked(id)), ...ids.filter((id) => isLocked(id))];
  if (repeat) {
    const at = ordered.findIndex((id) => selection.includes(id));
    if (at >= 0) return ordered[(at + 1) % ordered.length];
  }
  return ordered[0];
}

/** Ultimo clic di selezione: serve a riconoscere il clic ripetuto nello stesso punto. */
let lastClick: { x: number; y: number; time: number } | undefined;

/** Vero se il clic è nello stesso punto del precedente e abbastanza dopo da non essere un doppio clic. */
export function isRepeatClick(x: number, y: number, time: number): boolean {
  if (!lastClick) return false;
  const elapsed = time - lastClick.time;
  return Math.hypot(x - lastClick.x, y - lastClick.y) <= REPEAT_DISTANCE && elapsed >= DOUBLE_CLICK_MS && elapsed <= REPEAT_MAX_MS;
}

/** Registra l'ultimo clic di selezione (posizione in pixel e istante in ms). */
export function rememberClick(x: number, y: number, time: number): void {
  lastClick = { x, y, time };
}

/** Dimentica l'ultimo clic (per i test). */
export function forgetClick(): void {
  lastClick = undefined;
}

// Il gizmo dell'oggetto selezionato può stare dietro la superficie di un altro oggetto: il suo trascinamento parte dal
// premere del tasto, e il clic che ne segue non deve selezionare ciò che gli sta davanti. Il flag si imposta al premere
// (TransformControls azzera da solo l'asse al rilascio, quindi al clic non si può più leggere).
let pressedOnGizmo = false;

export function setPressedOnGizmo(value: boolean): void {
  pressedOnGizmo = value;
}

/** Vero se l'ultimo tasto premuto nella vista era su una maniglia del gizmo. */
export function wasPressedOnGizmo(): boolean {
  return pressedOnGizmo;
}
