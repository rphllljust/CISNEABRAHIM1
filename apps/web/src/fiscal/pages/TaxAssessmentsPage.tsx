import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Field, Input, Money, StatusBadge } from '../../ui';
import {
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePagination,
  UnitScopeLabel,
} from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistException,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistNumericHeadCellClass,
  worklistNumericCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { cn } from '../../ui/utils/cn';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { TAX_ASSESSMENT_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { OperationalUnitOptions } from '../../shell/hooks/useOperationalUnits';
import {
  adjustTaxAssessment,
  cancelTaxAssessment,
  createTaxAssessment,
  finalizeTaxAssessment,
  getTaxAssessment,
  listTaxAssessments,
} from '../api/fiscal-api';
import { mapFiscalErrorToMessage } from '../api/fiscal-error-messages';
import { useFiscalUnits } from '../hooks/useFiscalUnits';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import type { TaxAssessment, TaxAssessmentListItem } from '../types/fiscal.types';

const PAGE_SIZE = 20;

/**
 * Próxima ação derivada da situação PERSISTIDA da obrigação.
 *
 * Espelha o ciclo que o próprio domínio aplica (`DRAFT` → finalizar; `FINALIZED` → ajustar ou
 * cancelar; `ADJUSTED`/`CANCELLED` encerrados). Não cria transição: nomeia o passo que o
 * servidor já aceita, e o valor apurado continua sendo o da apuração persistida.
 */
function NEXT_ACTION_FOR(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'Finalizar e gerar o título a pagar';
    case 'FINALIZED':
      return 'Ajustar ou cancelar';
    case 'ADJUSTED':
      return 'Nenhuma — substituída por ajuste';
    case 'CANCELLED':
      return 'Nenhuma — cancelada';
    default:
      return '—';
  }
}

/**
 * EXCEÇÃO OPERACIONAL da linha — frase booleana sobre campos que a LISTAGEM publica
 * (`status`, `obligation`). O fato "apurada e ainda sem obrigação gerada" é o que impede o
 * pagamento de acontecer, e antes só era visível abrindo o registro.
 */
function ASSESSMENT_NOTICE(item: {
  status: string;
  obligation: { id: string } | null;
}): string | null {
  if (item.status === 'DRAFT' && !item.obligation) {
    return 'Sem título a pagar gerado';
  }
  if (item.status === 'CANCELLED') {
    return 'Cancelada';
  }
  return null;
}

/**
 * SEÇÕES DE AÇÃO admitidas pela situação persistida.
 *
 * Espelha o ciclo real do domínio: rascunho finaliza; finalizada ajusta; cancelar é recusado
 * pelo servidor quando a obrigação já está cancelada. A tela não oferece botão que o backend
 * recusaria, e a seção correspondente permanece declarada — o operador vê onde agir.
 */
function allowedAssessmentActions(status: string): {
  finalize: boolean;
  adjust: boolean;
  cancel: boolean;
} {
  return {
    finalize: status === 'DRAFT',
    adjust: status !== 'CANCELLED',
    cancel: status !== 'CANCELLED',
  };
}

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: TaxAssessmentListItem[]; total: number; page: number };

export function TaxAssessmentsPage() {
  const { assessmentId } = useParams();
  return assessmentId ? (
    <TaxAssessmentDetail assessmentId={assessmentId} />
  ) : (
    <TaxAssessmentsList />
  );
}

