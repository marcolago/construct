import { Check, Scissors, X } from 'lucide-react';
import { planeAxes } from '../../scene/splitTool';
import type { ConnectorOptions } from '../../scene/splitTool';
import { SliderField } from '../SliderField/SliderField';
import { useSplitTool } from './splitToolStore';
import type { SplitAxis } from './splitToolStore';
// Stesso aspetto del pannello di Raccordo, Smusso e Guscio
import '../EdgeTool/EdgeToolPanel.scss';

const AXES: [SplitAxis, string][] = [[0, 'X'], [1, 'Y'], [2, 'Z']];
const AXIS_LABEL = ['X', 'Y', 'Z'];

/** Avviso per i connettori (numerati da 1) che escono dal pezzo. */
function outsideMessage(outside: number[]): string {
  const names = outside.map((i) => i + 1);
  return names.length === 1
    ? `Il connettore ${names[0]} esce dal pezzo: spostalo o riduci diametro e profondità.`
    : `I connettori ${names.slice(0, -1).join(', ')} e ${names[names.length - 1]} escono dal pezzo: spostali o riduci diametro e profondità.`;
}

/**
 * Pannello di Dividi: asse del piano e sua posizione lungo l'asse (dentro l'ingombro del pezzo), con le due metà in
 * anteprima dal vivo; OK e Annulla. Sotto, i connettori (perni e sedi, o fori e spine) con la tolleranza per l'incastro.
 * Flottante e non modale: la vista 3D resta utilizzabile.
 */
