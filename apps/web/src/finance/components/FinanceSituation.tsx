import { Link } from 'react-router-dom';
import { cn } from '../../ui/utils/cn';
import type { FinanceTitleSummary } from '../api/finance-api';

/**
 * SITUACAO FINANCEIRA — a leitura que a worklist publica ANTES da grade.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA FAIXA EXISTE
 *
 * As worklists financeiras abriam pela tabela. O operador que entrava em Contas a Receber via uma
 * grade de titulos e precisava RECONSTRUIR de cabeca a resposta para tres perguntas que decidem o
 * dia: quanto esta vencido, o que vence agora, e quanto disso eu realmente consigo cobrar.
 *
 * Uma faixa de cards resolveria a leitura e criaria dois defeitos: (a) "parede de KPIs", que empurra
 * a grade para fora da primeira dobra ja em 900px de altura; (b) numero grande sem recorte, que o
 * operador nao consegue abrir e portanto nao consegue usar.
 *
 * Aqui a situacao e uma FAIXA DENSA: cada valor e (i) um numero AUTORITATIVO vindo do resumo do
 * servidor, (ii) rotulado com a pergunta que ele responde, e (iii) um LINK para o conjunto exato que
 * ele conta. O que nao foi publicado aparece como "nao publicado" — nunca como zero.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A REGRA QUE MANDA NESTE ARQUIVO
 *
 * NENHUM NUMERO E CALCULADO AQUI. `FinanceTitleSummary` e a agregacao do recorte COMPLETO, feita no
 * servidor (`/finance/receivables/summary`, `/finance/payables/summary`). Somar `items` da pagina
 * carregada e apresentar o resultado como posicao do dominio seria inventar financa — a pagina e uma
 * amostra de 50, o dominio pode ter 50 mil. Por isso este componente so FORMATA o que recebeu: nao
 * existe `reduce`, nao existe `Number(row.remainingBalance)` somado, nao existe fallback que
 * transforme amostra em total.
 *
 * Quando o resumo nao chegou, `summary` e `null` e TODA a faixa declara indisponibilidade. Isso e
 * diferente de "zero titulos", e a diferenca importa: "nao publicado" e um fato sobre a leitura;
 * "zero" e um fato sobre o negocio.
 */

export type FinanceSituationTone = 'neutral' | 'critical' | 'warning' | 'info' | 'success';

export type FinanceSituationItem = {
  id: string;
  /** A pergunta que este numero responde — o rotulo e a pergunta, nao o nome do campo. */
  label: string;
  /** Valor ja formatado. `null` = nao publicado (e a faixa diz isso). */
  value: string | null;
  /** Frase curta de contexto. Nunca repete o valor. */
  note?: string | null;
  tone?: FinanceSituationTone;
  /** O conjunto EXATO que este numero conta. Sem drilldown, o numero e decoracao. */
  to?: string;
};

const TONE_CLASS: Record<FinanceSituationTone, string> = {
  neutral: 'text-[color:var(--color-text-primary)]',
  critical: 'text-[color:var(--color-red-700)]',
  warning: 'text-[color:var(--color-amber-700)]',
  info: 'text-[color:var(--color-brand-700)]',
  success: 'text-[color:var(--color-emerald-700)]',
};

/**
 * FAIXA DE SITUACAO — uma linha, N celulas. Nao e uma grade de cards.
 *
 * A densidade e o ponto: os valores ficam lado a lado, separados por regua vertical, para que o
 * operador leia "o que esta vencido / o que vence / o que ja entrou" como UMA frase, e nao como tres
 * paineis independentes que ele precisa comparar de olho.
 */
export function FinanceSituationStrip({
  items,
  className,
  ariaLabel = 'Situação financeira do recorte',
}: {
  items: FinanceSituationItem[];
  className?: string;
  ariaLabel?: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <dl
      className={cn(
        'm-0 flex min-w-0 flex-wrap items-stretch gap-x-0 gap-y-2 border-b border-[color:var(--color-divider)] pb-2',
        className,
      )}
      aria-label={ariaLabel}
    >
      {items.map((item, index) => (
        <div
          key={item.id}
          className={cn(
            'flex min-w-0 flex-1 basis-40 flex-col gap-0.5 px-3',
            // A divisa pertence ao item SEGUINTE: o primeiro nao desenha regua a esquerda.
            index > 0 && 'border-l border-[color:var(--color-divider)]',
          )}
        >
          <dt className="cisne-meta-label m-0 truncate" title={item.label}>
            {item.label}
          </dt>
          <dd className="m-0 min-w-0">
            {item.value === null ? (
              /*
                AUSENCIA DECLARADA. "Não publicado" ocupa o lugar do numero sem fingir ser um: nao ha
                "—" decorativo nem 0 tranquilizador. A altura e a mesma do valor real, entao a
                geometria da faixa nao colapsa quando o resumo falta.
              */
              <span className="text-[15px] font-medium text-[color:var(--color-text-muted)]">
                Não publicado
              </span>
            ) : item.to ? (
              /*
                O NOME ACESSIVEL E A FRASE INTEIRA — "Vencido: 12", nao so "12".

                Um leitor de tela anuncia o link pelo proprio conteudo; "12" sozinho nao diz 12 do
                QUE. O `aria-label` junta rotulo e valor, e a nota entra junto porque ela e a
                qualificacao do numero ("R$ 4.500,00 vencidos"). O texto visivel nao muda: a leitura
                por teclado e por leitor de tela e que passa a ser auto-suficiente.
              */
              <Link
                to={item.to}
                aria-label={[item.label, item.value, item.note].filter(Boolean).join(': ')}
                className={cn(
                  'text-[19px] font-[650] tracking-[-0.01em] no-underline tabular-nums hover:underline',
                  TONE_CLASS[item.tone ?? 'neutral'],
                )}
              >
                {item.value}
              </Link>
            ) : (
              <span
                className={cn(
                  'text-[19px] font-[650] tracking-[-0.01em] tabular-nums',
                  TONE_CLASS[item.tone ?? 'neutral'],
                )}
              >
                {item.value}
              </span>
            )}
            {item.note ? (
              <span className="mt-0.5 block truncate text-[11px] text-[color:var(--color-text-muted)]" title={item.note}>
                {item.note}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * DINHEIRO POR MOEDA — o resumo publica `amounts` POR MOEDA, e nunca somamos moedas diferentes.
 *
 * Somar BRL com USD produziria um numero que nao existe em lugar nenhum. Quando ha mais de uma
 * moeda no recorte, as duas aparecem lado a lado, cada uma com o proprio codigo: e a leitura
 * verdadeira do que o servidor publicou.
 */
export function formatSummaryAmounts(
  summary: FinanceTitleSummary | null,
  key: 'openAmount' | 'overdueAmount' | 'dueAmount',
): string | null {
  if (!summary || summary.amounts.length === 0) {
    return null;
  }
  return summary.amounts
    .map((amount) => {
      const numeric = Number(amount[key]);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: amount.currencyCode,
        maximumFractionDigits: 2,
      }).format(numeric);
    })
    .filter((value): value is string => value !== null)
    .join(' · ');
}

/**
 * CONTAGEM DO SERVIDOR — `null` propaga como "nao publicado", nunca como 0.
 *
 * Existe para que nenhuma tela escreva `summary?.overdueCount ?? 0`: o `??` transformaria "o resumo
 * nao chegou" em "nao ha nada vencido", que e a mentira mais cara que uma tela financeira pode
 * contar.
 */
export function publishedCount(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}
