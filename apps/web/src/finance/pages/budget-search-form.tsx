import { useState } from 'react';

/**
 * Busca e recorte de status da lista de Orçamentos.
 *
 * Existe como componente próprio por uma razão de TAMANHO, declarada: a página precisa caber em
 * 150 linhas para que o encanamento (endpoint, filtros na URL, paginação) continue legível. Este
 * formulário é a única parte da tela que ainda desenha controles à mão, porque a entidade
 * `budgets` NÃO declara nenhum campo com `in_filter` — e a `DynamicFilterBar` só desenha o que o
 * metadado declara. Inventar o filtro dentro da engine seria hardcode de negócio.
 *
 * O que ele NÃO faz: decidir onde o filtro vive. Os valores sobem por `onChange`, que a página
 * traduz para a query string — o mesmo caminho que a barra da engine usaria.
 */
export type BudgetSearchFormProps = {
  statusFilter: string;
  isFiltered: boolean;
  onChange: (field: string, value: string) => void;
  onClear: () => void;
};

export function BudgetSearchForm({
  statusFilter,
  isFiltered,
  onChange,
  onClear,
}: BudgetSearchFormProps): React.ReactElement {
  const [term, setTerm] = useState('');

  return (
    <form
      className="mb-3 flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onChange('code', term.trim());
      }}
    >
      <label className="text-xs font-medium text-gray-700" htmlFor="budget-search">
        Buscar
      </label>
      <input
        id="budget-search"
        type="search"
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        placeholder="Código ou nome"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />

      {/*
        O recorte de status vem da URL e é o MESMO valor que o Ctrl+K publica (`?status=DRAFT`).
        O `select` fica sempre presente — escondido até haver recorte, o operador não teria como
        APLICAR um, e a visão embutida "Em rascunho" ficaria sem controle na tela.
      */}
      <label className="text-xs text-gray-700" htmlFor="budget-status-filter">
        Status
      </label>
      <select
        id="budget-status-filter"
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        value={statusFilter}
        onChange={(event) => onChange('status', event.target.value)}
      >
        <option value="">Todos</option>
        <option value="DRAFT">Rascunho</option>
        <option value="APPROVED">Aprovado</option>
        <option value="SUPERSEDED">Substituído</option>
      </select>

      <button type="submit" className="rounded border border-slate-300 px-2 py-1 text-xs">
        Buscar
      </button>
      {isFiltered ? (
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-xs"
          onClick={() => {
            setTerm('');
            onClear();
          }}
        >
          Limpar filtros
        </button>
      ) : null}
    </form>
  );
}
