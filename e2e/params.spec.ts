import { expect, test } from '@playwright/test';
import { addShape, openApp, readCode, sceneState, settled } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Scrive in un campo di testo e conferma con Invio. */
async function type(page: import('@playwright/test').Page, locator: import('@playwright/test').Locator, text: string) {
  await locator.click();
  await locator.fill(text);
  await locator.press('Enter');
  await settled(page);
}

test('parametri: una formula lega il campo, cambiare il parametro ridimensiona e il codice usa le variabili', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];

  // Crea il parametro `spessore = 2` dalla scheda Parametri
  await page.getByRole('tab', { name: 'Parametri' }).click();
  await page.getByRole('button', { name: 'Aggiungi parametro' }).click();
  await type(page, page.getByLabel('Nome del parametro parametro1'), 'spessore');
  await type(page, page.getByLabel('Formula di spessore'), '2');
  await expect(page.getByLabel('Valore di spessore')).toHaveText('2');

  // Il campo Altezza del cubo accetta la formula e resta legato
  const height = page.locator('.slider-field', { hasText: 'Altezza' }).locator('.number-field__input');
  await type(page, height, '2 * spessore');
  let node = (await sceneState(page)).nodes[id];
  expect(node.size[2]).toBe(4);
  expect(node.exprs['size.2'].expr).toBe('2 * spessore');
  // La base resta sul piatto: la quota si abbassa insieme all'altezza
  expect(node.position[2]).toBeCloseTo(2, 3);
  await expect(page.locator('.status-bar')).toContainText('Volume 1.60 cm³');

  // Cambiando il parametro il cubo si ridimensiona da solo
  await type(page, page.getByLabel('Formula di spessore'), '3');
  node = (await sceneState(page)).nodes[id];
  expect(node.size[2]).toBe(6);
  expect(node.position[2]).toBeCloseTo(3, 3);
  await expect(page.locator('.status-bar')).toContainText('Volume 2.40 cm³');

  // Il codice OpenSCAD ha la variabile e la formula
  const code = await readCode(page);
  expect(code).toContain('spessore = 3;');
  expect(code).toContain('cube([20, 20, (2 * spessore)], center = true);');

  // Annulla riporta il parametro e il cubo al passo precedente in un colpo solo
  await page.keyboard.press('Control+z');
  await settled(page);
  expect((await sceneState(page)).nodes[id].size[2]).toBe(4);
  expect((await sceneState(page)).params[0].expr).toBe('2');
});

test('parametri: scrivere un numero in un campo legato ne scioglie la formula', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await page.getByRole('tab', { name: 'Parametri' }).click();
  await page.getByRole('button', { name: 'Aggiungi parametro' }).click();
  const width = page.locator('.slider-field', { hasText: 'Larghezza' }).locator('.number-field__input');
  await type(page, width, 'parametro1 * 10');
  expect((await sceneState(page)).nodes[id].size[0]).toBe(10);
  await expect(page.locator('.number-field--bound')).toHaveCount(1);
  await type(page, width, '25');
  const node = (await sceneState(page)).nodes[id];
  expect(node.size[0]).toBe(25);
  expect(node.exprs).toBeUndefined();
  await expect(page.locator('.number-field--bound')).toHaveCount(0);
});
