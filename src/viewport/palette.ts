import { useUiStore } from '../ui/uiStore';
import type { Theme } from '../ui/uiStore';

/** Colori della vista 3D per tema: gli stessi toni dell'interfaccia (token in styles/abstracts/_tokens.scss). */
export interface ViewportPalette {
  background: string;
  /** Superficie piena del piatto. */
  bedPlate: string;
  gridCell: string;
  gridSection: string;
  bedBorder: string;
  /** Colori delle luci emisferiche: cielo e terreno. */
  skyLight: string;
  groundLight: string;
  /** Contorno dell'oggetto selezionato e di quello bloccato. */
  selection: string;
  selectionLocked: string;
  /** Colore delle lettere X, Y, Z nel cubo degli assi. */
  axisLabel: string;
  /** Evidenziazione di Raccordo e Smusso: faccia sotto il puntatore e facce scelte. */
  faceHover: string;
  facePick: string;
  /** Zone di un avviso di stampabilità messo in evidenza (sbalzi). */
  warning: string;
}

export const PALETTES: Record<Theme, ViewportPalette> = {
  light: {
    background: '#dde6f1',
    bedPlate: '#ffffff',
    gridCell: '#c3cfdf',
    gridSection: '#8fa3be',
    bedBorder: '#2f5fc7',
    skyLight: '#ffffff',
    groundLight: '#a9b6c8',
    selection: '#1e2433',
    selectionLocked: '#a86400',
    axisLabel: '#ffffff',
    faceHover: '#6f9bff',
    facePick: '#2f5fc7',
    warning: '#d9480f',
  },
  dark: {
    background: '#14171c',
    // Più chiaro dello sfondo, così il piano si distingue a colpo d'occhio; la griglia segue per restare leggibile
    bedPlate: '#2b3544',
    gridCell: '#3c4859',
    gridSection: '#5d6f88',
    bedBorder: '#4da3ff',
    skyLight: '#ffffff',
    groundLight: '#3a4350',
    selection: '#ffffff',
    selectionLocked: '#f0b429',
    axisLabel: '#14171c',
    faceHover: '#7fb7ff',
    facePick: '#ffb020',
    warning: '#ff6b35',
  },
};

/** Palette della vista 3D per il tema attivo. */
export function useViewportPalette(): ViewportPalette {
  return PALETTES[useUiStore((s) => s.theme)];
}
