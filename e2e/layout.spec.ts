import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('barra sinistra: il separatore ridimensiona libreria e oggetti, con mouse e tastiera, e la misura si ricorda', async ({ page }) => {
  const library = page.locator('.shape-library');
  const outliner = page.locator('.outliner');
  const splitter = page.getByRole('separator', { name: 'Altezza di libreria e oggetti' });
  const before = { lib: (await library.boundingBox())!.height, out: (await outliner.boundingBox())!.height };

  // Trascinandolo in basso la libreria cresce e gli oggetti si accorciano
  const box = (await splitter.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 90, { steps: 6 });
  await page.mouse.up();
  const after = { lib: (await library.boundingBox())!.height, out: (await outliner.boundingBox())!.height };
  expect(after.lib).toBeGreaterThan(before.lib + 60);
  expect(after.out).toBeLessThan(before.out - 60);

  // Frecce: su la accorcia; doppio clic: torna alla misura iniziale
  await splitter.focus();
  const now = Number(await splitter.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowUp');
  expect(Number(await splitter.getAttribute('aria-valuenow'))).toBe(now - 2);
  await splitter.dblclick();
  await expect(splitter).toHaveAttribute('aria-valuenow', '52');

  // La misura sta nelle preferenze e sopravvive al ricaricamento
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('construct:ui') ?? '{}').state?.librarySplit)).toBeCloseTo(0.54, 2);
  await page.reload();
  await expect(page.getByRole('separator', { name: 'Altezza di libreria e oggetti' })).toHaveAttribute('aria-valuenow', '54');
});

test('barra destra: schede Proprietà e Parametri, con il pulsante che apre la finestra di gestione', async ({ page }) => {
  await page.getByRole('tab', { name: /Parametri/ }).click();
  await expect(page.locator('.params-view__empty')).toBeVisible();
  await page.getByRole('button', { name: 'Gestisci parametri…' }).click();
  await expect(page.getByRole('dialog', { name: 'Parametri' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Proprietà' }).click();
  await expect(page.locator('.properties__empty')).toBeVisible();
});
