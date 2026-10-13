import { expect, test, type Page } from '@playwright/test';
import { addShape, openApp, sceneState, settled } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Sposta il nodo con l'azione dello store, come farebbe il gizmo. */
const moveTo = (page: Page, id: string, position: [number, number, number]) =>
  page.evaluate(([nodeId, p]) => window.__construct!.store.getState().updateNode(nodeId as string, { position: p as [number, number, number] }), [id, position] as const);

test('Avvisi: si può ignorare un avviso, ritrovarlo tra gli ignorati e ripristinarlo', async ({ page }) => {
  await addShape(page, 'Cubo');
  const id = (await sceneState(page)).rootIds[0];
  await moveTo(page, id, [0, 0, 60]);
  await settled(page);
  const section = page.getByRole('region', { name: 'Avvisi di stampabilità' });
  await expect(section.locator('.warnings__item')).toHaveCount(2);

  // Ignora lo sbalzo: resta il solo avviso di sospensione e il contatore scende
  await section.locator('.warnings__row', { has: page.locator('[data-kind="overhang"]') }).getByRole('button', { name: /^Ignora/ }).click();
  await expect(section.locator('.warnings__item')).toHaveCount(1);
  await expect(page.locator('.status-bar__warnings')).toHaveText('1 avviso');
  expect((await sceneState(page)).ignoredWarnings).toEqual([`overhang:${id}`]);

  // Ignorati: l'elenco si apre e l'avviso si ripristina
  await section.getByRole('button', { name: /Ignorati \(1\)/ }).click();
  await expect(section.locator('.warnings__row--ignored')).toContainText('Sbalzi oltre 45°');
  await section.getByRole('button', { name: /^Ripristina:/ }).click();
  await expect(section.locator('.warnings__item')).toHaveCount(2);
  expect((await sceneState(page)).ignoredWarnings).toBeUndefined();

  // Ignorando tutti il contatore sparisce; l'avviso ignorato non torna dopo un nuovo calcolo
  for (const kind of ['overhang', 'floating']) {
    await section.locator('.warnings__row', { has: page.locator(`[data-kind="${kind}"]`) }).getByRole('button', { name: /^Ignora/ }).click();
  }
  await expect(page.locator('.status-bar__warnings')).toHaveCount(0);
  await moveTo(page, id, [0, 0, 70]);
  await settled(page);
  await expect(section).toContainText('Nessun problema rilevato (oltre a quelli ignorati)');
  await section.getByRole('button', { name: /Ignorati \(2\)/ }).click();
  await section.getByRole('button', { name: 'Ripristina tutti' }).click();
  await expect(section.locator('.warnings__item')).toHaveCount(2);
});
