import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { cn } from '../../ui/utils/cn';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader, WorklistStatePanel, Button } from '../../ui';
import {
  ECONOMIC_FINANCIAL_LABELS,
  ECONOMIC_SEVERITY_TONE,
  ECONOMIC_STATE_LABELS,
  ECONOMIC_TRACE_KIND_LABELS,
  EconomicTraceApiError,
  fetchPaymentTrace,
  fetchSettlementTrace,
  retryEconomicPosting,
  type EconomicTraceView,
} from '../api/economic-trace-api';

/**
 * F1.1 — TRILHA ECONÔMICA DE UM FATO.
 *
 * Responde, numa tela: o que aconteceu · em que estado está · foi contabilizado · se
 * não, por quê · qual o impacto · quem age · qual a próxima ação · quais comandos
 * estão disponíveis.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * A LEITURA CENTRAL DA TELA
 *
 *   FINANCEIRO: LIQUIDADO · CONTABILIDADE: CONTABILIZADO
 *   FINANCEIRO: LIQUIDADO · CONTABILIDADE: FALHOU  → AÇÃO NECESSÁRIA
 *
 * A frase vem PRONTA do backend (`summary`). A tela não monta estado por conta
 * própria: se montasse, duas superfícies poderiam dizer coisas diferentes sobre o
 * mesmo fato — exatamente o defeito que a F1.1 elimina no backend.
 */

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; data: EconomicTraceView }
  | { phase: 'error'; message: string; denied: boolean };

function failureCopy(reason: unknown): { message: string; denied: boolean } {
  if (reason instanceof EconomicTraceApiError) {
    if (reason.kind === 'denied') {
      return { message: 'Você não tem permissão para ler este fato econômico.', denied: true };
    }
    if (reason.kind === 'not_found') {
      return { message: 'Este fato econômico não existe.', denied: false };
    }
    if (reason.kind === 'network') {
      return {
        message:
          'Não foi possível falar com o servidor: a situação contábil é desconhecida nesta leitura — não é "sem pendência".',
        denied: false,
      };
    }
  }
  return { message: 'Não foi possível ler a trilha econômica.', denied: false };
}

