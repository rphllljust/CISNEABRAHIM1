/**
 * APRESENTAÇÃO DO WORKBENCH DE MEDIÇÃO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * A FRONTEIRA EXATA DESTE MÓDULO
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Aqui SÓ existe tradução de dado em texto e de código de severidade em tom.
 * Nenhuma função deste arquivo afirma se algo PODE ser feito, se está dentro da
 * tolerância, se é elegível ou qual é o próximo passo.
 *
 * A distinção é deliberada e o teste de fitness a protege:
 *
 *   PERMITIDO    `formatDuration(seconds)`        → "6d 4h"
 *                `severityTone('HIGH')`          → 'critical'
 *                `billingResultTone('READY')`    → 'success'
 *
 *   PROIBIDO     `canApprove(workbench)`          → regra do backend
 *                `isWithinTolerance(variance)`    → regra do backend
 *                `computeEligibility(workbench)`  → regra do backend
 *
 * Um tom de cor para um severidade JÁ DECIDIDA não é regra: é a representação
 * visual de um fato que veio pronto. A tela não pode deixar de mostrar "HIGH"
 * em vermelho, e não pode decidir que algo é HIGH.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// DURAÇÃO E IDADE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Formata SEGUNDOS em duração legível (`6d 4h`, `2h 14m`, `18m`, `42s`).
 *
 * O backend publica segundos, nunca texto: texto de duração não é comparável,
 * não é ordenável e não é traduzível. A formatação é do consumidor.
 */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${total}s`;
}

/** Formata um instante ISO em data/hora local curta (`24 OUT 2026 15:42`). */
export function formatInstant(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = MONTH_LABELS[parsed.getMonth()] ?? '';
  const year = parsed.getFullYear();
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hours}:${minutes}`;
}

