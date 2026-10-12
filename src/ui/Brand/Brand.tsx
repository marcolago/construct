import './Brand.scss';

const NAME = 'Construct';
/** Le tinte delle sezioni della barra strumenti (token `tool-*`): si assegnano alle lettere a rotazione. */
const TONES = ['transform', 'combine', 'modify', 'arrange', 'object'] as const;

/** Marchio dell'app in cima alla barra laterale: l'icona della favicon e il nome con una tinta per lettera. */
export function Brand() {
  return (
    <div className="brand">
      {/* Stesso disegno di public/favicon.svg */}
      <svg className="brand__mark" viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
        <rect width="64" height="64" rx="12" fill="#14171c" />
        <path d="M32 10 52 21v22L32 54 12 43V21z" fill="none" stroke="#4da3ff" strokeWidth="4" strokeLinejoin="round" />
        <path d="M12 21l20 11 20-11M32 32v22" fill="none" stroke="#4da3ff" strokeWidth="4" strokeLinejoin="round" />
      </svg>
      {/* Il testo resta "Construct" (le lettere sono span adiacenti): il maiuscolo lo mette il CSS */}
      <span className="brand__name brand-name">
        {[...NAME].map((letter, i) => (
          <span key={i} className={`brand__letter brand__letter--${TONES[i % TONES.length]}`}>{letter}</span>
        ))}
      </span>
    </div>
  );
}
