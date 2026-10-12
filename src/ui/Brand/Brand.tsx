import './Brand.scss';

const NAME = 'Construct';
/** Le tinte delle sezioni della barra strumenti (token `tool-*`): si assegnano alle lettere a rotazione. */
const TONES = ['transform', 'combine', 'modify', 'arrange', 'object'] as const;

/** Icona del marchio: lo stesso disegno di public/favicon.svg (cubo azzurro sul quadrato scuro). */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="12" fill="#14171c" />
      <path d="M32 10 52 21v22L32 54 12 43V21z" fill="none" stroke="#4da3ff" strokeWidth="4" strokeLinejoin="round" />
      <path d="M12 21l20 11 20-11M32 32v22" fill="none" stroke="#4da3ff" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Le lettere del nome con una tinta ciascuna, a rotazione. Va dentro un elemento con la classe `brand-name`
 * (Orbitron, maiuscolo): il testo resta "Construct" perché le lettere sono span adiacenti.
 */
export function BrandLetters() {
  return (
    <>
      {[...NAME].map((letter, i) => (
        <span key={i} className={`brand__letter brand__letter--${TONES[i % TONES.length]}`}>{letter}</span>
      ))}
    </>
  );
}

/** Marchio in cima alla barra laterale: icona e nome colorato. */
export function Brand() {
  return (
    <div className="brand">
      <BrandMark className="brand__mark" />
      <span className="brand__name brand-name"><BrandLetters /></span>
    </div>
  );
}
