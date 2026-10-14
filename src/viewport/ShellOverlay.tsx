import { useShellTool } from '../ui/Shell/shellToolStore';
import { FaceHighlight } from './EdgeToolOverlay';
import { useViewportPalette } from './palette';

/** Evidenzia nella vista 3D la faccia sotto il puntatore mentre si sceglie la faccia aperta del Guscio. */
export function ShellOverlay() {
  const hover = useShellTool((s) => (s.picking ? s.hover : null));
  const palette = useViewportPalette();
  if (!hover) return null;
  return <FaceHighlight pick={hover} color={palette.faceHover} />;
}
