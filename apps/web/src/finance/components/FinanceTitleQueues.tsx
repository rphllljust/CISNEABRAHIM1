import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useOptionalIdentityId } from '../../auth/context/AuthProvider';
import { DynamicSavedViewsBar, useSavedViews } from '../../engine';
import { DateTime, Money, Button } from '../../ui';
import {
  WorkbenchQueue,
  WorkbenchQueueItem,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import { StatusBadge } from '../../ui/StatusBadge';
import { WorklistException } from '../../ui/enterprise-list';
import { ContextDrawer, type ContextField } from '../../operator';
import { cn } from '../../ui/utils/cn';
import { listPayables, listReceivables } from '../api/finance-api';
import type { FinanceTitlePage } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import {
  AGING_BUCKET_LABELS,
  PAYABLE_STATUS_LABELS,
  RECEIVABLE_STATUS_LABELS,
  labelOrRaw,
  toneForStatus,
} from '../../financial-ui/labels';
import type { PayableDetail, ReceivableDetail } from '../types/finance.types';

/**
 * FILAS DE TÍTULOS DO WORKSPACE FINANCEIRO — receber e pagar como TRABALHO, não como tabela.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE UMA FILA E NAO UMA TABELA
 *
 * A posição financeira já era publicada (contagens, aging, contas). O que faltava era o TÍTULO
 * CONCRETO: qual recebível cobrar agora, qual obrigação regularizar. A tabela da tela mostrava as
 * primeiras linhas da carteira sem recorte de exceção — o operador tinha de sair para Contas a
 * Receber / Contas a Pagar, aplicar o filtro lá e trabalhar de outra tela.
 *
 * Aqui os títulos viram FILA, na gramática de linha de todo o produto: SEVERIDADE -> MOTIVO ->
 * OBJETO -> PRAZO -> PRÓXIMA AÇÃO. E o recorte é o mesmo que o servidor executa.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O RECORTE É DO SERVIDOR
 *
 * `listReceivables`/`listPayables` executam `status` e `agingBucket` no servidor. A tela NUNCA
 * filtra a página recebida: filtrar no cliente esconderia títulos que ficaram fora da página e
 * apresentaria uma amostra como se fosse o conjunto — exatamente o defeito que o `total` do
 * contrato existe para impedir.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * HONESTIDADE
 *
 * - `total` vem do servidor sob o MESMO filtro e é dito como cobertura ("Exibindo N de M").
 * - Ausência NÃO vira zero: falha de leitura e negação são estados próprios, com frase própria, e a
 *   fila não é desenhada vazia por causa deles.
 * - A severidade vem do STATUS PERSISTIDO e do VENCIMENTO do título — nunca de score inventado.
 * - Nenhum valor é somado no navegador para virar "total do domínio": o dinheiro exibido é o saldo
 *   publicado POR TÍTULO.
 */

type TitleKind = 'receivable' | 'payable';

/** Recorte que o SERVIDOR executa. `null` = sem recorte (a carteira inteira, como o servidor devolve). */
type TitleScope = {
  status: string | null;
  agingBucket: string | null;
};

const ALL_TITLE_SCOPE: TitleScope = { status: null, agingBucket: null };

/**
 * RECORTES DE SISTEMA DO FINANCEIRO.
 *
 * `status` é o recorte que o servidor executa nas duas carteiras. Para recebíveis o contrato NÃO
 * publica `status` derivado do ciclo (a RE vem de lifecycle + liquidações + vencimento), então o
 * recorte rápido é o que o servidor realmente aceita — e a lista de opções é a mesma nas duas telas.
 */
const RECEIVABLE_SCOPES: ReadonlyArray<{ label: string; scope: TitleScope }> = [
  { label: 'Toda a carteira', scope: ALL_TITLE_SCOPE },
  { label: 'Em aberto', scope: { status: 'OPEN', agingBucket: null } },
  { label: 'Vencidos', scope: { status: 'OVERDUE', agingBucket: null } },
  { label: 'Liquidados', scope: { status: 'SETTLED', agingBucket: null } },
];

const PAYABLE_SCOPES: ReadonlyArray<{ label: string; scope: TitleScope }> = [
  { label: 'Todas as obrigações', scope: ALL_TITLE_SCOPE },
  { label: 'Em aberto', scope: { status: 'OPEN', agingBucket: null } },
  { label: 'Vencidos', scope: { status: 'OVERDUE', agingBucket: null } },
  { label: 'Pagos', scope: { status: 'SETTLED', agingBucket: null } },
];

const TITLE_LIMIT = 6;

type TitleState<T> =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; page: FinanceTitlePage<T> };

