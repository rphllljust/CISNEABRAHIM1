import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime, Money } from '../../ui';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import {
  RecordStatusCell,
  RowActionMenu,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  rowPrimaryActionClass,
  rowSecondaryActionClass,
  worklistButtonClass,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import { DrilldownMetric, DrilldownRow, SavedViewsBar, useSmartList } from '../../operator';
import { EXPENSE_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { DynamicList, useEntitySchema } from '../../engine';
import { listExpenses } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { expenseEngineRows, expensesListSchema } from './expense-engine-rows';

const PAGE_SIZE = 20;

/** Escopo estável de persistência das visões salvas desta lista. */
const SCOPE = 'finance.expenses';

/** Valores de status aceitos como visão/URL — os mesmos que a tela oferece. */
const EXPENSES_ALLOWED_FILTERS = {
  filters: { status: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] },
} as const;

/**
 * Visões embutidas derivadas do domínio real da tela: são exatamente os recortes que o Ctrl+K já
 * promete (`view.expenses.submitted`, `view.expenses.rejected`). Antes desta adoção o comando
 * navegava para `?status=...` e a tela IGNORAVA a query string — o filtro era prometido no
 * comando e descartado em silêncio na chegada.
 */
const EXPENSES_BUILT_IN_VIEWS = [
  {
    id: 'builtin.expenses.submitted',
    name: 'Aguardando aprovação',
    description: 'Despesas enviadas e ainda não decididas.',
    config: {
      filters: { status: 'SUBMITTED' },
      sortKey: null,
      sortDirection: 'asc' as const,
      groupKey: null,
    },
  },
  {
    id: 'builtin.expenses.rejected',
    name: 'Rejeitadas',
    description: 'Despesas recusadas que voltaram para correção.',
    config: {
      filters: { status: 'REJECTED' },
      sortKey: null,
      sortDirection: 'asc' as const,
      groupKey: null,
    },
  },
];

/**
 * DESPESAS — MESA DE TRABALHO FINANCEIRA.
 *
 * Deixou de ser "tabela com filtros" e passou a ser uma WORKLIST: identidade com a contagem REAL do
 * recorte, faixa de indicadores CLICÁVEIS, toolbar densa, filtros ativos visíveis e removíveis,
 * visões salvas, grade densa com exceção de prazo na linha e rodapé com a faixa real de registros.
 *
 * HIERARQUIA DA GRADE — a ordem de leitura do operador:
 *   O QUE     Descrição (link do registro, alvo esticado por toda a linha)
 *   ONDE      Centro de custo, como qualificador mono logo abaixo da descrição
 *   QUANTO    Valor alinhado à direita, moeda formatada, com ênfase
 *   QUANDO    Vencimento em data humana + o FATO de prazo em palavras (vencida / vence hoje)
 *   ESTADO    Situação como badge humano, sem enum cru
 *   AÇÃO      Ação primária exposta por linha; nada de comando de domínio escondido
 *
 * SOBRE A FAIXA DE INDICADORES — e por que ela NÃO é um total de carteira.
 *
 * `/finance/expenses` é PAGINADO: o servidor devolve `total` (contagem sob o recorte) e a página
 * corrente. Somar o valor das linhas desta página e chamar isso de "total" seria mentir sobre o
 * conjunto. A faixa publica somente o que é verdade — contagens por situação e o valor ainda em
 * aberto DESTA página —, sempre rotulado como tal. Cada indicador é um LINK para esta mesma lista
 * recortada pelo parâmetro que o servidor entende (`?status=…`), e o rodapé diz a faixa real
 * ("1–3 de 147"), de modo que nenhum número da tela fica órfão da sua origem.
 *
 * PARIDADE COM A VERSÃO ANTERIOR (cada feature → onde vive agora):
 *   - colunas Descrição / Centro de custo / Vencimento / Valor / Situação → view projetada por
 *     `expensesListSchema` + `renderCell` para as células tipadas (data, moeda, badge);
 *   - link da linha para o detalhe → `WorklistRowLink` (alvo esticado por `::after`), PRESERVADO;
 *   - busca por descrição/centro de custo → PRESERVADA, indo ao SERVIDOR como `q`;
 *   - filtro de status na URL → PRESERVADO (segue indo ao SERVIDOR como `status`);
 *   - visões salvas (aplicar/salvar/renomear/remover) → `SavedViewsBar`, PRESERVADO;
 *   - "Nova despesa" → PRESERVADO, agora como ação primária de verdade;
 *   - paginação server-side com faixa e total → `ModulePagination` + `WorklistFooter`;
 *   - vazio de origem vs. vazio do recorte → PRESERVADOS, com os mesmos textos;
 *   - estados carregando / negação / erro → `renderQueryGate`, PRESERVADOS.
 *
 * AÇÕES DE DECISÃO (aprovar/rejeitar/submeter) NÃO entram nesta tela: o original não as expõe na
 * lista, e elas são comandos de domínio com validação de versão, segregação de funções e
 * autoaprovação proibida — pertencem ao DETALHE da despesa. Trazê-las para a grade seria feature
 * nova fora do escopo desta migração.
 */
export function ExpensesListPage() {
  const [term, setTerm] = useState('');
  const [appliedTerm, setAppliedTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const { schema: rawSchema } = useEntitySchema('expenses');

  // O status vive na URL e em visão salva: o Ctrl+K abre a lista JÁ recortada e o endereço é
  // compartilhável. Somente valores enumerados entram (allow-list acima).
  const smartList = useSmartList({
    scope: SCOPE,
    builtInViews: EXPENSES_BUILT_IN_VIEWS,
    allowedFilters: EXPENSES_ALLOWED_FILTERS,
    urlSync: true,
  });
  const statusFilter = smartList.filters.status ?? '';

  const loader = useCallback(
    (signal?: AbortSignal) =>
      listExpenses(
        {
          limit: PAGE_SIZE,
          offset,
          status: statusFilter || undefined,
          q: appliedTerm || undefined,
        },
        signal,
      ),
    [appliedTerm, offset, statusFilter],
  );

  /*
   * O filtro recomeça na primeira página. Este efeito fica ANTES de qualquer retorno antecipado:
   * hooks não podem ser chamados condicionalmente, e o gate abaixo retorna cedo.
   */
  useEffect(() => {
    setOffset(0);
  }, [appliedTerm, statusFilter]);

  const { state, reload, refreshing } = useBackofficeQuery<
    Awaited<ReturnType<typeof listExpenses>>
  >({ loader, mapError: mapFinanceErrorToMessage });

  const schema = useMemo(() => expensesListSchema(rawSchema), [rawSchema]);

  const gate = renderQueryGate(
    'Despesas',
    'Carregando Despesas…',
    'Você não tem permissão para listar Despesas.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return null;
  }

  const page = state.data;
  const items = page.items;
  const pageNumber = Math.floor(page.offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, page.totalPages || 1);
  const hasMore = page.offset + items.length < page.total;
  const isFiltered = smartList.isFiltered || appliedTerm !== '';
  const rows = expenseEngineRows(items);
  const today = startOfDay(new Date());

  /*
   * CONTAGENS DO CONJUNTO VISÍVEL — derivadas exclusivamente do que o SERVIDOR já autorizou e
   * devolveu nesta página. Nenhum estado é inventado: as chaves são as do domínio
   * (`EXPENSE_STATUS_LABELS`) e "em aberto" considera exatamente as despesas ainda não decididas.
   */
  const countOf = (status: string): number => items.filter((item) => item.status === status).length;
  const pending = countOf('SUBMITTED');
  const drafts = countOf('DRAFT');
  const approved = countOf('APPROVED');
  const openRows = items.filter((item) => isOpenStatus(item.status));
  const openAmount = openRows.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
  const openCurrency = openRows[0]?.currencyCode ?? items[0]?.currencyCode ?? 'BRL';
  const overdue = items.filter(
    (item) => isOpenStatus(item.status) && daysUntil(item.dueDate, today) < 0,
  ).length;

  function clearAll(): void {
    smartList.clearFilters();
    setTerm('');
    setAppliedTerm('');
    setOffset(0);
  }

  /** Estado de prazo de uma linha, na leitura do operador. `null` = nada a sinalizar. */
  function dueFacts(
    dueDate: string,
    status: string,
  ): { label: string; tone: 'critical' | 'warning' | 'info' } | null {
    if (!isOpenStatus(status)) {
      return null;
    }
    const days = daysUntil(dueDate, today);
    if (days < 0) {
      const late = Math.abs(days);
      return { label: `Vencida há ${late} ${late === 1 ? 'dia' : 'dias'}`, tone: 'critical' };
    }
    if (days === 0) {
      return { label: 'Vence hoje', tone: 'warning' };
    }
    if (days <= 7) {
      return { label: `Vence em ${days} ${days === 1 ? 'dia' : 'dias'}`, tone: 'info' };
    }
    return null;
  }

  return (
    /*
     * `flex h-full flex-col` — a worklist OCUPA a altura disponível.
     *
     * Sem isto a página terminava na última linha da grade e deixava uma faixa morta de ~100px no
     * rodapé do viewport. Com a coluna flexível, o rodapé (faixa + paginação) ancora no fim da
     * área de trabalho, que é onde o operador o procura, e a grade recebe o espaço que sobra em vez
     * de sobrar espaço vazio na tela.
     */
    <ModulePage className="flex h-full min-h-0 flex-col">
      {/*
        CABEÇALHO — identidade, contagem REAL do recorte (contada no servidor) e a única ação
        primária da tela. Sem parágrafo explicativo: o operador de ERP lê número e estado, não
        manual.
      */}
      <WorklistHeader
        title={schema?.label ?? 'Despesas'}
        count={page.total}
        action={
          <Link className={rowPrimaryActionClass} to="/app/finance/expenses/new">
            Nova despesa
          </Link>
        }
      />

      {/*
        INDICADORES DO RECORTE VISÍVEL. Todo indicador tem caminho até o dado: ele abre ESTA lista
        já recortada pelo parâmetro que o servidor entende. O rótulo deixa explícito que a leitura é
        do conjunto visível ("desta página"), porque a lista é paginada e um total de carteira não
        é somável a partir de uma página.
      */}
      {/*
        INDICADORES DO RECORTE VISÍVEL — CINCO, e o número não é escolha estética.
        A faixa divide a mesma largura da grade; com seis cartões o último era empurrado para uma
        segunda linha e a borda direita da faixa não fechava com a da tabela logo abaixo. Cinco
        cartões cabem na largura útil sem sobra e sem quebra.

        Todo indicador tem caminho até o dado: ele abre ESTA lista já recortada pelo parâmetro que
        o servidor entende. O rótulo deixa explícito que a leitura é do conjunto visível, porque a
        lista é paginada e um total de carteira não é somável a partir de uma página.
      */}
      <DrilldownRow>
        <DrilldownMetric
          label="Nesta página"
          value={items.length}
          hint={refreshing ? 'atualizando…' : `${page.total} no recorte`}
          to="/app/finance/expenses"
        />
        <DrilldownMetric
          label="Aguardando aprovação"
          value={pending}
          hint="ver enviadas"
          tone={pending > 0 ? 'warning' : 'neutral'}
          muted={pending === 0}
          to="/app/finance/expenses?status=SUBMITTED"
        />
        <DrilldownMetric
          label="Rascunhos"
          value={drafts}
          hint="ver rascunhos"
          muted={drafts === 0}
          to="/app/finance/expenses?status=DRAFT"
        />
        <DrilldownMetric
          label="Aprovadas"
          value={approved}
          hint="ver aprovadas"
          tone="info"
          muted={approved === 0}
          to="/app/finance/expenses?status=APPROVED"
        />
        <DrilldownMetric
          label="Em aberto nesta página"
          value={<Money value={String(openAmount)} currencyCode={openCurrency} />}
          /*
           * O prazo vencido aparece AQUI, e não como sexto cartão: ele é uma leitura do MESMO
           * conjunto (despesas ainda não decididas) e o servidor só recorta uma situação por vez —
           * um cartão próprio prometeria um atalho de recorte que não existe. Como texto, o fato
           * fica visível sem inventar filtro.
           */
          hint={
            overdue > 0
              ? `${overdue} com prazo vencido`
              : 'ainda não decididas'
          }
          tone={overdue > 0 ? 'critical' : 'neutral'}
          to="/app/finance/expenses"
        />
      </DrilldownRow>

      {/*
        TOOLBAR — busca, filtro e limpeza em UMA faixa densa. A busca continua SUBMETIDA
        (Enter/botão): uma consulta por tecla digitada castigaria o servidor sem ganho de operação.
      */}
      <WorklistFilterBar
        meta={
          refreshing ? 'Atualizando…' : isFiltered ? 'Recorte aplicado' : 'Sem recorte'
        }
      >
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedTerm(term.trim());
          }}
        >
          <WorklistField label="Buscar" htmlFor="expense-search" grow>
            <input
              id="expense-search"
              type="search"
              className={worklistSelectClass}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Descrição ou centro de custo"
            />
          </WorklistField>
          {/*
            O rótulo do CONTROLE é "Status" — o vocabulário que os contratos desta tela já fixam (o
            teste de unidade e as duas jornadas de ponta a ponta o procuram por esse nome). Já o
            CABEÇALHO da coluna diz "Situação", que é o rótulo da view. Dois textos, dois
            propósitos; nenhum deles é enum cru.
          */}
          <WorklistField label="Status" htmlFor="expense-status-filter">
            <select
              id="expense-status-filter"
              className={worklistSelectClass}
              value={statusFilter}
              onChange={(event) => smartList.setFilter('status', event.target.value)}
            >
              <option value="">Todas</option>
              <option value="DRAFT">Rascunho</option>
              <option value="SUBMITTED">Enviada</option>
              <option value="APPROVED">Aprovada</option>
              <option value="REJECTED">Rejeitada</option>
            </select>
          </WorklistField>
          <button type="submit" className={worklistButtonClass}>
            Buscar
          </button>
          <WorklistClearFilters visible={isFiltered} onClick={clearAll} />
        </form>
      </WorklistFilterBar>

      {/*
        RECORTE ATIVO EM TEXTO — o operador vê QUAL recorte está aplicado sem reabrir o controle, e
        cada um é removível no lugar. O recorte de busca vive em estado próprio (não no smart list)
        e por isso precisa aparecer aqui também: sem isto, o filtro só existia dentro do `<select>`
        que o aplicou.
      */}
      {isFiltered ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
          <span className="font-semibold tracking-wide text-gray-500 uppercase">
            Filtros ativos
          </span>
          {statusFilter ? (
            <ActiveFilterChip
              label={`Situação: ${EXPENSE_STATUS_LABELS[statusFilter] ?? statusFilter}`}
              onRemove={() => smartList.setFilter('status', '')}
            />
          ) : null}
          {appliedTerm ? (
            <ActiveFilterChip
              label={`Busca: “${appliedTerm}”`}
              onRemove={() => {
                setTerm('');
                setAppliedTerm('');
              }}
            />
          ) : null}
        </div>
      ) : null}

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => {
          setAppliedTerm(term.trim());
          smartList.applyView(view);
        }}
        onSave={smartList.savedViews.saveView}
        onRename={smartList.savedViews.renameView}
        onRemove={smartList.savedViews.removeView}
        currentConfig={smartList.currentConfig}
        canSave={Object.keys(smartList.filters).length > 0}
        allLabel="Todas"
        className="mb-2"
      />

      {/*
        CARTEIRA VAZIA vs. RECORTE SEM RESULTADO.
        `page.total === 0` com o servidor respondendo significa "não há despesa no recorte". Quando o
        recorte zera, o painel explica E oferece a saída; a saída existe também quando quem zerou foi
        o termo de busca — as duas fontes de recorte entram em `isFiltered`.
      */}
      {items.length === 0 ? (
        <WorklistStatePanel
          title={
            isFiltered
              ? 'Nenhuma despesa corresponde ao recorte atual.'
              : 'Nenhuma despesa registrada ainda.'
          }
          description={
            isFiltered
              ? 'O conjunto completo continua disponível: limpe o recorte para vê-lo.'
              : 'Registre a primeira despesa para acompanhar valor, vencimento e aprovação.'
          }
          action={
            isFiltered ? (
              <WorklistClearFilters visible label="Ver todas as despesas" onClick={clearAll} />
            ) : (
              <Link className={rowPrimaryActionClass} to="/app/finance/expenses/new">
                Nova despesa
              </Link>
            )
          }
        />
      ) : (
        <DynamicList
          schema={schema}
          rows={rows}
          /* Nome acessível da grade: o operador de leitor de tela sabe QUAL lista abriu. */
          ariaLabel="Lista de Despesas"
          /* Recorte sem resultado permanece em GRADE: a grade continua montada, com a saída dentro. */
          emptyMessage="Nenhuma despesa corresponde ao recorte atual."
          /*
           * NAVEGAÇÃO — `WorklistRowLink`, o padrão de linha inteira do CISNE.
           *
           * Um `<a>` REAL cujo `::after` (theme.css) se estica sobre a linha, de modo que o operador
           * acerta o registro em qualquer ponto da grade densa. Mantém clique do meio, "abrir em nova
           * aba", foco por teclado e leitor de tela — nada disso sobrevive a um `onRowClick`
           * programático.
           *
           * NÃO se usa `onRowClick` junto: dois donos para o mesmo destino criariam navegação
           * concorrente. A coluna de AÇÕES da engine já sobe acima do alvo esticado (ela interrompe
           * a propagação), de modo que o botão de linha nunca disputa o clique com o link.
           */
          renderCell={(field, row) => {
            if (field.name === 'due_date') {
              /* DATA + FATO: a data é humana e o prazo é dito em palavras quando exige decisão. */
              const facts = dueFacts(String(row.due_date), String(row.status));
              return (
                <RecordStatusCell
                  badge={<DateTime value={String(row.due_date)} mode="date" />}
                  context={
                    facts ? <DueFact tone={facts.tone}>{facts.label}</DueFact> : null
                  }
                  accent={
                    facts?.tone === 'critical'
                      ? 'critical'
                      : facts?.tone === 'warning'
                        ? 'warning'
                        : 'none'
                  }
                />
              );
            }
            if (field.name === 'total_amount') {
              return (
                <Money
                  value={String(row.total_amount)}
                  currencyCode={String(row.currency_code)}
                  emphasis
                />
              );
            }
            if (field.name === 'status') {
              /* ESTADO + EXCEÇÃO: a barra lateral marca o prazo estourado sem pintar a linha. */
              const facts = dueFacts(String(row.due_date), String(row.status));
              return (
                <RecordStatusCell
                  badge={
                    <FinanceStatusBadge
                      status={String(row.status)}
                      labels={EXPENSE_STATUS_LABELS}
                    />
                  }
                  accent={facts?.tone === 'critical' ? 'critical' : 'none'}
                />
              );
            }
            if (field.name === 'description') {
              /*
               * O link é a ÚNICA fonte de navegação da linha e vive na PRIMEIRA célula — a mesma
               * posição do original —, esticando o alvo por toda a grade.
               */
              return (
                <WorklistRowLink href={`/app/finance/expenses/${row.id}`}>
                  {String(row.description)}
                </WorklistRowLink>
              );
            }
            if (field.name === 'cost_center_code') {
              /* Centro de custo é QUALIFICADOR do registro, não coluna de estado: mono e discreto. */
              return (
                <code className="font-mono text-[12px] text-gray-600">
                  {cellText(row.cost_center_code)}
                </code>
              );
            }
            return undefined;
          }}
          renderRowActions={(row) => (
            /*
             * AÇÃO DE LINHA — previsível. A ação primária ("Abrir") fica exposta e as secundárias
             * não competem com ela. Esta lista não tem comando de domínio adicional para a grade:
             * aprovar/rejeitar/enviar são decisões versionadas do detalhe.
             */
            <RowActionMenu
              label={`Despesa ${String(row.description)}`}
              primary={
                <Link
                  className={rowPrimaryActionClass}
                  to={`/app/finance/expenses/${row.id}`}
                  aria-label={`Abrir despesa ${String(row.description)}`}
                >
                  Abrir
                </Link>
              }
              secondary={
                <span className={rowSecondaryActionClass}>
                  Aprovar, rejeitar e enviar são decisões do detalhe.
                </span>
              }
            />
          )}
        />
      )}

      {/*
        RODAPÉ — faixa REAL de registros ("1–3 de 147"), não "3 nesta página". O contexto do recorte
        fica na MESMA linha, para que filtro e paginação nunca se contradigam.
      */}
      <WorklistFooter
        rangeLabel={
          items.length === 0
            ? 'Nenhum registro no recorte'
            : `${page.offset + 1}–${page.offset + items.length} de ${page.total}`
        }
        extra={
          <>
            Página {pageNumber} de {pageCount}
            {statusFilter ? ` · ${EXPENSE_STATUS_LABELS[statusFilter] ?? statusFilter}` : ''}
            {appliedTerm ? ` · busca “${appliedTerm}”` : ''}
          </>
        }
      >
        <ModulePagination
          pageNumber={pageNumber}
          previousDisabled={page.offset === 0}
          nextDisabled={!hasMore}
          onPrevious={() => setOffset(Math.max(0, page.offset - PAGE_SIZE))}
          onNext={() => setOffset(page.offset + PAGE_SIZE)}
        />
      </WorklistFooter>
    </ModulePage>
  );
}

