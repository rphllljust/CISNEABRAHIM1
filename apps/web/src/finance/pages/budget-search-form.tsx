import { useState } from 'react';
import { WorklistClearFilters, WorklistField, WorklistFilterBar, worklistButtonClass, worklistSelectClass } from '../../ui/enterprise-list';

/**
 * Busca e recorte de status da lista de Orçamentos.
 *
 * Existe como componente próprio por uma razão de TAMANHO, declarada: a página precisa caber em
 * 150 linhas para que o encanamento (endpoint, filtros na URL, paginação) continue legível. Este
 * formulário é a única parte da tela que ainda desenha controles à mão, porque a entidade
 * `budgets` NÃO declara nenhum campo com `in_filter` — e a `DynamicFilterBar` só desenha o que o
 * metadado declara. Inventar o filtro dentro da engine seria hardcode de negócio.
 *
 * A FAIXA é a mesma `WorklistFilterBar` das outras listas financeiras: rótulo do controle acima
 * do campo, busca submetida (Enter/botão) e limpeza no lugar. O que era artesanal aqui — rótulo
 * solto ao lado do input, botões com estilo próprio — destoava do resto do domínio.
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
    <WorklistFilterBar meta={isFiltered ? 'Recorte aplicado' : 'Sem recorte'}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onChange('code', term.trim());
        }}
      >
        <WorklistField label="Buscar" htmlFor="budget-search" grow>
          <input
            id="budget-search"
            type="search"
            className={worklistSelectClass}
            placeholder="Código ou nome"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </WorklistField>

        {/*
          O recorte de status vem da URL e é o MESMO valor que o Ctrl+K publica (`?status=DRAFT`).
          O `select` fica sempre presente — escondido até haver recorte, o operador não teria como
          APLICAR um, e a visão embutida "Em rascunho" ficaria sem controle na tela.
        */}
        <WorklistField label="Situação" htmlFor="budget-status-filter">
          <select
            id="budget-status-filter"
            className={worklistSelectClass}
            value={statusFilter}
            onChange={(event) => onChange('status', event.target.value)}
          >
            <option value="">Todos</option>
            <option value="DRAFT">Rascunho</option>
            <option value="APPROVED">Aprovado</option>
            <option value="SUPERSEDED">Substituído</option>
          </select>
        </WorklistField>

        <button type="submit" className={worklistButtonClass}>
          Buscar
        </button>
        <WorklistClearFilters
          visible={isFiltered}
          onClick={() => {
            setTerm('');
            onClear();
          }}
        />
      </form>
    </WorklistFilterBar>
  );
}
