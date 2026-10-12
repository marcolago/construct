import { createLucideIcon } from 'lucide-react';

/**
 * I tre piani cartesiani in prospettiva isometrica su una griglia 24×24: il piano orizzontale XY e le due pareti verticali
 * (XZ e YZ) che salgono dallo spigolo dietro. Si usa per il pulsante Viste. Stesse proprietà delle altre icone
 * (size, strokeWidth, color).
 */
export const Planes = createLucideIcon('Planes', [
  // Piano XY: il rombo orizzontale
  ['path', { d: 'M3 15 12 19.5 21 15 12 10.5Z', key: 'xy' }],
  // Pareti XZ e YZ: lo spigolo verticale al centro, il bordo superiore a V e i due lati esterni
  ['path', { d: 'M12 10.5V3.5M5 7.5l7-4 7 4M5 7.5v4M19 7.5v4', key: 'walls' }],
]);
