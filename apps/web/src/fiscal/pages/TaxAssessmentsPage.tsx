import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState, Field, Input, Money, worklistTableCardClass } from '../../ui';
import { FilterCard, ModuleErrorState, ModuleLoadingState, ModulePage, ModulePageHeader, ModulePagination, ModuleTableLink, UnitScopeLabel, filterControlClass, filterLabelClass } from '../../ui/module-layout';
import { worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass } from '../../ui/enterprise-list';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { TAX_ASSESSMENT_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
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
  const { units, unitId, setUnitId } = useFiscalUnits();
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

  return (
    <ModulePage>
      <ModulePageHeader
        title="Obrigações tributárias"
        description="O valor apurado vem da apuração persistida. Esta tela não calcula imposto."
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <label className={filterLabelClass} htmlFor="assessment-unit-filter">
              Unidade
            </label>
            <select
              id="assessment-unit-filter"
              className={filterControlClass}
              value={unitId}
              onChange={(event) => {
                setUnitId(event.target.value);
                setPage(0);
              }}
            >
              {units.length === 0 ? <option value="">Nenhuma unidade disponível</option> : null}

              {units.map((unit, index) => (

                <option key={unit} value={unit}>

                  Unidade {index + 1}

                </option>

              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="assessment-period-filter">
              Competência
            </label>
            <input
              id="assessment-period-filter"
              type="search"
              placeholder="AAAA-MM"
              className={filterControlClass}
              value={periodKey}
              onChange={(event) => {
                setPeriodKey(event.target.value.trim());
                setPage(0);
              }}
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="assessment-status-filter">
              Situação
            </label>
            <select
              id="assessment-status-filter"
              className={filterControlClass}
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
          </div>
        </div>
      </FilterCard>

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

      {state.phase === 'ready' && state.items.length === 0 ? (
        <EmptyState
          title="Nenhuma apuração"
          description="Não há apurações para a unidade, competência e situação selecionadas."
        />
      ) : null}

      {state.phase === 'ready' && state.items.length > 0 ? (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Lista de obrigações tributárias">
              <thead className={worklistHeadCellClass}>
                <tr>
                  <th scope="col" className={worklistHeadCellClass}>
                    Competência
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Componente
                  </th>
                  <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                    Valor apurado
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Obrigação
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Unidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((item) => (
                  <tr key={item.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      <ModuleTableLink to={`/app/fiscal/assessments/${item.id}`}>{item.periodKey}</ModuleTableLink>
                    </td>
                    <td className={worklistCellClass}>{item.taxComponent}</td>
                    <td className={`${worklistCellClass} text-right`}>
                      <Money value={item.assessedAmount} currencyCode={item.currencyCode} />
                    </td>
                    <td className={worklistCellClass}>
                      <FinanceStatusBadge status={item.status} labels={TAX_ASSESSMENT_STATUS_LABELS} />
                    </td>
                    <td className={worklistCellClass}>
                      {item.obligation ? `${item.obligation.status} · ${item.obligation.amount}` : '—'}
                    </td>
                    <td className={worklistCellClass}><UnitScopeLabel unitId={item.unitId} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ModulePagination
            pageNumber={state.page + 1}
            previousDisabled={state.page === 0}
            nextDisabled={!hasMore}
            onPrevious={() => setPage((current) => Math.max(0, current - 1))}
            onNext={() => setPage((current) => current + 1)}
          />
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

  return (
    <ModulePage>
      <ModulePageHeader
        title="Obrigação tributária"
        description="O valor apurado vem da apuração persistida. Esta tela não calcula imposto."
      />
      <p className="mb-6">
        <Link to="/app/fiscal/assessments" className="text-sm font-medium text-brand-600 no-underline">
          ← Voltar para a lista
        </Link>
      </p>

      <CreateRecordForm
        title="Criar obrigação a partir da apuração"
        description="A obrigação nasce de uma apuração já persistida no servidor."
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

      {gate}
      {state.phase === 'ready' ? (
        <>
          <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
            <DefinitionList
              items={[
                {
                  label: 'Status',
                  value: (
                    <FinanceStatusBadge status={state.data.status} labels={TAX_ASSESSMENT_STATUS_LABELS} />
                  ),
                },
                {
                  label: 'Valor apurado',
                  value: <Money value={state.data.assessedAmount} currencyCode={state.data.currencyCode} emphasis />,
                },
                { label: 'Competência', value: state.data.periodKey },
                { label: 'Pagável', value: state.data.obligation?.payableId ?? '—' },
                { label: 'Versão', value: String(state.data.rowVersion) },
              ]}
            />
          </div>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
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
          </div>
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
        </>
      ) : null}
    </ModulePage>
  );
}
