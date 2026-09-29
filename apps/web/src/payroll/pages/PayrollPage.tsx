import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, EmptyState, ErrorState, Field, Input, Money, Select } from '../../ui';
import {
  FilterCard,
  ModulePage,
  ModulePageHeader,
  ModuleTableCard,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { PAYROLL_PERIOD_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { BackofficeCapabilityRoute } from '../../financial-ui/BackofficeCapabilityRoute';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { isIdempotentAck } from '../utils/is-idempotent-ack';
import { periodActionsForStatus } from '../utils/period-action-state';
import {
  formatPayrollCompetence,
  knownEmploymentContractLabel,
  searchEmploymentContractOptions,
  searchPayrollPeriodOptions,
  usePayrollDirectoryVersion,
} from '../utils/payroll-directory';
import {
  calculatePayrollPeriod,
  closePayrollPeriod,
  createEmploymentContract,
  getPayrollPeriod,
  listPayrollResults,
  mapPayrollErrorToMessage,
  openPayrollPeriod,
  probePayrollReadAccess,
  recordPayrollEvent,
  reopenPayrollPeriod,
  type PayrollPeriod,
  type PayrollResult,
} from '../api/payroll-api';

const CALCULATE_DESCRIPTION =
  'O cálculo usa eventos persistidos. Fórmulas oficiais permanecem UNDECIDED.';
const CLOSE_DESCRIPTION = 'Fechamento exige checker distinto.';
const REOPEN_DESCRIPTION = 'Reabertura segue SOD no backend.';

/**
 * DIRETÓRIO DA API (fato registrado, não decisão de engenharia): a API de folha deste release só
 * endereça período por `GET /api/v1/payroll/periods/:periodId` (UUID) e cria contrato por
 * `POST /api/v1/payroll/contracts`. Não existe `GET /payroll/periods?unitId=` nem
 * `GET /payroll/contracts`, e nenhum endpoint de folha devolve código/nome do contrato dentro do
 * resultado calculado. Por isso a descoberta humana oferecida aqui é a que a API permite hoje:
 * unidade escolhida de uma lista real e período/contrato buscados entre os que já foram devolvidos
 * pelo servidor nesta sessão — nunca por identificador digitado.
 */

export function PayrollRoute({ children }: { children: ReactNode }) {
  return (
    <BackofficeCapabilityRoute probe={probePayrollReadAccess} capabilityId="payroll:period:read">
      {children}
    </BackofficeCapabilityRoute>
  );
}

export function PayrollPage() {
  const { periodId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const unitFromQuery = searchParams.get('unitId') ?? '';
  // A unidade é escolha humana: a mesma lista de unidades operacionais do usuário usada por
  // fiscal e contabilidade, em vez de um campo livre com identificador.
  const { units, unitId: defaultUnitId } = useOperationalUnits();
  const directoryVersion = usePayrollDirectoryVersion();
  const [unitId, setUnitId] = useState(unitFromQuery);
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [contractId, setContractId] = useState('');
  const [eventKind, setEventKind] = useState('EARNING');
  const [amount, setAmount] = useState('');
  const [componentLabel, setComponentLabel] = useState('');
  const [description, setDescription] = useState('');
  const [contractNotice, setContractNotice] = useState<string | null>(null);
  const [eventIdempotentNotice, setEventIdempotentNotice] = useState(false);

  // Link profundo sem unidade não obriga o operador a digitar nada: a primeira unidade visível
  // para ele é selecionada, como já acontece nas listas de fiscal e contabilidade.
  useEffect(() => {
    if (!unitId && defaultUnitId) {
      setUnitId(defaultUnitId);
    }
  }, [defaultUnitId, unitId]);

  const loader = useCallback(
    (signal?: AbortSignal) => getPayrollPeriod(periodId ?? '', unitId, signal),
    [periodId, unitId],
  );
  const { state, reload, setReady } = useBackofficeQuery<PayrollPeriod>({
    loader,
    mapError: mapPayrollErrorToMessage,
    enabled: Boolean(periodId && unitId),
    autoLoad: Boolean(periodId && unitId),
  });
  const resultsLoader = useCallback(
    (signal?: AbortSignal) => listPayrollResults(periodId ?? '', unitId, signal),
    [periodId, unitId],
  );
  const results = useBackofficeQuery<PayrollResult[]>({
    loader: resultsLoader,
    mapError: mapPayrollErrorToMessage,
    enabled: Boolean(periodId && unitId && state.phase === 'ready'),
    autoLoad: Boolean(periodId && unitId && state.phase === 'ready'),
  });
  /*
   * Escolher outro período na busca humana (ou trocar a unidade) muda a chave do que está na tela
   * SEM remontar a página. O hook compartilhado carrega uma vez por `enabled`, então sem este
   * efeito o operador veria dados do período/unidade anterior até recarregar a página. Aqui a troca
   * de chave recarrega o período e, em seguida, os resultados.
   */
  const loadKey = periodId && unitId ? `${unitId}::${periodId}` : '';
  const loadedKeyRef = useRef('');
  const resultsReloadRef = useRef<() => Promise<void>>(async () => undefined);
  resultsReloadRef.current = () => results.reload();

  useEffect(() => {
    if (!loadKey) {
      loadedKeyRef.current = '';
      return;
    }
    if (loadedKeyRef.current === loadKey) {
      return;
    }
    const isFirstLoad = loadedKeyRef.current === '';
    loadedKeyRef.current = loadKey;
    if (isFirstLoad) {
      // A primeira carga é do carregamento automático do hook, que já enxerga `enabled`.
      return;
    }
    void reload().then(() => resultsReloadRef.current());
  }, [loadKey, reload]);
  const gate =
    periodId && unitId
      ? renderQueryGate(
          'Folha',
          'Carregando período de folha…',
          'Você não tem permissão para ver a folha.',
          state,
          () => void reload(),
        )
      : null;
  const availability = periodActionsForStatus(
    state.phase === 'ready' ? state.data.status : '',
    { hasUnitId: unitId.trim() !== '' },
  );
  const loadedPeriodLabel =
    state.phase === 'ready' ? formatPayrollCompetence(state.data) : undefined;

  function openPeriod(nextPeriodId: string): void {
    if (!nextPeriodId) {
      return;
    }
    const query = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
    void navigate(`/app/payroll/periods/${nextPeriodId}${query}`);
  }

  return (
    <ModulePage>
      <ModulePageHeader
        title="Folha"
        description="Cálculo e fechamento são do servidor. Fórmulas oficiais permanecem indecisas."
      />
      <FilterCard>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field
            label="Unidade"
            htmlFor="payroll-unit"
            required
            hint="Unidades operacionais visíveis para o seu usuário."
          >
            <Select
              id="payroll-unit"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
            >
              <option value="">Selecione a unidade</option>
              {/*
                ESCOPO, NAO SLUG: `unitId` e identificador interno e nao vai para a superficie.
                O `value` continua sendo o recorte REAL enviado a API.
              */}
              {units.map((unit, index) => (
                <option key={unit} value={unit}>
                  Unidade {index + 1}
                </option>
              ))}
              {/* Unidade vinda de link que nao esta na lista visivel: sem esta opcao o recorte
                  chegaria a API sem o operador ver qual unidade e. */}
              {unitId && !units.includes(unitId) ? (
                <option value={unitId}>Unidade selecionada</option>
              ) : null}
            </Select>
          </Field>
          <HumanLookupField
            key={`payroll-period-lookup-${directoryVersion}`}
            label="Período de folha"
            htmlFor="payroll-period-lookup"
            hint="Busque por competência (MM/AAAA), status, unidade ou vigência."
            placeholder="Competência, status ou unidade"
            search={(term) => Promise.resolve(searchPayrollPeriodOptions(term))}
            value={periodId ?? ''}
            initialLabel={loadedPeriodLabel}
            onChange={openPeriod}
            emptyOptionLabel="Selecione o período"
            emptyMessage="Nenhum período alcançado nesta sessão. Abra um período abaixo — a API ainda não lista períodos por unidade."
          />
        </div>
        <p className="mt-3 text-xs text-gray-500">
          A API de folha ainda não expõe lista de períodos por unidade nem de contratos. Esta busca
          oferece o que o servidor já devolveu nesta sessão: períodos abertos ou consultados e
          contratos cadastrados aqui. Nenhum identificador técnico é digitado.
        </p>
      </FilterCard>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <CreateRecordForm
            title="Cadastrar contrato"
            description="O contrato não cria alocação de mão de obra na OS."
            submitLabel="Criar contrato"
            mapError={mapPayrollErrorToMessage}
            onSubmit={async () => {
              setContractNotice(null);
              await createEmploymentContract({
                unitId: unitId.trim(),
                code: code.trim(),
                displayName: displayName.trim(),
                startsOn: startsOn.trim(),
                endsOn: endsOn.trim() || null,
              });
              setCode('');
              setDisplayName('');
              setStartsOn('');
              setEndsOn('');
              setContractNotice(
                'Contrato cadastrado com sucesso. O servidor devolveu o novo contrato e ele já aparece na busca de contratos ao lançar um evento.',
              );
            }}
          >
            <Field label="Código" htmlFor="contract-code" required>
              <Input id="contract-code" value={code} onChange={(event) => setCode(event.target.value)} required />
            </Field>
            <Field label="Nome" htmlFor="contract-name" required>
              <Input id="contract-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
            </Field>
            <Field label="Início" htmlFor="contract-start" required>
              <Input id="contract-start" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required />
            </Field>
            <Field label="Fim" htmlFor="contract-end">
              <Input id="contract-end" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
            </Field>
          </CreateRecordForm>
          {contractNotice ? (
            <Alert tone="success" role="status" title="Contrato cadastrado" className="mt-3">
              {contractNotice}
            </Alert>
          ) : null}
        </div>
        <CreateRecordForm
          title="Abrir período"
          description="Competência e datas são validadas pela API."
          submitLabel="Abrir período"
          mapError={mapPayrollErrorToMessage}
          onSubmit={async () => {
            const created = await openPayrollPeriod({
              unitId: unitId.trim(),
              competenceYear: Number(year),
              competenceMonth: Number(month),
              startsOn: startsOn.trim(),
              endsOn: endsOn.trim(),
            });
            setYear('');
            setMonth('');
            const query = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
            void navigate(`/app/payroll/periods/${created.id}${query}`);
          }}
        >
          <Field label="Ano" htmlFor="pay-year" required>
            <Input id="pay-year" inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value)} required />
          </Field>
          <Field label="Mês" htmlFor="pay-month" required>
            <Input id="pay-month" inputMode="numeric" value={month} onChange={(event) => setMonth(event.target.value)} required />
          </Field>
        </CreateRecordForm>
      </div>
      {periodId ? (
        <CreateRecordForm
          title="Lançar evento"
          description="Tipos aceitos: EARNING, DEDUCTION, EMPLOYER_CHARGE. A fórmula oficial não é inventada."
          submitLabel="Registrar evento"
          mapError={mapPayrollErrorToMessage}
          onConflictReload={() => {
            if (periodId && unitId.trim()) {
              void reload();
            }
          }}
          onSubmit={async (idempotencyKey) => {
            setEventIdempotentNotice(false);
            const recorded = await recordPayrollEvent({
              unitId: unitId.trim(),
              payrollPeriodId: (periodId ?? '').trim(),
              employmentContractId: contractId.trim(),
              eventKind,
              amount: amount.trim(),
              componentLabel: componentLabel.trim(),
              description: description.trim(),
              idempotencyKey,
            });
            if (isIdempotentAck(recorded)) {
              setEventIdempotentNotice(true);
            }
          }}
        >
          <HumanLookupField
            key={`payroll-contract-lookup-${directoryVersion}`}
            label="Contrato de trabalho"
            htmlFor="event-contract"
            required
            hint="Busque por código ou nome do contrato."
            placeholder="Código ou nome do contrato"
            search={(term) => Promise.resolve(searchEmploymentContractOptions(term))}
            value={contractId}
            onChange={setContractId}
            emptyOptionLabel="Selecione o contrato"
            emptyMessage="Nenhum contrato alcançado nesta sessão. Cadastre um contrato acima — a API ainda não lista contratos."
          />
          <Field label="Tipo" htmlFor="event-kind" required>
            <Select id="event-kind" value={eventKind} onChange={(event) => setEventKind(event.target.value)}>
              <option value="EARNING">Provento</option>
              <option value="DEDUCTION">Desconto</option>
              <option value="EMPLOYER_CHARGE">Encargo</option>
            </Select>
          </Field>
          <Field label="Valor" htmlFor="event-amount" required>
            <Input id="event-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </Field>
          <Field label="Componente" htmlFor="event-label" required>
            <Input id="event-label" value={componentLabel} onChange={(event) => setComponentLabel(event.target.value)} required />
          </Field>
          <Field label="Descrição" htmlFor="event-desc" required className="md:col-span-2">
            <Input id="event-desc" value={description} onChange={(event) => setDescription(event.target.value)} required />
          </Field>
        </CreateRecordForm>
      ) : (
        <p className="mb-6 text-sm text-gray-500">
          Escolha um período de folha na busca acima ou abra um novo período para lançar eventos. O
          vínculo do evento exige um período carregado do servidor.
        </p>
      )}
      {eventIdempotentNotice ? (
        <Alert tone="info" role="status" title="Evento já registrado anteriormente" className="mb-6">
          Este evento já havia sido registrado (resposta idempotente do servidor). Nenhuma duplicata foi criada.
        </Alert>
      ) : null}
      {gate}
      {!periodId ? (
        <EmptyState
          title="Nenhum período carregado"
          description="Escolha um período já alcançado na busca por competência ou abra um novo período para começar."
        />
      ) : null}
      {state.phase === 'ready' ? (
        <>
          <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
            <DefinitionList
              items={[
                {
                  label: 'Status',
                  value: <FinanceStatusBadge status={state.data.status} labels={PAYROLL_PERIOD_STATUS_LABELS} />,
                },
                { label: 'Competência', value: formatPayrollCompetence(state.data) },
                { label: 'Versão', value: String(state.data.rowVersion) },
              ]}
            />
          </div>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <VersionedActionForm
              title="Calcular"
              description={availability.calculate.available ? CALCULATE_DESCRIPTION : (availability.calculate.reason ?? CALCULATE_DESCRIPTION)}
              confirmTitle="Calcular folha"
              confirmDescription="O servidor calcula totais. Nada é somado neste formulário."
              confirmLabel="Calcular"
              disabled={!availability.calculate.available}
              mapError={mapPayrollErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async () => {
                await calculatePayrollPeriod(state.data.id, unitId.trim());
                await reload();
                await results.reload();
              }}
            />
            <VersionedActionForm
              title="Fechar"
              description={availability.close.available ? CLOSE_DESCRIPTION : (availability.close.reason ?? CLOSE_DESCRIPTION)}
              confirmTitle="Fechar período"
              confirmDescription="O backend recusa fechamento sem cálculo e autoaprovação."
              confirmLabel="Fechar"
              disabled={!availability.close.available}
              mapError={mapPayrollErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async () => setReady(await closePayrollPeriod(state.data.id, unitId.trim()))}
            />
            <VersionedActionForm
              title="Reabrir"
              description={availability.reopen.available ? REOPEN_DESCRIPTION : (availability.reopen.reason ?? REOPEN_DESCRIPTION)}
              confirmTitle="Reabrir período"
              confirmDescription="O servidor registra o ator da reabertura."
              confirmLabel="Reabrir"
              disabled={!availability.reopen.available}
              mapError={mapPayrollErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async () => setReady(await reopenPayrollPeriod(state.data.id, unitId.trim()))}
            />
          </div>
          {results.state.phase === 'ready' ? (
            results.state.data.length > 0 ? (
              <ModuleTableCard>
                <table className={moduleTableClass} aria-label="Resultados da folha">
                  <thead className={moduleTableHeadClass}>
                    <tr>
                      <th scope="col" className={moduleTableHeaderCellClass}>Contrato</th>
                      <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Proventos</th>
                      <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Descontos</th>
                      <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.state.data.map((row) => (
                      <tr key={row.id} className={moduleTableRowClass}>
                        {/*
                          O resultado calculado devolve apenas o identificador do contrato. Quando o
                          contrato já foi alcançado nesta sessão, mostramos código e nome; quando não,
                          o identificador continua visível porque é o único dado que a API devolveu —
                          não inventamos um rótulo para ele.
                        */}
                        <td className={moduleTableCellClass}>
                          {knownEmploymentContractLabel(row.employmentContractId) ??
                            row.employmentContractId}
                        </td>
                        <td className={`${moduleTableCellClass} text-right`}>
                          <Money value={row.earningTotal} />
                        </td>
                        <td className={`${moduleTableCellClass} text-right`}>
                          <Money value={row.deductionTotal} />
                        </td>
                        <td className={`${moduleTableCellClass} text-right`}>
                          <Money value={row.netTotal} emphasis />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ModuleTableCard>
            ) : (
              <EmptyState
                title="Sem resultados calculados"
                description="Calcule o período para o servidor devolver os totais."
              />
            )
          ) : results.state.phase === 'loading' || results.state.phase === 'idle' ? (
            <p aria-busy="true" aria-live="polite" className="mb-6 text-sm text-gray-500">
              Carregando resultados calculados…
            </p>
          ) : results.state.phase === 'denied' ? (
            <Alert tone="warning" title="Acesso negado aos resultados" className="mb-6">
              Você não tem permissão para consultar os resultados da folha.
            </Alert>
          ) : results.state.phase === 'error' ? (
            <ErrorState
              kind={results.state.kind === 'not_found' ? 'not_found' : 'generic'}
              title="Não foi possível carregar os resultados"
              message={results.state.message}
              className="mb-6"
              onRetry={results.state.retryable ? () => void results.reload() : undefined}
            />
          ) : null}
        </>
      ) : null}
    </ModulePage>
  );
}
