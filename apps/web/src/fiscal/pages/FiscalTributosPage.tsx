import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Money } from '../../ui';
import { ModuleErrorState, ModuleLoadingState, ModulePage, ModulePagination, UnitScopeLabel } from '../../ui/module-layout';
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
import { OperationalUnitOptions } from '../../shell/hooks/useOperationalUnits';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { getTaxRule, listTaxRules } from '../api/fiscal-api';
import { mapFiscalErrorToMessage } from '../api/fiscal-error-messages';
import { useFiscalUnits } from '../hooks/useFiscalUnits';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import type { TaxRule, TaxRuleListItem } from '../types/fiscal.types';

const PAGE_SIZE = 20;

/**
 * VIGÊNCIA — comparação de datas das versões que a LISTAGEM já publica (`effectiveFrom`,
 * `effectiveTo`). Não interpreta regra tributária: apenas localiza a versão publicada no
 * calendário, para o operador saber se a alíquota exibida é a que vale HOJE ou uma já encerrada.
 * Sem versão publicada não existe vigência a declarar.
 */
function PUBLISHED_VERSION_STATUS(version: {
  effectiveFrom: string;
  effectiveTo: string | null;
}): { label: string; tone: 'info' | 'warning' } | null {
  const today = new Date().toISOString().slice(0, 10);
  if (version.effectiveTo && version.effectiveTo < today) {
    return { label: 'Vigência encerrada', tone: 'warning' };
  }
  if (version.effectiveFrom > today) {
    return { label: 'Vigência futura', tone: 'info' };
  }
  return { label: 'Vigente hoje', tone: 'info' };
}

/**
 * Próxima ação da régua tributária — nomeia o que a situação persistida exige. A publicação de
 * versão e a alteração de alíquota são decididas pelo backend; esta tela não as executa.
 */
function NEXT_ACTION_FOR(status: string, hasPublishedVersion: boolean): string {
  if (status !== 'ACTIVE') {
    return 'Nenhuma — regra inativa';
  }
  return hasPublishedVersion ? 'Nenhuma — versão publicada' : 'Publicar versão no backend';
}

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: TaxRuleListItem[]; total: number; page: number };

export function FiscalTributosPage() {
  const { taxRuleId } = useParams();
  return taxRuleId ? <TaxRuleDetail taxRuleId={taxRuleId} /> : <TaxRulesList />;
}

