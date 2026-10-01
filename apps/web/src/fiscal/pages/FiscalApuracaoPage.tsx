import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Money } from '../../ui';
import { ModuleLoadingState, ModulePage, ModulePagination } from '../../ui/module-layout';
import { cn } from '../../ui/utils/cn';
import {
  EnterpriseMetric,
  WorklistClearFilters,
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
import { ProcessingBanner } from '../../financial-ui/ProcessingBanner';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import {
  getTaxCalculation,
  listTaxCalculations,
  reproduceTaxCalculation,
  type TaxCalculationSummary,
} from '../api/fiscal-api';
import { mapFiscalErrorToMessage } from '../api/fiscal-error-messages';
import type { TaxCalculation, TaxReproduction } from '../types/fiscal.types';

/**
 * Apuração. Antes era consulta por identificador digitado. Agora a apuração é ENCONTRADA por
 * regra, versão, base/resultado e origem — e o detalhe é acessado pela lista.
 */
export function FiscalApuracaoPage() {
  const { calculationId = '' } = useParams();
  const [activeId, setActiveId] = useState(calculationId);
  const [reproduction, setReproduction] = useState<TaxReproduction | null>(null);
  const [processing, setProcessing] = useState(false);
  const inflight = useRef(false);
  /**
   * ESCOPO DE UNIDADE pelo hook compartilhado do shell — o mesmo das demais famílias. Antes esta
   * tela tinha um campo de TEXTO LIVRE para a unidade, que exigia o identificador interno
   * digitado; agora a unidade é escolhida em lista (valor real no `value`, rótulo humano no
   * texto) e continua sendo o recorte enviado à API.
   */
  const { options: unitOptions, unitId, setUnitId } = useOperationalUnits();
  const [term, setTerm] = useState('');
  /**
   * RECORTE APLICADO — `{ unitId, q, offset }` é o que o servidor recebeu de verdade. Guardar o
   * offset junto do termo evita que "próxima página" e "nova busca" disputem o mesmo estado:
   * mudar o termo reseta a paginação, mudar a página preserva o termo.
   */
  const [applied, setApplied] = useState<{ unitId: string; q: string } | null>(null);
  const [items, setItems] = useState<TaxCalculationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [listPhase, setListPhase] = useState<'idle' | 'loading' | 'ready' | 'denied' | 'error'>('idle');
  const [offset, setOffset] = useState(0);

  const loader = useCallback((signal?: AbortSignal) => getTaxCalculation(activeId, signal), [activeId]);

  const PAGE_SIZE = 20;

  /**
   * A ROTA é a fonte do detalhe aberto. `useState(calculationId)` só lê o parâmetro uma vez, então
   * navegar de uma apuração para outra (clique na lista) precisava de um segundo manipulador de
   * clique para sincronizar o estado. Sincronizar a partir do parâmetro da rota mantém UM único
   * caminho: o link navega, o parâmetro muda, o detalhe acompanha.
   */
  useEffect(() => {
    setActiveId(calculationId);
    setReproduction(null);
  }, [calculationId]);
  const { state, reload } = useBackofficeQuery<TaxCalculation>({
    loader,
    mapError: mapFiscalErrorToMessage,
    enabled: Boolean(activeId),
    autoLoad: Boolean(activeId),
  });

  useEffect(() => {
    if (!applied) {
      return;
    }
    const controller = new AbortController();
    setListPhase('loading');
    void listTaxCalculations(
      { unitId: applied.unitId, q: applied.q || undefined, limit: PAGE_SIZE, offset },
      controller.signal,
    )
      .then((response) => {
        setItems(response.items);
        setTotal(response.total);
        setListPhase('ready');
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
        setListPhase('denied');
      });
    return () => controller.abort();
  }, [applied, offset]);

  const gate = activeId
    ? renderQueryGate(
        'Apuração',
        'Carregando apuração…',
        'Você não tem permissão para consultar apurações fiscais.',
        state,
        () => void reload(),
      )
    : null;

  async function handleReproduce() {
    if (!activeId || inflight.current) {
      return;
    }
    inflight.current = true;
    setProcessing(true);
    try {
      setReproduction(await reproduceTaxCalculation(activeId));
    } finally {
      inflight.current = false;
      setProcessing(false);
    }
  }

  return (
    <ModulePage>
      <WorklistHeader
        title="Apuração"
        count={listPhase === 'ready' ? total : null}
        context="A apuração é encontrada por regra, versão e resultado. Reprodução vem do motor versionado; esta tela não calcula imposto."
        metrics={
          items.length > 0 ? (
            <>
              <EnterpriseMetric label="Apurações no recorte" value={total} />
              <EnterpriseMetric label="Nesta página" value={items.length} />
            </>
          ) : null
        }
      />

      {/*
        BARRA OPERACIONAL DE BUSCA — a unidade saiu do campo de texto livre e passou a ser
        escolhida em LISTA (mesmo primitivo compartilhado das demais famílias): o operador nunca
        digita o identificador interno. O recorte enviado à API é o mesmo.
      */}
      <WorklistFilterBar meta={listPhase === 'ready' ? `${total} apuração(ões) no recorte` : undefined}>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setActiveId('');
            setReproduction(null);
            setOffset(0);
            setApplied({ unitId: unitId.trim(), q: term.trim() });
          }}
        >
          <WorklistField label="Unidade" htmlFor="apuracao-unit">
            <select
              id="apuracao-unit"
              className={worklistSelectClass}
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
            >
              <OperationalUnitOptions options={unitOptions} />
            </select>
          </WorklistField>
          <WorklistField label="Buscar" htmlFor="apuracao-search" grow>
            <input
              id="apuracao-search"
              type="search"
              className={`${worklistSelectClass} w-full min-w-0`}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Regra, nome ou origem"
            />
          </WorklistField>
          <button
            type="submit"
            className="rounded border border-brand-600 bg-brand-600 px-2.5 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Buscar
          </button>
          {listPhase === 'ready' || listPhase === 'denied' ? (
            <WorklistClearFilters
              visible
              label="Limpar busca"
              onClick={() => {
                setTerm('');
                setApplied(null);
                setItems([]);
                setTotal(0);
                setOffset(0);
                setListPhase('idle');
                setActiveId('');
                setReproduction(null);
              }}
            />
          ) : null}
        </form>
      </WorklistFilterBar>

      {/*
        RESULTADO OFICIAL PRIMEIRO. Quando o operador abriu UMA apuração (drill-down da lista),
        o número que ele veio ver não pode ficar depois da lista inteira: a área de resultado do
        registro aberto vem antes da busca. Sem apuração aberta, o bloco simplesmente não existe.
      */}
      {gate}

      {listPhase === 'idle' ? (
        <WorklistStatePanel
          title="Nenhuma apuração consultada"
          description="Escolha a unidade na barra acima e busque por regra, nome ou origem. A lista é autorizada no servidor."
        />
      ) : null}

      {listPhase === 'denied' ? (
        <WorklistStatePanel
          tone="critical"
          title="Sem permissão para listar apurações desta unidade"
          description="A consulta foi recusada pelo servidor. Esta unidade não está no seu escopo de leitura fiscal."
        />
      ) : null}

      {listPhase === 'loading' ? <ModuleLoadingState title="Apuração" message="Carregando apurações…" /> : null}

      {/* ESTADO VAZIO DENTRO DA ESTRUTURA — cabeçalho e barra seguem montados. */}
      {listPhase === 'ready' && items.length === 0 ? (
        <WorklistStatePanel
          title="Nenhuma apuração encontrada"
          description="Não há apuração persistida para a unidade e o termo pesquisados. Ajuste a busca ou escolha outra unidade."
          action={
            <WorklistClearFilters
              visible
              label="Limpar busca"
              onClick={() => {
                setTerm('');
                setApplied(null);
                setListPhase('idle');
              }}
            />
          }
        />
      ) : null}

      {listPhase === 'ready' && items.length > 0 ? (
        <>
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista de Apurações">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>Regra</th>
                <th scope="col" className={worklistHeadCellClass}>Versão</th>
                <th scope="col" className={worklistHeadCellClass}>Origem</th>
                <th scope="col" className={worklistHeadCellClass}>Calculada em</th>
                <th scope="col" className={worklistNumericHeadCellClass}>Base</th>
                <th scope="col" className={worklistNumericHeadCellClass}>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((calculation) => (
                <tr key={calculation.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>
                    {/*
                      O detalhe é aberto pela ROTA (`/app/fiscal/apuracao/:calculationId`), que já é
                      a fonte de `activeId`. Um segundo manipulador de clique aqui só criaria dois
                      caminhos divergentes para o mesmo estado.
                    */}
                    <WorklistRowLink href={`/app/fiscal/apuracao/${calculation.id}`}>
                      {calculation.ruleName}
                    </WorklistRowLink>
                    <span className="block font-mono text-[11px] text-gray-500">
                      {calculation.ruleCode}
                    </span>
                  </td>
                  {/*
                    VERSAO DA REGRA — a versao que PRODUZIU este resultado. É o que permite
                    responder "por que este numero mudou desde o mes passado" sem abrir o registro.
                  */}
                  <td className={worklistCellRaisedClass}>
                    <span className="tabular-nums">v{calculation.versionNumber}</span>
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {calculation.sourceKind ?? (
                      <span className="text-[11px] text-gray-500">Não informada</span>
                    )}
                  </td>
                  <td className={cn(worklistCellRaisedClass, 'whitespace-nowrap')}>
                    {calculation.calculatedAt ? calculation.calculatedAt.slice(0, 10) : '—'}
                  </td>
                  {/*
                    BASE e RESULTADO são os valores persistidos pelo motor no servidor. Esta tela
                    não recalcula imposto: apenas publica o que foi apurado e com que versão.
                  */}
                  <td className={worklistNumericCellClass}>
                    <Money value={calculation.baseAmount} />
                  </td>
                  <td className={worklistNumericCellClass}>
                    <Money value={calculation.resultAmount} emphasis />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <WorklistFooter
          rangeLabel={
            <span aria-live="polite">
              Página {Math.floor(offset / PAGE_SIZE) + 1} · {total} apuração(ões) no recorte
            </span>
          }
          extra={applied?.q ? `busca: ${applied.q}` : null}
        >
          <ModulePagination
            pageNumber={Math.floor(offset / PAGE_SIZE) + 1}
            previousDisabled={offset === 0}
            nextDisabled={offset + items.length >= total}
            onPrevious={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            onNext={() => setOffset((current) => current + PAGE_SIZE)}
          />
        </WorklistFooter>
        </>
      ) : null}

      {state.phase === 'ready' ? (
        <>
          {/*
            RESULTADO OFICIAL — faixa densa com a leitura de UMA apuração, não cartão de respiro.
            Regra, versão, base, alíquota persistida e resultado continuam sendo os valores do
            servidor; nada é recalculado aqui.
          */}
          <section
            className="mb-2 rounded-md border border-gray-200 bg-white"
            aria-label="Resultado da apuração"
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2">
              <span className="text-[13px] font-semibold text-gray-900">
                {state.data.ruleCode}
              </span>
              <span className="text-xs text-gray-500">versão {state.data.versionNumber}</span>
              <span className="ml-auto flex flex-wrap items-center gap-x-4 text-xs text-gray-600 tabular-nums">
                <span>
                  Base <Money value={state.data.baseAmount} />
                </span>
                <span>
                  Alíquota persistida <strong>{state.data.rate ?? '—'}</strong>
                </span>
                <span>
                  Resultado <Money value={state.data.resultAmount} emphasis />
                </span>
              </span>
            </div>
          </section>

          {/* AÇÃO DO MOTOR — reprodução é decidida no servidor. */}
          <section
            className="mb-2 rounded-md border border-gray-200 bg-white"
            aria-label="Reprodução da apuração"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <h2 className="text-[13px] font-semibold text-gray-900">Reprodução</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  O servidor recomputa a apuração com a regra versionada e devolve se coincide com o
                  resultado persistido.
                </p>
              </div>
              <Button type="button" onClick={() => void handleReproduce()} loading={processing} disabled={processing}>
                Reproduzir no servidor
              </Button>
            </div>
            {processing ? <div className="px-3 pb-2"><ProcessingBanner /></div> : null}
            {reproduction ? (
              <p className="border-t border-gray-200 px-3 py-2 text-xs" role="status">
                Reprodução {reproduction.matches ? 'coincide' : 'diverge'} do resultado persistido.
                Valor recompute: <Money value={reproduction.recomputed.resultAmount} />
              </p>
            ) : null}
          </section>

          {/* LINHAS DA APURAÇÃO — área de resultado densa. */}
          <section className="mb-3" aria-label="Linhas da apuração">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Linhas da apuração</h2>
              <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 tabular-nums">
                {state.data.lines.length}
              </span>
            </div>
            {state.data.lines.length === 0 ? (
              <WorklistStatePanel
                title="Nenhuma linha na apuração"
                description="O servidor não publicou componentes para esta apuração."
              />
            ) : (
              <div className={worklistTableCardClass}>
                <table className={worklistTableClass} aria-label="Linhas da apuração">
                  <thead>
                    <tr>
                      <th scope="col" className={worklistHeadCellClass}>Componente</th>
                      <th scope="col" className={worklistNumericHeadCellClass}>Base</th>
                      <th scope="col" className={worklistNumericHeadCellClass}>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.lines.map((line) => (
                      <tr key={line.lineNumber} className={worklistRowClass}>
                        <td className={worklistCellClass}>{line.componentLabel}</td>
                        <td className={worklistNumericCellClass}>
                          <Money value={line.baseAmount} />
                        </td>
                        <td className={worklistNumericCellClass}>
                          <Money value={line.resultAmount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </ModulePage>
  );
}
