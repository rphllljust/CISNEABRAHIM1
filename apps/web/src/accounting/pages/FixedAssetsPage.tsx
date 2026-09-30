import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DateTime, EmptyState, Field, Input, Money, Select, worklistTableCardClass } from '../../ui';
import { ModulePage, ModulePageHeader } from '../../ui/module-layout';
import { worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass } from '../../ui/enterprise-list';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { RecordLookupCard } from '../../financial-ui/RecordLookupCard';
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

  return (
    <ModulePage>
      <ModulePageHeader
        title="Ativo imobilizado"
        description="Valor contábil e depreciação são os persistidos pelo servidor."
      />
      <RecordLookupCard
        fieldId="fixed-asset-id"
        label="Identificador do registro"
        value={lookupId}
        onChange={setLookupId}
        onSubmit={() => void navigate(`/app/accounting/fixed-assets/${lookupId.trim()}`)}
        submitLabel="Consultar"
        loading={state.phase === 'loading'}
      />
      <CreateRecordForm
        title="Consultar por ativo operacional"
        description="A API devolve o registro contábil associado ao ativo físico."
        submitLabel="Consultar ativo operacional"
        mapError={mapAccountingErrorToMessage}
        onSubmit={async () => {
          const found = await lookupFixedAsset({
            unitId: lookupUnit.unitId.trim(),
            operationalAssetId: lookupOperationalId.trim(),
          });
          void navigate(`/app/accounting/fixed-assets/${found.id}`);
        }}
      >
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
      </CreateRecordForm>
      <CreateRecordForm
        title="Registrar ativo operacional"
        description="Associa um ativo físico já cadastrado ao livro de imobilizado."
        submitLabel="Registrar"
        mapError={mapAccountingErrorToMessage}
        onSubmit={async () => {
          const created = await registerFixedAsset({
            unitId: registerUnit.unitId.trim(),
            operationalAssetId: operationalAssetId.trim(),
            currencyCode: 'BRL',
            usefulLifeMonths: Number(usefulLifeMonths),
          });
          void navigate(`/app/accounting/fixed-assets/${created.id}`);
        }}
      >
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
        <Field label="Vida útil (meses)" htmlFor="fa-life" required>
          <Input
            id="fa-life"
            inputMode="numeric"
            value={usefulLifeMonths}
            onChange={(event) => setUsefulLifeMonths(event.target.value)}
            required
          />
        </Field>
      </CreateRecordForm>
      {gate}
      {!registerId ? (
        <EmptyState title="Nenhum registro carregado" description="Consulte pelo identificador do servidor." />
      ) : null}
      {state.phase === 'ready' ? (
        <>
          <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
            <DefinitionList
              items={[
                { label: 'Status', value: state.data.status },
                {
                  label: 'Valor contábil',
                  value: <Money value={state.data.bookValue} currencyCode={state.data.currencyCode} emphasis />,
                },
                { label: 'Vida útil', value: `${state.data.usefulLifeMonths} meses` },
                { label: 'Aquisição', value: state.data.acquiredOn ?? '—' },
                { label: 'Baixa', value: state.data.disposedOn ?? '—' },
                { label: 'Versão', value: String(state.data.rowVersion) },
              ]}
            />
          </div>
          {state.data.movements.length === 0 ? (
            <EmptyState title="Sem movimentos" />
          ) : (
            <div className={worklistTableCardClass}>
              <table className={worklistTableClass} aria-label="Movimentos do imobilizado">
                <thead className={worklistHeadCellClass}>
                  <tr>
                    <th scope="col" className={worklistHeadCellClass}>Tipo</th>
                    <th scope="col" className={worklistHeadCellClass}>Data</th>
                    <th scope="col" className={`${worklistHeadCellClass} text-right`}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.movements.map((item) => (
                    <tr key={item.id} className={worklistRowClass}>
                      <td className={worklistCellClass}>{item.kind}</td>
                      <td className={worklistCellClass}>
                        <DateTime value={item.occurredOn} mode="date" />
                      </td>
                      <td className={`${worklistCellClass} text-right`}>
                        <Money value={item.amount} currencyCode={state.data.currencyCode} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
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
          </div>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
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
        </>
      ) : null}
    </ModulePage>
  );
}