/** Superficie de apuracao: lista paginada por unidade, competencia e situacao. */
function TaxAssessmentsList() {
  const { options: unitOptions, unitId, setUnitId } = useFiscalUnits();
  const [status, setStatus] = useState('');
  const [periodKey, setPeriodKey] = useState('');
  const [page, setPage] = useState(0);
  const [state, setState] = useState<ListState>({ phase: 'loading' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!unitId) {
        setState({ phase: 'ready', items: [], total: 0, page: 0 });
        return;
      }
      setState({ phase: 'loading' });
      try {
        const response = await listTaxAssessments(
          {
            unitId,
            status: status || undefined,
            periodKey: periodKey || undefined,
            page,
            pageSize: PAGE_SIZE,
          },
          signal,
        );
        setState({ phase: 'ready', items: response.items, total: response.total, page: response.page });
      } catch (error) {
        setState({
          phase: 'error',
          message: mapFiscalErrorToMessage(
            (error as { code?: string }).code,
            (error as { status?: number }).status ?? 0,
          ),
          retryable: true,
        });
      }
    },
    [page, periodKey, status, unitId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasMore = state.phase === 'ready' && (state.page + 1) * PAGE_SIZE < state.total;
  const items = state.phase === 'ready' ? state.items : [];
  const total = state.phase === 'ready' ? state.total : null;
  const currentPage = state.phase === 'ready' ? state.page : 0;
  /**
   * CONTAGENS DA PÁGINA — derivadas apenas de `status` e da presença de `obligation`, campos que
   * a própria listagem publica. Nenhum tributo é recalculado: o valor apurado exibido é o
   * persistido pelo servidor.
   */
  const finalizedOnPage = items.filter((item) => item.status === 'FINALIZED').length;
  const withObligation = items.filter((item) => item.obligation).length;
  /**
   * SEM OBRIGAÇÃO GERADA — apuração viva que ainda não virou título a pagar. É o estado que
   * exige trabalho do operador (finalizar) e o que hoje passa despercebido na lista.
   */
  const withoutObligation = items.filter(
    (item) => item.status === 'DRAFT' && !item.obligation,
  ).length;
  const filtersActive = status !== '' || periodKey !== '';

  return (
    <ModulePage>
      <WorklistHeader
        title="Obrigações tributárias"
        count={total}
        context="O valor apurado vem da apuração persistida. Esta tela não calcula imposto."
        metrics={
          items.length > 0 ? (
            <>
              {withoutObligation > 0 ? (
                <EnterpriseMetric
                  label="Sem título a pagar"
                  value={withoutObligation}
                  tone="warning"
                />
              ) : null}
              <EnterpriseMetric label="Finalizadas nesta página" value={finalizedOnPage} />
              <EnterpriseMetric label="Com obrigação gerada" value={withObligation} />
            </>
          ) : null
        }
      />

      {/* BARRA OPERACIONAL: unidade, competência e situação na mesma linha densa. */}
      <WorklistFilterBar meta={total !== null ? `${total} apuração(ões) no recorte` : undefined}>
        <WorklistField label="Unidade" htmlFor="assessment-unit-filter">
          <select
            id="assessment-unit-filter"
            className={worklistSelectClass}
            value={unitId}
            onChange={(event) => {
              setUnitId(event.target.value);
              setPage(0);
            }}
          >
            {/*
              ESCOPO DE UNIDADE pelo primitivo compartilhado — valor real no `value`, rótulo humano
              no texto, como nas demais famílias.
            */}
            <OperationalUnitOptions options={unitOptions} />
          </select>
        </WorklistField>
        <WorklistField label="Competência" htmlFor="assessment-period-filter">
          <input
            id="assessment-period-filter"
            type="search"
            placeholder="AAAA-MM"
            className={worklistSelectClass}
            value={periodKey}
            onChange={(event) => {
              setPeriodKey(event.target.value.trim());
              setPage(0);
            }}
          />
        </WorklistField>
        <WorklistField label="Situação" htmlFor="assessment-status-filter">
          <select
            id="assessment-status-filter"
            className={worklistSelectClass}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Todas</option>
            <option value="DRAFT">Rascunho</option>
            <option value="FINALIZED">Finalizada</option>
            <option value="ADJUSTED">Ajustada</option>
            <option value="CANCELLED">Cancelada</option>
          </select>
        </WorklistField>
        <WorklistClearFilters
          visible={filtersActive}
          onClick={() => {
            setStatus('');
            setPeriodKey('');
            setPage(0);
          }}
        />
      </WorklistFilterBar>

      {state.phase === 'loading' ? (
        <ModuleLoadingState title="Obrigações tributárias" message="Carregando apurações…" />
      ) : null}

      {state.phase === 'error' ? (
        <ModuleErrorState
          title="Obrigações tributárias"
          message={state.message}
          retryable={state.retryable}
          onRetry={() => void load()}
        />
      ) : null}

      {/* ESTADO VAZIO DENTRO DA ESTRUTURA — cabeçalho e barra seguem montados. */}
      {state.phase === 'ready' && items.length === 0 ? (
        <WorklistStatePanel
          title={filtersActive ? 'Nenhuma apuração para o recorte atual' : 'Nenhuma apuração'}
          description={
            filtersActive
              ? 'Não há apurações para a unidade, competência e situação selecionadas. Limpe o recorte para ver as apurações da unidade.'
              : 'Não há apurações persistidas para a unidade selecionada. A obrigação nasce de uma apuração já calculada pelo servidor.'
          }
          action={
            <WorklistClearFilters
              visible={filtersActive}
              onClick={() => {
                setStatus('');
                setPeriodKey('');
                setPage(0);
              }}
            />
          }
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Lista de obrigações tributárias">
              <thead>
                <tr>
                  <th scope="col" className={worklistHeadCellClass}>
                    Competência
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Componente
                  </th>
                  <th scope="col" className={worklistNumericHeadCellClass}>
                    Valor apurado
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Título a pagar
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Próxima ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const notice = ASSESSMENT_NOTICE(item);
                  return (
                    <tr key={item.id} className={worklistRowClass}>
                      <td className={worklistCellClass}>
                        <WorklistRowLink href={`/app/fiscal/assessments/${item.id}`}>
                          {item.periodKey}
                        </WorklistRowLink>
                      </td>
                      <td className={cn(worklistCellRaisedClass, 'whitespace-normal')}>
                        {item.taxComponent}
                      </td>
                      {/*
                        VALOR APURADO — valor persistido pela apuração do servidor. Esta tela
                        não calcula tributo e não soma valores: exibe o que foi apurado.
                      */}
                      <td className={worklistNumericCellClass}>
                        <Money value={item.assessedAmount} currencyCode={item.currencyCode} />
                      </td>
                      <td className={worklistCellRaisedClass}>
                        <FinanceStatusBadge
                          status={item.status}
                          labels={TAX_ASSESSMENT_STATUS_LABELS}
                        />
                        {notice ? (
                          <span className="mt-0.5 block">
                            <WorklistException
                              tone={item.status === 'CANCELLED' ? 'critical' : 'warning'}
                            >
                              {notice}
                            </WorklistException>
                          </span>
                        ) : null}
                      </td>
                      {/*
                        TITULO A PAGAR — o elo com o financeiro. `obligation` é o que o servidor
                        publicou; sem ele a célula declara a ausência em vez de mostrar vazio.
                      */}
                      <td className={cn(worklistCellRaisedClass, 'whitespace-normal')}>
                        {item.obligation ? (
                          <>
                            <span className="block">{item.obligation.status}</span>
                            <span className="block text-[11px] text-gray-500 tabular-nums">
                              {item.obligation.amount}
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] text-gray-500">Não gerado</span>
                        )}
                      </td>
                      <td className={worklistCellRaisedClass}>
                        <span
                          className={
                            item.status === 'DRAFT' || item.status === 'FINALIZED'
                              ? 'text-[12px] font-medium text-gray-800'
                              : 'text-[12px] text-gray-500'
                          }
                        >
                          {NEXT_ACTION_FOR(item.status)}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-gray-500">
                          <UnitScopeLabel unitId={item.unitId} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <WorklistFooter
            rangeLabel={
              <span aria-live="polite">
                Página {currentPage + 1} · {total} apuração(ões) no recorte
              </span>
            }
            extra={filtersActive ? 'recorte aplicado' : null}
          >
            <ModulePagination
              pageNumber={currentPage + 1}
              previousDisabled={currentPage === 0}
              nextDisabled={!hasMore}
              onPrevious={() => setPage((current) => Math.max(0, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          </WorklistFooter>
        </>
      ) : null}
    </ModulePage>
  );
}

function TaxAssessmentDetail({ assessmentId }: { assessmentId: string }) {
  const navigate = useNavigate();
  const [taxCalculationId, setTaxCalculationId] = useState('');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [costCenterCode, setCostCenterCode] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const loader = useCallback(
    (signal?: AbortSignal) => getTaxAssessment(assessmentId, signal),
    [assessmentId],
  );
  const { state, reload, setReady } = useBackofficeQuery<TaxAssessment>({
    loader,
    mapError: mapFiscalErrorToMessage,
    enabled: true,
    autoLoad: true,
  });
  const gate = renderQueryGate(
    'Obrigação tributária',
    'Carregando obrigação…',
    'Você não tem permissão para ver obrigações tributárias.',
    state,
    () => void reload(),
  );

  /**
   * AÇÃO PRIMÁRIA da obrigação = o passo que o estado persistido admite AGORA. Ela deixa de
   * existir apenas dentro do formulário correspondente: o cabeçalho declara qual é, para o
   * operador não precisar varrer a tela procurando o próximo passo. Nenhuma transição é criada
   * aqui — o rótulo e o passo vêm do mesmo `NEXT_ACTION_FOR` que a linha da lista exibe.
   */
  const primaryStep = state.phase === 'ready' ? NEXT_ACTION_FOR(state.data.status) : null;
  const selectors = state.phase === 'ready' ? allowedAssessmentActions(state.data.status) : null;

  return (
    <ModulePage>
      <WorklistHeader
        title="Obrigação tributária"
        context="O valor apurado vem da apuração persistida. Esta tela não calcula imposto."
        action={
          <Link
            to="/app/fiscal/assessments"
            className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800"
          >
            ← Voltar para obrigações
          </Link>
        }
        metrics={
          state.phase === 'ready' ? (
            <>
              <EnterpriseMetric label="Competência" value={state.data.periodKey} />
              <EnterpriseMetric
                label="Situação"
                value={TAX_ASSESSMENT_STATUS_LABELS[state.data.status] ?? state.data.status}
                tone={
                  state.data.status === 'CANCELLED'
                    ? 'critical'
                    : state.data.status === 'DRAFT'
                      ? 'warning'
                      : 'neutral'
                }
              />
              <EnterpriseMetric
                label="Valor apurado"
                value={<Money value={state.data.assessedAmount} currencyCode={state.data.currencyCode} />}
              />
              <EnterpriseMetric label="Versão" value={state.data.rowVersion} />
            </>
          ) : null
        }
      />
      {gate}
      {state.phase === 'ready' ? (
        <>
          {/* ESTADO DA OBRIGAÇÃO — faixa densa, não cartão `rounded-xl p-6 shadow-sm`. */}
          <section
            className="mb-2 rounded-md border border-gray-200 bg-white"
            aria-label="Estado da obrigação tributária"
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2">
              <StatusBadge
                tone={
                  state.data.status === 'CANCELLED'
                    ? 'error'
                    : state.data.status === 'DRAFT'
                      ? 'warning'
                      : 'success'
                }
                label={TAX_ASSESSMENT_STATUS_LABELS[state.data.status] ?? state.data.status}
              />
              <span className="text-[13px] font-semibold text-gray-900">
                {state.data.periodKey}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-x-4 text-xs text-gray-600 tabular-nums">
                <span>
                  Valor apurado{' '}
                  <strong>
                    {state.data.currencyCode} {state.data.assessedAmount}
                  </strong>
                </span>
                <span>
                  Pagável{' '}
                  <span className="font-mono">{state.data.obligation?.payableId ?? '—'}</span>
                </span>
                <span>
                  Versão <strong>{state.data.rowVersion}</strong>
                </span>
              </span>
            </div>
            {primaryStep ? (
              <div className="border-t border-gray-100 px-3 py-1.5">
                <span className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                  Próxima ação
                </span>{' '}
                <span className="text-[12px] font-medium text-gray-800">{primaryStep}</span>
              </div>
            ) : null}
          </section>

          {/*
            AÇÕES DO CICLO — finalizar, ajustar e cancelar eram três `CreateRecordForm` espalhados
            que faziam a tela parecer formulário gigante. Continuam sendo exatamente as mesmas
            chamadas, com os mesmos campos, idempotência e tratamento de erro, agora declaradas
            como AÇÕES do registro.
          */}
          <section
            className="mb-2 rounded-md border border-gray-200 bg-white"
            aria-label="Ações da obrigação tributária"
          >
            <div className="border-b border-gray-200 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-gray-900">Ações da obrigação</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Finalizar gera o título a pagar no backend; ajustar cria sucessor em rascunho e
                cancelar exige justificativa. O tributo é calculado pelo servidor.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 px-3 py-2 lg:grid-cols-2">
              {selectors?.finalize ? (
              <CreateRecordForm
                title="Finalizar"
                description="Gera o título a pagar no backend. Finalize é passo separado do ajuste."
                submitLabel="Finalizar"
                mapError={mapFiscalErrorToMessage}
                onSubmit={async () => {
                  setReady(
                    await finalizeTaxAssessment(state.data.id, {
                      counterpartyId: counterpartyId.trim(),
                      expenseCategoryId: expenseCategoryId.trim(),
                      costCenterId: costCenterId.trim(),
                      costCenterCode: costCenterCode.trim(),
                      dueDate: dueDate.trim(),
                      paymentTerms: paymentTerms.trim(),
                    }),
                  );
                }}
              >
                <Field label="Contraparte" htmlFor="finalize-counterparty" required>
                  <Input id="finalize-counterparty" value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)} required />
                </Field>
                <Field label="Categoria" htmlFor="finalize-category" required>
                  <Input id="finalize-category" value={expenseCategoryId} onChange={(event) => setExpenseCategoryId(event.target.value)} required />
                </Field>
                <Field label="Centro de custo (id)" htmlFor="finalize-cc-id" required>
                  <Input id="finalize-cc-id" value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)} required />
                </Field>
                <Field label="Centro de custo (código)" htmlFor="finalize-cc-code" required>
                  <Input id="finalize-cc-code" value={costCenterCode} onChange={(event) => setCostCenterCode(event.target.value)} required />
                </Field>
                <Field label="Vencimento" htmlFor="finalize-due" required>
                  <Input id="finalize-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
                </Field>
                <Field label="Condição" htmlFor="finalize-terms" required>
                  <Input id="finalize-terms" value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} required />
                </Field>
              </CreateRecordForm>
              ) : null}
              {selectors?.cancel ? (
              <VersionedActionForm
                title="Cancelar"
                description="Cancelamento exige justificativa."
                confirmTitle="Cancelar obrigação"
                confirmDescription="O servidor recusa cancelamento indevido."
                confirmLabel="Cancelar"
                variant="danger"
                reasonLabel="Motivo"
                mapError={mapFiscalErrorToMessage}
                onReload={() => void reload()}
                onSubmit={async ({ reason }) =>
                  setReady(await cancelTaxAssessment(state.data.id, { reason: reason ?? '' }))
                }
              />
              ) : null}
              {selectors?.adjust ? (
              <CreateRecordForm
                title="Ajustar"
                description="O ajuste cria sucessor em rascunho. Finalize é um passo separado do checker."
                submitLabel="Ajustar"
                mapError={mapFiscalErrorToMessage}
                onSubmit={async (idempotencyKey) => {
                  const next = await adjustTaxAssessment(state.data.id, {
                    taxCalculationId: taxCalculationId.trim() || state.data.taxCalculationId,
                    idempotencyKey,
                    reason: 'ajuste',
                    counterpartyId: counterpartyId.trim(),
                    expenseCategoryId: expenseCategoryId.trim(),
                    costCenterId: costCenterId.trim(),
                    costCenterCode: costCenterCode.trim(),
                    dueDate: dueDate.trim(),
                    paymentTerms: paymentTerms.trim(),
                  });
                  void navigate(`/app/fiscal/assessments/${next.id}`);
                }}
              >
                <Field label="Nova apuração (opcional)" htmlFor="adjust-calc" className="md:col-span-2">
                  <Input id="adjust-calc" value={taxCalculationId} onChange={(event) => setTaxCalculationId(event.target.value)} />
                </Field>
              </CreateRecordForm>
              ) : null}
            </div>
            {selectors && !selectors.finalize ? (
              <p className="border-t border-gray-200 px-3 py-2 text-xs text-gray-500">
                A obrigação não está em rascunho: o servidor não aceita a finalização a partir da
                situação atual. Ajustar cria o sucessor e o título é gerado na finalização dele.
              </p>
            ) : null}
          </section>

          {/*
            CRIAR OUTRA OBRIGAÇÃO — ação de ENTRADA em nova obrigação, não conteúdo desta.
            Por isso fica depois das ações do registro corrente, e não antes do gate: a tela deixa
            de abrir com um formulário quando o operador ainda nem viu o registro.
          */}
          <section
            className="mb-3 rounded-md border border-gray-200 bg-white"
            aria-label="Criar obrigação a partir da apuração"
          >
            <div className="border-b border-gray-200 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-gray-900">
                Criar obrigação a partir da apuração
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                A obrigação nasce de uma apuração já persistida no servidor.
              </p>
            </div>
            <div className="px-3 py-2">
              <CreateRecordForm
                title="Apuracão de origem"
                description="Informe a apuração já calculada pelo servidor."
                submitLabel="Criar obrigação"
                mapError={mapFiscalErrorToMessage}
                onSubmit={async (idempotencyKey) => {
                  const created = await createTaxAssessment({
                    taxCalculationId: taxCalculationId.trim(),
                    idempotencyKey,
                  });
                  void navigate(`/app/fiscal/assessments/${created.id}`);
                }}
              >
                <Field label="Apuração" htmlFor="assessment-calc" required className="md:col-span-2">
                  <Input
                    id="assessment-calc"
                    value={taxCalculationId}
                    onChange={(event) => setTaxCalculationId(event.target.value)}
                    required
                  />
                </Field>
              </CreateRecordForm>
            </div>
          </section>
        </>
      ) : null}
    </ModulePage>
  );
}
