import { beforeEach, describe, expect, it } from 'vitest';
import { applicableGroups, COMMANDS, COMMAND_GROUPS, getCommandContext, helpOf } from './commands';
import { TOOLBAR_HELP } from './Toolbar/toolbarHelp';
import { useResultStore } from '../kernel/useKernel';
import type { NodeMesh } from '../kernel/evaluate';
import { useSceneStore } from '../scene/store';

/** Id dei comandi che il menu contestuale mostra adesso per la selezione. */
const applicable = () => applicableGroups(getCommandContext()).flatMap((g) => g.commands.map((c) => c.id));

/** Mesh finta con il solo ingombro: al menu serve per sapere se l'oggetto poggia sul piatto. */
const meshAt = (rootId: string, minZ: number) => ({ id: rootId, rootId, path: [rootId], empty: false, bbox: { min: [0, 0, minZ], max: [10, 10, minZ + 10] } }) as NodeMesh;

beforeEach(() => {
  useSceneStore.getState().loadScene({ nodes: {}, rootIds: [] });
  useResultStore.setState({ meshes: [] });
});

describe('registro dei comandi', () => {
  it('ogni comando sta in un solo gruppo e ogni voce ha il suo aiuto', () => {
    const ids = COMMAND_GROUPS.flatMap((g) => g.ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.keys(COMMANDS).sort());
    const c = getCommandContext();
    for (const cmd of Object.values(COMMANDS)) expect(TOOLBAR_HELP[helpOf(cmd, c)]).toBeDefined();
  });

  it('senza oggetti nessun comando di selezione è applicabile', () => {
    expect(applicable()).toEqual([]);
  });

  it('un solo cubo: niente Unisci, Raggruppa, Allinea, Separa; sì Duplica, Elimina, Specchia, Blocca, Raccordo', () => {
    useSceneStore.getState().addPrimitive('box');
    const ids = applicable();
    for (const id of ['duplicate', 'delete', 'mirror', 'lock', 'hole', 'shell', 'pattern', 'array', 'fillet', 'chamfer', 'corner', 'layflat', 'lay', 'split'] as const) expect(ids).toContain(id);
    for (const id of ['union', 'group', 'hull', 'minkowski', 'align', 'ungroup'] as const) expect(ids).not.toContain(id);
  });

  it('due oggetti: compaiono le booleane e Allinea, ma non gli strumenti sulle facce né Separa', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    s.addPrimitive('cylinder');
    s.select(useSceneStore.getState().scene.rootIds);
    const ids = applicable();
    for (const id of ['union', 'group', 'hull', 'minkowski', 'align'] as const) expect(ids).toContain(id);
    for (const id of ['fillet', 'chamfer', 'corner', 'layflat', 'ungroup'] as const) expect(ids).not.toContain(id);
  });

  it('Separa solo su un gruppo, e il menu non include le modalità del gizmo', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    s.addPrimitive('box');
    s.select(useSceneStore.getState().scene.rootIds);
    s.unionSelected();
    const ids = applicable();
    expect(ids).toContain('ungroup');
    for (const id of ['select', 'translate', 'rotate', 'resize', 'extrude'] as const) expect(ids).not.toContain(id);
  });

  it('una sfera non ha facce piane: niente Raccordo, Smusso, Smusso angolare, Appoggia su una faccia', () => {
    useSceneStore.getState().addPrimitive('sphere');
    const ids = applicable();
    for (const id of ['fillet', 'chamfer', 'corner', 'layflat'] as const) expect(ids).not.toContain(id);
    expect(ids).toContain('duplicate');
  });

  it('Appoggia sul piatto compare solo se l\'oggetto non è già sul piatto', () => {
    useSceneStore.getState().addPrimitive('box');
    const id = useSceneStore.getState().scene.rootIds[0];
    useResultStore.setState({ meshes: [meshAt(id, 0)] });
    expect(applicable()).not.toContain('drop');
    useResultStore.setState({ meshes: [meshAt(id, 5)] });
    expect(applicable()).toContain('drop');
  });

  it('un oggetto bloccato offre solo Sblocca, Duplica, Nascondi e Misura', () => {
    const s = useSceneStore.getState();
    s.addPrimitive('box');
    s.toggleLockSelected();
    const c = getCommandContext();
    expect(helpOf(COMMANDS.lock, c)).toBe('unlock');
    expect(COMMANDS.mirror.enabled(c)).toBe(false);
    expect(applicable().sort()).toEqual(['duplicate', 'hide', 'lock', 'measure']);
  });

  it('Nascondi: con una selezione alla radice nasconde, senza selezione (e con nascosti) mostra tutti', () => {
    const s = useSceneStore.getState();
    // Senza oggetti non c'è nulla da nascondere né da mostrare
    expect(COMMANDS.hide.enabled(getCommandContext())).toBe(false);
    s.addPrimitive('box');
    let c = getCommandContext();
    expect(COMMANDS.hide.enabled(c)).toBe(true);
    expect(helpOf(COMMANDS.hide, c)).toBe('hide');
    expect(applicable()).toContain('hide');
    COMMANDS.hide.run(c);
    // Nascosto: la selezione si svuota, il comando offre "Mostra tutti" sulla barra ma non nel menu
    c = getCommandContext();
    expect(c.hasSelection).toBe(false);
    expect(c.someHidden).toBe(true);
    expect(helpOf(COMMANDS.hide, c)).toBe('showAll');
    expect(COMMANDS.hide.enabled(c)).toBe(true);
    expect(applicable()).not.toContain('hide');
    COMMANDS.hide.run(c);
    expect(getCommandContext().someHidden).toBe(false);
  });
});
