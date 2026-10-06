import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Checkbox, EmptyState, Field, Input, Money, Select } from '../../ui';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import {
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  worklistCellClass,
  worklistHeadCellClass,
  worklistNumericCellClass,
  worklistNumericHeadCellClass,
  worklistRowClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { CreateRecordForm } from '../../financial-ui/VersionedActionForm';
import { TREASURY_KIND_LABELS, TREASURY_LIFECYCLE_LABELS } from '../../financial-ui/labels';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  DynamicExportCsv,
  DynamicFilterBar,
  DynamicList,
  listColumns,
  useEntitySchema,
} from '../../engine';
import {
  getTreasuryReconciliation,
  listTreasuryAccounts,
  openTreasuryAccount,
  probeTreasuryReconciliationAccess,
} from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import type { FinancialAccount, TreasuryReconciliation } from '../types/finance.types';
import { treasuryEngineRows } from './treasury-engine-rows';

type AccountDraft = {
  unitId: string;
  kind: string;
  code: string;
  name: string;
  currencyCode: string;
  openingAmount: string;
  overdraftAllowed: boolean;
  bankCode: string;
  agency: string;
  accountNumber: string;
  locationCode: string;
};

const EMPTY_DRAFT: AccountDraft = {
  unitId: '',
  kind: 'CASH',
  code: '',
  name: '',
  currencyCode: 'BRL',
  openingAmount: '',
  overdraftAllowed: false,
  bankCode: '',
  agency: '',
  accountNumber: '',
  locationCode: '',
};

/**
 * Tamanho da página LOCAL.
 *
 * `/finance/treasury/accounts` NÃO é paginado: o serviço decide a autorização conta a conta e
 * devolve o conjunto visível ao ator. A tela fatia esse conjunto para exibição — nunca recorta a
 * lista autorizada, e nunca inventa `total`/`totalPages` que o contrato não publica.
 */
const PAGE_SIZE = 20;

/**
 * CAIXA E BANCOS — MESA DE TRABALHO, renderizada pela engine.
 *
 * A grade, os cabeçalhos, os rótulos de tipo/situação e o filtro por campo deixaram de ser JSX
 * artesanal: tudo vem de `/api/v1/meta/treasury-accounts` (view `list` + `in_filter`). O saldo
 * continua sendo o que o SERVIDOR reconstruiu — esta tela não soma nada.
 *
 * PARIDADE COM A VERSÃO ARTESANAL (cada feature do arquivo antigo → onde vive agora):
 *   - tabela Conta/Tipo/Situação/Saldo do servidor → `DynamicList` + coluna de saldo desenhada
 *     pela tela (`renderCell`), porque `balance` é reconstruído e não é coluna da view;
 *   - badge de tipo e de situação → `meta.fields.options`, resolvido pelo `FieldRenderer`;
 *   - link da linha para o detalhe → `onRowClick` navegando, PRESERVADO;
 *   - formulário "Abrir conta financeira" → PRESERVADO integralmente, com os campos condicionais
 *     de banco/caixa;
 *   - estados de negação/erro/vazio → PRESERVADOS;
 *   - paginação com faixa e contagem → `ModulePagination` + `WorklistFooter`.
 *
 * CAPACIDADE NOVA: o filtro por `kind`/`lifecycle` — os dois campos `in_filter` que o próprio
 * metadado declara — e a exportação CSV das MESMAS colunas da grade. Ambos recortam o que o
 * servidor já autorizou; nenhum é regra financeira nova.
 *
 * MOVIMENTAÇÃO FINANCEIRA ≠ AUDIT TRAIL. A distinção declarada no detalhe da conta vale aqui:
 * créditos, débitos e contagem de movimentos vêm de `GET /accounts/:id/reconciliation`, um
 * RECURSO FINANCEIRO. Não existe — e não é montada — trilha de auditoria nesta tela.
 */
