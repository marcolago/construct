# Studio di fattibilità: deformazioni (Torsione, Rastremazione, Piega) ed elica

Data: 16 ottobre 2026, sulla versione 0.66.0. Domanda: si possono aggiungere a Construct le deformazioni **Torsione**, **Rastremazione** e **Piega** su qualunque solido e un **passo elicoidale** per l'estrusione rotazionale (molle, viti, filetti), mantenendo la coerenza con il kernel, con il codice OpenSCAD esportabile e con il resto dell'interfaccia, e in quante fasi conviene farlo?

**Esito: fattibilità alta** per tutte e tre le deformazioni e per l'elica, con `manifold-3d` 3.5.4 già presente (nessuna libreria nuova). Tutti i calcoli del prototipo escono con stato `NoError`, una sola componente connessa e genere atteso; il volume resta entro lo 0,2% da quello esatto in quasi tutti i casi.

- **Torsione e Rastremazione**: alta. Ogni piano perpendicolare all'asse si muove per conto suo, quindi se la scala resta positiva l'autointersezione è impossibile per costruzione.
- **Piega**: alta fino a ±180°, con un controllo analitico del raggio. Oltre i 180° le due code possono incrociarsi e il controllo non basta: nello studio l'angolo si limita a ±180°.
- **Elica**: alta. Si costruisce a mezzi giri e si unisce, perché con il passo minore del profilo le spire si sovrappongono e un solo `warp` darebbe un solido autointersecante che manifold non ripara.
- **Codice OpenSCAD**: nativo per l'elica (un modulo con `polyhedron`) e per Torsione e Rastremazione di una forma 2D estrusa in linea; la **Piega** non ha equivalente e il codice contiene l'oggetto non deformato con un avviso ben visibile. L'import di un `.scad` non legge `polyhedron` (vedi `docs/da-fare.md`), quindi **il ritorno del modulo dell'elica è obbligatorio**, altrimenti un'elica esportata e riletta sparisce.
- **Costo vero**: non sta nei calcoli ma nei triangoli e nella memoria (sezione 4.4): una torsione di 3600° su una piastra con fori produce 790 mila triangoli e 711 MB di memoria WASM che non si restringe più. Serve un tetto di triangoli come requisito.

Il prototipo interattivo è in [`docs/prototipi/deformazioni.html`](prototipi/deformazioni.html) (si apre con un doppio clic; scarica `manifold-3d` e `three.js` da jsDelivr, quindi serve la rete). Le funzioni di calcolo sono pure e delimitate dai commenti `CORE-BEGIN` e `CORE-END`, pronte da portare in `src/kernel/`. L'interfaccia, invece, è solo un disegno.

![Elica: molla di compressione](images/deformazioni-elica-molla.png)

## 1. Che cosa c'è oggi

| Elemento | Stato | Riferimento |
|---|---|---|
| Torsione e Scala cima nell'estrusione lineare di una forma 2D | **Pronti**: `Manifold.extrude` con `twist` e `scaleTop`, lati del profilo spezzati in tratti lunghi uno strato | `src/kernel/evaluate.ts:454-465`, `src/kernel/twist.ts` |
| Divisioni della torsione | **Limite**: una ogni 2°, ma con tetto a 360, mentre il cursore accetta ±3600°; oltre 720° ogni strato supera i 2° | `src/scene/defaults.ts:83` |
| Estrusione rotazionale | **Al più 360°, senza passo**; segmenti tra 3 e 256 | `src/scene/shapes2d.ts:267`, `src/kernel/evaluate.ts:444-452` |
| Deformazioni di un solido qualunque | **Assenti**: nel kernel non si usa nessuna tra `warp`, `warpBatch`, `refineToLength`, `splitByPlane`, `simplify` | `src/kernel` |
| Gruppi con parametro e un figlio (Guscio, Ripetizione, Pattern) | **Schema pronto da seguire**: tipo di gruppo, chiave di cache, kernel, codice, strumento a pannello, campi nelle Proprietà | `src/scene/types.ts:262`, `src/kernel/evaluate.ts:92`, `:500-532`, `src/codegen/openscad.ts:513` |
| Strumenti a pannello con anteprima | **Pronti**: `shellToolStore`, `patternToolStore` (anteprima semplificata se il kernel supera 700 ms), `ShellPanel`, `PatternFields` riusati nelle Proprietà | `src/ui/Shell`, `src/ui/Pattern`, `SLOW_PREVIEW_MS` in `patternToolStore.ts:19` |
| Formule nei campi | **Pronte** anche per percorsi nuovi, come `deform.angle`, senza altro codice | `src/scene/params.ts` (`getPath`, `setPath`) |
| Controllo dei solidi non validi | **Non basta**: legge `status()` di manifold, che per `warp` non rileva le autointersezioni | `src/scene/printability.ts:123` |
| Versione del file di progetto | `VERSION = 6` | `src/scene/persistence.ts:18` |

