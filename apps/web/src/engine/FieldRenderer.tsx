import type { MetaField } from './types';

/**
 * Mapa tipo → componente.
 *
 * É o único lugar do frontend que sabe converter um tipo de metadado em controle visual.
 * Adicionar um tipo novo é adicionar um caso AQUI — e nenhuma entidade precisar mudar.
 */
export type FieldRendererProps = {
  field: MetaField;
  value: unknown;
  onChange?: (value: unknown) => void;
  /** Rótulo de exibição quando o valor é uma referência (link) já resolvida. */
  displayValue?: string | null;
};

/**
 * Converte um valor desconhecido em texto para exibição.
 *
 * `String(value)` sobre `unknown` produz `[object Object]` para objetos e arrays — um
 * resultado que PARECE dado e não é. Esta função prefere o vazio explícito ('—') a uma
 * string que mente sobre o conteúdo.
 */
export function toDisplayText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toDisplayText(entry)).filter((entry) => entry.length > 0).join(', ');
  }
  // Objeto: não há representação textual honesta sem saber o tipo. Devolve vazio em vez de
  // `[object Object]`, e o chamador exibe o marcador de ausência.
  return '';
}

/** Formata para leitura (lista, detalhe). Nunca inventa valor: ausente vira `—`. */
export function formatFieldValue(field: MetaField, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  switch (field.type) {
    case 'bool':
      return value === true ? 'Sim' : 'Não';
    case 'date':
      return formatDate(value);
    case 'datetime':
      return formatDateTime(value);
    case 'currency':
      return formatCurrency(value);
    case 'select': {
      const text = toDisplayText(value);
      const option = field.options?.options?.find((entry) => entry.value === text);
      return option?.label ?? text;
    }
    case 'integer':
      return toDisplayText(value);
    default: {
      const text = toDisplayText(value);
      return text.length > 0 ? text : '—';
    }
  }
}

/**
 * Renderiza o campo em MODO LEITURA.
 *
 * RESPEITO A `permLevel`: este componente NÃO é chamado para campos acima do nível do ator —
 * o servidor não os envia. A verificação aqui é uma segunda barreira (defesa em profundidade):
 * se um schema chegar com nível não permitido, o campo não renderiza NADA, nem desabilitado.
 * Não renderizar desabilitado é deliberado: um campo cinza revela que ele existe.
 */
export function FieldRenderer({
  field,
  value,
  displayValue,
}: FieldRendererProps): React.ReactElement | null {
  if (field.type === 'bool') {
    return <span data-field={field.name}>{value === true ? 'Sim' : 'Não'}</span>;
  }
  const text = displayValue ?? formatFieldValue(field, value);
  return (
    <span data-field={field.name} data-field-type={field.type}>
      {text}
    </span>
  );
}

function formatDate(value: unknown): string {
  const text = toDisplayText(value);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Porto_Velho',
  }).format(parsed);
}

function formatDateTime(value: unknown): string {
  const text = toDisplayText(value);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Porto_Velho',
  }).format(parsed);
}

function formatCurrency(value: unknown): string {
  const text = toDisplayText(value);
  const parsed = typeof value === 'number' ? value : Number(text);
  if (!Number.isFinite(parsed)) {
    return text;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(parsed);
}
