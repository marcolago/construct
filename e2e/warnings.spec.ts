import { expect, test } from '@playwright/test';
import { addShape, openApp, sceneState, settled } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Sposta il nodo con l'azione dello store, come farebbe il gizmo. */
const moveTo = (page: import('@playwright/test').Page, id: string, position: [number, number, number]) =>
  page.evaluate(([nodeId, p]) => window.__construct!.store.getState().updateNode(nodeId as string, { position: p as [number, number, number] }), [id, position] as const);

test('Avvisi: un cubo appoggiato non ne ha, sospeso o fuori dal piano compaiono nella sezione e nella barra di stato', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  const section = page.getByRole('region', { name: 'Avvisi di stampabilità' });
  await expect(section).toContainText('Nessun problema rilevato');
  await expect(page.locator('.status-bar__warnings')).toHaveCount(0);

  // Sollevato dal piano: sospeso e con la faccia inferiore in sbalzo
  await moveTo(page, id, [0, 0, 60]);
  await settled(page);
  await expect(section.locator('.warnings__item')).toHaveCount(2);
  await expect(section.locator('[data-kind="floating"]')).toContainText('«Cubo» non è appoggiato al piano: è sospeso di 50 mm');
  await expect(section.locator('[data-kind="overhang"]')).toContainText('Sbalzi oltre 45° su «Cubo» (400 mm²)');
  await expect(page.locator('.status-bar__warnings')).toHaveText('2 avvisi');

  // Fuori dal volume di stampa: errore, prima degli avvisi nell'elenco
  await moveTo(page, id, [200, 0, 10]);
  await settled(page);
  await expect(section.locator('.warnings__item').first()).toHaveAttribute('data-kind', 'outside');
  await expect(section.locator('[data-kind="outside"]')).toContainText('«Cubo» esce dal volume di stampa (X +82 mm)');
  await expect(page.locator('.status-bar__warnings')).toHaveText('1 avviso');

  // Un clic sull'avviso seleziona l'oggetto
  await page.evaluate(() => window.__construct!.store.getState().select([]));
  await section.locator('[data-kind="outside"]').click();
  expect((await page.evaluate(() => window.__construct!.store.getState().selection))).toEqual([id]);
});

test('Avvisi: il clic su uno sbalzo lo mette in evidenza e le impostazioni spengono i controlli', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await moveTo(page, id, [0, 0, 60]);
  await settled(page);
  const overhang = page.locator('.warnings__item[data-kind="overhang"]');
  await overhang.click();
  await expect(overhang).toHaveAttribute('aria-pressed', 'true');
  await overhang.click();
  await expect(overhang).toHaveAttribute('aria-pressed', 'false');

  // Spenti dalle Impostazioni: la sezione e il contatore spariscono
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  await page.getByLabel('Controlli di stampabilità').uncheck();
  await expect(page.getByRole('region', { name: 'Avvisi di stampabilità' })).toHaveCount(0);
  await expect(page.locator('.status-bar__warnings')).toHaveCount(0);
});

test('Avvisi: una formula che non si calcola è un errore con il nome del parametro', async ({ page }) => {
  await addShape(page, 'Cubo');
  await page.evaluate(() => window.__construct!.store.getState().addParam('spessore', '1 / 0'));
  await expect(page.locator('.warnings__item[data-kind="formula"]')).toContainText('Il parametro «spessore» non si calcola');
});

test('Avvisi: una parete più sottile del minimo e il suo evidenziamento nella vista', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  // Lastra di 0,4 mm: più sottile di due passate di un ugello da 0,4 mm
  await page.evaluate((nodeId) => window.__construct!.store.getState().updateNode(nodeId, { size: [0.4, 20, 20], position: [0, 0, 10] } as never), id);
  await settled(page);
  const thin = page.locator('.warnings__item[data-kind="thin"]');
  // Le analisi del kernel partono dopo una breve pausa
  await expect(thin).toContainText('Pareti sotto 0,8 mm su «Cubo»', { timeout: 15000 });
  await thin.click();
  await expect(thin).toHaveAttribute('aria-pressed', 'true');

  // Con la parete minima a 0,3 mm la lastra va bene
  await page.evaluate(() => window.__construct!.ui!.setState({ minWall: 0.3 }));
  await expect(thin).toHaveCount(0, { timeout: 15000 });
});

test('Avvisi: una parte staccata e sospesa dentro un Raggruppa appoggiato sul piano', async ({ page }) => {
  await addShape(page, 'Cubo');
  await addShape(page, 'Cubo');
  const ids: string[] = (await sceneState(page)).rootIds;
  await page.evaluate(([a, b]) => {
    const store = window.__construct!.store.getState();
    store.updateNode(a, { position: [0, 0, 10] } as never);
    // Il secondo cubo, piccolo, a mezz'aria
    store.updateNode(b, { size: [5, 5, 5], position: [0, 0, 40] } as never);
    store.select([a, b]);
    store.groupSelected();
  }, ids);
  await settled(page);
  await expect(page.locator('.warnings__item[data-kind="detached"]')).toContainText('Una parte staccata e sospesa', { timeout: 15000 });
});
