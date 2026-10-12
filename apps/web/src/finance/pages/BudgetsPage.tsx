import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, DateTime, EmptyState, Field, Input, Money, Select } from '../../ui';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import { WorklistFooter, WorklistHeader } from '../../ui/enterprise-list';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { DynamicForm, DynamicList, useEntitySchema } from '../../engine';
import { DynamicSubform } from '../../engine/DynamicSubform';
import {
  addBudgetLine,
  addBudgetPeriod,
  approveBudget,
  compareBudget,
  createBudget,
  createBudgetVersion,
  getBudget,
  listBudgets,
} from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { BUDGET_STATUS_LABELS } from '../../financial-ui/labels';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { budgetFormValues, budgetLineRows, budgetLineSchema } from '../utils/finance-engine-rows';
import type { BudgetComparison, BudgetDetail } from '../types/finance.types';
import type { BudgetSummary } from '../api/finance-api';

const BUDGET_LIST_PAGE_SIZE = 25;

function budgetSummaryRow(item: BudgetSummary): Record<string, unknown> & { id: string } {
  return {
    id: item.id,
    unit_id: item.unitId,
    code: item.code,
    name: item.name,
    currency_code: item.currencyCode,
    status: item.status,
    row_version: item.rowVersion,
    updated_at: item.updatedAt,
  };
}

