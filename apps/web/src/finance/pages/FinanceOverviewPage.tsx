import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button, DateTime, Money, cn } from '../../ui';
import { formatMoneyBrl } from '../../billing/utils/billing-format';
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
  TREASURY_KIND_LABELS,
  labelOrRaw,
  toneForStatus,
} from '../../financial-ui/labels';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { DomainWorkZones } from '../../workspaces/components/DomainWorkZones';
import { WorkspaceZone } from '../../workspaces/components/WorkspaceZone';
import { StatusBadge } from '../../ui/StatusBadge';
import { WorkbenchQueue, WorkbenchQueueItem } from '../../ui/workbench';
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
  /** Amostra: a posicao que a tela publica na primeira dobra. */
  receivables: OverviewSlice<FinanceTitlePage<ReceivableDetail>>;
  payables: OverviewSlice<FinanceTitlePage<PayableDetail>>;
  /**
   * RECORTE VENCIDO — `?status=OVERDUE`, contado E somado pelo SERVIDOR.
   *
   * A amostra nao serve para excecao: com 3 titulos dos quais 1 vencido, a pagina carregada
   * respondia "0 pagaveis vencidos" pelo simples fato de o titulo vencido estar fora das 100
   * primeiras linhas. Contagem de excecao sobre amostra nao e contagem — e leitura da pagina
   * disfarcada de posicao do dominio. A excecao passa a vir do unico lugar que conta o dominio
   * inteiro sob o recorte: o proprio servidor. Ausencia continua sendo ausencia: se a leitura
   * falhar, a linha declara a falha em vez de exibir zero.
   */
  overdueReceivables: OverviewSlice<FinanceTitlePage<ReceivableDetail>>;
  overduePayables: OverviewSlice<FinanceTitlePage<PayableDetail>>;
  accounts: OverviewSlice<FinancialAccount[]>;
  aging: OverviewSlice<PayableAgingResponse>;
};

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
 * Posicao da carteira `null` quando a leitura NAO autorizou/recebeu o recorte COMPLETO.
 *
 * `total` conta o recorte inteiro sob o filtro do servidor; quando ele vem ausente, contar a
 * amostra carregada seria apresentar uma pagina como dominio. `null` faz o indicador declarar
 * "—" (desconhecido) em vez de afirmar um numero que a leitura nao sustenta.
 */
function pageTotal(page: FinanceTitlePage<unknown> | null): number | null {
  if (!page) {
    return null;
  }
  return typeof page.total === 'number' ? page.total : null;
}

/**
 * Dinheiro do recorte COMPLETO (`?status=OVERDUE`): soma dos SALDOS EM ABERTO que o servidor
 * devolveu para aquele recorte.
 *
 * A soma envolve o recorte inteiro — nao uma pagina apresentada como dominio. Quando a leitura
 * do recorte devolve mais linhas do que a pagina carregada, o valor e declarado como piso
 * (`+`), com a contagem que o acompanha, em vez de passar por total do dominio.
 */
function sumOpenBalance(page: FinanceTitlePage<{ remainingBalance: string }> | null): string | null {
  if (!page || !Array.isArray(page.items)) {
    return null;
  }
  let total = 0;
  for (const item of page.items) {
    const numeric = Number(item.remainingBalance);
    if (Number.isFinite(numeric)) {
      total += numeric;
    }
  }
  return total.toFixed(4);
}

