import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DateTime, Money } from '../../ui';
import { ContextFacts, ContextSection } from '../../ui/workspace-frame';
import { FinanceStatusBadge } from './FinanceStatusBadge';
import { AGING_BUCKET_LABELS, labelOrRaw } from '../../financial-ui/labels';
import { dueLabel, overdueLabel } from '../utils/finance-aging';
import { cn } from '../../ui/utils/cn';

/**
 * CONTEXTO DO TITULO — a coluna de suporte da worklist financeira.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ELA RESPONDE, E POR QUE NESTA ORDEM
 *
 * A worklist entrega a linha; a coluna entrega a DECISAO. A ordem das secoes e a ordem das perguntas
 * que o operador faz com o titulo aberto:
 *
 *   1. SITUACAO   — este titulo exige acao agora? (situacao, atraso, prazo)
 *   2. VALORES    — quanto e quanto falta (original, saldo, liquidado, recebido/pago)
 *   3. CONTEXTO   — de onde veio e a quem pertence (origem, cliente/fornecedor, condicao)
 *   4. RELACOES   — o que mais existe por tras (parcelas, liquidacoes, cadeia)
 *   5. ESTRUTURA  — identidade e ciclo de vida (criado, atualizado, parcelas)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * SO ENTRA O QUE O DTO PUBLICA
 *
 * Cada fato abaixo corresponde a um campo REAL de `ReceivableDetail`/`PayableDetail`. Nada e
 * derivado por adivinhacao e nenhum identificador tecnico vira rotulo: quando o DTO traz um UUID sem
 * nome humano, a secao declara o vinculo como EXISTENTE e navegavel, sem imprimir o UUID — porque um
 * UUID na tela nao e informacao, e o mesmo defeito que a worklist de Clientes ja corrigiu.
 */

export type FinanceTitleContextProps = {
  /** Referencia humana do titulo. */
  reference: string;
  status: string;
  statusLabels: Record<string, string>;
  dueDate: string;
  /** Valores como STRING decimal — nunca convertidos para numero para exibicao monetaria. */
  principal: string;
  remainingBalance: string;
  settledAmount: string;
  currencyCode: string;
  /** Campos que so um dos dois lados publica. */
  agingBucket?: string | null;
  paymentTerms?: string | null;
  originKind?: string | null;
  originReference?: string | null;
  installmentsCount?: number;
  settlementsCount?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Rotulo do lado de contato ("Cliente" / "Fornecedor"). */
  counterpartyLabel: string;
  counterpartyHref?: string | null;
  /** Comandos semanticos reais — so os que o servidor executa. */
  actions?: ReactNode;
  /** Relacoes navegaveis (cadeia comercial, parcelas, liquidacoes). */
  relations?: ReactNode;
};

