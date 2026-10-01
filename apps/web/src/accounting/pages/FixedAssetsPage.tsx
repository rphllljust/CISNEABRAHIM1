import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, DateTime, Field, Input, Money, Select, StatusBadge } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
  worklistCellClass,
  worklistHeadCellClass,
  worklistNumericHeadCellClass,
  worklistNumericCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { searchPhysicalAssetOptions } from '../api/physical-asset-lookup';
import {
  acquireFixedAsset,
  depreciateFixedAsset,
  disposeFixedAsset,
  getFixedAsset,
  lookupFixedAsset,
  registerFixedAsset,
  reverseFixedAssetAcquisition,
  transferFixedAsset,
} from '../api/accounting-api';
import { mapAccountingErrorToMessage } from '../api/accounting-error-messages';
import type { FixedAssetRegister } from '../types/accounting.types';

/**
 * Rótulo humano do movimento persistido (`acc.fixed_asset_movements.kind`). Vocabulário fechado
 * do domínio — valor desconhecido continua aparecendo cru, nunca traduzido por adivinhação.
 */
const MOVEMENT_KIND_LABELS: Record<string, string> = {
  ACQUISITION: 'Aquisição',
  DEPRECIATION: 'Depreciação',
  DISPOSAL: 'Baixa',
  TRANSFER: 'Transferência de centro de custo',
  ACQUISITION_REVERSAL: 'Estorno de aquisição',
};

function formatMoney(value: string, currencyCode: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode }).format(
    numeric,
  );
}