function failure<T>(reason: unknown): TitleState<T> {
  if (reason && typeof reason === 'object' && 'kind' in reason && 'status' in reason) {
    const kind = (reason as { kind: string }).kind;
    const status = (reason as { status: number }).status;
    const code = (reason as { code?: string }).code;
    if (kind === 'denied') {
      return { phase: 'denied' };
    }
    return { phase: 'error', message: mapFinanceErrorToMessage(code, status) };
  }
  return { phase: 'error', message: mapFinanceErrorToMessage(undefined, 0) };
}

/** Dias corridos desde o vencimento PERSISTIDO do título. `null` sem vencimento ou no futuro. */
function daysLate(dueDate: string | null, now: Date = new Date()): number | null {
  if (!dueDate) {
    return null;
  }
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  const startOfDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const elapsed = Math.floor((startOfDay(now) - startOfDay(due)) / 86_400_000);
  return elapsed > 0 ? elapsed : null;
}

function titleReference(item: ReceivableDetail | PayableDetail): string {
  return item.externalReference ?? item.id.slice(0, 8);
}

/**
 * FATOS DO TÍTULO — o que decide a próxima ação: quanto, quando, em que estado.
 *
 * O contexto NÃO recalcula nada: principal, saldo e bucket são os valores publicados pelo servidor
 * por registro. Somar títulos aqui seria criar um agregado que o contrato não publica.
 *
 * As duas carteiras compartilham o essencial (situação, vencimento, valores) e divergem no que o
 * contrato realmente publica: pagáveis trazem faixa de aging, documento de origem e centro de custo;
 * recebíveis trazem o cliente. O painel mostra o que existe em cada uma e não inventa o que falta —
 * é por isso que os campos específicos são lidos com guarda de tipo, e não tratados como se as duas
 * formas fossem idênticas.
 */
function titleFacts(item: AnyTitle, kind: TitleKind): ContextField[] {
  const late = daysLate(item.dueDate);
  const facts: ContextField[] = [
    { label: 'Título', value: titleReference(item) },
    {
      label: 'Situação',
      value: labelOrRaw(
        item.status,
        kind === 'receivable' ? RECEIVABLE_STATUS_LABELS : PAYABLE_STATUS_LABELS,
      ),
    },
    { label: 'Vencimento', value: <DateTime value={item.dueDate} mode="date" /> },
    { label: 'Principal', value: <Money value={item.principal} currencyCode={item.currencyCode} /> },
    {
      label: 'Saldo em aberto',
      value: <Money value={item.remainingBalance} currencyCode={item.currencyCode} emphasis />,
    },
  ];

  if (late !== null) {
    facts.push({
      label: 'Atraso',
      value: `${late} dia${late === 1 ? '' : 's'} desde o vencimento`,
      emphasis: true,
    });
  }

  if (kind === 'payable') {
    const payable = item as PayableDetail;
    if (payable.agingBucket) {
      facts.push({ label: 'Faixa', value: labelOrRaw(payable.agingBucket, AGING_BUCKET_LABELS) });
    }
    if (payable.origin?.reference) {
      facts.push({ label: 'Documento de origem', value: payable.origin.reference });
    }
    if (payable.costCenter?.code) {
      facts.push({ label: 'Centro de custo', value: payable.costCenter.code });
    }
  }

  if (kind === 'receivable') {
    const receivable = item as ReceivableDetail;
    /*
     * ORIGEM DO RECEBÍVEL — a linhagem que o contrato publica: o documento de faturamento, a
     * medição e a ordem de serviço que produziram o título. É o contexto que diz DE ONDE o valor
     * veio, sem sair da fila e sem uma segunda consulta.
     */
    if (receivable.origin?.billingDocumentId) {
      facts.push({
        label: 'Documento de faturamento',
        value: (
          <Link
            to={`/app/billing/${receivable.origin.billingDocumentId}`}
            className="text-brand-700 no-underline hover:underline"
          >
            Abrir documento de faturamento
          </Link>
        ),
      });
    }
    if (receivable.origin?.serviceOrderId) {
      facts.push({
        label: 'Ordem de serviço',
        value: (
          <Link
            to={`/app/service-orders/${receivable.origin.serviceOrderId}`}
            className="text-brand-700 no-underline hover:underline"
          >
            Abrir ordem de serviço de origem
          </Link>
        ),
      });
    }
    if (receivable.clientId) {
      facts.push({
        label: 'Cliente',
        value: (
          <Link
            to={`/app/clients/${receivable.clientId}`}
            className="text-brand-700 no-underline hover:underline"
          >
            Abrir cliente no cadastro
          </Link>
        ),
      });
    }
  }

  return facts;
}