export function FinanceTitleContext({
  reference,
  status,
  statusLabels,
  dueDate,
  principal,
  remainingBalance,
  settledAmount,
  currencyCode,
  agingBucket,
  paymentTerms,
  originKind,
  originReference,
  installmentsCount,
  settlementsCount,
  createdAt,
  updatedAt,
  counterpartyLabel,
  counterpartyHref,
  actions,
  relations,
}: FinanceTitleContextProps) {
  const late = overdueLabel(dueDate);

  return (
    <div className="flex min-h-0 flex-col">
      {/*
        IDENTIDADE — referencia, situacao e o prazo em UMA linha de leitura.
        O prazo fica colado na identidade porque e ele que ordena a urgencia do titulo; separa-lo
        nos "fatos" faria o operador procurar a informacao que decide a acao.
      */}
      <ContextSection title="Título">
        <p className="m-0 text-[14px] font-[650] tracking-[-0.005em] text-[color:var(--color-text-primary)]">
          {reference}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <FinanceStatusBadge status={status} labels={statusLabels} />
          <span className="text-[11px] text-[color:var(--color-text-muted)] tabular-nums">
            Vence <DateTime value={dueDate} mode="date" />
          </span>
        </div>
        {/*
          O ATRASO E AFIRMADO SOMENTE COM VENCIMENTO PERSISTIDO NO PASSADO.
          Sem isso, a linha de prazo simplesmente nao aparece — nao ha "0 dias em atraso" para um
          titulo que ainda nao venceu, porque isso sugeriria monitoramento onde nao ha.
        */}
        {late ? (
          <p
            className={cn(
              'm-0 mt-1.5 inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[11px] font-semibold',
              'bg-[color:var(--color-red-50)] text-[color:var(--color-red-700)]',
            )}
          >
            {late}
          </p>
        ) : (
          <p className="m-0 mt-1.5 text-[11px] text-[color:var(--color-text-muted)]">
            {dueLabel(dueDate)}
          </p>
        )}
        {actions ? <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div> : null}
      </ContextSection>

      {/*
        VALORES — original, saldo e liquidado.
        Os tres juntos porque a RELACAO entre eles e a informacao: um titulo com saldo igual ao
        principal nao teve baixa nenhuma, e isso diz mais que qualquer um dos numeros isolado.
      */}
      <ContextSection title="Valores">
        <ContextFacts
          facts={[
            { label: 'Valor original', value: <Money value={principal} currencyCode={currencyCode} /> },
            {
              label: 'Saldo',
              value: (
                <Money value={remainingBalance} currencyCode={currencyCode} emphasis />
              ),
            },
            {
              label: 'Liquidado',
              value: <Money value={settledAmount} currencyCode={currencyCode} />,
            },
            { label: 'Moeda', value: currencyCode },
          ]}
        />
      </ContextSection>

      {/*
        CONTEXTO COMERCIAL — de onde o titulo veio e sob qual condicao.
        Campos que nao existem no payload NAO entram: `FinanceTitleContext` recebe `undefined` e a
        secao inteira desaparece, em vez de renderizar "—" para quatro linhas seguidas.
      */}
      {originKind || originReference || paymentTerms || agingBucket ? (
        <ContextSection title="Contexto">
          <ContextFacts
            facts={[
              ...(originKind ? [{ label: 'Origem', value: originKind }] : []),
              ...(originReference ? [{ label: 'Documento de origem', value: originReference }] : []),
              ...(paymentTerms ? [{ label: 'Condição', value: paymentTerms }] : []),
              ...(agingBucket
                ? [{ label: 'Faixa de atraso', value: labelOrRaw(agingBucket, AGING_BUCKET_LABELS) }]
                : []),
            ]}
          />
        </ContextSection>
      ) : null}

      {/*
        RELACOES — a cadeia empresarial e os vinculos navegaveis.
        Esta secao e a diferenca entre uma worklist financeira e uma planilha: o titulo nao existe
        sozinho, ele nasceu de uma OS, de uma medicao ou de um faturamento, e o operador precisa
        alcancar a origem para resolver a excecao.
      */}
      {relations ? <ContextSection title="Relações">{relations}</ContextSection> : null}

      {/*
        CONTRAPARTE — cliente ou fornecedor.
        Fica DEPOIS dos valores e das relacoes porque, na cobranca, "quem deve" e uma pergunta que so
        se faz depois de saber "quanto" e "de onde veio".
      */}
      {counterpartyHref ? (
        <ContextSection title={counterpartyLabel}>
          <p className="m-0 text-[12px]">
            <Link
              to={counterpartyHref}
              className="text-[color:var(--color-brand-700)] no-underline hover:underline"
            >
              Abrir cadastro
            </Link>
          </p>
          <p className="cisne-type-helper m-0 mt-1">
            O nome da contraparte não é publicado pelo título. O vínculo existe e abre o cadastro.
          </p>
        </ContextSection>
      ) : null}

      {/*
        ESTRUTURA — identidade do registro e ciclo de vida.
        Ultima secao de proposito: e leitura de auditoria, nao de decisao.
      */}
      {installmentsCount !== undefined || settlementsCount !== undefined || createdAt || updatedAt ? (
        <ContextSection title="Registro">
          <ContextFacts
            facts={[
              ...(installmentsCount !== undefined
                ? [{ label: 'Parcelas', value: String(installmentsCount) }]
                : []),
              ...(settlementsCount !== undefined
                ? [{ label: 'Liquidações', value: String(settlementsCount) }]
                : []),
              ...(createdAt ? [{ label: 'Criado em', value: <DateTime value={createdAt} mode="datetime" /> }] : []),
              ...(updatedAt
                ? [{ label: 'Atualizado em', value: <DateTime value={updatedAt} mode="datetime" /> }]
                : []),
            ]}
          />
        </ContextSection>
      ) : null}
    </div>
  );
}