/** Superficie de tributos: lista paginada de regras com a versao publicada vigente. */
function TaxRulesList() {
  const { options: unitOptions, unitId, setUnitId } = useFiscalUnits();
  const [status, setStatus] = useState('');
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
        const response = await listTaxRules(
          { unitId, status: status || undefined, page, pageSize: PAGE_SIZE },
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
    [page, status, unitId],
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
   * CONTAGENS DA PÁGINA — derivadas apenas de `status` e da presença de `publishedVersion`, que
   * a própria listagem do servidor publica. São contagens de cadastro sobre as linhas devolvidas,
   * nunca alíquota, tributo ou valor calculado nesta tela.
   */
  const activeOnPage = items.filter((item) => item.status === 'ACTIVE').length;
  const withoutPublishedVersion = items.filter((item) => !item.publishedVersion).length;

  return (
    <ModulePage>
      <WorklistHeader
        title="Tributos"
        count={total}
        context="Consulta regras versionadas já persistidas. Alíquotas oficiais não são inventadas nesta interface."
        metrics={
          items.length > 0 ? (
            <>
              <EnterpriseMetric label="Regras nesta página" value={items.length} />
              <EnterpriseMetric label="Ativas nesta página" value={activeOnPage} />
              <EnterpriseMetric
                label="Sem versão publicada"
                value={withoutPublishedVersion}
                tone={withoutPublishedVersion > 0 ? 'warning' : 'neutral'}
              />
            </>
          ) : null
        }
      />

      {/* BARRA OPERACIONAL: unidade e situação na mesma linha densa das demais worklists. */}
      <WorklistFilterBar
        meta={total !== null ? `${total} regra(s) no recorte` : undefined}
      >
        <WorklistField label="Unidade" htmlFor="tax-rule-unit-filter">
          <select
            id="tax-rule-unit-filter"
            className={worklistSelectClass}
            value={unitId}
            onChange={(event) => {
              setUnitId(event.target.value);
              setPage(0);
            }}
          >
            {/*
              ESCOPO DE UNIDADE pelo primitivo compartilhado — o `<option>` de ausência e o rótulo
              humano são os mesmos das demais superfícies. O VALOR continua sendo a unidade
              autorizada enviada à API.
            */}
            <OperationalUnitOptions options={unitOptions} />
          </select>
        </WorklistField>
        <WorklistField label="Situação" htmlFor="tax-rule-status-filter">
          <select
            id="tax-rule-status-filter"
            className={worklistSelectClass}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Todas</option>
            <option value="ACTIVE">Ativa</option>
            <option value="INACTIVE">Inativa</option>
          </select>
        </WorklistField>
        <WorklistClearFilters
          visible={status !== ''}
          onClick={() => {
            setStatus('');
            setPage(0);
          }}
          label="Limpar situação"
        />
      </WorklistFilterBar>

      {state.phase === 'loading' ? <ModuleLoadingState title="Tributos" message="Carregando regras…" /> : null}

      {state.phase === 'error' ? (
        <ModuleErrorState
          title="Tributos"
          message={state.message}
          retryable={state.retryable}
          onRetry={() => void load()}
        />
      ) : null}

      {/* ESTADO VAZIO DENTRO DA ESTRUTURA — cabeçalho e barra seguem montados. */}
      {state.phase === 'ready' && items.length === 0 ? (
        <WorklistStatePanel
          title={
            status === ''
              ? 'Nenhuma regra tributária'
              : `Nenhuma regra ${status === 'ACTIVE' ? 'ativa' : 'inativa'} nesta unidade`
          }
          description="Não há regras tributárias persistidas para a unidade e a situação selecionadas. Nenhuma alíquota é estimada nesta tela."
          action={
            <WorklistClearFilters
              visible={status !== ''}
              onClick={() => {
                setStatus('');
                setPage(0);
              }}
              label="Ver todas as situações"
            />
          }
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Lista de regras tributárias">
              <thead>
                <tr>
                  <th scope="col" className={worklistHeadCellClass}>
                    Código
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Nome
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Versão publicada
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Vigência
                  </th>
                  <th scope="col" className={worklistNumericHeadCellClass}>
                    Alíquota / valor
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Fonte
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Próxima ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const vigencia = item.publishedVersion
                    ? PUBLISHED_VERSION_STATUS(item.publishedVersion)
                    : null;
                  return (
                    <tr key={item.id} className={worklistRowClass}>
                      <td className={worklistCellClass}>
                        <WorklistRowLink href={`/app/fiscal/tributos/${item.id}`}>
                          <span className="font-mono">{item.code}</span>
                        </WorklistRowLink>
                        {item.versionCount > 1 ? (
                          <span className="block text-[11px] text-gray-500">
                            {item.versionCount} versões
                          </span>
                        ) : null}
                      </td>
                      <td className={cn(worklistCellRaisedClass, 'whitespace-normal')}>
                        {item.name}
                      </td>
                      <td className={worklistCellRaisedClass}>
                        <FinanceStatusBadge
                          status={item.status}
                          labels={{ ACTIVE: 'Ativa', INACTIVE: 'Inativa' }}
                        />
                        {item.status === 'ACTIVE' && !item.publishedVersion ? (
                          <span className="mt-0.5 block">
                            <WorklistException tone="warning">
                              Sem versão publicada
                            </WorklistException>
                          </span>
                        ) : null}
                      </td>
                      {/*
                        VERSAO PUBLICADA — a versao que o motor usa hoje, com o metodo de calculo
                        persistido. Sem versao publicada, a celula declara o fato e a contagem de
                        versoes existentes, em vez de um traco mudo.
                      */}
                      <td className={cn(worklistCellRaisedClass, 'whitespace-normal')}>
                        {item.publishedVersion ? (
                          <>
                            <span className="block tabular-nums">
                              v{item.publishedVersion.versionNumber}
                            </span>
                            <span className="block text-[11px] text-gray-500">
                              {item.publishedVersion.calculationMethod}
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] text-gray-500">
                            Nenhuma · {item.versionCount} versão(ões)
                          </span>
                        )}
                      </td>
                      {/*
                        VIGENCIA — a versao publicada esta valendo hoje? Encerrada e futura sao
                        fatos de calendario sobre datas que o servidor publicou; a aliquota
                        exibida so pode ser lida corretamente com essa informacao ao lado.
                      */}
                      <td className={cn(worklistCellRaisedClass, 'whitespace-normal')}>
                        {item.publishedVersion ? (
                          <>
                            <span className="block tabular-nums">
                              {item.publishedVersion.effectiveFrom} →{' '}
                              {item.publishedVersion.effectiveTo ?? 'aberta'}
                            </span>
                            {vigencia ? (
                              <span className="mt-0.5 block">
                                <WorklistException tone={vigencia.tone}>
                                  {vigencia.label}
                                </WorklistException>
                              </span>
                            ) : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      {/* ALIQUOTA — valor persistido da versão publicada. Não é estimada aqui. */}
                      <td className={worklistNumericCellClass}>
                        {item.publishedVersion?.rate ? (
                          <Money value={item.publishedVersion.rate} currencyCode="BRL" />
                        ) : (
                          (item.publishedVersion?.fixedAmount ?? '—')
                        )}
                      </td>
                      <td className={cn(worklistCellRaisedClass, 'whitespace-normal')}>
                        {item.publishedVersion?.sourceReference ?? '—'}
                      </td>
                      <td className={worklistCellRaisedClass}>
                        <span
                          className={
                            item.status === 'ACTIVE' && !item.publishedVersion
                              ? 'text-[12px] font-medium text-gray-800'
                              : 'text-[12px] text-gray-500'
                          }
                        >
                          {NEXT_ACTION_FOR(item.status, Boolean(item.publishedVersion))}
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
                Página {currentPage + 1} · {total} regra(s) no recorte
              </span>
            }
            extra={status === '' ? null : `situação: ${status === 'ACTIVE' ? 'Ativa' : 'Inativa'}`}
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

function TaxRuleDetail({ taxRuleId }: { taxRuleId: string }) {
  const loader = useCallback((signal?: AbortSignal) => getTaxRule(taxRuleId, signal), [taxRuleId]);
  const { state, reload } = useBackofficeQuery<TaxRule>({
    loader,
    mapError: mapFiscalErrorToMessage,
    enabled: true,
    autoLoad: true,
  });
  const gate = renderQueryGate(
    'Regra tributária',
    'Carregando regra tributária…',
    'Você não tem permissão para consultar regras tributárias.',
    state,
    () => void reload(),
  );

  return (
    <ModulePage>
      <WorklistHeader
        title="Regra tributária"
        context="Consulta regras versionadas já persistidas. Alíquotas oficiais não são inventadas nesta interface."
        action={
          <Link
            to="/app/fiscal/tributos"
            className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800"
          >
            ← Voltar para tributos
          </Link>
        }
        metrics={
          state.phase === 'ready' ? (
            <>
              <EnterpriseMetric label="Código" value={state.data.code} />
              <EnterpriseMetric label="Nome" value={state.data.name} />
            </>
          ) : null
        }
      />
      {gate}
      {state.phase === 'ready' ? (
        /*
         * IDENTIDADE DA REGRA — faixa densa acima do detalhe, não cartão `rounded-xl p-6`.
         * Código, nome, situação e unidade continuam sendo exatamente os valores do servidor.
         */
        <section
          className="mb-3 rounded-md border border-gray-200 bg-white"
          aria-label="Identificação da regra tributária"
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2">
            <span className="font-mono text-[13px] font-semibold text-gray-900">
              {state.data.code}
            </span>
            <span className="text-[13px] text-gray-900">{state.data.name}</span>
            <FinanceStatusBadge
              status={state.data.status}
              labels={{ ACTIVE: 'Ativa', DRAFT: 'Rascunho' }}
            />
            <span className="ml-auto text-xs text-gray-500">
              Unidade <UnitScopeLabel unitId={state.data.unitId} />
            </span>
          </div>
          {/*
            O QUE ESTA TELA NÃO FAZ — declarado onde o operador procura a alíquota. A regra
            versionada é publicada e alterada no backend; aqui a consulta é somente leitura, e
            dizer isso evita a leitura errada de que a versão vigente está "sendo editada".
          */}
          <div className="border-t border-gray-100 px-3 py-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
              Próxima ação
            </span>{' '}
            <span className="text-[12px] font-medium text-gray-800">
              {state.data.status === 'ACTIVE'
                ? 'Nenhuma — versão publicada é decidida no backend'
                : 'Nenhuma — regra não está ativa'}
            </span>
          </div>
        </section>
      ) : null}
    </ModulePage>
  );
}