/** Colunas de fatos que as duas carteiras compartilham, para o drawer ser um só. */
type AnyTitle = ReceivableDetail | PayableDetail;

export function FinanceTitleQueues() {
  return (
    <>
      <FinanceTitleQueue
        kind="receivable"
        title="Recebíveis em aberto"
        ariaLabel="Fila de recebíveis"
        description="Títulos a receber com o recorte publicado pelo servidor"
        emptyDescription="Nenhum título a receber neste recorte. A cobrança não inventa título para parecer cheia."
        listHref="/app/finance/receivables"
        listLabel="Abrir Contas a Receber"
        scopes={RECEIVABLE_SCOPES}
        savedViewsScope="finance.receivables"
      />
      <FinanceTitleQueue
        kind="payable"
        title="Obrigações a regularizar"
        ariaLabel="Fila de pagáveis"
        description="Títulos a pagar com o recorte publicado pelo servidor"
        emptyDescription="Nenhuma obrigação neste recorte. A tela não inventa título para parecer cheia."
        listHref="/app/finance/payables"
        listLabel="Abrir Contas a Pagar"
        scopes={PAYABLE_SCOPES}
        savedViewsScope="finance.payables"
      />
    </>
  );
}

function FinanceTitleQueue({
  kind,
  title,
  ariaLabel,
  description,
  emptyDescription,
  listHref,
  listLabel,
  scopes,
  savedViewsScope,
}: {
  kind: TitleKind;
  title: string;
  ariaLabel: string;
  description: string;
  emptyDescription: string;
  listHref: string;
  listLabel: string;
  scopes: ReadonlyArray<{ label: string; scope: TitleScope }>;
  savedViewsScope: string;
}) {
  const identityId = useOptionalIdentityId();
  const [scope, setScope] = useState<TitleScope>(ALL_TITLE_SCOPE);
  const [state, setState] = useState<TitleState<AnyTitle>>({ phase: 'loading' });
  const [selected, setSelected] = useState<AnyTitle | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const savedViews = useSavedViews(identityId ?? null, savedViewsScope);

  const load = useCallback(
    async (signal: AbortSignal): Promise<FinanceTitlePage<AnyTitle>> => {
      const query = {
        limit: TITLE_LIMIT,
        offset: 0,
        ...(scope.status ? { status: scope.status } : {}),
        ...(scope.agingBucket ? { agingBucket: scope.agingBucket } : {}),
      };
      /*
       * As duas carteiras publicam o MESMO envelope (`{ items, limit, offset, total, totalPages }`) e
       * divergem apenas no tipo do registro. A uniao `AnyTitle` e o que permite o drawer e a linha
       * serem escritos UMA vez para as duas — sem tipo paralelo e sem cast: cada leitura devolve o
       * proprio tipo, e a uniao e a dos dois contratos reais.
       */
      return kind === 'receivable'
        ? await listReceivables(query, signal)
        : await listPayables(query, signal);
    },
    [kind, scope.status, scope.agingBucket],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function run() {
      setState({ phase: 'loading' });
      try {
        const page = await load(controller.signal);
        if (active) {
          setState({ phase: 'ready', page });
        }
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setState(failure<AnyTitle>(error));
        }
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [load, reloadToken]);

  /* Trocar de recorte fecha o contexto: o item selecionado pode não pertencer ao novo conjunto. */
  useEffect(() => {
    setSelected(null);
  }, [scope.status, scope.agingBucket]);

  const items = state.phase === 'ready' ? state.page.items : [];
  const total = state.phase === 'ready' ? state.page.total : null;

  /** A saída leva o MESMO recorte para a lista completa — o operador não remonta o filtro. */
  const listParams = new URLSearchParams();
  if (scope.status) {
    listParams.set('status', scope.status);
  }
  if (scope.agingBucket) {
    listParams.set('agingBucket', scope.agingBucket);
  }
  const scopedListHref = listParams.toString() ? `${listHref}?${listParams}` : listHref;

  return (
    <div>
      <WorkbenchQueue
        title={title}
        regionLabel={ariaLabel}
        count={total}
        description={
          state.phase === 'loading'
            ? 'Lendo os títulos do recorte no servidor…'
            : state.phase === 'ready'
              ? `${coverage(items.length, total)} · ${description}`
              : description
        }
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={workbenchSecondaryActionClass}
              onClick={() => setReloadToken((token) => token + 1)}
            >
              Atualizar
            </button>
            {items.length > 0 ? (
              <Link className={workbenchSecondaryActionClass} to={scopedListHref}>
                {listLabel}
              </Link>
            ) : null}
          </div>
        }
        emptyTitle={
          state.phase === 'denied'
            ? 'Fila indisponível'
            : state.phase === 'error'
              ? 'Não foi possível ler esta fila'
              : 'Nenhum título neste recorte.'
        }
        emptyDescription={
          state.phase === 'denied'
            ? 'Você não tem permissão para ler esta carteira.'
            : state.phase === 'error'
              ? state.message
              : emptyDescription
        }
        emptyAction={
          state.phase === 'ready' ? (
            <Link className={workbenchPrimaryActionClass} to={scopedListHref}>
              {listLabel}
            </Link>
          ) : null
        }
      >
        <div className="border-b border-gray-100 px-2.5 py-1.5">
          <DynamicSavedViewsBar
            views={savedViews.views}
            persistedLocally={savedViews.persistedLocally}
            persistable={savedViews.persistable}
            onSave={(name) =>
              savedViews.save(
                name,
                {
                  ...(scope.status ? { status: scope.status } : {}),
                  ...(scope.agingBucket ? { agingBucket: scope.agingBucket } : {}),
                },
                'list',
              )
            }
            onDelete={savedViews.remove}
            onApply={(view) =>
              setScope({
                status: view.filters['status'] ?? null,
                agingBucket: view.filters['agingBucket'] ?? null,
              })
            }
          />
        </div>

        {/* RECORTES DE SISTEMA — o que o contrato do servidor executa, e nada além. */}
        <ul
          aria-label="Recortes da carteira"
          className="m-0 flex list-none flex-wrap items-center gap-1.5 border-b border-gray-100 bg-gray-50/60 px-2.5 py-1.5"
        >
          {scopes.map((option) => {
            const active =
              option.scope.status === scope.status &&
              option.scope.agingBucket === scope.agingBucket;
            return (
              <li key={option.label}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScope(option.scope)}
                  className={cn(
                    'rounded border px-2 py-0.5 text-xs',
                    active
                      ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800'
                      : 'border-gray-300 bg-white font-medium text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>

        {items.map((item) => {
          const late = daysLate(item.dueDate);
          const statusLabels =
            kind === 'receivable' ? RECEIVABLE_STATUS_LABELS : PAYABLE_STATUS_LABELS;
          return (
            <WorkbenchQueueItem
              key={item.id}
              severity={
                late !== null ? (
                  <WorklistException tone="critical">
                    {late} dia{late === 1 ? '' : 's'} em atraso
                  </WorklistException>
                ) : (
                  <StatusBadge
                    label={labelOrRaw(item.status, statusLabels)}
                    tone={toneForStatus(item.status)}
                  />
                )
              }
              severityTone={late !== null ? 'critical' : 'info'}
              title={`Título ${titleReference(item)}`}
              reason={
                late !== null
                  ? 'Vencimento publicado já passou e o saldo segue em aberto'
                  : 'Título em aberto com vencimento ainda no prazo'
              }
              context={
                <>
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    title="Ver o contexto deste título"
                    className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                  >
                    {titleReference(item)}
                  </button>
                  <span className="ml-3">
                    <Money value={item.remainingBalance} currencyCode={item.currencyCode} />
                  </span>
                  {kind === 'payable' && (item as PayableDetail).agingBucket ? (
                    <span className="ml-3">
                      {labelOrRaw((item as PayableDetail).agingBucket, AGING_BUCKET_LABELS)}
                    </span>
                  ) : null}
                </>
              }
              age={
                <>
                  Vencimento <DateTime value={item.dueDate} mode="date" />
                </>
              }
              action={
                <Link
                  className={workbenchPrimaryActionClass}
                  to={
                    kind === 'receivable'
                      ? `/app/finance/receivables/${item.id}`
                      : `/app/finance/payables/${item.id}`
                  }
                >
                  {kind === 'receivable' ? 'Abrir recebível' : 'Abrir obrigação'}
                </Link>
              }
            />
          );
        })}
      </WorkbenchQueue>

      {/*
        CONTEXTO DO TÍTULO — o mesmo primitivo lateral das listas maduras. Entrega o suficiente para
        decidir (situação, vencimento, principal, saldo, atraso, faixa) e o atalho para o título
        completo. Nenhum valor é recalculado: tudo vem do registro publicado.
      */}
      <ContextDrawer
        open={selected !== null}
        title={kind === 'receivable' ? 'Contexto do recebível' : 'Contexto da obrigação'}
        onClose={() => setSelected(null)}
        preview={
          selected
            ? {
                identifier: titleReference(selected),
                subtitle:
                  kind === 'receivable'
                    ? 'Título a receber'
                    : 'Título a pagar',
                status: (
                  <StatusBadge
                    label={labelOrRaw(
                      selected.status,
                      kind === 'receivable' ? RECEIVABLE_STATUS_LABELS : PAYABLE_STATUS_LABELS,
                    )}
                    tone={toneForStatus(selected.status)}
                  />
                ),
                facts: titleFacts(selected, kind),
                nextAction: {
                  label: kind === 'receivable' ? 'Abrir recebível' : 'Abrir obrigação',
                  href:
                    kind === 'receivable'
                      ? `/app/finance/receivables/${selected.id}`
                      : `/app/finance/payables/${selected.id}`,
                  kind: 'primary',
                },
                detailHref:
                  kind === 'receivable'
                    ? `/app/finance/receivables/${selected.id}`
                    : `/app/finance/payables/${selected.id}`,
                detailLabel: 'Abrir título completo',
                body: (
                  <p className="cisne-type-helper m-0">
                    A liquidação, o baixa e o estorno continuam no domínio responsável — a fila não
                    executa transição financeira sensível.
                  </p>
                ),
              }
            : null
        }
      />
    </div>
  );
}

/** Cobertura do recorte: a RELAÇÃO entre a amostra e o total do servidor, nunca só o array. */
function coverage(shown: number, total: number | null): string {
  if (total === null) {
    return `${shown} ${shown === 1 ? 'título lido' : 'títulos lidos'}`;
  }
  if (total <= 0) {
    return 'Nenhum título no recorte';
  }
  const noun = total === 1 ? 'título' : 'títulos';
  return shown >= total ? `${total} de ${total} ${noun} no recorte` : `Exibindo ${shown} de ${total} ${noun}`;
}

/** Botão de atualização reutilizável das zonas financeiras. */
export function FinanceReloadButton({ onClick }: { onClick: () => void }): ReactNode {
  return (
    <Button type="button" variant="secondary" onClick={onClick}>
      Atualizar
    </Button>
  );
}