export function SplitPanel() {
  const { active, axis, offset, angle, tiltAxis, connectors, outside, bounds, error, ids, cancel, commit, setOption, setConnectors } = useSplitTool();
  if (!active || !bounds) return null;
  const [min, max] = [bounds.min[axis], bounds.max[axis]];
  const [axA, axB] = planeAxes(axis);
  // Spostamento del centro della fila: al più fino ai bordi dell'ingombro, sui due assi del piano
  const reach = (ax: SplitAxis) => Math.round(((bounds.max[ax] - bounds.min[ax]) / 2) * 10) / 10;
  const on = connectors.type !== 'none';

  /** Riga con un gruppo di pulsanti a scelta singola. */
  const choice = <T extends string | number>(label: string, aria: string, value: T, options: [T, string, string?][], onPick: (v: T) => void) => (
    <div className="edge-panel__row">
      <span className="edge-panel__label">{label}</span>
      <div className="edge-panel__segmented" role="group" aria-label={aria}>
        {options.map(([v, text, title]) => (
          <button key={String(v)} type="button" aria-pressed={value === v} className={value === v ? 'is-active' : undefined} title={title} onClick={() => onPick(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="edge-panel edge-panel--scroll" aria-label="Dividi">
      <h2 className="edge-panel__title">
        <Scissors size={16} aria-hidden="true" />
        Dividi
      </h2>

      <div className="edge-panel__section">
        {choice('Piano', 'Asse del piano di taglio', axis, AXES.map(([v, l]) => [v, l, `Piano perpendicolare all'asse ${l}`]), (v) => setOption({ axis: v }))}
        <SliderField
          label="Posizione"
          unit="mm"
          min={Math.round(min * 10) / 10}
          max={Math.round(max * 10) / 10}
          step={0.5}
          hardMin={min}
          hardMax={max}
          tooltip={`Quota del piano lungo l'asse ${AXES[axis][1]}, in mm (nel mondo): da un bordo all'altro dell'oggetto.`}
          history={false}
          value={offset}
          onCommit={(v) => setOption({ offset: v })}
        />
        {choice('Inclina attorno a', 'Asse di inclinazione del piano', tiltAxis, AXES.filter(([v]) => v !== axis).map(([v, l]) => [v, l, `Il piano ruota attorno all'asse ${l}, passando dal punto di taglio`]), (v) => setOption({ tiltAxis: v }))}
        <SliderField
          label="Angolo"
          unit="°"
          min={-90}
          max={90}
          step={1}
          hardMin={-90}
          hardMax={90}
          tooltip="Inclinazione del piano di taglio in gradi: 0 lo lascia perpendicolare all'asse, 45 taglia in diagonale."
          history={false}
          value={angle}
          onCommit={(v) => setOption({ angle: v })}
        />
        <p className="edge-panel__hint">Il risultato sono due oggetti (1 e 2), ciascuno un'intersezione con un cubo di taglio, ruotato se il piano è inclinato: spostando o ruotando il cubo si cambia il taglio.</p>
      </div>

      <div className="edge-panel__section" role="group" aria-label="Connettori">
        {choice<ConnectorOptions['type']>(
          'Connettori',
          'Tipo di connettore',
          connectors.type,
          [
            ['none', 'Nessuno', 'Taglio liscio, senza incastri'],
            ['peg', 'Perno', 'Un perno su una metà e la sede nell\'altra'],
            ['dowel', 'Spine', 'Un foro in ogni metà e le spine da stampare a parte'],
          ],
          (v) => setConnectors({ type: v }),
        )}
        {on && (
          <>
            {choice<ConnectorOptions['shape']>('Forma', 'Forma dei connettori', connectors.shape, [['round', 'Tonda'], ['square', 'Quadrata']], (v) => setConnectors({ shape: v }))}
            {connectors.type === 'peg' &&
              choice<number>('Perno su', 'Metà che porta il perno', connectors.pegHalf, [[0, 'Metà 1'], [1, 'Metà 2']], (v) => setConnectors({ pegHalf: v as 0 | 1 }))}
            <SliderField
              label={connectors.shape === 'round' ? 'Diametro' : 'Lato'}
              unit="mm"
              min={1}
              max={30}
              step={0.5}
              hardMin={0.1}
              hardMax={100}
              tooltip="Misura del perno o della spina. Sede e fori sono più larghi del doppio della tolleranza."
              history={false}
              value={connectors.size}
              onCommit={(v) => setConnectors({ size: v })}
            />
            <SliderField
              label="Profondità"
              unit="mm"
              min={1}
              max={30}
              step={0.5}
              hardMin={0.1}
              hardMax={100}
              tooltip="Quanto il connettore entra in ogni metà. La spina è lunga il doppio."
              history={false}
              value={connectors.depth}
              onCommit={(v) => setConnectors({ depth: v })}
            />
            <SliderField
              label="Tolleranza"
              unit="mm"
              min={0}
              max={1}
              step={0.05}
              hardMin={0}
              hardMax={2}
              tooltip="Gioco per lato (e sul fondo) tra perno o spina e la sede: serve a farli entrare dopo la stampa. 0,2 mm va bene per la maggior parte delle stampanti FDM."
              history={false}
              value={connectors.tolerance}
              onCommit={(v) => setConnectors({ tolerance: v })}
            />
            <SliderField
              label="Numero"
              min={1}
              max={10}
              step={1}
              hardMin={1}
              hardMax={10}
              tooltip="Quanti connettori mettere in fila sul piano di taglio."
              history={false}
              value={connectors.count}
              onCommit={(v) => setConnectors({ count: Math.round(v) })}
            />
            <SliderField
              label="Distanza"
              unit="mm"
              min={1}
              max={100}
              step={1}
              hardMin={1}
              hardMax={200}
              disabled={connectors.count < 2}
              tooltip="Distanza tra i centri di due connettori vicini."
              history={false}
              value={connectors.spacing}
              onCommit={(v) => setConnectors({ spacing: v })}
            />
            {choice<number>('Fila lungo', 'Direzione della fila', connectors.row, [axA, axB].map((v) => [v, AXIS_LABEL[v], `I connettori stanno in fila lungo l'asse ${AXIS_LABEL[v]}`]), (v) => setConnectors({ row: v as 0 | 1 | 2 }))}
            <SliderField
              label={`Sposta ${AXIS_LABEL[axA]}`}
              unit="mm"
              min={-reach(axA)}
              max={reach(axA)}
              step={0.5}
              hardMin={-reach(axA)}
              hardMax={reach(axA)}
              tooltip={`Sposta il centro della fila lungo l'asse ${AXIS_LABEL[axA]}, rispetto al centro del taglio.`}
              history={false}
              value={connectors.shiftA}
              onCommit={(v) => setConnectors({ shiftA: v })}
            />
            <SliderField
              label={`Sposta ${AXIS_LABEL[axB]}`}
              unit="mm"
              min={-reach(axB)}
              max={reach(axB)}
              step={0.5}
              hardMin={-reach(axB)}
              hardMax={reach(axB)}
              tooltip={`Sposta il centro della fila lungo l'asse ${AXIS_LABEL[axB]}, rispetto al centro del taglio.`}
              history={false}
              value={connectors.shiftB}
              onCommit={(v) => setConnectors({ shiftB: v })}
            />
            {outside.length > 0 && (
              <p className="edge-panel__error" role="status">
                {outsideMessage(outside)}
              </p>
            )}
            <p className="edge-panel__hint">
              {connectors.type === 'peg'
                ? 'Il perno è unito alla metà scelta; la sede nell\'altra è più larga della tolleranza.'
                : 'Le spine compaiono in un oggetto a parte accanto al pezzo, sdraiate sul piatto, pronte da stampare.'}
            </p>
          </>
        )}
        {error && (
          <p className="edge-panel__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="edge-panel__actions">
        <span className="edge-panel__spacer" />
        <button type="button" className="edge-panel__button" onClick={cancel}>
          <X size={14} />
          Annulla
        </button>
        <button type="button" className="edge-panel__button edge-panel__button--primary" disabled={!ids} onClick={commit}>
          <Check size={14} />
          OK
        </button>
      </div>
    </section>
  );
}
