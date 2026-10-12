import { beforeEach, describe, expect, it } from 'vitest';
import { forgetClick, isRepeatClick, pickTarget, rememberClick, type PickHit } from './pick';

const hit = (id: string, ...parents: string[]): PickHit => ({ id, path: [...parents, id] });
const free = () => false;
const base = { alt: false, selection: [] as string[], repeat: false, isLocked: free };

describe('pickTarget', () => {
  it('senza mesh colpite non sceglie nulla', () => {
    expect(pickTarget({ ...base, hits: [] })).toBeUndefined();
  });

  it('sceglie l\'oggetto più vicino al raggio', () => {
    expect(pickTarget({ ...base, hits: [hit('a'), hit('b')] })).toBe('a');
  });

  it('un clic su una parte di un gruppo sceglie il gruppo, con Alt la parte', () => {
    const hits = [hit('parte', 'gruppo')];
    expect(pickTarget({ ...base, hits })).toBe('gruppo');
    expect(pickTarget({ ...base, hits, alt: true })).toBe('parte');
  });

  it('più mesh dello stesso oggetto contano una volta sola', () => {
    const hits = [hit('p1', 'g'), hit('p2', 'g'), hit('b')];
    expect(pickTarget({ ...base, hits, selection: ['g'], repeat: true })).toBe('b');
  });

  it('un oggetto bloccato viene attraversato se dietro ce n\'è uno libero', () => {
    const isLocked = (id: string) => id === 'grande';
    expect(pickTarget({ ...base, hits: [hit('grande'), hit('piccolo')], isLocked })).toBe('piccolo');
  });

  it('un oggetto bloccato isolato si può ancora scegliere', () => {
    expect(pickTarget({ ...base, hits: [hit('solo')], isLocked: () => true })).toBe('solo');
    // Con più bloccati sceglie il più vicino
    expect(pickTarget({ ...base, hits: [hit('a'), hit('b')], isLocked: () => true })).toBe('a');
  });

  it('il clic ripetuto scorre i candidati in modo circolare, con i bloccati in fondo', () => {
    const isLocked = (id: string) => id === 'a';
    const hits = [hit('a'), hit('b'), hit('c')];
    // Ordine: b, c, a (il bloccato in fondo)
    expect(pickTarget({ ...base, hits, isLocked, repeat: true, selection: ['b'] })).toBe('c');
    expect(pickTarget({ ...base, hits, isLocked, repeat: true, selection: ['c'] })).toBe('a');
    expect(pickTarget({ ...base, hits, isLocked, repeat: true, selection: ['a'] })).toBe('b');
  });

  it('un clic ripetuto con una selezione estranea ai candidati sceglie il primo', () => {
    expect(pickTarget({ ...base, hits: [hit('a'), hit('b')], repeat: true, selection: ['altro'] })).toBe('a');
  });

  it('un solo candidato resta lo stesso anche con il clic ripetuto', () => {
    expect(pickTarget({ ...base, hits: [hit('a')], repeat: true, selection: ['a'] })).toBe('a');
  });
});

describe('isRepeatClick', () => {
  beforeEach(forgetClick);

  it('il primo clic non è mai una ripetizione', () => {
    expect(isRepeatClick(10, 10, 1000)).toBe(false);
  });

  it('è una ripetizione solo nello stesso punto e dopo la soglia del doppio clic', () => {
    rememberClick(100, 100, 1000);
    expect(isRepeatClick(102, 101, 1600)).toBe(true);
    // Doppio clic: troppo presto
    expect(isRepeatClick(100, 100, 1200)).toBe(false);
    // Punto diverso
    expect(isRepeatClick(130, 100, 1600)).toBe(false);
    // Troppo tardi
    expect(isRepeatClick(100, 100, 5000)).toBe(false);
  });
});