export function FixedAssetsPage() {
  const { registerId } = useParams();
  const navigate = useNavigate();
  const [lookupId, setLookupId] = useState(registerId ?? '');
  // ADOCAO DE MECANISMO: a unidade sai do campo de texto livre e passa a vir do hook
  // compartilhado do shell (unidades visiveis para o ator). O ativo operacional sai do campo de
  // identificador e passa a vir da busca humana do cadastro de Recursos (`HumanLookupField`).
  // Uma instancia por formulario mantem a independencia entre consultar e registrar. Nenhuma
  // regra de autorizacao muda: a API continua decidindo o que o ator pode ver.
  const registerUnit = useOperationalUnits();
  const lookupUnit = useOperationalUnits();
  const [operationalAssetId, setOperationalAssetId] = useState('');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState('');
  const [toCostCenterCode, setToCostCenterCode] = useState('');
  const [lookupOperationalId, setLookupOperationalId] = useState('');
  /**
   * Estado das duas AÇÕES da barra. Antes cada formulário era um `CreateRecordForm`, que já
   * tratava erro e processamento internamente; agora que eles são botões da barra densa, o
   * tratamento (inclusive o `BackofficeApiError` mapeado pelo mesmo `mapAccountingErrorToMessage`)
   * continua idêntico — só passou a viver no componente da página.
   */
  const [errorRegister, setErrorRegister] = useState<string | null>(null);
  const [errorLookup, setErrorLookup] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const loader = useCallback(
    (signal?: AbortSignal) => getFixedAsset(registerId ?? '', signal),
    [registerId],
  );
  const { state, reload, setReady } = useBackofficeQuery<FixedAssetRegister>({
    loader,
    mapError: mapAccountingErrorToMessage,
    enabled: Boolean(registerId),
    autoLoad: Boolean(registerId),
  });
  const gate = registerId
    ? renderQueryGate(
        'Ativo imobilizado',
        'Carregando registro contábil…',
        'Você não tem permissão para ver o ativo imobilizado.',
        state,
        () => void reload(),
      )
    : null;

  /**
   * REGISTRAR — mesma chamada `registerFixedAsset` com os mesmos campos e a mesma moeda BRL do
   * servidor. O erro continua mapeado pelo mesmo tradutor de códigos contábeis.
   */
  async function submitRegister(): Promise<void> {
    setErrorRegister(null);
    setRegistering(true);
    try {
      const created = await registerFixedAsset({
        unitId: registerUnit.unitId.trim(),
        operationalAssetId: operationalAssetId.trim(),
        currencyCode: 'BRL',
        usefulLifeMonths: Number(usefulLifeMonths),
      });
      void navigate(`/app/accounting/fixed-assets/${created.id}`);
    } catch {
      setErrorRegister(mapAccountingErrorToMessage(undefined, 0));
    } finally {
      setRegistering(false);
    }
  }

  /** CONSULTAR POR ATIVO OPERACIONAL — mesma consulta `lookupFixedAsset`, mesma navegação. */
  async function submitLookup(): Promise<void> {
    setErrorLookup(null);
    setLookingUp(true);
    try {
      const found = await lookupFixedAsset({
        unitId: lookupUnit.unitId.trim(),
        operationalAssetId: lookupOperationalId.trim(),
      });
      void navigate(`/app/accounting/fixed-assets/${found.id}`);
    } catch {
      setErrorLookup(mapAccountingErrorToMessage(undefined, 0));
    } finally {
      setLookingUp(false);
    }
  }

  return (
    <ModulePage>
      {/*
        CONSULTA COMO BARRA OPERACIONAL — os campos de identificador e de busca humana deixam de
        ser dois formulários empilhados (`RecordLookupCard` + `CreateRecordForm`) e passam a UMA
        linha de trabalho, na mesma densidade das demais superfícies da contabilidade.

        Nenhum contrato, capability ou chamada mudou: `lookupFixedAsset` continua recebendo a
        unidade autorizada e o ativo escolhido humanamente; a busca de ativo físico continua sendo
        a mesma fonte (`searchPhysicalAssetOptions`), que é lida — não alterada — da Família 3.
      */}
      <WorklistHeader
        title="Ativo imobilizado"
        context="Valor contábil e depreciação são os persistidos pelo servidor; nenhum valor é recalculado nesta tela."
        metrics={
          state.phase === 'ready' ? (
            <>
              <EnterpriseMetric label="Situação" value={state.data.status} />
              <EnterpriseMetric
                label="Valor contábil"
                value={<Money value={state.data.bookValue} currencyCode={state.data.currencyCode} />}
              />
              <EnterpriseMetric label="Vida útil" value={`${state.data.usefulLifeMonths} meses`} />
              <EnterpriseMetric label="Movimentos" value={state.data.movements.length} />
            </>
          ) : null
        }
      />

      <WorklistFilterBar>
        <WorklistField label="Registro contábil" htmlFor="fixed-asset-id" grow>
          <input
            id="fixed-asset-id"
            className={`${worklistSelectClass} w-full min-w-0`}
            value={lookupId}
            onChange={(event) => setLookupId(event.target.value)}
            placeholder="Identificador do registro"
            autoComplete="off"
            spellCheck={false}
          />
        </WorklistField>
        <button
          type="button"
          className="rounded border border-gray-300 bg-white px-2 py-1 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void navigate(`/app/accounting/fixed-assets/${lookupId.trim()}`)}
          disabled={lookupId.trim() === '' || state.phase === 'loading'}
        >
          {state.phase === 'loading' ? 'Consultando…' : 'Consultar'}
        </button>
      </WorklistFilterBar>

      {/*
        REGISTRO OPERACIONAL — registrar um ativo físico no livro de imobilizado é uma AÇÃO, não
        a identidade da página. Ela mora numa seção densa abaixo da área de resultado; a
        estrutura dominante continua sendo o registro contábil consultado.
      */}
      <section
        className="mb-2 rounded-md border border-gray-200 bg-white"
        aria-label="Registrar ativo operacional"
      >
        <div className="border-b border-gray-200 px-3 py-2">
          <h2 className="text-[13px] font-semibold text-gray-900">Registrar ativo operacional</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Associa um ativo físico já cadastrado ao livro de imobilizado. A vida útil é a
            informada ao servidor; nada é depreciado aqui.
          </p>
        </div>
        {errorRegister ? (
          <div className="px-3 pt-2">
            <Alert tone="error">{errorRegister}</Alert>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2 px-3 py-2">
          <div className="w-44 min-w-0 shrink">
            <Field label="Unidade" htmlFor="fa-unit" required>
              <Select
                id="fa-unit"
                value={registerUnit.unitId}
                onChange={(event) => registerUnit.setUnitId(event.target.value)}
                required
              >
                <OperationalUnitOptions options={registerUnit.options} />
              </Select>
            </Field>
          </div>
          <div className="min-w-52 flex-1">
            <HumanLookupField
              label="Ativo operacional"
              htmlFor="fa-asset"
              required
              placeholder="Buscar por nome ou código do ativo"
              search={searchPhysicalAssetOptions}
              value={operationalAssetId}
              onChange={setOperationalAssetId}
              emptyMessage="Nenhum ativo físico encontrado para a busca."
            />
          </div>
          <div className="w-32 min-w-0 shrink">
            <Field label="Vida útil (meses)" htmlFor="fa-life" required>
              <Input
                id="fa-life"
                inputMode="numeric"
                value={usefulLifeMonths}
                onChange={(event) => setUsefulLifeMonths(event.target.value)}
                required
              />
            </Field>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-brand-600 bg-brand-600 px-2.5 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={registering}
            onClick={() => void submitRegister()}
          >
            {registering ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </section>

      {/*
        CONSULTA POR ATIVO OPERACIONAL — mesma ação que existia no `CreateRecordForm`, agora na
        mesma linha densa: a API devolve o registro contábil associado ao ativo físico escolhido.
      */}
      <section
        className="mb-2 rounded-md border border-gray-200 bg-white"
        aria-label="Consultar por ativo operacional"
      >
        <div className="border-b border-gray-200 px-3 py-2">
          <h2 className="text-[13px] font-semibold text-gray-900">Consultar por ativo operacional</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            A API devolve o registro contábil associado ao ativo físico.
          </p>
        </div>
        {errorLookup ? (
          <div className="px-3 pt-2">
            <Alert tone="error">{errorLookup}</Alert>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2 px-3 py-2">
          <div className="w-44 min-w-0 shrink">
            <Field label="Unidade" htmlFor="fa-lookup-unit" required>
              <Select
                id="fa-lookup-unit"
                value={lookupUnit.unitId}
                onChange={(event) => lookupUnit.setUnitId(event.target.value)}
                required
              >
                <OperationalUnitOptions options={lookupUnit.options} />
              </Select>
            </Field>
          </div>
          <div className="min-w-52 flex-1">
            <HumanLookupField
              label="Ativo operacional"
              htmlFor="fa-lookup-op"
              required
              placeholder="Buscar por nome ou código do ativo"
              search={searchPhysicalAssetOptions}
              value={lookupOperationalId}
              onChange={setLookupOperationalId}
              emptyMessage="Nenhum ativo físico encontrado para a busca."
            />
          </div>
          <button
            type="button"
            className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={lookingUp}
            onClick={() => void submitLookup()}
          >
            {lookingUp ? 'Consultando…' : 'Consultar ativo operacional'}
          </button>
        </div>
      </section>

      {gate}
      {!registerId && state.phase !== 'loading' ? (
        <WorklistStatePanel
          title="Nenhum registro carregado"
          description="Consulte pelo identificador do servidor na barra acima, ou pelo ativo operacional. O valor contábil e a depreciação vêm do registro persistido."
        />
      ) : null}
      {state.phase === 'ready' ? (
        <>
          {/* IDENTIDADE DO REGISTRO — faixa densa acima dos movimentos, não cartão de respiro. */}
          <section
            className="mb-2 rounded-md border border-gray-200 bg-white"
            aria-label="Registro do imobilizado"
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-gray-200 px-3 py-2">
              <StatusBadge tone="neutral" label={state.data.status} />
              <span className="text-xs text-gray-500">
                Ativo operacional <span className="font-mono">{state.data.operationalAssetId}</span>
              </span>
              <span className="text-xs text-gray-500">
                Centro de custo {state.data.costCenterCode ?? '—'}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-x-4 text-xs text-gray-600 tabular-nums">
                <span>
                  Valor contábil{' '}
                  <strong>
                    {formatMoney(state.data.bookValue, state.data.currencyCode)}
                  </strong>
                </span>
                <span>
                  Vida útil <strong>{state.data.usefulLifeMonths} meses</strong>
                </span>
                <span>
                  Aquisição <strong>{state.data.acquiredOn ?? '—'}</strong>
                </span>
                <span>
                  Baixa <strong>{state.data.disposedOn ?? '—'}</strong>
                </span>
                <span>
                  Versão <strong>{state.data.rowVersion}</strong>
                </span>
              </span>
            </div>
          </section>

          {/* MOVIMENTOS — área de resultado principal, com o vazio DENTRO da estrutura. */}
          <section className="mb-2" aria-label="Movimentos do imobilizado">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Movimentos</h2>
              <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 tabular-nums">
                {state.data.movements.length}
              </span>
            </div>
            {state.data.movements.length === 0 ? (
              <WorklistStatePanel
                title="Nenhum movimento registrado"
                description="O ativo ainda não tem aquisição, depreciação, transferência ou baixa persistida pelo servidor."
              />
            ) : (
              <div className={worklistTableCardClass}>
                <table className={worklistTableClass} aria-label="Movimentos do imobilizado">
                  <thead>
                    <tr>
                      <th scope="col" className={worklistHeadCellClass}>
                        Tipo
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Situação
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Data
                      </th>
                      <th scope="col" className={worklistNumericHeadCellClass}>
                        Valor
                      </th>
                      <th scope="col" className={`${worklistHeadCellClass} whitespace-normal`}>
                        Lançamento
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.movements.map((item) => (
                      <tr key={item.id} className={worklistRowClass}>
                        <td className={worklistCellClass}>
                          {MOVEMENT_KIND_LABELS[item.kind] ?? item.kind}
                        </td>
                        <td className={worklistCellClass}>{item.status}</td>
                        <td className={worklistCellClass}>
                          <DateTime value={item.occurredOn} mode="date" />
                        </td>
                        <td className={worklistNumericCellClass}>
                          <Money value={item.amount} currencyCode={state.data.currencyCode} />
                        </td>
                        <td className={worklistCellClass}>
                          {item.journalEntryId ? (
                            <button
                              type="button"
                              className="text-[13px] font-semibold text-brand-700 hover:text-brand-800"
                              onClick={() =>
                                void navigate(`/app/accounting/journals/${item.journalEntryId}`)
                              }
                            >
                              Ver lançamento
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/*
            AÇÕES EXISTENTES — adquirir, depreciar, baixar, transferir e estornar continuam sendo
            exatamente as chamadas anteriores. O que mudou é a moldura: uma seção de AÇÕES do
            registro, não cinco cartões competindo com o próprio registro.
          */}
          <section
            className="mb-3 rounded-md border border-gray-200 bg-white"
            aria-label="Ações do registro de imobilizado"
          >
            <div className="border-b border-gray-200 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-gray-900">Ações do registro</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Aquisição, depreciação, baixa, transferência e estorno são persistidas e calculadas
                pelo servidor. Nenhum valor é calculado neste formulário.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 px-3 py-2 lg:grid-cols-2">
              <CreateRecordForm
                title="Adquirir"
                description="O valor de aquisição é o informado ao servidor."
                submitLabel="Registrar aquisição"
                mapError={mapAccountingErrorToMessage}
                onSubmit={async (idempotencyKey) => {
                  setReady(
                    await acquireFixedAsset(state.data.id, {
                      amount: amount.trim(),
                      occurredOn: occurredOn.trim(),
                      idempotencyKey,
                    }),
                  );
                }}
              >
                <Field label="Valor" htmlFor="fa-amount" required>
                  <Input id="fa-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
                </Field>
                <Field label="Data" htmlFor="fa-occurred" required>
                  <Input id="fa-occurred" type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required />
                </Field>
              </CreateRecordForm>
              <VersionedActionForm
                title="Depreciar"
                description="A depreciação é calculada pelo backend."
                confirmTitle="Lançar depreciação"
                confirmDescription="Nenhum valor é calculado neste formulário."
                confirmLabel="Depreciar"
                mapError={mapAccountingErrorToMessage}
                onReload={() => void reload()}
                onSubmit={async () => setReady(await depreciateFixedAsset(state.data.id))}
              />
              <CreateRecordForm
                title="Baixar"
                description="A baixa é recusada se o servidor não aceitar o estado atual."
                submitLabel="Baixar"
                mapError={mapAccountingErrorToMessage}
                onSubmit={async (idempotencyKey) => {
                  setReady(
                    await disposeFixedAsset(state.data.id, {
                      occurredOn: occurredOn.trim(),
                      idempotencyKey,
                    }),
                  );
                }}
              >
                <Field label="Data da baixa" htmlFor="fa-dispose-on" required>
                  <Input id="fa-dispose-on" type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required />
                </Field>
              </CreateRecordForm>
              <CreateRecordForm
                title="Transferir centro de custo"
                description="A transferência é persistida pelo servidor."
                submitLabel="Transferir"
                mapError={mapAccountingErrorToMessage}
                onSubmit={async (idempotencyKey) => {
                  setReady(
                    await transferFixedAsset(state.data.id, {
                      toCostCenterCode: toCostCenterCode.trim(),
                      occurredOn: occurredOn.trim(),
                      idempotencyKey,
                    }),
                  );
                }}
              >
                <Field label="Centro de custo destino" htmlFor="fa-transfer-cc" required>
                  <Input
                    id="fa-transfer-cc"
                    value={toCostCenterCode}
                    onChange={(event) => setToCostCenterCode(event.target.value)}
                    required
                  />
                </Field>
                <Field label="Data" htmlFor="fa-transfer-on" required>
                  <Input
                    id="fa-transfer-on"
                    type="date"
                    value={occurredOn}
                    onChange={(event) => setOccurredOn(event.target.value)}
                    required
                  />
                </Field>
              </CreateRecordForm>
              <VersionedActionForm
                title="Estornar aquisição"
                description="O estorno exige motivo e é recusado se o backend não aceitar."
                confirmTitle="Estornar aquisição"
                confirmDescription="Nenhum valor é recalculado neste formulário."
                confirmLabel="Estornar"
                variant="danger"
                reasonLabel="Motivo"
                mapError={mapAccountingErrorToMessage}
                onReload={() => void reload()}
                onSubmit={async ({ reason }) =>
                  setReady(await reverseFixedAssetAcquisition(state.data.id, { reason: reason ?? '' }))
                }
              />
            </div>
          </section>
        </>
      ) : null}
    </ModulePage>
  );
}