const MONTH_LABELS = [
  'JAN',
  'FEV',
  'MAR',
  'ABR',
  'MAI',
  'JUN',
  'JUL',
  'AGO',
  'SET',
  'OUT',
  'NOV',
  'DEZ',
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// DINHEIRO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Formata valor monetário em string decimal.
 *
 * `null` continua `null` e a tela mostra "não informado": `R$ 0,00` para um valor
 * que o backend não conhece seria uma AFIRMAÇÃO sobre dinheiro.
 */
export function formatMoney(amount: string | null, currency: string | null): string | null {
  if (amount === null) {
    return null;
  }
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const formatted = parsed.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}

/** Percentual com sinal explícito (`+15,00%`, `-4,20%`). */
export function formatSignedPercent(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

/** Decimal de quantidade, sem casas artificiais (`82.4` → `82,4`; `16` → `16`). */
export function formatQuantity(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return parsed.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOM (REPRESENTAÇÃO, NÃO DECISÃO)
// ═══════════════════════════════════════════════════════════════════════════════

export type PresentationTone = 'neutral' | 'info' | 'warning' | 'critical' | 'success';

/**
 * Tom para uma severidade JÁ DECIDIDA pelo backend.
 *
 * `NONE` e `LOW` são neutros: uma diferença dentro da tolerância não merece
 * vermelho. A escala de cores é a MESMA das situações de operação deste produto,
 * para que "crítico" signifique a mesma coisa em qualquer tela.
 */
export function severityTone(severity: string): PresentationTone {
  switch (severity) {
    case 'CRITICAL':
    case 'P1':
      return 'critical';
    case 'HIGH':
    case 'P2':
      return 'warning';
    case 'MEDIUM':
    case 'P3':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Tom para o RESULTADO de elegibilidade já decidido. */
export function billingResultTone(result: string): PresentationTone {
  switch (result) {
    case 'READY':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'BLOCKED':
      return 'critical';
    default:
      return 'neutral';
  }
}

/** Tom para o estado do aceite já derivado. */
export function acceptanceTone(state: string): PresentationTone {
  switch (state) {
    case 'ACCEPTED':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'REJECTED':
      return 'critical';
    default:
      return 'neutral';
  }
}

/** Tom para o estado de um marco do processo. */
export function milestoneTone(state: string): PresentationTone {
  switch (state) {
    case 'COMPLETED':
      return 'success';
    case 'CURRENT':
      return 'info';
    case 'NOT_APPLICABLE':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Tom para o risco de processo já classificado. */
export function riskTone(risk: string): PresentationTone {
  switch (risk) {
    case 'HIGH':
      return 'critical';
    case 'MEDIUM':
      return 'warning';
    case 'LOW':
      return 'success';
    default:
      return 'neutral';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RÓTULOS DE ESTADO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rótulo humano para códigos de estado.
 *
 * Tradução de VOCABULÁRIO, não de regra: o código já é o contrato. Um código
 * desconhecido aparece como ele mesmo — um rótulo em branco esconderia o motivo
 * de um bloqueio.
 */
const STATE_LABELS: Record<string, string> = {
  // Aceite
  NOT_REQUIRED: 'Não exigido',
  PENDING: 'Pendente',
  ACCEPTED: 'Aceito',
  REJECTED: 'Recusado',
  // Elegibilidade
  READY: 'Liberado',
  BLOCKED: 'Bloqueado',
  SATISFIED: 'Atendido',
  NOT_APPLICABLE: 'Não aplicável',
  // Marcos de processo
  COMPLETED: 'Concluído',
  CURRENT: 'Em curso',
  FUTURE: 'Pendente',
  // Medição
  DRAFT: 'Rascunho',
  SUBMITTED: 'Submetida',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovada',
  NOT_CREATED: 'Não criada',
  // Execução e faturamento
  CLOSED: 'Fechada',
  NOT_PREPARED: 'Não preparado',
  PREPARED: 'Preparado',
  NOT_ELIGIBLE: 'Não elegível',
  NOT_EVALUATED: 'Não avaliada',
  // Severidade
  CRITICAL: 'Crítica',
  HIGH: 'Alta',
  MEDIUM: 'Média',
  LOW: 'Baixa',
  NONE: 'Sem divergência',
  // Risco
  UNKNOWN: 'Indeterminado',
};

export function stateLabel(code: string | null): string | null {
  if (code === null) {
    return null;
  }
  return STATE_LABELS[code] ?? code;
}

/** Rótulo do estágio da cadeia. */
const STAGE_LABELS: Record<string, string> = {
  EXECUTED_NOT_MEASURED: 'Executado, não medido',
  MEASURED_NOT_APPROVED: 'Medido, não aprovado',
  APPROVED_NOT_ACCEPTED: 'Aprovado, aguardando aceite',
  ACCEPTED_NOT_BILLABLE: 'Aceito, bloqueado para faturar',
  READY_NOT_PREPARED: 'Pronto, não preparado',
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/**
 * ORIENTAÇÃO DE IMPACTO dos comandos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO VIVE NO FRONTEND
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Isto NÃO é regra de negócio: é o texto que explica ao operador o que um
 * comando SIGNIFICA, escrito uma vez por tipo de comando. A decisão de poder
 * executá-lo continua sendo `availableCommands[].enabled`.
 *
 * Explicar o impacto ANTES da confirmação é o que impede o operador de autorizar
 * uma variação sem saber que o valor bruto recalcula e que a elegibilidade é
 * reavaliada.
 */
export const COMMAND_IMPACT: Record<string, readonly string[]> = {
  RECORD_ACCEPTANCE: [
    'O ciclo de aceite fecha como ACEITO',
    'A elegibilidade de faturamento é reavaliada',
    'A situação de aceite pendente é resolvida',
  ],
  RECORD_REJECTION: [
    'O ciclo de aceite fecha como RECUSADO',
    'Abrir correção não apaga a decisão anterior',
    'O faturamento permanece bloqueado',
    'A medição retorna para resolução',
  ],
  AUTHORIZE_ADJUSTMENT: [
    'A quantidade medida do item muda',
    'O valor bruto é recalculado',
    'A elegibilidade de aprovação é reavaliada',
    'Um registro de auditoria é gerado',
  ],
  APPROVE: [
    'A medição passa a APROVADA',
    'A política de aceite é reavaliada',
    'A elegibilidade de faturamento é reavaliada',
  ],
};

export function commandImpact(code: string): readonly string[] {
  return COMMAND_IMPACT[code] ?? [];
}