/** Recorte carregado por inteiro? Sem `total` publicado, a tela nao afirma cobertura. */
function isFullyLoaded(page: FinanceTitlePage<unknown> | null): boolean {
  if (!page || typeof page.total !== 'number') {
    return false;
  }
  return page.items.length >= page.total;
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

export function FinanceOverviewPage() {
  const loader = useCallback(async (signal?: AbortSignal): Promise<OverviewData> => {
    const [receivables, payables, overdueReceivables, overduePayables, accounts, aging] =
      await Promise.allSettled([
        // A visao geral mostra POSICAO, nao pagina: pede o maior lote aceito e usa `total`.
        listReceivables({ limit: 100, offset: 0 }, signal),
        listPayables({ limit: 100, offset: 0 }, signal),
        /*
         * EXCECAO — mesmo lote, recorte de VENCIDO aplicado no servidor. A leitura de excecao
         * custa uma requisicao a mais e e o unico caminho honesto para dizer "quantos vencidos
         * existem" e "quanto esta vencido, a receber e a pagar".
         */
        listReceivables({ limit: 100, offset: 0, status: 'OVERDUE' }, signal),
        listPayables({ limit: 100, offset: 0, status: 'OVERDUE' }, signal),
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
      overdueReceivables:
        overdueReceivables.status === 'fulfilled'
          ? fulfilled(overdueReceivables.value)
          : failed(overdueReceivables.reason),
      overduePayables:
        overduePayables.status === 'fulfilled'
          ? fulfilled(overduePayables.value)
          : failed(overduePayables.reason),
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

  const { receivables, payables, overdueReceivables, overduePayables, accounts, aging } = state.data;
  const agingEntries = aging.data ? Object.entries(aging.data.buckets) : [];
  const positionIsEmpty = isPositionEmpty(state.data);

  const receivableItems = receivables.data?.items ?? [];
  const payableItems = payables.data?.items ?? [];

  /**
   * CONTAGEM DE DOMINIO — do servidor, nunca da amostra.
   *
   * `total` e contado pelo servidor sob o recorte da consulta; e o numero que a worklist de
   * destino reproduz. `null` = desconhecido, e desconhecido nao vira zero.
   */
  const receivablesInFlight = pageTotal(receivables.data);
  const payablesInFlight = pageTotal(payables.data);
  const overdueReceivableCount = pageTotal(overdueReceivables.data);
  const overduePayableCount = pageTotal(overduePayables.data);

  /** Dinheiro do recorte vencido — somado sobre o recorte inteiro, nunca sobre a amostra. */
  const overdueReceivableAmount = sumOpenBalance(overdueReceivables.data);
  const overduePayableAmount = sumOpenBalance(overduePayables.data);
  const overdueCurrency = overdueReceivables.data?.items[0]?.currencyCode
    ?? receivableItems[0]?.currencyCode
    ?? 'BRL';
  /** Recorte vencido maior que a pagina carregada: o valor e piso, e a tela diz isso. */
  const overdueIsPartial =
    !isFullyLoaded(overdueReceivables.data) || !isFullyLoaded(overduePayables.data);

  /**
   * DRILLDOWN/contagem apenas. O contrato NAO publica totalizador monetario global, entao esta
   * tela NAO soma a amostra para exibir "total a receber", "total a pagar", "caixa total" ou
   * "carteira total". Somar a pagina e chama-la de total do dominio seria inventar financa.
   * Aqui so existem QUANTIDADES, ESTADOS, VENCIMENTOS e EXCECOES — todos vem do servidor.
   *
   * A UNICA excecao e o vencido, e ela e deliberada: aquele valor vem do recorte
   * `?status=OVERDUE` inteiro, contado e somado pelo servidor — nao da amostra da primeira dobra.
   */
  const agingTitleCount = agingEntries.reduce((total, [, item]) => total + Number(item.count || 0), 0);

  /** Moeda do aging a pagar: vem do proprio titulo a pagar devolvido pelo servidor. */
  const agingCurrency = payableItems[0]?.currencyCode ?? 'BRL';

  /** Contagem de contas devolvidas pela leitura real de tesouraria (nao ha total monetario). */
  const accountCount = accounts.data ? accounts.data.length : null;

  /**
   * Procedencia do recorte, em uma linha. O operador precisa saber se o numero grande e dominio
   * ou amostra — e a tela diz qual dos dois, sem esconder o que foi lido.
   */
  const positionNote = [
    'Cada número é uma leitura do servidor sobre um recorte declarado.',
    receivables.data
      ? `Em aberto: contagem do recorte completo (${receivablesInFlight ?? '—'} títulos a receber, ${payablesInFlight ?? '—'} a pagar).`
      : 'Contas a receber indisponíveis nesta leitura.',
    overdueReceivables.data && overduePayables.data
      ? `Vencidos: recorte completo (${overdueReceivableCount ?? '—'} a receber, ${overduePayableCount ?? '—'} a pagar)${
          overdueIsPartial ? ' — valor é o mínimo confirmado nas linhas lidas' : ''
        }.`
      : 'Recorte de vencidos indisponível nesta leitura.',
  ].join(' ');

  return (
    <ModulePage layout="workspace">
      <WorklistHeader
        title="Financeiro"
        context="Workspace financeiro: quanto receber, quanto pagar, caixa atual, o que vence, o que está atrasado e o que não foi conciliado. Exceções primeiro; cada número abre os registros que o formam."
      />

      {/* 1 e 2 e 3 — AGORA, ATENÇÃO e CONTINUAR: as mesmas zonas de todo workspace de dominio. */}


      {/*
        1. EXCECOES FINANCEIRAS — a PRIMEIRA dobra do workspace financeiro.
        Vem na gramatica de fila do produto (`WorkbenchQueue` + `WorkbenchQueueItem`), a mesma de
        Alertas, Conciliacao e Central de trabalho: SEVERIDADE, MOTIVO, VALOR, ACAO, DRILLDOWN, na
        ordem em que o operador ja le as outras filas. Antes, tres blocos de texto empilhados
        abriam a tela e a excecao que decide o dia so aparecia abaixo da posicao.
      */}
      <WorkbenchQueue
        title="Exceções financeiras"
        description="Recortes publicados pelo servidor. A ação abre exatamente o conjunto representado."
        emptyTitle="Nenhuma exceção financeira"
        emptyDescription="Nenhum título vencido e nenhuma conta pendente de leitura neste escopo."
      >
        {overdueReceivables.error ? (
          <p role="alert" className="m-0 py-2 text-[13px] text-red-700">
            Recorte de recebíveis vencidos indisponível: {overdueReceivables.error}
          </p>
        ) : (overdueReceivableCount ?? 0) > 0 ? (
          <WorkbenchQueueItem
            severity={<StatusBadge label="Vencido" tone="error" />}
            severityTone="critical"
            title="Recebíveis vencidos"
            reason="Títulos a receber cujo vencimento passou e que seguem em aberto."
            context={
              <>
                {overdueReceivableCount} {overdueReceivableCount === 1 ? 'título' : 'títulos'} ·{' '}
                <Money value={overdueReceivableAmount ?? '0'} currencyCode={overdueCurrency} emphasis />
              </>
            }
            age={overdueIsPartial ? 'valor somado nas linhas devolvidas' : undefined}
            action={
              <Link
                to={receivableHref('overdue')}
                className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800 hover:underline"
              >
                Cobrar títulos vencidos
              </Link>
            }
            drilldown={
              <Link
                to="/app/finance/receivables"
                className="text-[13px] text-gray-600 no-underline hover:text-gray-800 hover:underline"
              >
                Ver toda a carteira
              </Link>
            }
          />
        ) : null}

        {overduePayables.error ? (
          <p role="alert" className="m-0 py-2 text-[13px] text-red-700">
            Recorte de pagáveis vencidos indisponível: {overduePayables.error}
          </p>
        ) : (overduePayableCount ?? 0) > 0 ? (
          <WorkbenchQueueItem
            severity={<StatusBadge label="Vencido" tone="error" />}
            severityTone="critical"
            title="Pagáveis vencidos"
            reason="Obrigações cujo vencimento passou e que ainda não foram pagas."
            context={
              <>
                {overduePayableCount} {overduePayableCount === 1 ? 'título' : 'títulos'} ·{' '}
                <Money value={overduePayableAmount ?? '0'} currencyCode={overdueCurrency} emphasis />
              </>
            }
            age={overdueIsPartial ? 'valor somado nas linhas devolvidas' : undefined}
            action={
              <Link
                to={payableHref('overdue')}
                className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800 hover:underline"
              >
                Regularizar pagamentos vencidos
              </Link>
            }
            drilldown={
              <Link
                to="/app/finance/payables"
                className="text-[13px] text-gray-600 no-underline hover:text-gray-800 hover:underline"
              >
                Ver todas as obrigações
              </Link>
            }
          />
        ) : null}

        {/*
          CONCILIACAO — a excecao de conciliacao NAO e contavel por unidade: nao existe endpoint
          de conciliacao por unidade e o contrato nao publica extrato pendente. Zero nao e
          afirmado, e por isso a linha aparece como PENDENCIA DE LEITURA (severidade informativa),
          nao como numero: dizer "0 a conciliar" seria conclusao que o dado nao sustenta.
        */}
        {accounts.data && accounts.data.length > 0 ? (
          <WorkbenchQueueItem
            severity={<StatusBadge label="Conferir" tone="info" />}
            severityTone="info"
            title="Conciliação por conta"
            reason="A conciliação é por conta e por extrato — não há leitura pendente por unidade."
            context={
              <>
                {accountCount} {accountCount === 1 ? 'conta' : 'contas'} com saldo publicado
              </>
            }
            action={
              <Link
                to="/app/finance/reconciliation"
                className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800 hover:underline"
              >
                Abrir conciliação
              </Link>
            }
            drilldown={
              <Link
                to="/app/finance/treasury"
                className="text-[13px] text-gray-600 no-underline hover:text-gray-800 hover:underline"
              >
                Ver contas e saldos
              </Link>
            }
          />
        ) : null}
      </WorkbenchQueue>

      {/*
        SUMMARY — indicadores AUTORITATIVOS: contagem e estado do recorte COMPLETO devolvido pelo
        servidor. O contrato nao publica totalizador monetario global, entao nao existe "total da
        carteira" aqui: existem quantos titulos estao em aberto, quantos venceram e quantos ja
        foram liquidados — cada um abrindo exatamente o conjunto que conta.
      */}
      <WorkspaceZone title="Posição financeira" note={positionNote}>
        {positionIsEmpty ? (
          <p className="m-0 text-sm text-gray-600">Não há títulos nem contas na posição financeira.</p>
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
                {receivablesInFlight ?? '—'}
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
                {payablesInFlight ?? '—'}
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
                className="m-0 text-2xl font-semibold text-red-700 tabular-nums"
              >
                {overdueReceivableCount === null || overduePayableCount === null
                  ? '—'
                  : overdueReceivableCount + overduePayableCount}
              </p>
              {/*
                O VALOR DO VENCIDO — o único dinheiro que esta tela publica, e ele vem do recorte
                `status=OVERDUE` INTEIRO contado pelo servidor, nao da amostra da primeira dobra.
                É o número que decide a operação do dia: quanto está atrasado, a receber e a pagar.
              */}
              <p className="m-0 text-[11px] text-gray-500 tabular-nums">
                {overdueReceivableCount === null ? '—' : `${overdueReceivableCount} a receber`}
                {overdueReceivableAmount !== null ? (
                  <>
                    {' ('}
                    <Money value={overdueReceivableAmount} currencyCode={overdueCurrency} />
                    {')'}
                  </>
                ) : null}
                {' · '}
                {overduePayableCount === null ? '—' : `${overduePayableCount} a pagar`}
                {overduePayableAmount !== null ? (
                  <>
                    {' ('}
                    <Money value={overduePayableAmount} currencyCode={overdueCurrency} />
                    {')'}
                  </>
                ) : null}
              </p>
              {overdueIsPartial ? (
                <p className="m-0 text-[11px] text-gray-500">
                  Valores somados sobre as linhas que o servidor devolveu neste recorte.
                </p>
              ) : null}
            </li>
            <li className="min-w-0">
              <p className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                Contas financeiras
              </p>
              <p
                aria-label="Quantidade de contas financeiras"
                className="m-0 text-2xl font-semibold text-gray-900 tabular-nums"
              >
                {accountCount === null ? '—' : accountCount}
              </p>
              <p className="m-0 text-[11px] text-gray-500">
                {accountCount === null
                  ? 'Tesouraria indisponível'
                  : `${accountCount === 1 ? 'conta' : 'contas'} com saldo publicado por conta`}
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
        2. FILAS DE TRABALHO E FLUXO DO DOMINIO — AGORA, ATENÇÃO e CONTINUAR, as mesmas zonas de
        todo workspace de dominio do CISNE. Vem DEPOIS da fila de excecoes: a tela responde
        primeiro o que exige decisao de dinheiro e so entao onde o trabalho continua.
      */}
      <DomainWorkZones domain="FINANCEIRO" />

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
                    <td className={enterpriseCellMutedClass}>
                      {labelOrRaw(account.kind, TREASURY_KIND_LABELS)}
                    </td>
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
        note={`${receivableItems.length} de ${receivables.data?.total ?? '—'} títulos a receber — as primeiras linhas do recorte, para leitura imediata. A lista completa abre em Contas a Receber, com busca, filtro e paginação do servidor.`}
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
                    Cliente
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
                    </td>
                    <td className={enterpriseCellMutedClass}>
                      {item.clientId ? (
                        <Link
                          to={`/app/clients/${item.clientId}`}
                          className="text-brand-700 no-underline hover:underline"
                        >
                          Abrir cliente
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
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
        note={`${payableItems.length} de ${payables.data?.total ?? '—'} títulos a pagar — as primeiras linhas do recorte, para leitura imediata. A lista completa abre em Contas a Pagar, com busca, filtro e paginação do servidor.`}
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
      <WorklistFooter rangeLabel="Origem dos valores" extra="Leituras do servidor, sem agregado inventado">
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
        Contagens e recortes vêm do servidor. Vencidos: {formatMoneyBrl(overdueReceivableAmount ?? '0')}{' '}
        a receber e {formatMoneyBrl(overduePayableAmount ?? '0')} a pagar
        {overdueIsPartial ? ', sobre as linhas devolvidas neste recorte' : ''}. Nada é recalculado no
        navegador.
      </span>
    </ModulePage>
  );
}