Materiale già scritto: `docs/studio-fattibilita.md:112-142` raccomanda `refineToLength` prima di `warp`, ma in forma generica. **Questo studio lo corregge**: il raffinamento isotropo è risultato da 11 a 46 volte più costoso di quello mirato con la regola predefinita (e da 42 a 164 volte rispetto al solo raffinamento assiale), sezione 4.2.

## 2. Come lo fanno gli altri

La ricerca ha usato i manuali ufficiali dove le pagine erano leggibili. Dove non lo erano, la fonte è scritta accanto all'affermazione.

| Software | Torsione | Piega | Rastremazione | Elica e filetto | Zona e interfaccia |
|---|---|---|---|---|---|
| **Blender** (manuale) | Simple Deform, Twist: angolo e asse | Simple Deform, Bend | Simple Deform, Taper: fattore | Screw: Angle, Screw (passo), Iterations, Steps, Axis | Origine (un Empty), **Limits** inferiore e superiore, Lock sugli altri assi, Vertex Group; serve una mesh suddivisa |
| **SolidWorks** Flex (Help 2023) | Twisting: angolo attorno a Z | Bending: angolo oppure raggio, lunghezza d'arco costante | Tapering: fattore | Hélice e filetto come funzioni a parte | Due **trim plane** (posizione iniziale dal riquadro), triade XYZ, cursore di accuratezza |
| **Fusion 360** | Sweep con Twist Angle | **Nessun comando** sui solidi (richieste aperte nell'IdeaStation) | Coil con Angle, oppure Loft | **Coil**: giri e altezza, giri e passo, altezza e passo, Spiral; sezione (tonda, quadra, triangolare); **Thread** ISO a tabella | Anteprima nel comando; nessun gioco di stampa (solo un add-in a pagamento) |
| **OpenSCAD** | `linear_extrude(twist, slices)` | **Nessuno** | `linear_extrude(scale)` | `rotate_extrude(angle)`; BOSL2 `spiral_sweep`, `threaded_rod` con `$slop`; `threads-scad` con `tolerance` 0,4 | Parametri nel codice; nessun gizmo |
| **FreeCAD** | Curves, Multiloft | Nessun comando sui solidi | Cone angle dell'Helix | Part Helix e PartDesign Additive/SubtractiveHelix (pitch, height, turns, angle) | Pannello del task |
| **Onshape** | Custom feature "Deform" | idem | idem | **Helix** (Turns, Pitch, Turns and pitch); filetto nativo | Manipolatori (nella custom feature) |
| **Shapr3D** | no | no | no | Revolve oltre 360°, Sweep su spirale | nessuna |
| **Tinkercad** | non verificato | non verificato | non verificato | non verificato | nessuna |
| Slicer (Bambu, Prusa, Orca) | no | no | no | no | solo Cut con connettori |

**Livello di verifica.** Il manuale di Blender e la pagina Coil di Fusion sono stati letti direttamente. Per **SolidWorks Flex** e per le pagine del **wiki di FreeCAD** la lettura diretta è stata bloccata: i parametri vengono dal testo di anteprima dei risultati di ricerca. **Shapr3D** si basa solo su discussioni del forum, non su un manuale. L'assenza della piega in **Fusion** si basa su discussioni datate; va riverificata sull'ultima versione. Per **Tinkercad** non ho trovato fonti: nello studio dei profili la stessa lacuna è dichiarata. Un post di Hackaday sulla fine degli Shape Generators non ha data. Il sorgente di `FeatureHelix.cpp` di FreeCAD è citato solo da un mirror: nelle fonti è indicato il repository ufficiale.

**Che cosa se ne ricava per Construct:**

- **I parametri come Blender** (Tipo, Asse, Angolo o Fattore, Limiti). I tre tipi stanno nello stesso strumento, come nel Simple Deform.
- **La zona come SolidWorks**: due piani di limite, mostrati nella vista, con la deformazione solo tra i due e la parte fuori zona che si muove in modo rigido.
- **La Piega con raggio o angolo, a lunghezza d'arco costante**, come Flex.
- **L'elica con due dei tre valori tra giri, passo e altezza**, come Fusion Coil e Onshape Helix; per Construct bastano giri e passo, l'altezza si calcola.
- **Il filetto** come in OpenSCAD con un gioco regolabile ($slop o tolerance), perché Fusion non lo offre: per la stampa FDM è il valore che fa funzionare il pezzo.
- Nessuno dei programmi di fascia Tinkercad offre queste funzioni: è un vantaggio di Construct, non un obbligo.

![Torsione di una stella con i piani dei limiti](images/deformazioni-torsione.png)

## 3. Modello dati proposto

### Elica (fase 1)

L'elica **non** può riusare `revolveParams`: l'angolo si ferma a 360° e i segmenti a 256 (20 giri a 48 segmenti sono 960), e il codice di `revolveParams` è letto da kernel, generatore, import e modale del Profilo. Si propone un campo facoltativo a parte della forma 2D in rotazione:

```ts
helix?: { pitch: number; turns: number; hand: 'right' | 'left'; segments: number }
// pitch: mm per giro (0 non ammesso); turns: giri, anche frazionari (0,5 a 60);
// segments: per giro intero. Altezza = turns * pitch + altezza del profilo (calcolata, non memorizzata)
```

Con `helix` presente, `revolveAngle` e `revolveSegments` non contano. Senza, tutto resta com'è, quindi i progetti salvati non cambiano.

### Deforma (fasi 2 e 3)

Nuovo `GroupOp` `'deform'` con un figlio, come Guscio e Pattern:

```ts
deform?: {
  kind: 'twist' | 'taper' | 'bend';
  axis: 'x' | 'y' | 'z';          // nel sistema locale del figlio
  angle: number;                   // gradi: torsione e piega (piega entro ±180)
  scale: number;                   // scala finale: rastremazione (> 0)
  dir: 0 | 1;                      // piega: quale dei due assi perpendicolari
  from: number; to: number;        // limiti in percentuale dell'ingombro lungo l'asse
  edge?: number; lat?: number;     // qualità: lato assiale e laterale in mm (assenti = automatico)
}
```

Il percorso `deform.angle` funziona già con le formule e il selettore dei parametri.

### Punti da toccare per un nuovo tipo di gruppo

- **Chiave di cache** in `evaluate.ts:92`: un op sconosciuto cade oggi nell'**intersezione** (`evaluate.ts:555`), quindi senza questo cambiare i parametri non ricalcola il gruppo.
- `groupIcons.ts`, `store.ts:120` (`GROUP_LABELS`) e `canMoveInto` (`store.ts:206`), l'esclusione dal selettore Operazione nelle Proprietà.
- Creazione con `wrapInGroup`, come `applyPattern` in `src/scene/patternTool.ts`.
- **`VERSION` a 7.** I tipi Array e Pattern non l'hanno alzata, ma una build vecchia che apre un file con `deform` mostrerebbe il figlio non deformato (intersezione di un solo solido) senza alcun avviso. Alzandola, il file viene rifiutato con un errore pulito. L'autosalvataggio in IndexedDB invece non è versionato: va deciso se dargli un controllo.
- L'import da OpenSCAD ha un suo `GroupOp` ridotto (`src/import/scad/evaluate.ts:210`): `deform` non ci entra, vedi sezione 5.

## 4. Kernel

Tutto quello che segue è stato misurato nel prototipo con `manifold-3d` 3.5.4 in Node 26 su Windows, mediana di 5-7 prove. I tempi variano di 2 o 3 volte da una serie all'altra (la macchina di prova era condivisa): vanno letti come ordine di grandezza. **I triangoli sono la misura affidabile.**

### 4.1 Elica

1. Il profilo si disegna nel piano (raggio, quota), in senso antiorario.
2. Un **pezzo da mezzo giro** è `Manifold.revolve(profilo, segmenti, 180)`, poi `warpBatch` solleva ogni vertice di `passo × θ / 360`, con θ l'angolo del vertice (l'estremo a 180° può uscire come -180°: si corregge sommando 2π).
3. I pezzi si ruotano di 180° e si alzano di mezzo passo l'uno rispetto al precedente, e si uniscono con `Manifold.union`. Un pezzo basta per tutti quelli interi.
4. Il **filetto** aggiunge un nucleo cilindrico e taglia a filo le due estremità con un cilindro; il profilo è il trapezio ISO a 60° (cresta P/8, fondo P/4, altezza utile 5H/8 con H = 0,866 P) con un gioco radiale regolabile.

