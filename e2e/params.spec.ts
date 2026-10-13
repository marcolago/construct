import { expect, test, type Locator, type Page } from '@playwright/test';
import { addShape, openApp, openMenuItem, readCode, sceneState, settled } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Scrive in un campo di testo e conferma con Invio. */
async function type(page: Page, locator: Locator, text: string) {
  await locator.click();
  await locator.fill(text);
  await locator.press('Enter');
  await settled(page);
}

/** Crea `spessore = 2` dalla finestra Parametri e la chiude. */
async function createSpessore(page: Page) {
  await openMenuItem(page, 'Parametri…');
  const dialog = page.getByRole('dialog', { name: 'Parametri' });
  await dialog.getByRole('button', { name: 'Aggiungi parametro' }).click();
  await type(page, page.getByLabel('Nome del parametro parametro1'), 'spessore');
  await type(page, page.getByLabel('Formula di spessore'), '2');
  await expect(page.getByLabel('Valore di spessore')).toHaveText('2');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** Lega un campo (riga con il nome dato) a una formula con il selettore aperto dal doppio clic sul nome. */
async function bindField(page: Page, row: Locator, name: string, formula: string) {
  await row.locator('.slider-field__label, .number-field__label', { hasText: name }).first().dblclick();
  const picker = page.getByRole('dialog', { name: /Parametro per/ });
  await picker.getByLabel('Formula').fill(formula);
  await picker.getByRole('button', { name: 'Applica' }).click();
  await expect(picker).toBeHidden();
  await settled(page);
}

test('parametri: finestra di gestione, elenco a destra, formula dal selettore, ricalcolo e codice', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await createSpessore(page);

  // La scheda Parametri a destra mostra l'elenco, solo in lettura
  await page.getByRole('tab', { name: /Parametri/ }).click();
  const row = page.locator('.params-view__row[data-param="spessore"]');
  await expect(row).toContainText('2');
  await expect(row.locator('input')).toHaveCount(0);

  // Doppio clic sul nome del campo Altezza: il campo diventa fx con il valore, senza slider né campo
  const height = page.locator('.slider-field', { hasText: 'Altezza' });
  await bindField(page, height, 'Altezza', '2 * spessore');
  await expect(height.locator('.bound-value')).toContainText('4');
  await expect(height.locator('input')).toHaveCount(0);
  let node = (await sceneState(page)).nodes[id];
  expect(node.size[2]).toBe(4);
  expect(node.exprs['size.2'].expr).toBe('2 * spessore');
  // La base resta sul piatto
  expect(node.position[2]).toBeCloseTo(2, 3);
  await expect(page.locator('.status-bar')).toContainText('Volume 1.60 cm³');

  // Cambiando il parametro dalla finestra il cubo si ridimensiona
  await openMenuItem(page, 'Parametri…');
  await type(page, page.getByLabel('Formula di spessore'), '3');
  await page.keyboard.press('Escape');
  node = (await sceneState(page)).nodes[id];
  expect(node.size[2]).toBe(6);
  await expect(page.locator('.status-bar')).toContainText('Volume 2.40 cm³');

  // Il codice OpenSCAD ha la variabile e la formula
  const code = await readCode(page);
  expect(code).toContain('spessore = 3;');
  expect(code).toContain('cube([20, 20, (2 * spessore)], center = true);');
});

test('parametri: un campo legato non si modifica; "Togli parametro" lo restituisce alla modifica manuale', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await createSpessore(page);
  const height = page.locator('.slider-field', { hasText: 'Altezza' });
  await bindField(page, height, 'Altezza', 'spessore * 5');
  expect((await sceneState(page)).nodes[id].size[2]).toBe(10);

  // Una modifica che tocca l'altezza (come il ridimensionamento proporzionale) lascia l'altezza e cambia le altre misure
  await page.evaluate((nodeId) => window.__construct!.store.getState().updateNode(nodeId, { size: [30, 30, 30] } as never), id);
  expect((await sceneState(page)).nodes[id].size).toEqual([30, 30, 10]);

  // Doppio clic sul nome: il selettore ha il pulsante per togliere il parametro
  await height.locator('.slider-field__label').dblclick();
  const picker = page.getByRole('dialog', { name: /Parametro per/ });
  await picker.getByRole('button', { name: 'Togli parametro' }).click();
  await expect(picker).toBeHidden();
  await expect(height.locator('.bound-value')).toHaveCount(0);
  await expect(height.locator('input[type=range]')).toHaveCount(1);
  expect((await sceneState(page)).nodes[id].exprs).toBeUndefined();
  // Il valore resta com'era e ora si modifica
  await type(page, height.locator('.number-field__input'), '12');
  expect((await sceneState(page)).nodes[id].size[2]).toBe(12);
});

test('parametri: il selettore rifiuta formule senza parametri o non valide', async ({ page }) => {
  await addShape(page, 'Cubo');
  await createSpessore(page);
  await page.locator('.slider-field', { hasText: 'Altezza' }).locator('.slider-field__label').dblclick();
  const picker = page.getByRole('dialog', { name: /Parametro per/ });
  await picker.getByLabel('Formula').fill('5');
  await expect(picker.getByRole('button', { name: 'Applica' })).toBeDisabled();
  await picker.getByLabel('Formula').fill('2 * sconosciuto');
  await expect(picker.getByRole('status')).toContainText('Parametro sconosciuto');
  await picker.getByRole('button', { name: 'spessore' }).click();
  await expect(picker.getByLabel('Formula')).toHaveValue('spessore');
  await expect(picker.getByRole('status')).toContainText('Valore: 2');
  await picker.getByRole('button', { name: 'Annulla' }).click();
  await expect(picker).toBeHidden();
});
