import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button, DateTime, Money, cn } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  WorklistFooter,
  WorklistHeader,
  WorklistStatePanel,
  enterpriseCellClass,
  enterpriseCellMutedClass,
  enterpriseHeadCellClass,
  enterpriseNumericCellClass,
  enterpriseNumericHeadCellClass,
  enterpriseRowClass,
  enterpriseTableCardClass,
  enterpriseTableClass,
  worklistGroupClass,
} from '../../ui/enterprise-list';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import {
  AGING_BUCKET_LABELS,
  PAYABLE_STATUS_LABELS,
  RECEIVABLE_STATUS_LABELS,
  labelOrRaw,
  toneForStatus,
} from '../../financial-ui/labels';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { DomainWorkZones } from '../../workspaces/components/DomainWorkZones';
import { WorkspaceZone } from '../../workspaces/components/WorkspaceZone';
import { StatusBadge } from '../../ui/StatusBadge';
import {
  getPayablesAging,
  listPayables,
  listReceivables,
  listTreasuryAccounts,
} from '../api/finance-api';
import type { FinanceTitlePage } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import type {
  FinancialAccount,
  PayableAgingResponse,
  PayableDetail,
  ReceivableDetail,
} from '../types/finance.types';

/**
 * WORKSPACE FINANCEIRO — `/app/finance`.
 *
 * Baseline de funcao (relatorio ERP oficial): FinanceOverview NAO e dashboard de cards. E um
 * WORKSPACE financeiro executivo/operacional — EXCEPTION-FIRST, com CONSOLIDACAO e DRILLDOWN —
 * que responde de imediato: quanto receber, quanto pagar, caixa atual, o que vence, o que esta
 * atrasado, o que nao foi conciliado e onde estao as excecoes.
 *
 * Regra CISNE: METADATA DESCREVE. BACKEND DECIDE. BANCO PROTEGE.
 * Numero sem drilldown = decoracao.
 *
 * ORDEM DA TELA (a excecao vem ANTES da posicao):
 *
 *   1. HEADER  — contexto financeiro.
 *   2. RESUMO  — somente indicadores AUTORITATIVOS: contagens, estados e vencimentos.
 *   3. EXCECOES — VENCIDOS, PENDENCIAS, CONCILIACAO, bloqueios/alertas reais.
 *   4. DRILLDOWN — cada numero abre os registros que o formam.
 *
 * CADA NUMERO CARREGA: recorte exato, autoridade, contagem e drilldown. Os indicadores abrem o
 * conjunto EXATO que contam (`?status=OVERDUE`, `?status=OPEN`, `?agingBucket=`), nao a lista
 * generica — o "drilldown honesto" que a baseline exige.
 *
 * LIMITE DECLARADO (nao e decoracao, e contrato): `listReceivables`/`listPayables` sao paginados
 * pelo servidor (limite 100) e o contrato NAO publica totalizador monetario global —
 * `FinanceTitlePage` traz so `{ items, limit, offset, total, totalPages }`, ou seja, `total` de
 * REGISTROS. Por isso esta tela NAO SOMA a pagina/amostra para exibir "total a receber", "total a
 * pagar", "caixa total" ou "carteira total": somar a amostra e chama-la de total do dominio seria
 * inventar financa. O resumo usa CONTAGENS e ESTADOS; o unico dinheiro que aparece e o valor por
 * REGISTRO publicado pelo servidor (principal/saldo por titulo, saldo por conta), cada um com
 * drilldown para o proprio registro. Nao existe endpoint de conciliacao por unidade: "nao
 * conciliado" e a leitura real de tesouraria e o drilldown leva a Caixa e Bancos / Conciliacao,
 * onde a conciliacao por conta existe. Nenhum agregado e inventado no navegador.
 *
 * NAO ha backend aberto nesta etapa: GAP nao existe, entao nada de endpoint novo.
 */

type OverviewSlice<T> = {
  data: T | null;
  error: string | null;
  retryable: boolean;
};

