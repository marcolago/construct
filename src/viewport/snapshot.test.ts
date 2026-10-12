import { describe, expect, it } from 'vitest';
import { CELL, cellOrigin, GAP, SNAPSHOT_VIEWS, sheetSize, viewFrame } from './snapshot';
import { PRESET_DIRECTIONS } from './cameraControl';
import type { Bounds } from '../scene/placement';

const box: Bounds = { min: [-10, -10, 0], max: [10, 10, 20] };

describe('immagine con le 4 viste', () => {
  it('le viste sono Alto, Fronte, Lato, Isometrica e stanno in una griglia 2×2', () => {
    expect(SNAPSHOT_VIEWS).toEqual(['top', 'front', 'side', 'iso']);
    expect([0, 1, 2, 3].map((i) => cellOrigin(i))).toEqual([
      { x: 0, y: 0 },
      { x: CELL + GAP, y: 0 },
      { x: 0, y: CELL + GAP },
      { x: CELL + GAP, y: CELL + GAP },
    ]);
    // L'ultima cella finisce esattamente sul bordo dell'immagine
    expect(cellOrigin(3).x + CELL).toBe(sheetSize());
    expect(cellOrigin(3).y + CELL).toBe(sheetSize());
  });

  it('la camera guarda il centro dell\'ingombro dalla direzione del preset', () => {
    const center = [0, 0, 10];
    for (const preset of SNAPSHOT_VIEWS) {
      const f = viewFrame(preset, box);
      expect(f.target).toEqual(center);
      const delta = f.position.map((p, i) => p - center[i]);
      const length = Math.hypot(...delta);
      // La direzione dal centro verso la camera è quella del preset
      delta.forEach((d, i) => expect(d / length).toBeCloseTo(PRESET_DIRECTIONS[preset][i], 6));
    }
  });

  it('tutte le viste hanno la stessa scala e vedono l\'oggetto intero con un po\' di margine', () => {
    const sizes = SNAPSHOT_VIEWS.map((preset) => viewFrame(preset, box).halfSize);
    expect(new Set(sizes).size).toBe(1);
    const radius = Math.hypot(20, 20, 20) / 2;
    expect(sizes[0]).toBeGreaterThan(radius);
    expect(sizes[0]).toBeCloseTo(radius * 1.15, 6);
  });

  it('i piani di taglio tengono dentro l\'ingombro, anche con il piano di stampa', () => {
    for (const reach of [0, 256]) {
      const f = viewFrame('iso', box, reach);
      const distance = Math.hypot(f.position[0], f.position[1], f.position[2] - 10);
      expect(f.near).toBeLessThan(distance - Math.hypot(20, 20, 20) / 2);
      expect(f.far).toBeGreaterThan(distance + Math.max(reach, 30));
    }
  });

  it('un oggetto minuscolo o un ingombro vuoto non danno una vista di dimensione nulla', () => {
    const tiny: Bounds = { min: [0, 0, 0], max: [0, 0, 0] };
    expect(viewFrame('front', tiny).halfSize).toBeGreaterThan(0);
  });
});
