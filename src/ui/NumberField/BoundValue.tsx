import { round } from '../../scene/math';

/** Campo legato a un parametro: l'icona fx e il valore calcolato, non modificabili. La formula sta nel tooltip. */
export function BoundValue({ value, formula }: { value: number; formula: string }) {
  return (
    <span className="bound-value" title={`Legato al parametro: = ${formula}\nDoppio clic sul nome del campo per cambiarlo o toglierlo`} aria-label={`Valore ${round(value, 3)} dalla formula ${formula}`}>
      <span className="bound-value__fx" aria-hidden="true">fx</span>
      <span className="bound-value__num">{round(value, 3)}</span>
    </span>
  );
}
