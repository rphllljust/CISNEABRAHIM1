import { useMemo } from 'react';
import { t } from '../i18n';
import type { DynamicListRow } from './DynamicList';
import type { MetaEntitySchema, MetaView } from './types';
import { fieldLabel, findView, readFieldName, type ViewLayout } from './view-layout';

/**
 * VISÃO DE CALENDÁRIO dirigida por metadado.
 *
 * Lê `meta.views[viewType='calendar'].layout`:
 *   - `dateField`  — QUAL campo posiciona o registro no dia (obrigatório)
 *   - `titleField` — o que aparece no cartão do dia (default: `schema.labelField`)
 *   - `colorField` — QUAL campo colore o cartão (opcional)
 *
 * NADA aqui conhece "ordem de serviço" ou "vencimento". O componente recebe `rows` genéricas
 * e as posiciona segundo o layout. Uma entidade diferente com uma view `calendar` funciona
 * sem alteração — é a mesma prova de genericidade que a lista já tem.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * GRADE DE MÊS, NÃO LISTA AGRUPADA
 *
 * A grade desenha TODOS os dias do mês, inclusive os vazios, porque um calendário existe
 * justamente para mostrar a DISTRIBUIÇÃO — inclusive a ausência. Uma lista agrupada só mostra
 * dias com registro e esconde que o dia 12 está vazio, que costuma ser a informação que o
 * operador procura. Por isso `[data-calendar-day]` cobre o mês inteiro (>= 28 por construção).
 */

export type DynamicCalendarProps = {
  schema: MetaEntitySchema;
  rows: DynamicListRow[];
  /** Tipo da view no store. Default `calendar`; permite uma segunda view de calendário. */
  viewType?: string;
  /** Fuso usado para decidir o DIA de um instante. */
  timeZone?: string;
  /** Mês exibido. Default: o mês da primeira linha, ou hoje quando não há linha. */
  month?: Date;
  onNavigate?: (month: Date) => void;
  onDayClick?: (date: string) => void;
  onCardClick?: (row: DynamicListRow) => void;
  emptyMessage?: string;
};

const DEFAULT_TIME_ZONE = 'America/Porto_Velho';

/** Tokens de cor permitidos — nunca hexadecimal vindo do banco. */
const COLOR_TOKENS = ['critical', 'warning', 'info', 'success', 'neutral'] as const;
type ColorToken = (typeof COLOR_TOKENS)[number];

const COLOR_CLASSES: Record<ColorToken, string> = {
  critical: 'border-red-300 bg-red-50 text-red-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  info: 'border-sky-300 bg-sky-50 text-sky-900',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  neutral: 'border-slate-300 bg-slate-50 text-slate-900',
};

/**
 * Chave do DIA de um instante, no fuso do operador.
 *
 * NÃO usa `toISOString().slice(0,10)`: isso responde pela data em UTC, e num fuso a oeste um
 * compromisso das 20h locais cairia no dia seguinte. `en-CA` produz `YYYY-MM-DD` já no fuso
 * pedido, que é o formato que a chave do mapa espera.
 */
export function dayKey(value: unknown, timeZone: string = DEFAULT_TIME_ZONE): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  // `en-CA` é o locale cujo formato curto é ISO `YYYY-MM-DD`.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Texto curto de hora no fuso do operador; `null` quando o valor é inválido. */
export function timeLabel(value: unknown, timeZone: string = DEFAULT_TIME_ZONE): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Normaliza o valor de `colorField` para um token conhecido. */
function toColorToken(value: unknown): ColorToken | null {
  if (typeof value !== 'string') {
    return null;
  }
  const lowered = value.toLowerCase();
  return (COLOR_TOKENS as readonly string[]).includes(lowered) ? (lowered as ColorToken) : null;
}

/** Todas as células de um mês, de domingo a sábado, cobrindo o mês inteiro. */
export function monthGrid(anchor: Date): { date: string; inMonth: boolean }[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  const cells: { date: string; inMonth: boolean }[] = [];
  // 6 semanas cobrem qualquer mês (mês de 31 dias começando no sábado).
  for (let offset = 0; offset < 42; offset += 1) {
    const cursor = new Date(start);
    cursor.setDate(start.getDate() + offset);
    cells.push({
      date: localDayKey(cursor),
      inMonth: cursor.getMonth() === month && cursor.getFullYear() === year,
    });
  }
  return cells;
}

/** `YYYY-MM-DD` de uma data já no fuso local do browser (a grade é construída localmente). */
function localDayKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Mês do primeiro registro com data válida; hoje quando não há nenhum. */
function anchorMonth(rows: DynamicListRow[], dateField: string | null): Date {
  for (const row of rows) {
    const key = dateField ? dayKey(row[dateField]) : null;
    if (key) {
      return new Date(`${key}T12:00:00`);
    }
  }
  return new Date();
}

