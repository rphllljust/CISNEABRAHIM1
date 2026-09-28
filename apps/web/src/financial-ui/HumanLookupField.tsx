import { useEffect, useRef, useState } from 'react';
import { Field, Input, Select } from '../ui';

export type HumanLookupOption = {
  id: string;
  label: string;
  /** Documento ou código de apoio exibido junto do nome (nunca o identificador técnico). */
  support?: string;
};

/**
 * Seleção humana de uma entidade que a API endereça por identificador.
 *
 * O operador procura por termo livre (nome/documento) e escolhe em uma lista carregada pelo
 * servidor; o identificador técnico é mantido apenas internamente e nunca é digitado. Componente
 * de propósito geral: qualquer módulo que precise trocar "campo de UUID" por escolha humana usa
 * este mesmo componente, com o próprio serviço de busca.
 *
 * Quando a busca não devolve nada, o componente diz isso — não inventa opções nem oferece um
 * campo de identificador como saída.
 */
export function HumanLookupField({
  label,
  htmlFor,
  required,
  hint,
  placeholder,
  search,
  value,
  onChange,
  emptyMessage = 'Nenhum registro encontrado para a busca.',
  emptyOptionLabel,
  className,
  initialLabel,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  search: (term: string, signal?: AbortSignal) => Promise<HumanLookupOption[]>;
  value: string;
  onChange: (id: string) => void;
  emptyMessage?: string;
  /** Rótulo da opção vazia. Em filtro, "Todos" é mais honesto que "Selecione". */
  emptyOptionLabel?: string;
  className?: string;
  /** Rótulo já conhecido (ex.: vindo do próprio registro) para exibir sem nova busca. */
  initialLabel?: string;
}) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<HumanLookupOption[]>([]);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPhase('loading');
      void searchRef
        .current(term, controller.signal)
        .then((items) => {
          setOptions(items);
          setPhase('ready');
        })
        .catch(() => {
          setOptions([]);
          setPhase('error');
        });
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  const selectedOption = options.find((option) => option.id === value);
  const selectId = `${htmlFor}-select`;

  return (
    <div className={className}>
      <Field label={label} htmlFor={selectId} required={required} hint={hint}>
        <Input
          id={htmlFor}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={placeholder ?? 'Buscar por nome ou documento'}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Buscar ${label.toLowerCase()}`}
        />
        <Select
          id={selectId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          className="mt-2"
        >
          <option value="">
            {phase === 'loading'
              ? 'Buscando…'
              : (emptyOptionLabel ?? `Selecione ${label.toLowerCase()}`)}
          </option>
          {value !== '' && !selectedOption ? (
            <option value={value}>{initialLabel ?? 'Selecionado'}</option>
          ) : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.support ? `${option.label} — ${option.support}` : option.label}
            </option>
          ))}
        </Select>
      </Field>
      {phase === 'ready' && options.length === 0 ? (
        <p className="mt-1 text-sm text-gray-500" role="status">
          {emptyMessage}
        </p>
      ) : null}
      {phase === 'error' ? (
        <p className="mt-1 text-sm text-red-700" role="alert">
          Não foi possível buscar no servidor. Tente novamente.
        </p>
      ) : null}
    </div>
  );
}
