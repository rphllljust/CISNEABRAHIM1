import { Link } from 'react-router-dom';
import { cn } from '../../ui/utils/cn';

/**
 * BUSINESS CHAIN — cadeia empresarial reutilizavel.
 *
 * Mostra a origem do registro sem o operador abrir cinco menus:
 *   CLIENTE -> SOLICITACAO -> PROPOSTA -> PO -> OS -> EXECUCAO -> MEDIACAO
 *   -> FATURAMENTO -> RECEBIVEL -> PAGAMENTO -> CONTABILIDADE
 *
 * REGRA DE HONESTIDADE:
 * - So renderiza o degrau cujo vinculo JA EXISTE no payload recebido.
 * - Degrau sem dado persistido NAO aparece como "pendente" nem como "sem dados":
 *   simplesmente nao e afirmado. Nao inventamos relacao.
 * - Nenhuma chamada nova de API. Se a relacao nao veio, ela nao e mostrada —
 *   ver PARK de contrato no relatorio.
 */

export const CHAIN_STEPS = [
  'CLIENTE',
  'SOLICITACAO',
  'PROPOSTA',
  'PO',
  'OS',
  'EXECUCAO',
  'MEDICAO',
  'FATURAMENTO',
  'RECEBIVEL',
  'PAGAMENTO',
  'CONTABILIDADE',
] as const;

export type ChainStep = (typeof CHAIN_STEPS)[number];

export type ChainLink = {
  step: ChainStep;
  /** Referencia humana (codigo/nome), nunca um UUID cru quando houver codigo. */
  label: string;
  href?: string;
  /** Fato do estado atual, quando o payload traz. */
  status?: string;
};

export type BusinessChainProps = {
  links: ChainLink[];
  /** Degrau em foco (o registro que o operador esta olhando). */
  current?: ChainStep;
  className?: string;
  compact?: boolean;
};

export function BusinessChain({ links, current, className, compact = false }: BusinessChainProps) {
  const ordered = CHAIN_STEPS.map((step) => links.find((link) => link.step === step)).filter(
    (link): link is ChainLink => Boolean(link),
  );

  if (ordered.length < 2) {
    return null;
  }

  return (
    <nav
      className={cn(
        'flex flex-wrap items-center gap-x-1 gap-y-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2',
        className,
      )}
      aria-label="Cadeia empresarial do registro"
    >
      {ordered.map((link, index) => (
        <span key={link.step} className="flex items-center gap-1">
          {index > 0 ? (
            <span aria-hidden className="text-gray-300">
              →
            </span>
          ) : null}
          <ChainNode link={link} isCurrent={link.step === current} compact={compact} />
        </span>
      ))}
    </nav>
  );
}

function ChainNode({
  link,
  isCurrent,
  compact,
}: {
  link: ChainLink;
  isCurrent: boolean;
  compact: boolean;
}) {
  const body = (
    <>
      <span className="block text-[9px] font-semibold tracking-wide uppercase opacity-60">
        {link.step.replace('_', ' ')}
      </span>
      <span className="block max-w-[18ch] truncate text-[11px] font-medium">{link.label}</span>
      {!compact && link.status ? (
        <span className="block text-[10px] opacity-70">{link.status}</span>
      ) : null}
    </>
  );

  const classes = cn(
    'flex flex-col items-start rounded-md border px-2 py-1 leading-tight',
    isCurrent
      ? 'border-brand-600 bg-brand-50 text-brand-900'
      : 'border-gray-200 bg-gray-50/60 text-gray-700',
  );

  if (link.href) {
    return (
      <Link to={link.href} className={cn(classes, 'no-underline hover:border-brand-400')}>
        {body}
      </Link>
    );
  }
  return <span className={classes}>{body}</span>;
}

/**
 * Monta a cadeia a partir de um payload onde os vinculos existem, sem inventar.
 * Cada entrada so entra quando o campo correspondente esta presente.
 */
export function buildChainLinks(candidates: (ChainLink | null | undefined | false)[]): ChainLink[] {
  return candidates.filter((candidate): candidate is ChainLink => Boolean(candidate));
}