export function DynamicCalendar({
  schema,
  rows,
  viewType = 'calendar',
  timeZone = DEFAULT_TIME_ZONE,
  month,
  onNavigate,
  onDayClick,
  onCardClick,
  emptyMessage,
}: DynamicCalendarProps): React.ReactElement {
  const view: MetaView | null = useMemo(() => findView(schema, viewType), [schema, viewType]);
  const layout: ViewLayout | null = (view?.layout as ViewLayout | undefined) ?? null;

  const dateField = readFieldName(layout, 'dateField');
  const titleField = readFieldName(layout, 'titleField') ?? schema.labelField;
  const colorField = readFieldName(layout, 'colorField');

  const resolvedMonth = useMemo(
    () => month ?? anchorMonth(rows, dateField),
    [month, rows, dateField],
  );
  const cells = useMemo(() => monthGrid(resolvedMonth), [resolvedMonth]);

  /**
   * Registros por dia. Um registro com data inválida é DESCARTADO do calendário, não
   * empilhado num "dia desconhecido": um dia que não existe no calendário não pode ser
   * clicado nem navegado, então ali ele seria dado invisível.
   */
  const byDay = useMemo(() => {
    const map = new Map<string, DynamicListRow[]>();
    if (!dateField) {
      return map;
    }
    for (const row of rows) {
      const key = dayKey(row[dateField], timeZone);
      if (!key) {
        continue;
      }
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        map.set(key, [row]);
      }
    }
    return map;
  }, [rows, dateField, timeZone]);

  /**
   * GAP DE METADADO, não erro de renderização.
   *
   * A view existe no store mas não declara `dateField`: sem ele não há como posicionar nada.
   * Dizer exatamente qual chave falta é o que permite corrigir por SQL em um minuto.
   */
  if (!dateField) {
    return (
      <div
        data-testid="dynamic-calendar"
        data-entity={schema.name}
        data-view-type={viewType}
        data-calendar-gap="dateField"
        className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      >
        A view <strong>{viewType}</strong> não declara <code>layout.dateField</code> no metadata
        store, então não há campo que posicione os registros no calendário.
      </div>
    );
  }

  const monthTitle = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(resolvedMonth.getFullYear(), resolvedMonth.getMonth(), 15)));

  const shift = (delta: number): void => {
    if (!onNavigate) {
      return;
    }
    onNavigate(new Date(resolvedMonth.getFullYear(), resolvedMonth.getMonth() + delta, 1));
  };

  const dateLabel = schema.fields.find((field) => field.name === dateField)?.label ?? dateField;
  const titleResolved = schema.fields.find((field) => field.name === titleField);

  return (
    <div
      data-testid="dynamic-calendar"
      data-entity={schema.name}
      data-view-type={viewType}
      // A PROVA fica no DOM: estes atributos são o layout que a view efetivamente usou.
      data-date-field={dateField}
      data-title-field={titleField}
      data-color-field={colorField ?? ''}
      className="rounded border border-slate-200 bg-white"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          data-testid="calendar-prev"
          aria-label={t('calendar.prev', 'Mês anterior')}
          onClick={() => shift(-1)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          ‹
        </button>
        <h3 data-testid="calendar-month" className="text-sm font-semibold capitalize text-slate-800">
          {monthTitle}
        </h3>
        <button
          type="button"
          data-testid="calendar-next"
          aria-label={t('calendar.next', 'Próximo mês')}
          onClick={() => shift(1)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          ›
        </button>
      </header>

      <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
        {t('calendar.drivenBy', 'Posicionado por')} <strong>{dateLabel}</strong>
        {colorField ? (
          <>
            {' · '}
            {t('calendar.coloredBy', 'colorido por')}{' '}
            <strong>
              {schema.fields.find((field) => field.name === colorField)?.label ?? colorField}
            </strong>
          </>
        ) : null}
      </p>

      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium text-slate-600">
        {['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((day) => (
          <div key={day} className="px-2 py-1">
            {t(`calendar.weekday.${day}`, day)}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const dayRows = byDay.get(cell.date) ?? [];
          return (
            <div
              key={cell.date}
              data-calendar-day={cell.date}
              data-in-month={cell.inMonth ? 'true' : 'false'}
              data-day-count={dayRows.length}
              className={`min-h-[92px] border-b border-r border-slate-100 p-1 align-top ${
                cell.inMonth ? 'bg-white' : 'bg-slate-50/60'
              }`}
            >
              <button
                type="button"
                onClick={() => onDayClick?.(cell.date)}
                className={`mb-1 w-full text-left text-[11px] font-medium ${
                  cell.inMonth ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                {Number(cell.date.slice(-2))}
              </button>
              <div className="flex flex-col gap-1">
                {dayRows.map((row, index) => {
                  const token = colorField ? toColorToken(row[colorField]) : null;
                  const title = row[titleField];
                  const moment = timeLabel(row[dateField], timeZone);
                  return (
                    <button
                      key={`${cell.date}-${index}`}
                      type="button"
                      data-calendar-card={String(title ?? '')}
                      onClick={() => onCardClick?.(row)}
                      className={`truncate rounded border px-1 py-0.5 text-left text-[11px] ${
                        token ? COLOR_CLASSES[token] : COLOR_CLASSES.neutral
                      }`}
                    >
                      {moment ? <span className="text-slate-500">{moment} </span> : null}
                      {String(title ?? '—')}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p data-testid="calendar-empty" className="px-4 py-3 text-sm text-slate-500">
          {emptyMessage ?? t('common.empty', 'Nenhum registro encontrado.')}
        </p>
      ) : null}

      {/*
       * AVISO DE METADADO TORTO — `titleField` que o schema não conhece. O calendário
       * continua funcionando (mostra o nome cru do campo), mas o operador fica sabendo que
       * a configuração e o schema discordam.
       */}
      {!titleResolved ? (
        <p data-testid="calendar-title-gap" className="px-4 py-2 text-xs text-amber-700">
          O layout declara <code>titleField={titleField}</code>, que não existe em{' '}
          <code>meta.fields</code> de {schema.name}.
        </p>
      ) : null}
    </div>
  );
}