function BudgetListWorkspace() {
  const navigate = useNavigate();
  const { schema } = useEntitySchema('budgets');
  const [pageNumber, setPageNumber] = useState(1);
  const [status, setStatus] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const offset = (pageNumber - 1) * BUDGET_LIST_PAGE_SIZE;
  const loader = useCallback(
    (signal?: AbortSignal) =>
      listBudgets(
        {
          limit: BUDGET_LIST_PAGE_SIZE,
          offset,
          status: status || undefined,
          q: search || undefined,
        },
        signal,
      ),
    [offset, search, status],
  );
  const { state, reload, refreshing } = useBackofficeQuery({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const gate = renderQueryGate(
    'Orçamentos',
    'Carregando orçamentos…',
    'Você não tem permissão para listar orçamentos.',
    state,
    () => void reload(),
  );
  if (gate) return gate;
  if (state.phase !== 'ready') return null;

  const page = state.data;
  const pageCount = Math.max(1, page.totalPages);
  const safePage = Math.min(pageNumber, pageCount);
  const rows = page.items.map(budgetSummaryRow);

  return (
    <>
      <WorklistHeader
        title={schema?.label ?? 'Orçamentos'}
        count={page.total}
        context="Carteira orçamentária versionada: código, unidade, moeda e estado vêm do servidor. Abra o registro para linhas, períodos, aprovação e comparação com realizado."
      />

      <div className="mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <Field label="Buscar" htmlFor="budget-list-search">
          <Input
            id="budget-list-search"
            value={searchDraft}
            placeholder="Código ou nome"
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setPageNumber(1);
                setSearch(searchDraft.trim());
              }
            }}
          />
        </Field>
        <Field label="Situação" htmlFor="budget-list-status">
          <Select
            id="budget-list-status"
            value={status}
            onChange={(event) => {
              setPageNumber(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">Todas</option>
            {Object.entries(BUDGET_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button
            type="button"
            onClick={() => {
              setPageNumber(1);
              setSearch(searchDraft.trim());
            }}
          >
            Aplicar
          </Button>
          {(search || status) ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSearchDraft('');
                setSearch('');
                setStatus('');
                setPageNumber(1);
              }}
            >
              Limpar
            </Button>
          ) : null}
        </div>
      </div>

      <DynamicList
        schema={schema}
        rows={rows}
        emptyMessage="Nenhum orçamento corresponde ao recorte atual."
        onRowClick={(row) => void navigate(`/app/finance/budgets/${row.id}`)}
        renderCell={(field, row) => {
          if (field.name === 'status') {
            return <FinanceStatusBadge status={String(row.status)} labels={BUDGET_STATUS_LABELS} />;
          }
          if (field.name === 'updated_at') {
            return <DateTime value={String(row.updated_at)} />;
          }
          return undefined;
        }}
      />

      <WorklistFooter
        rangeLabel={`Página ${safePage} de ${pageCount} · ${page.total} orçamento(s)${refreshing ? ' · atualizando…' : ''}`}
      >
        <ModulePagination
          pageNumber={safePage}
          previousDisabled={safePage <= 1}
          nextDisabled={safePage >= pageCount}
          onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
          onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
        />
      </WorklistFooter>
    </>
  );
}

/**
 * DETALHE DO ORÇAMENTO — dirigido por metadados.
 *
 * O bloco de identificação/vigência/controle deixou de ser uma `DefinitionList` artesanal: é o
 * `DynamicForm` do schema `budgets`, com `status` resolvido pelo metadado em vez de
 * `BUDGET_STATUS_LABELS` em TypeScript. As LINHAS viraram um `DynamicSubform` — o mesmo padrão
 * One2Many inline do Odoo, onde a coleção filha é uma tabela dentro do form do pai.
 *
 * PARIDADE COM A VERSÃO ARTESANAL (cada feature do arquivo antigo → onde vive agora):
 *   - DefinitionList código/nome/status/versão/moeda → `DynamicForm` (schema `budgets`);
 *   - tabela artesanal Competência/Dimensão/Valor     → `DynamicSubform`, com rodapé totalizado
 *                                                        por `aggregation` declarada;
 *   - formulário "Adicionar período"                  → PRESERVADO;
 *   - formulário "Adicionar linha"                    → PRESERVADO;
 *   - ações Aprovar / Nova versão / Comparar          → PRESERVADAS (`VersionedActionForm`);
 *   - painel orçado × realizado × variância           → PRESERVADO;
 *   - link de volta à lista                           → PRESERVADO;
 *   - estados loading/erro/negação                    → `renderQueryGate`, PRESERVADO.
 *
 * PARIDADE_PERDIDA: nenhuma.
 *
 * O SUBFORMULÁRIO É SOMENTE LEITURA, e isso é paridade, não perda: a API de orçamento não publica
 * PATCH por linha — `addBudgetLine` é um comando que exige `periodId`. Um grid editável aqui
 * prometeria gravação que não existe. Ver `budgetLineSchema()`.
 */
export function BudgetsPage() {
  const { budgetId } = useParams();
  const navigate = useNavigate();
  const [unitId, setUnitId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [currencyCode, setCurrencyCode] = useState('BRL');

  const { schema } = useEntitySchema('budgets');

  const loader = useCallback((signal?: AbortSignal) => getBudget(budgetId ?? '', signal), [budgetId]);
  const { state, reload, setReady } = useBackofficeQuery<BudgetDetail>({
    loader,
    mapError: mapFinanceErrorToMessage,
    enabled: Boolean(budgetId),
    autoLoad: Boolean(budgetId),
  });

  const gate = budgetId
    ? renderQueryGate(
        'Orçamentos',
        'Carregando orçamento…',
        'Você não tem permissão para ver orçamentos.',
        state,
        () => void reload(),
      )
    : null;

  return (
    <ModulePage>
      {!budgetId ? (
        <BudgetListWorkspace />
      ) : (
        <>
          <header className="mb-4">
            <h1 className="text-xl font-semibold" data-testid="entity-title">
              {schema?.label ?? 'Orçamentos'}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Versões, linhas e aprovação são persistidas pelo servidor. Variância não é calculada no
              navegador.
            </p>
          </header>
          <p className="mb-4 text-sm text-gray-500">
            <Link className="font-semibold text-gray-700 hover:text-gray-900" to="/app/finance/budgets">
              Voltar para a lista de orçamentos
            </Link>
          </p>
        </>
      )}

      <CreateRecordForm
        title="Criar orçamento"
        description="O código e a moeda são validados pela API."
        submitLabel="Criar orçamento"
        mapError={mapFinanceErrorToMessage}
        onSubmit={async () => {
          const created = await createBudget({
            unitId: unitId.trim(),
            code: code.trim(),
            name: name.trim(),
            currencyCode: currencyCode.trim() || 'BRL',
          });
          void navigate(`/app/finance/budgets/${created.id}`);
        }}
      >
        <Field label="Unidade" htmlFor="budget-unit" required>
          <Input id="budget-unit" value={unitId} onChange={(event) => setUnitId(event.target.value)} required />
        </Field>
        <Field label="Código" htmlFor="budget-code" required>
          <Input id="budget-code" value={code} onChange={(event) => setCode(event.target.value)} required />
        </Field>
        <Field label="Nome" htmlFor="budget-name" required>
          <Input id="budget-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Moeda" htmlFor="budget-currency" required>
          <Input
            id="budget-currency"
            value={currencyCode}
            onChange={(event) => setCurrencyCode(event.target.value)}
            required
          />
        </Field>
      </CreateRecordForm>

      {gate}
      {state.phase === 'ready' ? (
        <BudgetView budget={state.data} onReload={reload} onReady={setReady} />
      ) : null}
    </ModulePage>
  );
}

function BudgetView({
  budget,
  onReload,
  onReady,
}: {
  budget: BudgetDetail;
  onReload: () => Promise<void>;
  onReady: (next: BudgetDetail) => void;
}) {
  const [periodKey, setPeriodKey] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [lineAmount, setLineAmount] = useState('');
  const [costCenterCode, setCostCenterCode] = useState('');
  const [comparison, setComparison] = useState<BudgetComparison | null>(null);

  const { schema } = useEntitySchema('budgets');
  const draft = budget.versions.find((version) => version.status === 'DRAFT') ?? budget.versions.at(-1);
  const rows = budgetLineRows(budget);
  const values = budgetFormValues(budget);
  const lineSchema = budgetLineSchema();

  return (
    <>
      {schema ? (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          {/* SOMENTE LEITURA: o detalhe exibe o registro; quem grava são os comandos do servidor. */}
          <DynamicForm schema={schema} values={values} readOnly />
        </div>
      ) : (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              { label: 'Código', value: budget.code },
              { label: 'Nome', value: budget.name },
              { label: 'Status', value: budget.status },
              { label: 'Versão do registro', value: String(budget.rowVersion) },
              { label: 'Moeda', value: budget.currencyCode },
            ]}
          />
        </div>
      )}

      <CreateRecordForm
        title="Adicionar período"
        description="A chave do período segue o formato exigido pelo servidor."
        submitLabel="Incluir período"
        mapError={mapFinanceErrorToMessage}
        onSubmit={async () => {
          onReady(await addBudgetPeriod(budget.id, { periodKey: periodKey.trim(), startsOn, endsOn }));
        }}
      >
        <Field label="Competência (AAAA-MM)" htmlFor="budget-period-key" required>
          <Input id="budget-period-key" value={periodKey} onChange={(event) => setPeriodKey(event.target.value)} required />
        </Field>
        <Field label="Início" htmlFor="budget-starts" required>
          <Input id="budget-starts" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required />
        </Field>
        <Field label="Fim" htmlFor="budget-ends" required>
          <Input id="budget-ends" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} required />
        </Field>
      </CreateRecordForm>

      <CreateRecordForm
        title="Adicionar linha"
        description="Informe pelo menos uma dimensão. O valor não é totalizado no navegador."
        submitLabel="Incluir linha"
        mapError={mapFinanceErrorToMessage}
        onSubmit={async () => {
          onReady(
            await addBudgetLine(budget.id, {
              periodId: periodId.trim(),
              amount: lineAmount.trim(),
              costCenterCode: costCenterCode.trim() || null,
            }),
          );
        }}
      >
        <Field label="Período (id)" htmlFor="budget-line-period" required>
          <Input id="budget-line-period" value={periodId} onChange={(event) => setPeriodId(event.target.value)} required />
        </Field>
        <Field label="Valor" htmlFor="budget-line-amount" required>
          <Input id="budget-line-amount" inputMode="decimal" value={lineAmount} onChange={(event) => setLineAmount(event.target.value)} required />
        </Field>
        <Field label="Centro de custo" htmlFor="budget-line-cc">
          <Input id="budget-line-cc" value={costCenterCode} onChange={(event) => setCostCenterCode(event.target.value)} />
        </Field>
      </CreateRecordForm>

      {rows.length === 0 ? (
        <EmptyState
          title="Sem linhas nesta versão"
          description="Inclua períodos e linhas para o rascunho atual."
        />
      ) : (
        <div className="mb-6">
          <DynamicSubform schema={lineSchema} rows={rows} onChange={() => undefined} readOnly />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <VersionedActionForm
          title="Aprovar"
          description="Aprovação exige checker distinto no backend e a versão carregada aqui."
          confirmTitle="Aprovar orçamento"
          confirmDescription="O servidor recusa rascunho incompleto, autoaprovação e versão desatualizada."
          confirmLabel="Aprovar"
          mapError={mapFinanceErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            // A versao vai no corpo: aprovacao sem versao e recusada pelo servidor, e uma
            // versao desatualizada vira conflito em vez de aprovar estado velho.
            onReady(await approveBudget(budget.id, { version: draft?.versionNumber ?? 0 }));
          }}
        />
        <VersionedActionForm
          title="Nova versão"
          description="Cria rascunho a partir da versão aprovada."
          confirmTitle="Criar versão"
          confirmDescription="Somente o backend decide se uma nova versão pode ser aberta."
          confirmLabel="Criar versão"
          mapError={mapFinanceErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            onReady(await createBudgetVersion(budget.id));
          }}
        />
        <VersionedActionForm
          title="Comparar realizado"
          description="Orçado × realizado vêm do servidor."
          confirmTitle="Consultar comparação"
          confirmDescription="Nenhum saldo é calculado neste formulário."
          confirmLabel="Comparar"
          mapError={mapFinanceErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            setComparison(await compareBudget(budget.id));
          }}
        />
      </div>

      {comparison ? (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              { label: 'Orçado', value: <Money value={comparison.budgeted} currencyCode={comparison.currencyCode} /> },
              { label: 'Realizado', value: <Money value={comparison.actual} currencyCode={comparison.currencyCode} /> },
              { label: 'Variância', value: <Money value={comparison.variance} currencyCode={comparison.currencyCode} emphasis /> },
            ]}
          />
        </div>
      ) : null}
    </>
  );
}
