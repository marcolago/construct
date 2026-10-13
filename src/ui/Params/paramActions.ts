import { queueKeepBase } from '../../kernel/placement';
import { usageCount, usersOf } from '../../scene/params';
import { useSceneStore } from '../../scene/store';
import type { Binding, Param } from '../../scene/types';
import { confirmDialog, notify } from '../notify/notifyStore';

/**
 * Cambiare un parametro ridimensiona gli oggetti legati: come per le misure scritte a mano, la base di ciascuno resta
 * dov'era (chi sta sul piatto ci resta). Va chiamata prima della modifica.
 */
function keepBasesOfBoundObjects(): void {
  for (const node of Object.values(useSceneStore.getState().scene.nodes)) if (node.exprs) queueKeepBase(node.id);
}

/** Aggiunge un parametro con un nome libero ("parametro1", "parametro2"...) e valore 1. */
export function createParam(): string {
  const used = new Set((useSceneStore.getState().scene.params ?? []).map((p) => p.name));
  let i = 1;
  while (used.has(`parametro${i}`)) i++;
  return useSceneStore.getState().addParam(`parametro${i}`, '1');
}

/** Modifica un parametro; false se il nome non è valido o è già usato. */
export function editParam(id: string, patch: Partial<Pick<Param, 'name' | 'expr' | 'note'>>): boolean {
  // Un numero con la virgola decimale italiana ("2,5") vale 2.5; in una formula la virgola separa gli argomenti
  const expr = patch.expr?.trim().replace(/^(-?\d+),(\d+)$/, '$1.$2');
  if (expr !== undefined) keepBasesOfBoundObjects();
  return useSceneStore.getState().updateParam(id, expr === undefined ? patch : { ...patch, expr });
}

/** Elimina un parametro; se qualche campo lo usa chiede conferma (i campi restano con il valore attuale). */
export async function deleteParam(id: string): Promise<void> {
  const scene = useSceneStore.getState().scene;
  const param = scene.params?.find((p) => p.id === id);
  if (!param) return;
  const used = usageCount(scene)[param.name] ?? 0;
  if (used > 0) {
    const ok = await confirmDialog(`«${param.name}» è usato da ${used === 1 ? 'una formula' : `${used} formule`}: i campi restano con il valore attuale, ma senza formula. Eliminarlo?`, 'Elimina');
    if (!ok) return;
  }
  useSceneStore.getState().removeParam(id);
}

/**
 * Lega un campo di un nodo a una formula, o la scioglie con null. Come per le misure scritte a mano, la base
 * dell'oggetto resta dov'era (lo spostamento no).
 */
export function bindFieldKeepingBase(nodeId: string, path: string, binding: Binding | null): void {
  if (!path.startsWith('position')) queueKeepBase(nodeId);
  useSceneStore.getState().bindField(nodeId, path, binding);
}

/** Seleziona nella vista gli oggetti che usano il parametro (così si vedono evidenziati). */
export function selectUsers(name: string): void {
  const { nodes } = usersOf(useSceneStore.getState().scene, name);
  if (nodes.length === 0) {
    notify.info(`Nessun oggetto usa «${name}»`);
    return;
  }
  useSceneStore.getState().select(nodes);
}

/**
 * Cambia il nome di un parametro. Se è usato chiede conferma elencando chi verrà aggiornato (le formule seguono il nuovo
 * nome). Restituisce false se il nome è stato rifiutato o l'utente ha annullato.
 */
export async function renameParam(id: string, name: string): Promise<boolean> {
  const scene = useSceneStore.getState().scene;
  const param = scene.params?.find((p) => p.id === id);
  if (!param) return false;
  const users = usersOf(scene, param.name);
  const who = [...users.nodes.map((n) => `«${scene.nodes[n].name}»`), ...users.params.map((p) => `il parametro «${p}»`)];
  if (who.length > 0) {
    const shown = who.length > 6 ? `${who.slice(0, 6).join(', ')} e altri ${who.length - 6}` : who.join(', ');
    const ok = await confirmDialog(`Rinominare «${param.name}» in «${name}»? Le formule che lo usano seguono il nuovo nome: ${shown}.`, 'Rinomina');
    if (!ok) return false;
  }
  return useSceneStore.getState().updateParam(id, { name });
}