**Perché a mezzi giri e con l'unione**: `warp` non verifica le autointersezioni. Con il passo minore dell'altezza del profilo le spire si toccano o si sovrappongono: un solo `warp` darebbe un solido con triangoli che si attraversano. L'unione di manifold, invece, li fonde in un solido valido.

**Segmenti**: in `manifold-3d` 3.5.4 il numero di segmenti di `revolve` vale **per l'arco intero, qualunque sia l'angolo** (misurato: 48 segmenti su 360°, 180°, 90° e 45° danno sempre 48 divisioni). Nel prototipo si scalano per l'angolo del pezzo, così `segments` vale per giro intero. Vedi anche l'appendice A.

| Caso | Triangoli | Tempo | Volume (atteso con Pappus) | Componenti, genere |
|---|---|---|---|---|
| Molla, raggio 10, filo 2, passo 5, 6 giri, 48 seg/giro | 11 556 | circa 25-65 ms | 1 162 mm³ (1 165) | 1, 0 |
| Molla a 20 giri | 38 436 | circa 80-130 ms | 3 873 mm³ | 1, 0 |
| Spire che si toccano (passo 2, filo 3) | 8 108 | circa 50-120 ms | 1 445 mm³ | 1, **1** (un guscio cilindrico fuso, quindi genere 1 è corretto) |
| Filo quadro 2,5 × 2, passo 4, 5 giri | 1 924 | circa 5-8 ms | 1 882 mm³ (1 885) | 1, 0 |
| Filetto M8 passo 1,25, 8 giri | 8 600 | circa 60-125 ms | 380 mm³ | 1, 0 |
| Filetto M8, 20 giri | 20 888 | circa 130-290 ms | 949 mm³ | 1, 0 |
| Filetto M5 sinistro, 10 giri | 6 076 | circa 60-90 ms | 117 mm³ | 1, 0 |