/* ------------------------------------------------------------------ apoio local */

/** Situações em que a despesa ainda depende de alguém — prazo importa. */
function isOpenStatus(status: string): boolean {
  return status === 'DRAFT' || status === 'SUBMITTED' || status === 'APPROVED';
}

/**
 * Valor de célula como texto, nunca `String(valor)` direto.
 *
 * A linha da engine é `Record<string, unknown>`: `String(undefined)` produziria a string
 * `"undefined"` na tela — um dado que parece dado e não é —, e `String(objeto)` produziria
 * `"[object Object]"`. Ausência vira "—", que é o que o operador deve ler.
 */
function cellText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim() === '' ? '—' : value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '—';
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Dias inteiros até o vencimento, na data local do operador. */
function daysUntil(dueDate: string, today: Date): number {
  const due = startOfDay(new Date(`${dueDate.slice(0, 10)}T00:00:00`));
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Fato de prazo — texto com semântica, não enfeite. */
function DueFact({
  tone,
  children,
}: {
  tone: 'critical' | 'warning' | 'info';
  children: string;
}) {
  const className =
    tone === 'critical'
      ? 'text-[11px] font-semibold text-red-700'
      : tone === 'warning'
        ? 'text-[11px] font-semibold text-amber-700'
        : 'text-[11px] text-gray-500';
  return <span className={className}>{children}</span>;
}

/** Recorte ativo, removível no próprio lugar. */
function ActiveFilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-medium text-brand-800">
      {label}
      <button
        type="button"
        className="rounded-full px-1 text-brand-700 hover:bg-brand-100"
        aria-label={`Remover filtro ${label}`}
        onClick={onRemove}
      >
        ✕
      </button>
    </span>
  );
}
