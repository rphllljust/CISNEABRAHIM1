const MONEY_DISPLAY = /^-?(?:\d{1,14})(?:\.\d{1,4})?$/;

export function formatMoneyBrl(value: string | null | undefined, currencyCode = 'BRL'): string {
  if (!value) {
    return '—';
  }
  const normalized = value.trim();
  if (!MONEY_DISPLAY.test(normalized)) {
    return value;
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) {
    return value;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export function formatQuantity(value: string | null | undefined, unitCode: string): string {
  if (!value) {
    return '—';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return `${value} ${unitCode}`;
  }
  const formatted = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 6,
  }).format(numeric);
  return `${formatted} ${unitCode}`;
}

/**
 * DATA SEM HORA (`AAAA-MM-DD`) é um dia do CALENDÁRIO, não um instante.
 *
 * `new Date('2026-09-25')` é interpretado como meia-noite **UTC**. Formatado num fuso a oeste de
 * Greenwich (o Brasil inteiro), esse instante cai no dia ANTERIOR: um vencimento em 25/09 aparecia
 * como 24/09 na tela. O backend publica `due_date` como coluna `date` — não há hora, não há fuso,
 * e portanto não há deslocamento a aplicar.
 *
 * A leitura é feita por componentes LOCAIS para que o dia renderizado seja o dia publicado, em
 * qualquer fuso em que o operador esteja.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTimePtBr(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const dateOnly = parseDateOnly(value);
  if (dateOnly) {
    // Sem hora publicada, a leitura correta é o DIA — exibir meia-noite seria inventar horário.
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(dateOnly);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function formatDatePtBr(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = parseDateOnly(value) ?? new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date);
}

export function formatTaxId(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return value;
}

export function formatPaymentDueHint(paymentTerms: string | null | undefined, referenceDate?: string): string {
  if (!paymentTerms?.trim()) {
    return 'Conforme condição comercial';
  }
  const match = paymentTerms.match(/(\d+)\s*DDL/i);
  if (!match) {
    return `Conforme: ${paymentTerms.trim()}`;
  }
  const days = Number(match[1]);
  if (!Number.isFinite(days) || days < 1) {
    return `Conforme: ${paymentTerms.trim()}`;
  }
  const base = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(base.getTime())) {
    return `Até ${days} dias após emissão`;
  }
  const due = new Date(base);
  due.setDate(due.getDate() + days);
  return formatDatePtBr(due.toISOString());
}

export function sumMoneyLines(values: Array<string | null | undefined>): string {
  let total = 0;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      total += numeric;
    }
  }
  return total.toFixed(4);
}