![Filetto M8 destro](images/deformazioni-elica-filetto.png)

### 4.2 Deforma: la pipeline misurata

Un `warp` sposta solo i vertici esistenti: su un cubo da 12 triangoli non produce curve. Serve quindi prima suddividere, e il **modo** in cui si suddivide decide il costo. La pipeline che il prototipo ha validato è questa:

1. **Controlli analitici** (sezione 4.3): se non passano, errore del gruppo, come "pareti troppo spesse" del Guscio.
2. **Taglio sui limiti** con `splitByPlane` sul piano `da` e sul piano `a`: la parte fuori zona resta con i triangoli di partenza e i limiti sono esatti (con un solo `refine` il limite cadrebbe sul vertice più vicino).
3. **Raffinamento a due lunghezze della sola zona**: lato `edge` lungo l'asse e lato `lat` nel piano della sezione. Si ottiene dilatando l'asse di `lam = ceil(lat / edge)` volte, con `refineToLength(edge · lam)` e poi la scala inversa: gli spigoli assiali si dividono in tratti da `edge`, quelli laterali solo se superano `lat`.
4. **`warpBatch`** della zona e della parte oltre il limite: lì la funzione è già un moto rigido (rotazione, scala costante, rotazione con traslazione), quindi non serve raffinare.
5. **`Manifold.union`** delle (fino a) tre parti: le facce coplanari sui piani di taglio si fondono.

I `delete()` di ogni passaggio intermedio sono parte della pipeline, non un'ottimizzazione (sezione 4.4).

**Perché il raffinamento è mirato.** Sotto Torsione, Piega e Rastremazione ogni piano perpendicolare all'asse si trasforma in un piano (o resta tale con una rotazione rigida, una scala o una rotazione di raggio dipendente dalla posizione): **gli spigoli che stanno in quel piano restano rettilinei**. Dividere anche quelli è sprecato; basta dividere quelli lungo l'asse. Misurato su un cubo da 30 mm con torsione:

| Torsione | Solo assiale (2°, senza taglio laterale) | Isotropo (`refineToLength` semplice) | Rapporto |
|---|---|---|---|
| 90° | 732 triangoli | 30 480 | 42 |
| 180° | 1 452 | 119 688 | 82 |
| 360° | 2 892 | 473 940 | 164 |

