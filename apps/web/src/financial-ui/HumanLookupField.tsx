import { useEffect, useRef, useState } from 'react';
import { Field, Input, Select } from '../ui';
import { cn } from '../ui/utils/cn';

export type HumanLookupOption = {
  id: string;
  label: string;
  /** Documento ou código de apoio exibido junto do nome (nunca o identificador técnico). */
  support?: string;
};

/**
 * Mesma densidade dos controles da barra de filtros da worklist (`worklistControlClass`).
 * Declarado aqui — sem importar do `ui/enterprise-list` — para manter este componente de
 * propósito geral independente da composição visual de lista.
 */
const compactControlClass =
  'rounded border border-gray-300 bg-white px-2 py-1 text-[13px] text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30';

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
  variant = 'field',
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
  /**
   * `field` (padrão) é o campo de formulário: rótulo próprio acima, busca e seleção empilhadas.
   * `compact` é a variante de BARRA DE FILTROS: um único controle denso, do lado dos demais
   * filtros da worklist. Sem ela, um lookup dentro de uma toolbar empilhava rótulo + busca +
   * select e virava uma faixa de 105px ao lado de filtros de 44px — a barra deixava de ser uma
   * linha e a primeira dobra da lista sumia.
   */
  variant?: 'field' | 'compact';
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

  if (variant === 'compact') {
    /*
      VARIANTE DE TOOLBAR — um controle denso, mesma altura dos filtros vizinhos.
      O `label` continua existindo como rótulo acessível (o `<span>` da WorklistField é quem o
      desenha), então nada se perde em semântica; o que sai é o empilhamento vertical que
      quebrava a linha da barra.
    */
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <input
          id={htmlFor}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={placeholder ?? 'Buscar por nome ou documento'}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Buscar ${label.toLowerCase()}`}
          className={cn(compactControlClass, 'w-36')}
        />
        <select
          id={selectId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          aria-label={label}
          className={cn(compactControlClass, 'min-w-40 flex-1 cursor-pointer')}
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
        </select>
        {phase === 'ready' && options.length === 0 ? (
          <span className="text-[11px] text-gray-500" role="status">
            {emptyMessage}
          </span>
        ) : null}
        {phase === 'error' ? (
          <span className="text-[11px] text-red-700" role="alert">
            Não foi possível buscar no servidor.
          </span>
        ) : null}
      </div>
    );
  }

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
