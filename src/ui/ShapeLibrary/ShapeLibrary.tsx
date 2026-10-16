import { Box, Circle, CircleDot, Cone, Cylinder, Diamond, Donut, Droplet, Egg, Heart, Hexagon, Moon, PenTool, Pentagon, Plus, Shapes, Square, Star, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Decagon } from '../icons/Decagon';
import { Ring, Trapezoid } from '../icons/Shapes2D';
import { ProfileH, ProfileL, ProfileT, ProfileU, TubeRect, TubeRound } from '../icons/Profiles';
import { useSceneStore } from '../../scene/store';
import { useProfileEditor } from '../ProfileEditor/profileEditorStore';
import { PRIMITIVE_LABELS, SHAPE2D_LABELS, SHAPES_2D, SHAPES_3D } from '../../scene/defaults';
import { isProfileKind } from '../../scene/profiles';
import type { PrimitiveKind, Shape2DKind } from '../../scene/types';
import './ShapeLibrary.scss';

/** Icona di ogni primitiva, condivisa con l'outliner. */
export const PRIMITIVE_ICONS: Record<PrimitiveKind, LucideIcon> = {
  box: Box,
  cylinder: Cylinder,
  cone: Cone,
  sphere: Circle,
  torus: Donut,
  octahedron: Diamond,
  decahedron: Decagon,
  dodecahedron: Pentagon,
  icosahedron: Hexagon,
};

/** Icona di ogni forma 2D estrudibile. */
export const SHAPE2D_ICONS: Record<Shape2DKind, LucideIcon> = {
  circle: CircleDot,
  square: Square,
  ring: Ring,
  heart: Heart,
  star: Star,
  egg: Egg,
  trapezoid: Trapezoid,
  cross: Plus,
  drop: Droplet,
  crescent: Moon,
  text: Type,
  svg: Shapes,
  path: PenTool,
  profileL: ProfileL,
  profileT: ProfileT,
  profileH: ProfileH,
  profileU: ProfileU,
  tubeRect: TubeRect,
  tubeRound: TubeRound,
};

/** Griglia delle primitive 3D e dei profilati (prima tab della libreria). */
export function Shapes3DGrid() {
  const addPrimitive = useSceneStore((s) => s.addPrimitive);
  const addShape2D = useSceneStore((s) => s.addShape2D);
  return (
    <div className="shape-library__grid">
      {/* Ordine per frequenza d'uso (SHAPES_3D); i profilati sono sezioni estruse (forme 2D) che si usano come solidi */}
      {SHAPES_3D.map((kind) => {
        const profile = isProfileKind(kind);
        const Icon = profile ? SHAPE2D_ICONS[kind] : PRIMITIVE_ICONS[kind as PrimitiveKind];
        const label = profile ? SHAPE2D_LABELS[kind] : PRIMITIVE_LABELS[kind as PrimitiveKind];
        return (
          <button key={kind} type="button" className="shape-library__item" onClick={() => (profile ? addShape2D(kind) : addPrimitive(kind as PrimitiveKind))} title={`Aggiungi: ${label}`}>
            <Icon size={24} strokeWidth={1.6} />
            <span className="shape-library__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Griglia delle forme 2D estrudibili (seconda tab della libreria). */
export function Shapes2DGrid() {
  const addShape2D = useSceneStore((s) => s.addShape2D);
  return (
    <div className="shape-library__grid">
      {/* Ordine per frequenza d'uso (SHAPES_2D). Il Profilo si disegna in una modale: il nodo nasce solo con l'OK */}
      {SHAPES_2D.map((kind) => {
        const Icon = SHAPE2D_ICONS[kind];
        const isPath = kind === 'path';
        return (
          <button
            key={kind}
            type="button"
            className="shape-library__item"
            onClick={() => (isPath ? useProfileEditor.getState().open({ new: true }) : addShape2D(kind))}
            title={isPath ? `Aggiungi: ${SHAPE2D_LABELS.path}` : `Aggiungi: ${SHAPE2D_LABELS[kind]} estruso`}
          >
            <Icon size={24} strokeWidth={1.6} />
            <span className="shape-library__label">{SHAPE2D_LABELS[kind]}</span>
          </button>
        );
      })}
    </div>
  );
}
