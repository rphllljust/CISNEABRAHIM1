/**
 * MARCA CISNE — silhueta vetorial de um cisne em perfil, glidando sobre a linha d'água.
 *
 * Monocromática, discreta e institucional. Não é brasão público, não é símbolo de órgão fiscal e
 * não imita selo de autenticação: é a identidade da própria empresa emissora no papel.
 *
 * O `d` abaixo é idêntico ao do renderizador do PDF
 * (`apps/api/src/billing/domain/billing-document-pdf.ts`, `CISNE_SWAN_PATH`). Os dois devem
 * permanecer iguais para que a prévia na tela e o documento impresso mostrem a mesma marca.
 */
const CISNE_SWAN_PATH = [
  'M 4.6 8.7',
  'C 4.2 8.2 4.6 7.2 5.6 7.0',
  'C 6.6 6.8 7.5 7.4 7.7 8.3',
  'C 7.9 9.2 7.6 9.9 7.0 10.1',
  'C 6.5 10.3 6.0 10.6 5.9 11.2',
  'C 5.8 12.4 6.5 13.8 8.0 14.9',
  'C 10.3 16.5 13.5 17.1 16.2 16.3',
  'C 18.6 15.6 20.2 14.0 20.4 12.2',
  'C 20.6 10.6 19.6 9.3 17.8 8.7',
  'C 16.2 8.2 14.4 8.3 13.0 9.0',
  'C 12.0 9.4 14.0 9.2 15.6 9.6',
  'C 17.2 10.0 21.0 10.0 21.0 13.5',
  'C 21.0 15.6 19.3 17.1 16.8 17.5',
  'C 13.9 17.9 10.3 17.1 7.8 15.5',
  'C 5.9 14.2 5.0 12.5 4.9 11.0',
  'C 4.8 9.5 5.0 9.2 4.6 8.7',
  'Z',
].join(' ');

type NotaFaturaBrandMarkProps = {
  className?: string;
};

export function NotaFaturaBrandMark({ className }: NotaFaturaBrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      focusable="false"
      role="presentation"
    >
      <path d={CISNE_SWAN_PATH} fill="currentColor" />
      <path
        d="M 6.2 19.5 L 20.0 19.5"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}
