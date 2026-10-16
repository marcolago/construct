import { createLucideIcon } from 'lucide-react';

/** Trapezio con la base larga in basso. */
export const Trapezoid = createLucideIcon('Trapezoid', [['polygon', { points: '3,19 21,19 17,5 7,5', key: 'trapezoid' }]]);

/** Anello: due cerchi concentrici. */
export const Ring = createLucideIcon('Ring', [
  ['circle', { cx: 12, cy: 12, r: 9, key: 'outer' }],
  ['circle', { cx: 12, cy: 12, r: 4.5, key: 'inner' }],
]);
