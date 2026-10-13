import { beforeEach, describe, expect, it } from 'vitest';
import { evalFormula, formulaDeps, nameProblem, renameInExpr, resolveParams, validName } from './params';
import { useSceneStore } from './store';
import type { Param } from './types';

const p = (name: string, expr: string): Param => ({ id: name, name, expr });
const st = () => useSceneStore.getState();
const steps = () => useSceneStore.temporal.getState().pastStates.length;

describe('formule', () => {
  it('rispetta la precedenza degli operatori e la potenza associativa a destra', () => {
    expect(evalFormula('2 + 3 * 4', {})).toEqual({ ok: true, value: 14 });
    expect(evalFormula('(2 + 3) * 4', {})).toEqual({ ok: true, value: 20 });
    expect(evalFormula('2 ^ 3 ^ 2', {})).toEqual({ ok: true, value: 512 });
    expect(evalFormula('-2 ^ 2', {})).toEqual({ ok: true, value: -4 });
  });

  it('usa i parametri, le funzioni (angoli in gradi), PI e il condizionale', () => {
    expect(evalFormula('2 * spessore + 1', { spessore: 2.4 })).toEqual({ ok: true, value: 5.8 });
    expect(evalFormula('max(3, spessore * 2)', { spessore: 2 })).toEqual({ ok: true, value: 4 });
    expect(evalFormula('round(-2.5)', {})).toEqual({ ok: true, value: -3 });
    expect(evalFormula('sin(90)', {})).toEqual({ ok: true, value: 1 });
    expect(evalFormula('PI * 2', {})).toMatchObject({ ok: true });
    expect(evalFormula('d > 10 ? d / 2 : 5', { d: 30 })).toEqual({ ok: true, value: 15 });
  });

  it('rifiuta con un messaggio ciò che non è un numero calcolabile', () => {
    expect(evalFormula('x + 1', {})).toMatchObject({ ok: false, error: 'Parametro sconosciuto: x' });
    expect(evalFormula('1 / 0', {})).toMatchObject({ ok: false });
    expect(evalFormula('cube(1)', {})).toMatchObject({ ok: false });
    expect(evalFormula('[1, 2]', {})).toMatchObject({ ok: false });
    expect(evalFormula('2 *', {})).toMatchObject({ ok: false });
    // Un testo che produce altre istruzioni non è una formula
    expect(evalFormula('1; cube(2)', {})).toMatchObject({ ok: false });
    expect(evalFormula('', {})).toMatchObject({ ok: false });
  });

  it('elenca i parametri usati, senza PI né funzioni', () => {
    expect(formulaDeps('max(a, b * 2) + a + PI')).toEqual(['a', 'b']);
  });
});

describe('nomi dei parametri', () => {
  it('accetta solo variabili OpenSCAD valide', () => {
    expect(validName('spessore_1')).toBe(true);
    expect(validName('1spessore')).toBe(false);
    expect(validName('profondità')).toBe(false);
    expect(validName('max')).toBe(false);
    expect(validName('PI')).toBe(false);
    expect(nameProblem('profondità')).toContain('accentate');
    expect(nameProblem('')).toBe('Il nome è vuoto');
  });

  it('rinomina nelle formule solo il nome intero', () => {
    expect(renameInExpr('a + ab + a2 * a', 'a', 'x')).toBe('x + ab + a2 * x');
    expect(renameInExpr('1e2 + e2', 'e2', 'y')).toBe('1e2 + y');
    expect(renameInExpr('v.x + x', 'x', 'k')).toBe('v.x + k');
  });
});