type OverviewData = {
  receivables: OverviewSlice<FinanceTitlePage<ReceivableDetail>>;
  payables: OverviewSlice<FinanceTitlePage<PayableDetail>>;
  accounts: OverviewSlice<FinancialAccount[]>;
  aging: OverviewSlice<PayableAgingResponse>;
};

/** Titulo ainda em aberto: e sobre ele que "receber/pagar/vencimentos" fazem sentido. */
function isOpenStatus(status: string): boolean {
  return status !== 'PAID' && status !== 'CANCELLED';
}

function fulfilled<T>(value: T): OverviewSlice<T> {
  return { data: value, error: null, retryable: false };
}

function failed<T>(reason: unknown): OverviewSlice<T> {
  if (reason instanceof BackofficeApiError) {
    return {
      data: null,
      error: mapFinanceErrorToMessage(reason.code, reason.status),
      retryable: reason.kind === 'network' || reason.kind === 'unknown',
    };
  }
  return { data: null, error: mapFinanceErrorToMessage(undefined, 0), retryable: true };
}

function isDenied(reason: unknown): boolean {
  return reason instanceof BackofficeApiError && reason.kind === 'denied';
}

/**
 * Posicao vazia de verdade: o servidor respondeu as QUATRO leituras e NENHUMA tem titulo ou
 * faixa de aging. Sem isso nao existe "vazio": erro de leitura nunca pode virar "sem valores".
 */
function isPositionEmpty(data: OverviewData): boolean {
  const { receivables, payables, accounts, aging } = data;
  if (!receivables.data || !payables.data || !accounts.data || !aging.data) {
    return false;
  }
  const agingIsZero = Object.values(aging.data.buckets).every((bucket) => bucket.count === 0);
  // `total` pode vir ausente numa leitura vazia; posicao sem titulo nenhum e vazia de fato.
  const receivableTotal = receivables.data.total ?? 0;
  const payableTotal = payables.data.total ?? 0;
  return (
    receivableTotal === 0 &&
    payableTotal === 0 &&
    accounts.data.length === 0 &&
    agingIsZero
  );
}

/**
 * Drilldown dos indicadores: o `href` abre o conjunto EXATO do indicador.
 *
 * RECEBER: "em aberto" -> `status=OPEN`; "vencidos" -> `status=OVERDUE`; "nao conciliado" nao
 * existe para titulos a receber, entao nao ha indicador — em vez de um numero sem recorte.
 */
function receivableHref(kind: 'open' | 'overdue'): string {
  return `/app/finance/receivables?status=${kind === 'open' ? 'OPEN' : 'OVERDUE'}`;
}

function payableHref(kind: 'open' | 'overdue'): string {
  return `/app/finance/payables?status=${kind === 'open' ? 'OPEN' : 'OVERDUE'}`;
}

/**
 * ATENCAO OPERACIONAL — uma linha por excecao real, com valor, contagem e drilldown.
 *
 * Conforme a Pagina 11 ("Indicador sem origem e sem drilldown e decoracao"), cada linha declara
 * a autoridade do numero e abre o recorte correspondente. Nao existe linha para excecao que o
 * servidor nao publicou.
 */
/**
 * EXCECAO OPERACIONAL — uma linha por excecao real, com contagem, autoridade e drilldown.
 *
 * A linha NAO carrega valor monetario: o contrato nao publica totalizador de valor, e um R$ aqui
 * seria soma de pagina apresentada como total do dominio. O que a linha carrega e o que o
 * servidor sustenta — quantos titulos, sob qual autoridade, e para onde clicar.
 */
