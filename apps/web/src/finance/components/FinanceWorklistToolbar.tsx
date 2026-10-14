import { useId, type ReactNode } from 'react';
import { cn } from '../../ui/utils/cn';
import {
  FINANCE_SORT_LABELS,
  type FinanceSortKey,
  type FinanceSortState,
} from '../utils/finance-aging';

/**
 * BARRA DE FERRAMENTAS DA WORKLIST FINANCEIRA — a faixa unica de consulta.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ISTO CORRIGE
 *
 * As duas worklists financeiras tinham busca do servidor no contrato (`q`, `dueFrom`, `dueTo`,
 * `sortBy`, `sortDir` — ver `buildFinanceTitleQuery`) e NAO publicavam nenhum controle para ela. O
 * operador via uma grade paginada de 50 linhas e nenhum caminho para responder "onde esta o titulo
 * do cliente X" ou "o que vence nesta semana" sem sair da tela.
 *
 * Ao mesmo tempo, o filtro que EXISTIA (status) ficava num `<select>` solto, sem indicacao do que
 * estava aplicado. Em uma carteira filtrada, "nenhum titulo" e indistinguivel de "carteira vazia".
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A ORDEM E FIXA EM TODO O PRODUTO
 *
 *   ESQUERDA  views salvas (o recorte que o operador guardou)
 *   DIREITA   busca · vencimento de/ate · ordenacao · aplicar
 *
 * Um operador aprende a posicao uma vez e ela vale em Receber, Pagar e Financeiro. A barra nao
 * esconde estado: quando ha recorte ativo, os chips dizem QUAIS, e cada chip se remove sozinho.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A BUSCA VAI AO SERVIDOR — e a barra diz isso
 *
 * O contrato publica `q` e o servidor aplica sobre o dominio inteiro. Isto e diferente da busca
 * local do painel operacional, que recorta a pagina ja recebida. A distincao nao e detalhe de
 * implementacao: e a diferenca entre "nao existe" e "nao esta nas 50 que eu carreguei", e o
 * placeholder nao pode sugerir a segunda quando entrega a primeira.
 */

export type FinanceToolbarProps = {
  /** Visoes salvas — sempre a esquerda. */
  views?: ReactNode;
  /** Termo de busca atual (controlado pela tela, que o envia ao servidor). */
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /** Vencimento de/ate. Strings `YYYY-MM-DD` do `<input type="date">`. */
  dueFrom: string;
  dueTo: string;
  onDueFromChange: (value: string) => void;
  onDueToChange: (value: string) => void;
  /** Ordenacao da pagina exibida. */
  sort: FinanceSortState;
  onSortChange: (next: FinanceSortState) => void;
  /** Comandos adicionais a direita (exportar, colunas). */
  children?: ReactNode;
  className?: string;
};

/** Altura e tipografia dos controles da barra — uma constante, para as duas listas nao divergirem. */
export const financeControlClass =
  'h-[var(--control-height)] rounded-[3px] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface-raised)] px-2 text-[12px] text-[color:var(--color-text-primary)] focus:border-[color:var(--color-brand-600)] focus:outline-none';

export function FinanceWorklistToolbar({
  views,
  search,
  onSearchChange,
  searchPlaceholder = 'Buscar por documento, referência ou origem…',
  dueFrom,
  dueTo,
  onDueFromChange,
  onDueToChange,
  sort,
  onSortChange,
  children,
  className,
}: FinanceToolbarProps) {
  const searchId = useId();

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[color:var(--color-divider)] pb-2',
        className,
      )}
      data-region="workspace-toolbar"
    >
      {views ? <div className="flex min-w-0 flex-wrap items-center gap-1.5">{views}</div> : null}

      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
        {/*
          BUSCA — `type="search"` para o navegador oferecer o proprio "limpar", e rotulo real
          (`htmlFor`/`id`) porque "buscar" na tela financeira e uma acao com consequencia: ela
          consulta o DOMINIO, nao a pagina.
        */}
        <label htmlFor={searchId} className="cisne-sr-only">
          Buscar títulos no domínio
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className={cn(financeControlClass, 'w-64')}
        />

        {/*
          JANELA DE VENCIMENTO — dois campos, nao um "periodo" pre-definido.
          O contrato aceita `dueFrom`/`dueTo` livres; oferecer presets ("esta semana", "este mes")
          exigiria decidir qual semana e qual mes no navegador, e essa decisao e do operador.
        */}
        <label className="flex items-center gap-1">
          <span className="cisne-meta-label">Vence de</span>
          <input
            type="date"
            value={dueFrom}
            onChange={(event) => onDueFromChange(event.target.value)}
            aria-label="Vencimento a partir de"
            className={financeControlClass}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="cisne-meta-label">até</span>
          <input
            type="date"
            value={dueTo}
            onChange={(event) => onDueToChange(event.target.value)}
            aria-label="Vencimento até"
            className={financeControlClass}
          />
        </label>

        {/*
          ORDENACAO — par chave/direcao, e nao cabecalho clicavel da grade.

          A grade e renderizada pela engine a partir de metadados; os cabecalhos clicaveis dela
          ordenam a AMOSTRA com acessores locais e nao dizem ao servidor nada. Um segundo mecanismo
          de ordenacao sobre o mesmo dado, com semantica diferente, seria a "segunda verdade" que este
          produto recusa. Aqui ha UM lugar que declara a ordem, e ele e explicito sobre o escopo:
          "nesta página".
        */}
        <label className="flex items-center gap-1">
          <span className="cisne-meta-label">Ordenar por</span>
          <select
            value={sort.key}
            onChange={(event) =>
              onSortChange({ ...sort, key: event.target.value as FinanceSortKey })
            }
            aria-label="Ordenar por"
            className={cn(financeControlClass, 'cursor-pointer')}
          >
            {(Object.keys(FINANCE_SORT_LABELS) as FinanceSortKey[]).map((key) => (
              <option key={key} value={key}>
                {FINANCE_SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() =>
            onSortChange({
              ...sort,
              direction: sort.direction === 'asc' ? 'desc' : 'asc',
            })
          }
          aria-label={
            sort.direction === 'asc' ? 'Ordem crescente — inverter' : 'Ordem decrescente — inverter'
          }
          title={sort.direction === 'asc' ? 'Crescente' : 'Decrescente'}
          className={cn(financeControlClass, 'w-8 cursor-pointer px-0 text-center font-semibold')}
        >
          {sort.direction === 'asc' ? '↑' : '↓'}
        </button>

        {children}
      </div>
    </div>
  );
}