describe('resolveParams', () => {
  it('calcola in ordine di dipendenza qualunque sia l\'ordine della lista', () => {
    const { values, errors } = resolveParams([p('altezza', '2 * spessore'), p('spessore', '2.4')]);
    expect(values).toEqual({ altezza: 4.8, spessore: 2.4 });
    expect(errors).toEqual({});
  });

  it('segnala cicli, riferimenti mancanti, nomi doppi e nomi non validi', () => {
    const { values, errors } = resolveParams([p('a', 'b + 1'), p('b', 'a + 1'), p('c', 'zzz'), p('d', '1'), { id: 'd2', name: 'd', expr: '2' }, p('9x', '1')]);
    expect(errors.a).toBe('Riferimento circolare');
    expect(errors.b).toBeDefined();
    expect(errors.c).toBe('Parametro sconosciuto: zzz');
    expect(errors.d2).toContain('Esiste già');
    expect(errors['9x']).toBeDefined();
    expect(values).toEqual({ d: 1 });
  });
});

describe('parametri nello store', () => {
  beforeEach(() => {
    st().clear();
    useSceneStore.temporal.getState().clear();
  });

  /** Un cubo con l'altezza legata a `2 * spessore`. */
  const boundBox = () => {
    st().addParam('spessore', '2');
    st().addPrimitive('box');
    const id = st().scene.rootIds[0];
    st().bindField(id, 'size.2', { expr: '2 * spessore', min: 0.1 });
    return id;
  };

  it('lega un campo a una formula e lo ricalcola al cambio del parametro, in un solo passo di Annulla', () => {
    const id = boundBox();
    const node = () => st().scene.nodes[id] as { size: number[]; exprs?: Record<string, unknown> };
    expect(node().size[2]).toBe(4);
    const before = steps();
    st().updateParam(st().scene.params![0].id, { expr: '3' });
    expect(node().size[2]).toBe(6);
    expect(steps()).toBe(before + 1);
    useSceneStore.temporal.getState().undo();
    expect(node().size[2]).toBe(4);
    expect(st().scene.params![0].expr).toBe('2');
  });

  it('applica i limiti del campo e lascia il valore se la formula si rompe', () => {
    const id = boundBox();
    const pid = st().scene.params![0].id;
    st().updateParam(pid, { expr: '-5' });
    expect((st().scene.nodes[id] as { size: number[] }).size[2]).toBe(0.1);
    st().updateParam(pid, { expr: '1 / 0' });
    expect((st().scene.nodes[id] as { size: number[] }).size[2]).toBe(0.1);
  });

  it('rinomina un parametro aggiornando formule e campi legati, e rifiuta nomi non validi o doppi', () => {
    const id = boundBox();
    st().addParam('base', 'spessore * 3');
    const [spessore, base] = st().scene.params!;
    expect(st().updateParam(spessore.id, { name: 'parete' })).toBe(true);
    expect(st().scene.params!.find((x) => x.id === base.id)!.expr).toBe('parete * 3');
    expect(st().scene.nodes[id].exprs!['size.2'].expr).toBe('2 * parete');
    expect(st().updateParam(spessore.id, { name: 'base' })).toBe(false);
    expect(st().updateParam(spessore.id, { name: 'altezza ' })).toBe(false);
    expect(st().scene.params![0].name).toBe('parete');
  });

  it('modificare a mano un campo legato ne scioglie la formula', () => {
    const id = boundBox();
    st().updateNode(id, { size: [20, 20, 7] } as never);
    expect(st().scene.nodes[id].exprs).toBeUndefined();
    // Un campo non legato dello stesso vettore non scioglie nulla
    const id2 = boundBox();
    st().updateNode(id2, { size: [30, 20, 4] } as never);
    expect(st().scene.nodes[id2].exprs?.['size.2']).toBeDefined();
  });

  it('eliminando un parametro i campi restano con il valore e senza formula', () => {
    const id = boundBox();
    const pid = st().scene.params![0].id;
    st().removeParam(pid);
    expect(st().scene.params).toBeUndefined();
    expect(st().scene.nodes[id].exprs).toBeUndefined();
    expect((st().scene.nodes[id] as { size: number[] }).size[2]).toBe(4);
  });
});