Con la regola predefinita proposta (spigoli laterali al più un ottavo dell'ingombro) il cubo a 360° passa a 10 296 triangoli: è un costo di 3,5 volte per una precisione che sul cubo non serve, ma che serve negli altri casi (4.2.1).

#### 4.2.1 Qualità della Torsione: due lunghezze, non una

Il solo raffinamento assiale lascia lunghi gli spigoli del piano: ogni quadrilatero di parete tra due strati è storto, e la diagonale che lo divide si scosta dalla superficie vera. Il volume di un cubo non se ne accorge (-0,01%), ma quello di una piastra con fori e di una stella sì. Misurato **rispetto al volume esatto** (la torsione lo conserva), a 2° per tratto:

| Oggetto e angolo | Solo assiale | Con spigoli laterali ≤ 10 mm | Isotropo |
|---|---|---|---|
| Scatola con tre fori, 120° | +0,44% con 24 408 triangoli | -0,08% con 27 524 | -0,02% con 600 072 |
| Stella a cinque punte, 360° | -0,36% con 7 236 | +0,13% con 10 168 | -0,02% con 222 512 |

Lo scarto del solo raffinamento assiale scende **in modo lineare** con il passo (scatola: 0,87%, 0,44%, 0,22%, 0,11% a 4°, 2°, 1° e 0,5° per tratto), cioè dimezzare il passo raddoppia i triangoli per dimezzare l'errore. Tagliare gli spigoli laterali rende lo stesso risultato con il 13% di triangoli in più. **Il volume è una misura debole** (errori di segno opposto si compensano) e non ho misurato la distanza dalla superficie vera: va aggiunto ai test della fase 2 (distanza massima da una superficie di riferimento calcolata a passo molto fine).

La qualità automatica della Torsione quindi è: **un tratto assiale ogni 2° di angolo** e **spigoli laterali non più lunghi di un ottavo dell'ingombro nel piano**. Piega e Rastremazione non hanno il problema (le facce restano esatte, tranne le corde): lì i lati laterali non si dividono.

### 4.3 Controlli analitici e autointersezioni

`status()` di manifold non rileva le autointersezioni prodotte da `warp`, e l'avviso `invalid` di `printability.ts:123` si appoggia a quello. Per questo i controlli stanno nel kernel, prima del calcolo, e sono analitici. Ogni deformazione agisce su un piano alla volta, quindi:

- **Torsione**: ogni piano ruota rigidamente. La mappa è iniettiva per qualsiasi angolo: **nessuna autointersezione possibile**. Il determinante è 1, quindi il volume si conserva.
- **Rastremazione**: scala positiva piano per piano: nessuna autointersezione se `scale > 0`. Il controllo rifiuta 0 e valori negativi. Il volume è `(V/L) · ∫ s(t)² dt` per un solido a sezione costante lungo l'asse (nel prototipo l'atteso si calcola solo in quel caso).
- **Piega**: i piani diventano spicchi che si aprono dal centro di curvatura. La mappa è iniettiva se il **raggio `R = lunghezza della zona / angolo` supera la distanza massima del solido dal piano neutro, sul lato interno**, e se le due code non si incrociano. Fino a **±180°** le code sono antiparallele e distano `2R`, che supera lo spessore, quindi basta il controllo del raggio. **Oltre i 180° il controllo non basta**: l'angolo va limitato a ±180° oppure va aggiunto un controllo sulle code. Questo studio propone ±180°.

Provato nel prototipo: una barra 100 × 10 × 5 si piega fino a 180° (raggio 31,8 mm, lato interno 5 mm); un cubo da 30 mm con 180° è rifiutato con "Raggio 9,5 mm, minore dello spessore dal lato interno (15,0 mm)". Il volume della barra piegata torna entro lo 0,02%.

![Piega rifiutata dal controllo del raggio](images/deformazioni-piega-rifiutata.png)

### 4.4 Costi, memoria e tetto di triangoli

