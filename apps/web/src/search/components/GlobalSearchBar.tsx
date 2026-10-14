import { useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { readRecentSearches } from '../hooks/useGlobalSearch';
import { cn } from '../../ui/utils/cn';

type GlobalSearchBarProps = {
  compact?: boolean;
};

export function GlobalSearchBar({ compact = false }: GlobalSearchBarProps) {
  const navigate = useNavigate();
  const inputId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const recentSearches = readRecentSearches();

  // Ctrl+K passou a ser propriedade exclusiva do Command Center
  // (`operator/commands/CommandPalette`). Dois donos no mesmo gesto fariam o
  // atalho focar o campo E abrir a paleta — por isso este listener foi removido.
  // A busca direta continua disponível clicando no campo ou enviando o formulário.

  function submitSearch(nextValue = value) {
    const trimmed = nextValue.trim();
    if (trimmed.length < 2) {
      return;
    }
    void navigate(`/app/search?q=${encodeURIComponent(trimmed)}`);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, recentSearches.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, -1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0 && recentSearches[activeIndex]) {
        submitSearch(recentSearches[activeIndex]);
        return;
      }
      submitSearch();
    }
    if (event.key === 'Escape') {
      inputRef.current?.blur();
    }
  }

  if (compact) {
    return (
      <div className="relative w-full min-w-0">
        <label className="cisne-sr-only" htmlFor={inputId}>
          Busca global
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-on-shell-muted)]"
          strokeWidth={2.2}
          aria-hidden
        />
        <input
          ref={inputRef}
          id={inputId}
          /*
            BUSCA DE APPLICATION SHELL — surface tonal, borda quase invisivel, foco azul forte.

            O campo e o maior alvo da topbar (35-40% da largura util) e por isso ele NAO e um
            controle de formulario: e uma superficie de consulta. `--color-search-surface` sobre a
            topbar branca separa os dois planos sem borda pesada; o foco troca para branco + ring
            azul, que e quando o operador esta de fato digitando.
          */
          className="w-full rounded-md border border-[var(--color-search-border)] bg-[var(--color-search-surface)] py-2 pr-3 pl-9 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-on-shell-muted)] focus:border-[var(--color-cisne-action)] focus:bg-white focus:ring-2 focus:ring-[var(--color-cisne-action)]/25"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={recentSearches.length > 0}
          aria-controls={listboxId}
          placeholder="Buscar clientes, OS, contrato, proposta, medição, faturamento…"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onInputKeyDown}
        />
        {recentSearches.length > 0 ? (
          <ul
            id={listboxId}
            className="absolute top-[calc(100%+0.25rem)] right-0 left-0 z-[var(--z-dropdown)] m-0 list-none rounded-lg border border-[var(--color-divider)] bg-white p-1 shadow-[0_10px_24px_rgb(7_24_39/12%)]"
            role="listbox"
          >
            {recentSearches.map((entry, index) => (
              <li key={entry} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)]',
                    index === activeIndex ? 'bg-[var(--color-surface-highlight)]' : 'hover:bg-[var(--color-surface-hover)]',
                  )}
                  onClick={() => submitSearch(entry)}
                >
                  {entry}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative w-full min-w-0">
      <label className="cisne-sr-only" htmlFor={inputId}>
        Busca global
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400"
          strokeWidth={2}
          aria-hidden
        />
        <input
          ref={inputRef}
          id={inputId}
          className="w-full rounded-md border-0 bg-gray-100 py-2 pr-24 pl-9 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-brand-500 focus:ring-inset"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={recentSearches.length > 0}
          aria-controls={listboxId}
          placeholder="Buscar clientes, OS, PO…"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onInputKeyDown}
        />
        <button
          type="button"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md bg-brand-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
          onClick={() => submitSearch()}
        >
          Buscar
        </button>
      </div>
      {recentSearches.length > 0 ? (
        <ul
          id={listboxId}
          className="absolute top-[calc(100%+0.25rem)] right-0 left-0 z-[var(--z-dropdown)] m-0 list-none rounded-lg bg-white p-1 shadow-md ring-1 ring-gray-900/5"
          role="listbox"
        >
          {recentSearches.map((entry, index) => (
            <li key={entry} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                className={cn(
                  'w-full rounded-md px-3 py-2 text-left text-sm text-gray-700',
                  index === activeIndex ? 'bg-gray-100' : 'hover:bg-gray-50',
                )}
                onClick={() => submitSearch(entry)}
              >
                {entry}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