export function EconomicTracePage() {
  const params = useParams<{ factKind: string; factId: string }>();
  const factKind = params.factKind === 'payment' ? 'payment' : 'settlement';
  const factId = params.factId ?? '';

  const [state, setState] = useState<State>({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!factId) {
      setState({ phase: 'error', message: 'Fato econômico não informado.', denied: false });
      return;
    }
    const controller = new AbortController();
    let active = true;

    async function run() {
      setState({ phase: 'loading' });
      try {
        const data =
          factKind === 'payment'
            ? await fetchPaymentTrace(factId, controller.signal)
            : await fetchSettlementTrace(factId, controller.signal);
        if (active && !controller.signal.aborted) {
          setState({ phase: 'ready', data });
        }
      } catch (reason) {
        if (active && !controller.signal.aborted) {
          setState({ phase: 'error', ...failureCopy(reason) });
        }
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [factKind, factId, reloadToken]);

  const reload = useCallback(() => {
    setActionError(null);
    setReloadToken((token) => token + 1);
  }, []);

  const retry = useCallback(async () => {
    if (state.phase !== 'ready') {
      return;
    }
    const outboxEventId = state.data.economicEvent?.outboxEventId ?? null;
    if (!outboxEventId) {
      setActionError('Este fato não possui evento de transporte identificado.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await retryEconomicPosting(outboxEventId);
      reload();
    } catch (reason) {
      setActionError(failureCopy(reason).message);
    } finally {
      setBusy(false);
    }
  }, [state, reload]);

  if (state.phase === 'loading') {
    return (
      <ModulePage layout="workspace">
        <WorklistStatePanel
          title="Lendo a trilha econômica"
          description="Situação financeira, evento econômico, posting e lançamento estão sendo lidos."
        />
      </ModulePage>
    );
  }

  if (state.phase === 'error') {
    return (
      <ModulePage layout="workspace">
        <WorklistStatePanel
          title={state.denied ? 'Acesso negado' : 'Leitura indisponível'}
          description={state.message}
        />
      </ModulePage>
    );
  }

  const trace = state.data;
  const tone = ECONOMIC_SEVERITY_TONE[trace.severity];

  return (
    <ModulePage layout="workspace">
      <div data-region="work-surface">
        <div data-region="operating-header">
          <WorklistHeader
            title={trace.factKind === 'SETTLEMENT' ? 'Trilha da liquidação' : 'Trilha do pagamento'}
            count={null}
            context="Cadeia completa: título → fato financeiro → evento econômico → posting → lançamento contábil."
            action={
              <Button type="button" variant="secondary" onClick={reload}>
                Atualizar
              </Button>
            }
          />
        </div>

        {/* ESTADO DUPLO — a leitura que a F1.1 existe para publicar. */}
        <section
          aria-label="Situação do fato econômico"
          className={cn(
            'mx-3 mb-2 rounded-[10px] border px-4 py-3',
            tone === 'critical'
              ? 'border-red-300 bg-red-50'
              : tone === 'warning'
                ? 'border-amber-300 bg-amber-50'
                : 'border-[color:var(--color-border-default)] bg-white',
          )}
        >
          <p className="m-0 text-sm font-semibold">{trace.summary}</p>
          {trace.impact ? <p className="mt-1 mb-0 text-xs text-red-800">{trace.impact}</p> : null}

          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
            <Fact label="Financeiro" value={ECONOMIC_FINANCIAL_LABELS[trace.financialState]} />
            <Fact label="Contabilidade" value={ECONOMIC_STATE_LABELS[trace.accountingState]} />
            <Fact label="Valor" value={formatMoney(trace.amount, trace.currencyCode)} />
            <Fact label="Competência" value={trace.occurredOn} />
          </dl>
        </section>

        {/* FALHA PERSISTIDA — nunca toast. Fica visível até resolução. */}
        {trace.posting.failure ? (
          <section
            aria-label="Falha de contabilização"
            className="mx-3 mb-2 rounded-[10px] border border-red-300 bg-red-50 px-4 py-3"
          >
            <p className="m-0 text-xs font-semibold text-red-800">Contabilização não concluída</p>
            <p className="mt-1 mb-0 text-xs text-red-800">
              <strong>Causa:</strong> {trace.posting.failure.message}
            </p>
            <p className="mt-1 mb-0 text-xs text-red-800">
              <strong>Motivo registrado:</strong> {trace.posting.failure.code}
            </p>
            <p className="mt-1 mb-0 text-xs text-red-800">
              <strong>Tentativas:</strong> {trace.posting.failure.attempts} de{' '}
              {trace.posting.failure.maxAttempts}
              {trace.posting.failure.firstFailedAt
                ? ` · desde ${formatDate(trace.posting.failure.firstFailedAt)}`
                : ''}
            </p>
            {actionError ? (
              <p role="alert" className="mt-2 mb-0 text-xs text-red-900">
                {actionError}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* PRÓXIMA AÇÃO — decidida pelo backend. */}
        <section
          aria-label="Próxima ação"
          className="mx-3 mb-2 rounded-[10px] border border-[color:var(--color-border-default)] bg-white px-4 py-3"
        >
          <p className="m-0 text-xs font-semibold">{trace.nextAction.label}</p>
          <p className="mt-1 mb-0 text-xs text-[color:var(--color-text-secondary)]">
            {trace.nextAction.reason}
          </p>
          {trace.nextAction.owner ? (
            <p className="mt-1 mb-0 text-xs text-[color:var(--color-text-secondary)]">
              Responsável: {trace.nextAction.owner}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {trace.availableCommands.includes('RETRY_POSTING') ? (
              <Button type="button" onClick={() => void retry()} disabled={busy}>
                {busy ? 'Reprocessando…' : 'Reprocessar contabilização'}
              </Button>
            ) : null}
            {trace.availableCommands.includes('OPEN_JOURNAL') ? (
              <a
                className="text-xs font-semibold text-brand-700 underline"
                href="/app/accounting/journals"
              >
                Abrir lançamentos
              </a>
            ) : null}
            {trace.availableCommands.includes('OPEN_ACCOUNTING_PERIOD') ? (
              <a
                className="text-xs font-semibold text-brand-700 underline"
                href="/app/accounting/periods"
              >
                Ver competências
              </a>
            ) : null}
          </div>
        </section>

        {/* TRILHA NAVEGÁVEL. */}
        <section
          aria-label="Trilha do fato econômico"
          className="mx-3 mb-2 overflow-hidden rounded-[10px] border border-[color:var(--color-border-default)] bg-white"
        >
          <h2 className="cisne-type-workspace m-0 border-b border-[color:var(--color-divider)] bg-[color:var(--color-surface-header)] px-3 py-1.5">
            Cadeia do fato
          </h2>
          <ol className="m-0 list-none p-0">
            {trace.trace.map((node) => (
              <li
                key={`${node.kind}:${node.reference}`}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-b border-gray-100 px-3 py-2 last:border-b-0"
              >
                <span className="text-xs font-semibold">
                  {ECONOMIC_TRACE_KIND_LABELS[node.kind]}
                </span>
                <span className="text-xs text-[color:var(--color-text-secondary)]">
                  {node.reference}
                </span>
                <span className="text-xs font-medium">{node.status}</span>
                {node.occurredAt ? (
                  <span className="text-xs tabular-nums text-[color:var(--color-text-secondary)]">
                    {node.occurredAt}
                  </span>
                ) : null}
                {node.route ? (
                  <a className="text-xs font-semibold text-brand-700 underline" href={node.route}>
                    Abrir
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        {/* REGRA DE POSTING APLICADA — rastreabilidade contábil. */}
        {trace.posting.rule ? (
          <section
            aria-label="Regra contábil aplicada"
            className="mx-3 mb-2 rounded-[10px] border border-[color:var(--color-border-default)] bg-white px-4 py-3"
          >
            <p className="m-0 text-xs font-semibold">
              Regra {trace.posting.rule.ruleCode ?? '—'}
              {trace.posting.rule.versionNumber !== null
                ? ` · versão ${trace.posting.rule.versionNumber}`
                : ''}
            </p>
            <dl className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-xs md:grid-cols-2">
              <Fact label="Débito" value={trace.posting.rule.debitAccountLabel ?? '—'} />
              <Fact label="Crédito" value={trace.posting.rule.creditAccountLabel ?? '—'} />
            </dl>
            {trace.posting.journalNumber !== null ? (
              <p className="mt-1 mb-0 text-xs">
                Lançamento #{trace.posting.journalNumber}
                {trace.posting.postedAt ? ` · ${formatDate(trace.posting.postedAt)}` : ''}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </ModulePage>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="cisne-meta-label m-0">{label}</dt>
      <dd className="m-0 font-medium">{value}</dd>
    </div>
  );
}

function formatMoney(amount: string, currencyCode: string): string {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    return `${amount} ${currencyCode}`;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode || 'BRL',
  }).format(parsed);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}