| Caso | Triangoli | Tempo | Scarto di volume |
|---|---|---|---|
| Cubo 30 mm, torsione 90° | 2 696 | 6 ms | +0,01% |
| Cubo 30 mm, torsione 360° | 10 296 | 16 ms | -0,01% |
| Cubo 30 mm, torsione 3600° | 101 016 | 194 ms | -0,02% |
| Stella, torsione 360° | 12 382 | 15 ms | +0,17% |
| Scatola con fori, torsione 120° | 27 604 | 43 ms | -0,08% |
| Scatola con fori, torsione 120° con limiti 25-75% | 27 822 | 174 ms (l'unione di tre parti pesa) | -0,01% |
| Scatola con fori, torsione 720° | 159 620 | 370 ms, 203 MB di memoria del processo | -0,11% |
| Scatola con fori, torsione 3600° | **792 940** | **1,8 s, 711 MB** | -0,17% |
| Cubo, rastremazione 40% | 140 | 0,3 ms | 0,00% |
| Scatola con fori, rastremazione 40% | 3 608 | 6 ms | 0,00% |
| Barra 100 × 10 × 5, piega 90° | 732 | 1,6 ms | -0,02% |
| Barra, piega 180° | 1 444 | 2,7 ms | -0,02% |
| Scatola con fori, piega 60° attorno a X | 3 504 | 7,5 ms | -0,02% |

Tutti: una componente, genere 0 o 3 (la scatola ha tre fori passanti), stato `NoError`. La memoria è quella residente del processo di prova, che dopo il picco non scende più.

- **Il tetto di triangoli è un requisito.** La torsione a 3600° su una piastra con fori produce quasi 800 mila triangoli, circa 2 secondi, e 711 MB di memoria WASM che non si restringe più dopo il calcolo. L'anteprima semplificata dei Pattern (oltre 700 ms) è lo schema giusto da riusare. Si propone un **budget di triangoli** al posto dell'attuale tetto di 360 divisioni in `twistDivisions` (a ±3600° il tetto dà 10° per strato, quindi la precisione cala proprio dove il solido è più complesso): il passo cresce oltre i 2° solo quando il costo stimato supera il budget (i triangoli crescono con angolo × ingombro nel piano / lato laterale), e il pannello mostra la qualità effettiva, come fa il Profilo con i tetti dei punti.
- **La memoria WASM non la libera il garbage collector in tempo.** Nella prima serie di misure un ciclo senza `delete()` degli intermedi ha portato il puntatore oltre i 2 GB e `warpBatch` è caduto con `RangeError: Start offset -1890640352 is outside the bounds of the buffer`. Il kernel dell'app libera già gli intermedi a mano (`evaluate.ts`); lo stesso vale per `deform.ts` e `helix.ts`. Nel prototipo, `scope()` raccoglie i temporanei e li cancella a fine calcolo.
- **Il `splitByPlane` aggiunge un'unione**: con i limiti interni il tempo cresce (174 ms contro 43 nella scatola). Con i limiti a 0 e 100 la pipeline salta il taglio e l'unione.

### 4.5 Ordine rispetto alle booleane

Si decide con l'annidamento dei gruppi, non con un'opzione: **Deforma dopo la differenza** deforma anche i fori (di solito è quello che si vuole: una piastra forata e poi torta), **Deforma prima** lascia i tagli dritti. Il gruppo Deforma accetta un solo figlio, qualunque nodo (primitiva, forma 2D, mesh, un altro gruppo). Le mesh importate funzionano purché siano manifold.

## 5. Codice OpenSCAD e ritorno dall'import

OpenSCAD non ha deformazioni generiche. Il codice esportato deve restare **coerente con il kernel** (regola del progetto), con un avviso dove non è possibile.

| Oggetto | Codice esportato | Coerenza |
|---|---|---|
| Elica | Un modulo `construct_helix(...)` scritto una volta in testa al file, come fa BOSL2 con `spiral_sweep`: costruisce un `polyhedron` per ogni mezzo giro dentro `union()`. Passo, giri e verso restano parametri leggibili e funzionano con il Customizer. | Stessi punti del profilo e stessa regola dei segmenti del kernel. Con il backend Manifold di OpenSCAD l'unione è veloce; con CGAL è lenta (avviso nel commento). |
| Torsione o Rastremazione di una forma 2D estrusa lungo il proprio asse Z, asse coincidente | `linear_extrude(height, twist = -angolo, scale = ...)`: nativo, leggibile, già usato oggi per la torsione | Entro la tolleranza. **Il segno cambia**: la torsione di OpenSCAD è oraria, quella di Construct antioraria (`openscad.ts` già scrive `twist = -p.twist`). |
| Qualunque altro caso, Piega compresa | Il figlio **non deformato**, con il commento `// ATTENZIONE: la deformazione Piega non si può rappresentare in OpenSCAD: usa l'export STL o 3MF` | Il codice non coincide con il solido: l'avviso è ben visibile anche nella finestra del codice. |

**Ritorno dall'import.** `src/import/scad/` non legge `polyhedron` (nodo mancante, vedi `da-fare.md`). Quindi il modulo dell'elica ha bisogno di un **commento di servizio** riconosciuto dall'import, come `// construct:path` per i profili di Bézier (`openscad.ts:195`, `toScene.ts`): `// construct:helix {...}` con profilo, passo, giri, verso e segmenti, e la chiamata `construct_helix(...)` che l'import riconosce e ricostruisce come forma in rotazione con `helix`. Senza il ritorno un'elica esportata e riletta sparisce. Per `deform` non serve un ritorno (non si esporta in modo non nativo); i casi nativi tornano come `linear_extrude` con torsione, già letta.

**Verifica ancora da fare.** OpenSCAD non è installato in questa macchina, quindi la coincidenza del volume dell'elica esportata con quella del kernel **non è stata provata**: è il primo test della fase 1. La regola dei frammenti è invece confermata nel sorgente (appendice A).

![Rastremazione di un cilindro con i limiti](images/deformazioni-rastremazione.png)

## 6. Interfaccia

Il prototipo mostra due schede, perché le due funzioni stanno in posti diversi di Construct.

### Elica: Proprietà della forma in rotazione

Non è uno strumento: è una sezione delle Proprietà di una forma 2D (o di un Profilo) con estrusione rotazionale, accanto ad Angolo e Segmenti.

```
Rotazione
Passo        [ 5 ] mm          (vuoto = rotazione normale)
Giri         [ 6 ]
Verso        ( Destro | Sinistro )
Segmenti/giro [ 48 ]
Altezza 32 mm (calcolata)
! Passo minore del profilo: le spire si toccano e si fondono.
```

L'avviso è informativo, non un errore: una molla chiusa a spire fuse è un solido valido (genere 1).

### Deforma: strumento a pannello

Tasto proposto **Maiusc+D**: tutte le lettere senza modificatori sono occupate (verificato in `useShortcuts.ts`) e Maiusc+D non è assegnata. Oggi però fa la stessa cosa di D (cambia il tema, `useShortcuts.ts:109`, perché la lettera semplice non esclude Maiusc): il nuovo controllo va **prima** di quella riga, come già fanno Maiusc+P e Maiusc+V. Pannello flottante come Guscio e Pattern:

```
Deforma                                    [x]
Tipo   ( Torsione | Rastremazione | Piega )
Asse   ( X | Y | Z )
Angolo [ 120 ] °        (Piega: Direzione [ Y ])
Da [ 0 ] %   A [ 100 ] %
Qualità  ( Automatico | Manuale )
[x] Mostra asse e piani dei limiti
Raggio 31,8 mm, spessore interno 5 mm: nessuna autointersezione.
                                   [Annulla] [OK]
```

- **In vista**: l'asse neutro (deformato, quindi curvo nella Piega) e i due piani dei limiti, calcolati con la stessa funzione di warp: la torsione li ruota, la rastremazione li rimpicciolisce, la piega li inclina. Il prototipo li mostra e funzionano. Nella **fase 3** i piani si trascinano.
- **Anteprima**: semplificata (passo maggiore) quando il kernel supera 700 ms, come per il Pattern; la qualità piena si calcola all'OK. Un solo passo di Annulla (`labelled('Deforma', ...)`).
- **Le stesse righe** nelle Proprietà del gruppo (`DeformFields`, come `PatternFields`), con le formule.
- **Altri file da toccare**: registro dei comandi in `commands.tsx` (identificativo, contesto, voce in `COMMANDS` e in `TOOL_COMMANDS`), `useShortcuts.ts` per Esc, Invio e il tasto, `toolbarHelp.ts` con immagine, `Viewport.tsx`, e **tutti gli altri `toggle` che si annullano a vicenda** (ogni strumento chiude gli altri a mano).
- Il prototipo misura anche l'interfaccia stretta: a 390 px non scorre in orizzontale; i controlli sono accessibili da tastiera (`aria-pressed` sui selettori, `aria-label` sui numeri).

![Piega di una barra con i limiti, tema scuro](images/deformazioni-piega.png)

## 7. Miglioramenti proposti

- **Sostituire il tetto di `twistDivisions`** con un budget di triangoli (sezione 4.4): vale anche per l'estrusione lineare esistente, e si può fare prima e da solo.
- **Distanza dalla superficie vera** nei test, accanto al volume (sezione 4.2.1).
- Opzione **simmetrica** per la rotazione, come Fusion (da -angolo/2 a +angolo/2), già in `da-fare.md`.
- **Deforma più volte**: si annida come il Pattern (un gruppo dentro l'altro).
- **Preset Molla e Filetto** nella libreria (fase 4).
- Avviso di stampabilità per **spire sotto l'ugello** e per i filetti con gioco insufficiente.
- **Piega con asse scelto con un clic** su una faccia (come "Appoggia su una faccia").

## 8. Rischi e limiti

| Rischio | Gravità | Mitigazione |
|---|---|---|
| Autointersezione della Piega oltre i 180°, o con raggio piccolo | Alta | Controllo analitico del raggio e angolo limitato a ±180° (sezione 4.3); errore del gruppo con il perché |
| Crescita dei triangoli e della memoria (800 mila triangoli, 711 MB nel caso estremo) | Alta | Budget di triangoli, raffinamento mirato, anteprima semplificata, `delete()` degli intermedi |
| `status()` non rileva le autointersezioni di `warp` | Media | Controlli prima del calcolo; test con volume e distanza dalla superficie |
| Torsione con spigoli laterali lunghi: scarto di volume fino allo 0,4% | Media | Regola dei due lati (sezione 4.2.1) |
| Coerenza kernel e codice: `revolve` segmenti per arco (appendice A) | Media | Segmenti per giro intero nell'elica; decisione sul comportamento esistente |
| Codice OpenSCAD che non coincide con il solido (Piega) | Media | Avviso nel commento e nella finestra del codice; export STL e 3MF corretti |
| Ritorno dall'import dell'elica | Media | Commento di servizio e test di andata e ritorno |
| `VERSION` non alzata: una build vecchia mostra il figlio non deformato | Media | `VERSION = 7` |
| Mesh importate non manifold | Bassa | Il gruppo segue lo stato già mostrato per le mesh |
| Verso delle facce dopo il warp | Bassa | Il determinante positivo dei tre warp lo mantiene: verificato dal volume positivo |
| Tempo di unione dei pezzi dell'elica con molti giri | Bassa | 20 giri sono circa 130-290 ms; si può costruire a pezzi più lunghi |

## 9. Fasi e stima

Un branch e una PR per fase, con il metodo già in uso (un agente implementa, un agente nuovo revisiona).

**Interventi preliminari (indipendenti, piccoli):**
- sostituire il tetto di `twistDivisions` con il budget di triangoli (rilascio a parte, patch);
- decidere sull'appendice A (segmenti di `revolve`).

| Fase | Contenuto | Test | Costo relativo |
|---|---|---|---|
| **1. Elica** | Campo `helix` della forma in rotazione, `src/kernel/helix.ts` (mezzi giri, `warpBatch`, `union`), sezione nelle Proprietà, modulo OpenSCAD con ritorno dall'import | Volume e ingombro contro Pappus, genere, mano destra e sinistra, passo minore del profilo, andata e ritorno OpenSCAD, confronto del volume con OpenSCAD in locale, benchmark | Medio |
| **2. Torsione e Rastremazione** | Gruppo `deform` (`twist`, `taper`), `src/kernel/deform.ts` con la pipeline della sezione 4.2, strumento a pannello con tasto Maiusc+D, piani dei limiti in vista, codice nativo `linear_extrude`, `VERSION = 7`, budget di triangoli e anteprima semplificata | Volume, ingombro, limiti esatti, componenti e genere, distanza dalla superficie, codice, e2e del pannello, benchmark | Alto |
| **3. Piega** | Tipo `bend`, controllo del raggio e angolo ±180°, scelta Angolo o Raggio, piani dei limiti trascinabili | Come la fase 2, più raggio minimo e i casi rifiutati | Medio |
| **4. Filetto e Molla** (facoltativa) | Preset ISO da M3 a M12 (passo grosso), gioco FDM regolabile (valore iniziale 0,15 mm sul raggio, da tarare con stampe di prova), esterno e interno, smusso d'ingresso; molla con diametro, filo, passo, giri ed estremità piane | Misure ISO, gioco, ingombro | Medio |

La fase 1 si può fare da sola e dà subito valore (molle e viti). Le fasi 2 e 3 condividono il gruppo e la pipeline. Fase 4 dopo la 1: la decisione sulla forma (sezione 10) conviene farla dopo aver provato l'elica.

Alternativa per i soli **filetti** (fase 4): OpenSCAD li fa anche con `linear_extrude(twist)` di una sezione perpendicolare all'asse, nativo e leggibile; non vale per le molle a filo tondo.

## 10. Domande aperte

- **Filetto e Molla**: un **preset** che crea un gruppo (nucleo, elica, taglio) o un **nodo parametrico**? Con il preset la misura M8 non si può più cambiare dopo la creazione; con il nodo sì, ma serve un tipo nuovo e un ritorno dall'import.
- **Mano dell'elica**: campo esplicito (`hand`, proposta) oppure passo negativo?
- **Origine della deformazione**: il centro dell'ingombro del figlio (usato nel prototipo) o l'origine del suo sistema locale?
- **Rastremazione**: scala uniforme (come nel prototipo) o per asse, con Lock come in Blender?
- **Stretch** (Blender e SolidWorks): escluso, perché duplica il Ridimensiona.
- **Appendice A**: allineare il kernel a OpenSCAD (segmenti per giro intero) cambia la mesh dei progetti già salvati con rotazione parziale; accettabile o serve una migrazione?
- **Budget di triangoli**: valore iniziale (il prototipo rifiuta oltre 800 mila nel raffinamento isotropo di confronto).

## Appendice A: due scoperte emerse durante lo studio

**`revolve` e i segmenti con un angolo parziale.** Verificato con manifold 3.5.4: `Manifold.revolve(profilo, segmenti, angolo)` usa `segmenti` divisioni **sull'arco intero**, qualunque sia l'angolo (48 segmenti danno 48 divisioni a 360°, 180°, 90° e 45°). Il kernel di Construct passa `segments` così com'è (`evaluate.ts:450`), mentre il codice esportato è `rotate_extrude(angle = ..., $fn = segments)` e in OpenSCAD `$fn` si scala con l'angolo: nel sorgente di OpenSCAD `getCircularSegmentCount` calcola `ceil(fn) * |angolo| / 360` (`src/core/CurveDiscretizer.cc`) e `rotate_extrude` gli passa l'angolo (`src/geometry/rotate_extrude.cc`). **Esempio**: una rotazione di 90° con 64 segmenti ha 64 lati nel kernel e 16 nel codice. È una discrepanza **già presente** tra kernel e codice. Non va corretta in questo giro; va decisa (sezione 10) e registrata in `docs/da-fare.md`.

**Il tetto di `twistDivisions` (360) e il cursore (±3600°)**: oltre 720° ogni strato supera i 2° e riappare il difetto della Bauble descritto in `twist.ts`. Si risolve con il budget di triangoli (sezione 4.4).