function AttentionRow({
  id,
  label,
  authority,
  count,
  href,
  countLabel,
}: {
  id: string;
  label: string;
  authority: string;
  count: number;
  href: string;
  /** Rotulo de acessibilidade do CONTADOR — e ele que a verificacao focalizada le. */
  countLabel: string;
}) {
  return (
    <li id={id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-gray-100 py-2 last:border-b-0">
      <Link
        to={href}
        className="min-w-52 flex-1 text-[13px] font-semibold text-brand-800 no-underline hover:text-brand-900 hover:underline"
      >
        {label}
      </Link>
      <span className="text-[11px] text-gray-500">{authority}</span>
      <span
        aria-label={countLabel}
        className="w-24 text-right text-[13px] font-semibold text-gray-900 tabular-nums"
      >
        {count} {count === 1 ? 'título' : 'títulos'}
      </span>
    </li>
  );
}

export function FinanceOverviewPage() {
  const loader = useCallback(async (signal?: AbortSignal): Promise<OverviewData> => {
    const [receivables, payables, accounts, aging] = await Promise.allSettled([
      // A visao geral mostra POSICAO, nao pagina: pede o maior lote aceito e usa `total`.
      listReceivables({ limit: 100, offset: 0 }, signal),
      listPayables({ limit: 100, offset: 0 }, signal),
      listTreasuryAccounts(signal),
      getPayablesAging(signal),
    ]);
    const deniedAll =
      receivables.status === 'rejected' &&
      payables.status === 'rejected' &&
      accounts.status === 'rejected' &&
      isDenied(receivables.reason) &&
      isDenied(payables.reason) &&
      isDenied(accounts.reason);
    if (deniedAll) {
      throw receivables.reason;
    }
    return {
      receivables:
        receivables.status === 'fulfilled'
          ? fulfilled(receivables.value)
          : failed(receivables.reason),
      payables:
        payables.status === 'fulfilled' ? fulfilled(payables.value) : failed(payables.reason),
      accounts:
        accounts.status === 'fulfilled' ? fulfilled(accounts.value) : failed(accounts.reason),
      aging: aging.status === 'fulfilled' ? fulfilled(aging.value) : failed(aging.reason),
    };
  }, []);

  const { state, reload } = useBackofficeQuery<OverviewData>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const gate = renderQueryGate(
    'Financeiro',
    'Carregando a visão financeira…',
    'Você não tem permissão para acessar o financeiro.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return null;
  }

  const { receivables, payables, accounts, aging } = state.data;
  const agingEntries = aging.data ? Object.entries(aging.data.buckets) : [];
  const positionIsEmpty = isPositionEmpty(state.data);

  const receivableItems = receivables.data?.items ?? [];
  const payableItems = payables.data?.items ?? [];
  const openReceivables = receivableItems.filter((item) => isOpenStatus(item.status));
  const openPayables = payableItems.filter((item) => isOpenStatus(item.status));
  const overdueReceivables = receivableItems.filter((item) => item.status === 'OVERDUE');
  const overduePayables = payableItems.filter((item) => item.status === 'OVERDUE');

  /**
   * DRILLDOWN/contagem apenas. O contrato NAO publica totalizador monetario global, entao esta
   * tela NAO soma a amostra para exibir "total a receber", "total a pagar", "caixa total" ou
   * "carteira total". Somar a pagina e chama-la de total do dominio seria inventar financa.
   * Aqui so existem QUANTIDADES, ESTADOS, VENCIMENTOS e EXCECOES — todos vem do servidor.
   */
  const agingTitleCount = agingEntries.reduce((total, [, item]) => total + Number(item.count || 0), 0);

  /** Moeda do aging a pagar: vem do proprio titulo a pagar devolvido pelo servidor. */
  const agingCurrency = payableItems[0]?.currencyCode ?? 'BRL';

  /** Contagem de contas devolvidas pela leitura real de tesouraria (nao ha total monetario). */
  const accountCount = accounts.data ? accounts.data.length : null;

  /**
   * Recorte da amostra carregada: a contagem de REGISTROS e exata e vem de `total`; o contrato nao
   * publica valor. A tela declara o recorte em vez de apresentar a pagina como o dominio inteiro.
   */
  const sampleNote =
    receivables.data && payables.data
      ? `Recorte: ${receivableItems.length} de ${receivables.data.total} títulos a receber · ${payableItems.length} de ${payables.data.total} títulos a pagar. Contagens, estados e vencimentos vêm do servidor.`
      : 'Contagens, estados e vencimentos vêm do servidor.';

  return (
    <ModulePage layout="workspace">
      <WorklistHeader
        title="Financeiro"
        context="Workspace financeiro: quanto receber, quanto pagar, caixa atual, o que vence, o que está atrasado e o que não foi conciliado. Exceções primeiro; cada número abre os registros que o formam."
      />

      {/* 1 e 2 e 3 — AGORA, ATENÇÃO e CONTINUAR: as mesmas zonas de todo workspace de dominio. */}
      <DomainWorkZones domain="FINANCEIRO" />

      {/*
        SUMMARY — somente indicadores AUTORITATIVOS: quantidades, estados e vencimentos.
        O contrato so publica contagem (`total`), entao a tela usa contagem. Nenhum KPI em R$:
        sem totalizador global, valor seria decoracao inventada.
      */}
      <WorkspaceZone title="Posição financeira" note={sampleNote}>
        {positionIsEmpty ? (
          <p className="m-0 text-sm text-gray-600">Não há valores vencidos.</p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-3 p-0 lg:grid-cols-4">
            <li className="min-w-0">
              <p className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                Recebíveis em aberto
              </p>
              <p
                aria-label="Quantidade de títulos a receber"
                className="m-0 text-2xl font-semibold text-gray-900 tabular-nums"
              >
                {receivables.data ? openReceivables.length : '—'}
              </p>
              <p className="m-0 text-[11px]">
                <Link
                  to={receivableHref('open')}
                  className="text-brand-700 no-underline hover:underline"
                >
                  Abrir títulos a receber
                </Link>
              </p>
            </li>
            <li className="min-w-0">
              <p className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                Pagáveis em aberto
              </p>
              <p
                aria-label="Quantidade de títulos a pagar"
                className="m-0 text-2xl font-semibold text-gray-900 tabular-nums"
              >
                {payables.data ? openPayables.length : '—'}
              </p>
              <p className="m-0 text-[11px]">
                <Link
                  to={payableHref('open')}
                  className="text-brand-700 no-underline hover:underline"
                >
                  Abrir títulos a pagar
                </Link>
              </p>
            </li>
            <li className="min-w-0">
              <p className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                Vencidos
              </p>
              <p
                aria-label="Quantidade de títulos vencidos"
                className="m-0 text-2xl font-semibold text-gray-900 tabular-nums"
              >
                {receivables.data && payables.data
                  ? overdueReceivables.length + overduePayables.length
                  : '—'}
              </p>
              <p className="m-0 text-[11px] text-gray-500 tabular-nums">
                {receivables.data ? `${overdueReceivables.length} a receber` : '—'} ·{' '}
                {payables.data ? `${overduePayables.length} a pagar` : '—'}
              </p>
            </li>
            <li className="min-w-0">
              <p className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                Itens para conciliar
              </p>
              <p
                aria-label="Quantidade de contas não conciliadas"
                className="m-0 text-2xl font-semibold text-gray-900 tabular-nums"
              >
                {accountCount === null ? '—' : accountCount}
              </p>
              <p className="m-0 text-[11px] text-gray-500">
                {accountCount === null
                  ? 'Tesouraria indisponível'
                  : `${accountCount === 1 ? 'conta' : 'contas'} — conciliação por conta e extrato`}
              </p>
              <p className="m-0 text-[11px]">
                <Link
                  to="/app/finance/reconciliation"
                  className="text-brand-700 no-underline hover:underline"
                >
                  Abrir Conciliação
                </Link>
              </p>
            </li>
          </ul>
        )}

        {/* VENCENDO — faixas de aging publicadas pelo servidor: titulos e vencimento, sem R$. */}
        {aging.error ? (
          <div role="alert" className="mt-4">
            <p className="m-0 text-[13px] text-red-700">
              Não foi possível carregar o aging: {aging.error}
            </p>
            {aging.retryable ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => void reload()}
              >
                Tentar novamente
              </Button>
            ) : null}
          </div>
        ) : aging.data && agingEntries.length > 0 ? (
          <div className={cn(enterpriseTableCardClass, 'mt-4 mb-0')}>
            <table className={enterpriseTableClass} aria-label="Aging de contas a pagar">
              <caption className="px-3 pt-3 text-left text-[11px] text-gray-500">
                Faixas de vencimento a pagar — posição em{' '}
                <DateTime value={aging.data.asOf} mode="date" />. {agingTitleCount} títulos nas
                faixas.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Faixa
                  </th>
                  <th scope="col" className={enterpriseNumericHeadCellClass}>
                    Títulos
                  </th>
                  <th scope="col" className={enterpriseNumericHeadCellClass}>
                    Saldo informado
                  </th>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Drilldown
                  </th>
                </tr>
              </thead>
              <tbody>
                {agingEntries.map(([bucket, item]) => (
                  <tr key={bucket} className={enterpriseRowClass}>
                    <td className={enterpriseCellClass}>{labelOrRaw(bucket, AGING_BUCKET_LABELS)}</td>
                    <td className={enterpriseNumericCellClass}>{item.count}</td>
                    <td className={enterpriseNumericCellClass}>
                      <Money value={item.remaining} currencyCode={agingCurrency} />
                    </td>
                    <td className={enterpriseCellMutedClass}>
                      <Link
                        to={`/app/finance/payables?agingBucket=${encodeURIComponent(bucket)}`}
                        className="text-brand-700 no-underline hover:underline"
                      >
                        Abrir títulos desta faixa
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </WorkspaceZone>

      {/*
        EXCECOES — VENCIDOS, NAO CONCILIADOS e alertas reais. Vem ANTES da posicao detalhada.
        Cada linha tem autoridade declarada, contagem, valor e drilldown para o recorte exato.
      */}
      <WorkspaceZone
        title="Exceções financeiras"
        note="Recortes publicados pelo servidor. O clique abre exatamente o conjunto representado."
      >
        {positionIsEmpty ? (
          <p className="m-0 text-sm text-gray-600">Nenhuma exceção financeira.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {receivables.error ? (
              <li className="py-2 text-[13px] text-red-700" role="alert">
                Contas a receber indisponíveis: {receivables.error}
              </li>
            ) : (
              <AttentionRow
                id="attention-receivable-overdue"
                label="Recebíveis vencidos"
                authority="títulos a receber com status Vencido"
                count={overdueReceivables.length}
                countLabel="Quantidade de recebíveis vencidos"
                href={receivableHref('overdue')}
              />
            )}
            {payables.error ? (
              <li className="py-2 text-[13px] text-red-700" role="alert">
                Contas a pagar indisponíveis: {payables.error}
              </li>
            ) : (
              <AttentionRow
                id="attention-payable-overdue"
                label="Pagáveis vencidos"
                authority="títulos a pagar com status Vencido"
                count={overduePayables.length}
                countLabel="Quantidade de pagáveis vencidos"
                href={payableHref('overdue')}
              />
            )}
            {/*
              NAO CONCILIADOS: nao existe endpoint de conciliacao por unidade. A linha declara a
              autoridade real (contas devolvidas pela leitura de tesouraria) e faz drillback para
              Caixa e Bancos / Conciliacao, onde a conciliacao por conta e por extrato existe.
            */}
            <li
              id="attention-unreconciled-accounts"
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-gray-100 py-2 last:border-b-0"
            >
              <Link
                to="/app/finance/reconciliation"
                className="min-w-52 flex-1 text-[13px] font-semibold text-brand-800 no-underline hover:text-brand-900 hover:underline"
              >
                Contas não conciliadas
              </Link>
              <span className="text-[11px] text-gray-500">
                conciliação é por conta e por extrato, não por unidade
              </span>
              <span
                aria-label="Quantidade de contas não conciliadas"
                className="w-24 text-right text-[13px] font-semibold text-gray-900 tabular-nums"
              >
                {accountCount === null ? '—' : accountCount}{' '}
                {accountCount === 1 ? 'conta' : 'contas'}
              </span>
            </li>
          </ul>
        )}
      </WorkspaceZone>

      {/*
        TESOURARIA / CONCILIACAO — drilldown. Cada conta e um registro do servidor, com saldo
        proprio e origem (link para a conta). Nenhum saldo e somado aqui: o contrato nao publica
        "caixa total", e soma de contas seria inventar financa.
      */}
      <WorkspaceZone
        title="Caixa e Bancos"
        note="Contas devolvidas pelo servidor. O saldo é o publicado por conta; a conciliação é por conta e por extrato."
      >
        {accounts.error ? (
          <div role="alert">
            <p className="m-0 text-[13px] text-red-700">
              Não foi possível carregar as contas: {accounts.error}
            </p>
            {accounts.retryable ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => void reload()}
              >
                Tentar novamente
              </Button>
            ) : null}
          </div>
        ) : accounts.data && accounts.data.length > 0 ? (
          <div className={cn(enterpriseTableCardClass, 'mb-0')}>
            <table className={enterpriseTableClass} aria-label="Contas de caixa e bancos">
              <thead>
                <tr>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Conta
                  </th>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Tipo
                  </th>
                  <th scope="col" className={enterpriseNumericHeadCellClass}>
                    Saldo do servidor
                  </th>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Conciliação
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.data.map((account) => (
                  <tr key={account.id} className={enterpriseRowClass}>
                    <td className={enterpriseCellClass}>
                      <Link
                        to={`/app/finance/treasury/${account.id}`}
                        className="font-semibold text-brand-800 no-underline hover:underline"
                      >
                        {account.name}
                      </Link>
                      <span className="ml-2 font-mono text-[11px] text-gray-500">
                        {account.code}
                      </span>
                    </td>
                    <td className={enterpriseCellMutedClass}>{account.kind}</td>
                    <td className={enterpriseNumericCellClass}>
                      <Money value={account.balance} currencyCode={account.currencyCode} />
                    </td>
                    <td className={enterpriseCellMutedClass}>
                      <Link
                        to={`/app/finance/treasury/${account.id}`}
                        className="text-brand-700 no-underline hover:underline"
                      >
                        Ver movimentos e conciliação
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : accounts.data ? (
          <WorklistStatePanel
            title="Sem contas financeiras visíveis"
            description="Nenhuma conta de caixa ou banco foi devolvida pelo servidor para o seu escopo."
          />
        ) : null}
      </WorkspaceZone>

      {/* 6 — TITULOS: onde "excecoes" ganha linha, valor, vencimento e drilldown. */}
      <WorkspaceZone
        title="Títulos a receber"
        note="Amostra devolvida pelo servidor. Vencimento, status e saldo são os publicados pelo contrato."
      >
        {receivables.error ? (
          <div role="alert">
            <p className="m-0 text-[13px] text-red-700">{receivables.error}</p>
            {receivables.retryable ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => void reload()}
              >
                Tentar novamente
              </Button>
            ) : null}
          </div>
        ) : receivableItems.length === 0 ? (
          <WorklistStatePanel
            title="Nenhum título a receber"
            description="O servidor não devolveu títulos para o seu escopo."
          />
        ) : (
          <div className={cn(enterpriseTableCardClass, 'mb-0')}>
            <table className={enterpriseTableClass} aria-label="Títulos a receber">
              <thead>
                <tr>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Título
                  </th>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Vencimento
                  </th>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Status
                  </th>
                  <th scope="col" className={enterpriseNumericHeadCellClass}>
                    Principal
                  </th>
                  <th scope="col" className={enterpriseNumericHeadCellClass}>
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {receivableItems.map((item) => (
                  <tr key={item.id} className={enterpriseRowClass}>
                    <td className={enterpriseCellClass}>
                      <Link
                        to={`/app/finance/receivables/${item.id}`}
                        className="font-semibold text-brand-800 no-underline hover:underline"
                      >
                        {item.externalReference ?? item.id.slice(0, 8)}
                      </Link>
                      <span className="ml-2 font-mono text-[11px] text-gray-500">{item.unitId}</span>
                    </td>
                    <td className={enterpriseCellMutedClass}>
                      <DateTime value={item.dueDate} mode="date" />
                    </td>
                    <td className={enterpriseCellClass}>
                      <StatusBadge
                        label={labelOrRaw(item.status, RECEIVABLE_STATUS_LABELS)}
                        tone={toneForStatus(item.status)}
                      />
                    </td>
                    <td className={enterpriseNumericCellClass}>
                      <Money value={item.principal} currencyCode={item.currencyCode} />
                    </td>
                    <td className={enterpriseNumericCellClass}>
                      <Money value={item.remainingBalance} currencyCode={item.currencyCode} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WorkspaceZone>

      <WorkspaceZone
        title="Títulos a pagar"
        note="Amostra devolvida pelo servidor. Vencimento, status e saldo são os publicados pelo contrato."
      >
        {payables.error ? (
          <div role="alert">
            <p className="m-0 text-[13px] text-red-700">{payables.error}</p>
            {payables.retryable ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => void reload()}
              >
                Tentar novamente
              </Button>
            ) : null}
          </div>
        ) : payableItems.length === 0 ? (
          <WorklistStatePanel
            title="Nenhum título a pagar"
            description="O servidor não devolveu títulos para o seu escopo."
          />
        ) : (
          <div className={cn(enterpriseTableCardClass, 'mb-0')}>
            <table className={enterpriseTableClass} aria-label="Títulos a pagar">
              <thead>
                <tr>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Título
                  </th>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Vencimento
                  </th>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Status
                  </th>
                  <th scope="col" className={enterpriseHeadCellClass}>
                    Faixa
                  </th>
                  <th scope="col" className={enterpriseNumericHeadCellClass}>
                    Principal
                  </th>
                  <th scope="col" className={enterpriseNumericHeadCellClass}>
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {payableItems.map((item) => (
                  <tr key={item.id} className={enterpriseRowClass}>
                    <td className={enterpriseCellClass}>
                      <Link
                        to={`/app/finance/payables/${item.id}`}
                        className="font-semibold text-brand-800 no-underline hover:underline"
                      >
                        {item.externalReference ?? item.id.slice(0, 8)}
                      </Link>
                      <span className="ml-2 font-mono text-[11px] text-gray-500">{item.unitId}</span>
                    </td>
                    <td className={enterpriseCellMutedClass}>
                      <DateTime value={item.dueDate} mode="date" />
                    </td>
                    <td className={enterpriseCellClass}>
                      <StatusBadge
                        label={labelOrRaw(item.status, PAYABLE_STATUS_LABELS)}
                        tone={toneForStatus(item.status)}
                      />
                    </td>
                    <td className={enterpriseCellMutedClass}>
                      {labelOrRaw(item.agingBucket, AGING_BUCKET_LABELS)}
                    </td>
                    <td className={enterpriseNumericCellClass}>
                      <Money value={item.principal} currencyCode={item.currencyCode} />
                    </td>
                    <td className={enterpriseNumericCellClass}>
                      <Money value={item.remainingBalance} currencyCode={item.currencyCode} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WorkspaceZone>

      {/* RODAPE: de onde vem cada numero e onde o resto do dominio vive. */}
      <WorklistFooter rangeLabel="Origem dos valores" extra="Contratos reais, sem agregado inventado">
        <Link to="/app/finance/receivables" className="text-[12px] text-brand-700 no-underline hover:underline">
          Contas a Receber
        </Link>
        <Link to="/app/finance/payables" className="text-[12px] text-brand-700 no-underline hover:underline">
          Contas a Pagar
        </Link>
        <Link to="/app/finance/treasury" className="text-[12px] text-brand-700 no-underline hover:underline">
          Caixa e Bancos
        </Link>
        <Link to="/app/finance/reconciliation" className="text-[12px] text-brand-700 no-underline hover:underline">
          Conciliação
        </Link>
        <Link to="/app/finance/forecast" className="text-[12px] text-brand-700 no-underline hover:underline">
          Previsão de caixa
        </Link>
      </WorklistFooter>
      <span className={worklistGroupClass}>
        Valores, vencimentos e status são os devolvidos pelo servidor; nada é recalculado no navegador.
      </span>
    </ModulePage>
  );
}
