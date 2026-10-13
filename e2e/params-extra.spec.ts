import { expect, test, type Page } from '@playwright/test';
import { addShape, openApp, openMenuItem, sceneState } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Apre il selettore del parametro sul campo Altezza del cubo selezionato. */
async function openPicker(page: Page) {
  await page.locator('.slider-field', { hasText: 'Altezza' }).locator('.slider-field__label').dblclick();
  return page.getByRole('dialog', { name: /Parametro per/ });
}

test('selettore: un parametro nuovo si crea al volo e si usa subito; l\'elenco oggetti mostra fx', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await expect(page.locator('.outliner__fx')).toHaveCount(0);

  const picker = await openPicker(page);
  // Senza parametri si può crearne uno proprio dal selettore
  await picker.getByRole('button', { name: 'Crea un parametro' }).click();
  await picker.getByLabel('Nome del nuovo parametro').fill('spessore');
  await picker.getByLabel('Valore del nuovo parametro').fill('3');
  await picker.getByRole('button', { name: 'Crea', exact: true }).click();
  await expect(picker.getByLabel('Formula')).toHaveValue('spessore');
  await picker.getByLabel('Formula').fill('4 * spessore');
  await picker.getByRole('button', { name: 'Applica' }).click();
  await expect(picker).toBeHidden();

  const node = (await sceneState(page)).nodes[id];
  expect(node.size[2]).toBe(12);
  expect((await sceneState(page)).params.map((p: { name: string }) => p.name)).toEqual(['spessore']);
  // L'oggetto che usa un parametro porta l'icona fx nell'elenco, con i nomi nel tooltip
  await expect(page.locator('.outliner__fx')).toHaveCount(1);
  await expect(page.locator('.outliner__fx')).toHaveAttribute('title', 'Usa i parametri: spessore');

  // Un nome già usato o non valido è rifiutato
  const again = await openPicker(page);
  await again.getByRole('button', { name: 'Nuovo parametro…' }).click();
  await again.getByLabel('Nome del nuovo parametro').fill('spessore');
  await again.getByLabel('Valore del nuovo parametro').fill('1');
  await expect(again.getByRole('button', { name: 'Crea', exact: true })).toBeDisabled();
  await again.getByLabel('Nome del nuovo parametro').fill('profondità');
  await expect(again.getByRole('button', { name: 'Crea', exact: true })).toBeDisabled();
});

test('elenco parametri: il clic sul nome seleziona gli oggetti che lo usano', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Cilindro');
  const [cylinder, cube] = (await sceneState(page)).rootIds as string[];
  await page.evaluate(([c]) => {
    const s = window.__construct!.store.getState();
    s.addParam('spessore', '2');
    s.select([c]);
    s.bindField(c, 'size.2', { expr: 'spessore * 5' });
  }, [cube]);
  await page.evaluate(() => window.__construct!.store.getState().select([]));
  await page.getByRole('tab', { name: /Parametri/ }).click();
  await page.getByRole('button', { name: 'spessore' }).click();
  expect(await page.evaluate(() => window.__construct!.store.getState().selection)).toEqual([cube]);
  expect(cylinder).not.toBe(cube);
});

test('finestra Parametri: rinominare un parametro usato chiede conferma e aggiorna le formule', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await page.evaluate((nodeId) => {
    const s = window.__construct!.store.getState();
    s.addParam('spessore', '2');
    s.bindField(nodeId, 'size.2', { expr: 'spessore * 5' });
  }, id);
  await openMenuItem(page, 'Parametri…');
  const row = page.locator('.params__row[data-param="spessore"]');
  await expect(row).toContainText('usato da Cubo');

  const name = page.getByLabel('Nome del parametro spessore');
  await name.fill('parete');
  await name.press('Enter');
  const confirm = page.getByRole('dialog').filter({ hasText: 'Rinominare «spessore» in «parete»' });
  await expect(confirm).toContainText('«Cubo»');
  // Annullando non cambia nulla
  await confirm.getByRole('button', { name: 'Annulla' }).click();
  expect((await sceneState(page)).params[0].name).toBe('spessore');

  await name.fill('parete');
  await name.press('Enter');
  await page.getByRole('dialog').filter({ hasText: 'Rinominare «spessore» in «parete»' }).getByRole('button', { name: 'Rinomina' }).click();
  await expect.poll(async () => (await sceneState(page)).params[0].name).toBe('parete');
  expect((await sceneState(page)).nodes[id].exprs['size.2'].expr).toBe('parete * 5');
});

test('lucchetto delle proporzioni: con una misura legata resta aperto e disattivato, poi torna', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  // Lucchetto chiuso, poi altezza legata a un parametro
  await page.evaluate((nodeId) => {
    const s = window.__construct!.store.getState();
    s.updateNode(nodeId, { lockRatio: true } as never);
    s.addParam('spessore', '2');
    s.bindField(nodeId, 'size.2', { expr: 'spessore * 5' });
  }, id);
  const lock = page.locator('.properties__lock');
  await expect(lock).toBeDisabled();
  await expect(lock).toContainText('Libere');
  await expect(lock).toHaveAttribute('title', /legata a un parametro/);
  // Cambiando la larghezza dalla quota, le altre misure non seguono
  await page.evaluate((nodeId) => window.__construct!.store.getState().updateNode(nodeId, { size: [40, 20, 7] } as never), id);
  expect((await sceneState(page)).nodes[id].size).toEqual([40, 20, 10]);

  // Tolto il parametro, il lucchetto salvato torna attivo
  await page.locator('.slider-field', { hasText: 'Altezza' }).locator('.slider-field__label').dblclick();
  await page.getByRole('dialog', { name: /Parametro per/ }).getByRole('button', { name: 'Togli parametro' }).click();
  await expect(lock).toBeEnabled();
  await expect(lock).toContainText('Bloccate');
});