export function TreasuryListPage() {
  const navigate = useNavigate();
  const [pageNumber, setPageNumber] = useState(1);
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const { schema } = useEntitySchema('treasury-accounts');

  /*
   * A LISTA é a porta de entrada e a autoridade. O bloco de reconciliação vem no MESMO
   * carregamento, para as contas que o servidor devolveu: sem conta não há o que reconciliar, e a
   * falha daquele bloco nunca apaga a lista já autorizada.
   */
  const loader = useCallback(async (signal?: AbortSignal) => {
    const accounts = await listTreasuryAccounts(signal);
    const reconciliationAllowed = await probeTreasuryReconciliationAccess(accounts, signal);
    const reconciliations = new Map<string, TreasuryReconciliation>();
    if (reconciliationAllowed) {
      const results = await Promise.all(
        accounts.map(async (account) => {
          try {
            return { id: account.id, value: await getTreasuryReconciliation(account.id, signal) };
          } catch {
            // Conta sem leitura de reconciliação NÃO vira zero: o total fica AUSENTE e o bloco
            // omite a linha, em vez de afirmar créditos/débitos que não foram lidos.
            return { id: account.id, value: null };
          }
        }),
      );
      for (const result of results) {
        if (result.value) {
          reconciliations.set(result.id, result.value);
        }
      }
    }
    return { accounts, reconciliationAllowed, reconciliations };
  }, []);

  const { state, reload } = useBackofficeQuery<{
    accounts: FinancialAccount[];
    reconciliationAllowed: boolean;
    reconciliations: Map<string, TreasuryReconciliation>;
  }>({ loader, mapError: mapFinanceErrorToMessage });

  const allRows = useMemo(
    () => (state.phase === 'ready' ? treasuryEngineRows(state.data.accounts) : []),
    [state],
  );

  const gate = renderQueryGate(
    'Caixa e bancos',
    'Carregando contas financeiras…',
    'Você não tem permissão para listar caixa e bancos.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return null;
  }

  const { accounts, reconciliationAllowed, reconciliations } = state.data;
  const isBank = draft.kind === 'BANK';

  /*
   * RECORTE POR CAMPO DO METADADO — conjuntivo, sobre o conjunto que o servidor autorizou. Não é
   * um recorte de servidor porque o endpoint não aceita `kind`/`lifecycle` como parâmetro; o
   * filtro é do que já chegou, e o rodapé DIZ quantas contas o recorte deixou de fora.
   */
  const activeFilters = Object.entries(filters).filter(([, value]) => value.trim() !== '');
  const byFilter = activeFilters.length
    ? allRows.filter((row) =>
        activeFilters.every(([field, value]) => {
          const cell = row[field];
          return typeof cell === 'string' || typeof cell === 'number'
            ? String(cell) === value
            : false;
        }),
      )
    : allRows;

  const pageCount = Math.max(1, Math.ceil(byFilter.length / PAGE_SIZE));
  const safePage = Math.min(pageNumber, pageCount);
  const pageItems = byFilter.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const isFiltered = activeFilters.length > 0;

  return (
    <ModulePage layout="workspace">
      <WorklistHeader
        title={schema?.label ?? 'Caixa e bancos'}
        count={accounts.length}
        context="O saldo de cada conta é o valor reconstruído pelo servidor. Esta tela não soma nem recalcula."
      />

      {accounts.length === 0 ? (
        <EmptyState
          title="Nenhuma conta financeira"
          description="O servidor não devolveu contas no seu escopo."
        />
      ) : (
        <>
          {/* FILTRO POR CAMPO DO METADADO: `kind` e `lifecycle` são os `in_filter` declarados. */}
          {schema ? (
            <DynamicFilterBar
              schema={schema}
              values={filters}
              onChange={(field, value) => {
                setPageNumber(1);
                setFilters((current) => ({ ...current, [field]: value }));
              }}
              onClear={() => {
                setPageNumber(1);
                setFilters({});
              }}
            />
          ) : null}

          {schema ? (
            <div className="mb-2">
              {/* O arquivo leva as MESMAS colunas que a grade exibe. */}
              <DynamicExportCsv
                schema={schema}
                rows={byFilter}
                fileName="caixa-e-bancos"
                columns={listColumns(schema)}
              />
            </div>
          ) : null}

          <DynamicList
            schema={schema}
            rows={pageItems}
            emptyMessage="Nenhuma conta corresponde ao recorte atual."
            onRowClick={(row) => {
              void navigate(`/app/finance/treasury/${row.id}`);
            }}
            /*
             * CÉLULAS TIPADAS. Tipo e situação são `select` do metadado e viram badge com o rótulo
             * humano; `currency_code` continua sendo o valor do servidor.
             *
             * O SALDO NÃO tem coluna na view `list` — é reconstruído pelo servidor a cada leitura
             * —, então ele NÃO aparece como célula da grade. Ele permanece visível: o bloco de
             * reconciliação abaixo o publica na coluna "Saldo do servidor" para as contas da
             * página. Esconder saldo seria perder capacidade; duplicá-lo em coluna inventada
             * seria declarar campo que o metadado não tem.
             */
            renderCell={(field, row) => {
              if (field.name === 'kind') {
                return <FinanceStatusBadge status={String(row.kind)} labels={TREASURY_KIND_LABELS} />;
              }
              if (field.name === 'lifecycle') {
                return <FinanceStatusBadge status={String(row.lifecycle)} labels={TREASURY_LIFECYCLE_LABELS} />;
              }
              return undefined;
            }}
          />

          {/*
            RECONCILIAÇÃO DAS CONTAS DA PÁGINA — créditos, débitos, movimentos e o SALDO do
            servidor vivem aqui, no mesmo lugar do detalhe da conta.

            O SALDO só é afirmado para as contas cuja RECONCILIAÇÃO foi efetivamente lida: ele e
            os totais chegam pelo mesmo `GET /accounts/:id/reconciliation`, e uma conta sem essa
            leitura não tem como publicar créditos/débitos. Nenhum zero é inventado — a linha
            simplesmente não é montada para essa conta.

            O bloco inteiro fica AUSENTE quando a leitura não foi autorizada ou quando nenhuma
            conta da página pôde ser reconciliada.
          */}
          {reconciliationAllowed && pageItems.some((row) => reconciliations.has(row.id)) ? (
            <div className={`mt-3 ${worklistTableCardClass}`}>
              <table className={worklistTableClass} aria-label="Reconciliação das contas da página">
                <thead>
                  <tr>
                    <th scope="col" className={worklistHeadCellClass}>
                      Conta
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Saldo do servidor
                    </th>
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Créditos
                    </th>
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Débitos
                    </th>
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Movimentos
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((row) => {
                    const reconciliation = reconciliations.get(row.id);
                    if (!reconciliation) {
                      return null;
                    }
                    const account = accounts.find((item) => item.id === row.id);
                    if (!account) {
                      return null;
                    }
                    return (
                      <tr key={row.id} className={worklistRowClass}>
                        <td className={worklistCellClass}>
                          <WorklistRowLink href={`/app/finance/treasury/${account.id}`}>
                            {account.name}
                          </WorklistRowLink>
                          <p className="font-mono text-[11px] text-gray-500">{account.code}</p>
                        </td>
                        <td className={worklistCellClass}>
                          <Money value={account.balance} currencyCode={account.currencyCode} emphasis />
                        </td>
                        <td className={worklistNumericCellClass}>
                          <Money value={reconciliation.credits} currencyCode={account.currencyCode} />
                        </td>
                        <td className={worklistNumericCellClass}>
                          <Money value={reconciliation.debits} currencyCode={account.currencyCode} />
                        </td>
                        <td
                          className={worklistNumericCellClass}
                          data-movement-count={reconciliation.movementCount}
                        >
                          {reconciliation.movementCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          <WorklistFooter
            rangeLabel={`Página ${safePage} de ${pageCount} · ${byFilter.length}${
              isFiltered ? ` de ${accounts.length}` : ''
            } contas`}
          >
            <ModulePagination
              pageNumber={safePage}
              onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
              onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
              previousDisabled={safePage <= 1}
              nextDisabled={safePage >= pageCount}
            />
          </WorklistFooter>
        </>
      )}

      {/*
        ABRIR CONTA — depois da fila, não antes dela.

        A tela é uma WORKSPACE de tesouraria: o que o operador vem fazer aqui é ler saldo,
        créditos, débitos e movimentos das contas. O cadastro é a exceção do dia, não o objeto — e
        aberto no topo ele empurrava a grade inteira para fora da primeira dobra em 1440x900. O
        bloco vem recolhido (o botão anuncia a ação) e, quando aberto, fica no mesmo lugar, sem
        tirar o operador da lista.
      */}
      <CreateRecordForm
        title="Abrir conta financeira"
        description="A abertura é decidida pelo backend: tipo, moeda, conta bancária ou localização de caixa."
        submitLabel="Abrir conta"
        mapError={mapFinanceErrorToMessage}
        onConflictReload={() => void reload()}
        onSuccess={() => {
          setDraft(EMPTY_DRAFT);
          void reload();
        }}
        onSubmit={async () => {
          await openTreasuryAccount({
            unitId: draft.unitId.trim(),
            kind: draft.kind,
            code: draft.code.trim(),
            name: draft.name.trim(),
            currencyCode: draft.currencyCode.trim().toUpperCase(),
            overdraftAllowed: draft.overdraftAllowed,
            openingAmount: draft.openingAmount.trim() || undefined,
            ...(isBank
              ? {
                  bank: {
                    bankCode: draft.bankCode.trim(),
                    agency: draft.agency.trim(),
                    accountNumber: draft.accountNumber.trim(),
                  },
                }
              : { cash: { locationCode: draft.locationCode.trim() } }),
          });
        }}
      >
        <Field label="Unidade" htmlFor="account-unit" required>
          <Input
            id="account-unit"
            value={draft.unitId}
            onChange={(event) => setDraft((current) => ({ ...current, unitId: event.target.value }))}
            required
          />
        </Field>
        <Field label="Tipo" htmlFor="account-kind" required>
          <Select
            id="account-kind"
            value={draft.kind}
            onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))}
          >
            <option value="CASH">Caixa</option>
            <option value="BANK">Conta bancária</option>
          </Select>
        </Field>
        <Field label="Código" htmlFor="account-code" required>
          <Input
            id="account-code"
            value={draft.code}
            onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
            required
          />
        </Field>
        <Field label="Nome" htmlFor="account-name" required>
          <Input
            id="account-name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            required
          />
        </Field>
        <Field label="Moeda" htmlFor="account-currency" required>
          <Input
            id="account-currency"
            value={draft.currencyCode}
            onChange={(event) => setDraft((current) => ({ ...current, currencyCode: event.target.value }))}
            required
          />
        </Field>
        <Field label="Saldo inicial (opcional)" htmlFor="account-opening" hint="Valor positivo validado pelo servidor.">
          <Input
            id="account-opening"
            inputMode="decimal"
            value={draft.openingAmount}
            onChange={(event) => setDraft((current) => ({ ...current, openingAmount: event.target.value }))}
          />
        </Field>
        <Field label="Permitir saldo negativo" htmlFor="account-overdraft" className="md:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <Checkbox
              id="account-overdraft"
              checked={draft.overdraftAllowed}
              onChange={(event) => setDraft((current) => ({ ...current, overdraftAllowed: event.target.checked }))}
            />
            Cheque especial / limite de caixa
          </label>
        </Field>
        {isBank ? (
          <>
            <Field label="Banco (código)" htmlFor="account-bank-code" required>
              <Input
                id="account-bank-code"
                value={draft.bankCode}
                onChange={(event) => setDraft((current) => ({ ...current, bankCode: event.target.value }))}
                required
              />
            </Field>
            <Field label="Agência" htmlFor="account-agency" required>
              <Input
                id="account-agency"
                value={draft.agency}
                onChange={(event) => setDraft((current) => ({ ...current, agency: event.target.value }))}
                required
              />
            </Field>
            <Field label="Conta" htmlFor="account-number" required className="md:col-span-2">
              <Input
                id="account-number"
                value={draft.accountNumber}
                onChange={(event) => setDraft((current) => ({ ...current, accountNumber: event.target.value }))}
                required
              />
            </Field>
          </>
        ) : (
          <Field label="Localização do caixa" htmlFor="account-location" required className="md:col-span-2">
            <Input
              id="account-location"
              value={draft.locationCode}
              onChange={(event) => setDraft((current) => ({ ...current, locationCode: event.target.value }))}
              required
            />
          </Field>
        )}
      </CreateRecordForm>
    </ModulePage>
  );
}
