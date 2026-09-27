import {
  PROPOSAL_VERSION_STATUSES,
  type ProposalLinked,
  type ProposalNextStepCode,
  type ProposalRevisionDiff,
  type ProposalRevisionDiffField,
  type ProposalRevisionSummary,
  type ProposalTransition,
  type ProposalVersionStatus,
} from '../types/proposal.types';

/**
 * Derivacoes comerciais da proposta.
 *
 * Tudo aqui e CALCULADO a partir de campos que o backend ja persiste (validade, timestamps da
 * versao, status, totais). Nenhum prazo, SLA, score comercial ou margem e inventado: os textos
 * descrevem FATOS — "vence em 3 dias", "venceu há 2 dias", "revisão 2 substituiu a revisão 1".
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function formatRelativePast(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) {
    return null;
  }
  const diff = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(diff)) {
    return null;
  }
  if (diff < MINUTE_MS) {
    return 'agora há pouco';
  }
  if (diff < HOUR_MS) {
    return `há ${Math.floor(diff / MINUTE_MS)} min`;
  }
  if (diff < DAY_MS) {
    return `há ${Math.floor(diff / HOUR_MS)} h`;
  }
  const days = Math.floor(diff / DAY_MS);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

export type ProposalValidityTiming = {
  code: 'EXPIRES_TODAY' | 'EXPIRES_SOON' | 'EXPIRES_LATER' | 'EXPIRED';
  text: string;
  tone: 'critical' | 'warning' | 'info' | 'neutral';
};

/**
 * Contexto temporal da validade comercial. Sempre derivado do relogio — nunca persistido, nunca
 * chamado de SLA, e sem criar estado paralelo ao status real da versao.
 */
export function describeValidityTiming(
  validUntil: string | null,
  now: Date = new Date(),
): ProposalValidityTiming | null {
  if (!validUntil) {
    return null;
  }
  const target = new Date(validUntil);
  if (Number.isNaN(target.getTime())) {
    return null;
  }
  const dayDiff = Math.round((startOfDay(target) - startOfDay(now)) / DAY_MS);

  if (dayDiff < 0) {
    const days = Math.abs(dayDiff);
    return {
      code: 'EXPIRED',
      text: days === 1 ? 'venceu há 1 dia' : `venceu há ${days} dias`,
      tone: 'critical',
    };
  }
  if (dayDiff === 0) {
    return { code: 'EXPIRES_TODAY', text: 'vence hoje', tone: 'critical' };
  }
  if (dayDiff <= 7) {
    return {
      code: 'EXPIRES_SOON',
      text: dayDiff === 1 ? 'vence amanhã' : `vence em ${dayDiff} dias`,
      tone: 'warning',
    };
  }
  return {
    code: 'EXPIRES_LATER',
    text: dayDiff === 1 ? 'vence amanhã' : `vence em ${dayDiff} dias`,
    tone: 'neutral',
  };
}

export type ProposalAttentionFact = {
  code: string;
  text: string;
  tone: 'critical' | 'warning' | 'info';
};

/**
 * Fatos que exigem atencao comercial. Somente o que e derivavel: proximidade/vencimento da
 * validade, ausencia de validade, ausencia de solicitacao de origem legivel e proposta sem versao.
 */
export function describeProposalAttention(
  input: {
    currentVersionStatus: string | null;
    validUntil: string | null;
    originRequestCount: number;
    revisionCount: number;
  },
  now: Date = new Date(),
): ProposalAttentionFact[] {
  const facts: ProposalAttentionFact[] = [];

  if (!input.currentVersionStatus) {
    facts.push({ code: 'NO_VERSION', text: 'Sem versão registrada', tone: 'warning' });
    return facts;
  }

  if (!input.validUntil) {
    facts.push({ code: 'NO_VALIDITY', text: 'Validade não informada', tone: 'info' });
  } else {
    const timing = describeValidityTiming(input.validUntil, now);
    if (timing?.code === 'EXPIRED') {
      facts.push({ code: 'VALIDITY_EXPIRED', text: timing.text, tone: 'critical' });
    } else if (timing?.code === 'EXPIRES_TODAY') {
      facts.push({ code: 'VALIDITY_TODAY', text: timing.text, tone: 'critical' });
    } else if (timing?.code === 'EXPIRES_SOON') {
      facts.push({ code: 'VALIDITY_SOON', text: timing.text, tone: 'warning' });
    }
  }

  if (input.originRequestCount === 0) {
    facts.push({ code: 'NO_ORIGIN', text: 'Sem solicitação de origem vinculada', tone: 'info' });
  }

  if (input.revisionCount > 1) {
    facts.push({
      code: 'HAS_PRIOR_REVISIONS',
      text:
        input.revisionCount === 2
          ? 'Existe 1 revisão anterior'
          : `Existem ${input.revisionCount - 1} revisões anteriores`,
      tone: 'info',
    });
  }

  return facts;
}

export const PROPOSAL_NEXT_STEP_LABELS: Record<ProposalNextStepCode, string> = {
  COMPLETE_AND_ISSUE: 'Completar e emitir a proposta',
  AWAIT_CLIENT_DECISION: 'Aguardar decisão do cliente',
  FOLLOW_COMMERCIAL_FLOW: 'Seguir com o fluxo comercial (pedido de compra / operação)',
  CREATE_NEW_REVISION: 'Criar nova revisão',
  CLOSED: 'Ciclo encerrado',
};

export function formatProposalNextStep(step: ProposalNextStepCode): string {
  return PROPOSAL_NEXT_STEP_LABELS[step] ?? step;
}

export const PROPOSAL_TRANSITION_LABELS: Record<ProposalTransition, string> = {
  issue: 'Emitir proposta',
  accept: 'Registrar aceite',
  reject: 'Registrar rejeição',
  expire: 'Marcar como expirada',
  cancel: 'Cancelar versão',
  revise: 'Criar nova revisão',
};

export function formatProposalTransition(transition: ProposalTransition): string {
  return PROPOSAL_TRANSITION_LABELS[transition] ?? transition;
}

/** Codigos de bloqueio vem do backend — a UI apenas os nomeia. */
export const PROPOSAL_BLOCKER_LABELS: Record<string, string> = {
  GLOBAL_SALE_PRICE_REQUIRED: 'Informe o preço global de venda antes de emitir.',
  ITEMIZED_ITEMS_REQUIRED: 'Inclua ao menos um item com valor antes de emitir.',
  ITEM_LINE_AMOUNT_REQUIRED: 'Todos os itens precisam de valor de linha antes da emissão.',
};

export function formatProposalBlocker(code: string): string {
  return PROPOSAL_BLOCKER_LABELS[code] ?? code;
}

export const PROPOSAL_REVISION_STATE_LABELS: Record<ProposalVersionStatus, string> = {
  DRAFT: 'Rascunho',
  ISSUED: 'Emitida',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
  EXPIRED: 'Expirada',
  CANCELLED: 'Cancelada',
};

export function formatRevisionState(status: ProposalVersionStatus): string {
  return PROPOSAL_REVISION_STATE_LABELS[status] ?? status;
}

/**
 * Linha do tempo comercial derivada dos TIMESTAMPS REAIS de cada revisao.
 *
 * Nao existe tabela de eventos comerciais no dominio: cada entrada abaixo e um campo persistido em
 * `com.proposal_versions` (created_at, issued_at, accepted_at, rejected_at, expired_at,
 * cancelled_at, superseded_at) somado a data de criacao da proposta. Nenhum evento e fabricado.
 */
export type ProposalTimelineEntry = {
  id: string;
  code: string;
  label: string;
  detail: string | null;
  occurredAt: string;
  revisionNumber: number | null;
  actorIdentityId: string | null;
};

export function buildProposalTimeline(input: {
  proposalCreatedAt: string;
  proposalCode: string;
  revisions: ProposalRevisionSummary[];
  actorByRevision?: Record<number, { issuedByIdentityId?: string | null }>;
}): ProposalTimelineEntry[] {
  const entries: ProposalTimelineEntry[] = [
    {
      id: `${input.proposalCode}-created`,
      code: 'PROPOSAL_CREATED',
      label: 'Proposta registrada',
      detail: null,
      occurredAt: input.proposalCreatedAt,
      revisionNumber: null,
      actorIdentityId: null,
    },
  ];

  for (const revision of input.revisions) {
    const actor = input.actorByRevision?.[revision.versionNumber]?.issuedByIdentityId ?? null;
    if (revision.issuedAt) {
      entries.push({
        id: `${revision.versionNumber}-issued`,
        code: 'VERSION_ISSUED',
        label: `Revisão ${revision.versionNumber} emitida`,
        detail:
          revision.supersedesVersionNumber === null
            ? null
            : `Revisão ${revision.supersedesVersionNumber} anterior`,
        occurredAt: revision.issuedAt,
        revisionNumber: revision.versionNumber,
        actorIdentityId: actor,
      });
    }
    if (revision.supersededAt) {
      entries.push({
        id: `${revision.versionNumber}-superseded`,
        code: 'VERSION_SUPERSEDED',
        label: `Revisão ${revision.versionNumber} substituída`,
        detail: 'Deixou de ser a revisão vigente',
        occurredAt: revision.supersededAt,
        revisionNumber: revision.versionNumber,
        actorIdentityId: null,
      });
    }
    if (revision.acceptedAt) {
      entries.push({
        id: `${revision.versionNumber}-accepted`,
        code: 'VERSION_ACCEPTED',
        label: `Revisão ${revision.versionNumber} aceita`,
        detail: null,
        occurredAt: revision.acceptedAt,
        revisionNumber: revision.versionNumber,
        actorIdentityId: null,
      });
    }
    if (revision.rejectedAt) {
      entries.push({
        id: `${revision.versionNumber}-rejected`,
        code: 'VERSION_REJECTED',
        label: `Revisão ${revision.versionNumber} rejeitada`,
        detail: null,
        occurredAt: revision.rejectedAt,
        revisionNumber: revision.versionNumber,
        actorIdentityId: null,
      });
    }
    if (revision.expiredAt) {
      entries.push({
        id: `${revision.versionNumber}-expired`,
        code: 'VERSION_EXPIRED',
        label: `Revisão ${revision.versionNumber} expirada`,
        detail: null,
        occurredAt: revision.expiredAt,
        revisionNumber: revision.versionNumber,
        actorIdentityId: null,
      });
    }
    if (revision.cancelledAt) {
      entries.push({
        id: `${revision.versionNumber}-cancelled`,
        code: 'VERSION_CANCELLED',
        label: `Revisão ${revision.versionNumber} cancelada`,
        detail: null,
        occurredAt: revision.cancelledAt,
        revisionNumber: revision.versionNumber,
        actorIdentityId: null,
      });
    }
  }

  return entries.sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
}

export const PROPOSAL_LINKED_KIND_LABELS: Record<string, string> = {
  REQUEST: 'Solicitação de serviço',
  SERVICE_ORDER: 'Ordem de serviço',
  PURCHASE_ORDER: 'Pedido de compra',
};

export function formatProposalLinkedKind(kind: string): string {
  return PROPOSAL_LINKED_KIND_LABELS[kind] ?? kind;
}

export function linkedRecordPath(record: ProposalLinked): string {
  switch (record.kind) {
    case 'REQUEST':
      return `/app/requests/${record.id}`;
    case 'SERVICE_ORDER':
      return `/app/service-orders/${record.id}/planning`;
    case 'PURCHASE_ORDER':
      return `/app/purchase-orders/${record.id}`;
    default:
      return '/app/proposals';
  }
}

/** Revisao vigente e revisao anterior, conforme os numeros persistidos. */
export function selectRevisionPair(
  revisions: ProposalRevisionSummary[],
): { current: ProposalRevisionSummary | null; previous: ProposalRevisionSummary | null } {
  const ordered = [...revisions].sort((left, right) => left.versionNumber - right.versionNumber);
  const current = ordered.find((revision) => revision.isCurrent) ?? ordered[ordered.length - 1] ?? null;
  const previous = current
    ? ordered
        .filter((revision) => revision.versionNumber < current.versionNumber)
        .sort((left, right) => right.versionNumber - left.versionNumber)[0] ?? null
    : null;
  return { current, previous };
}

export function formatDiffFieldValue(field: ProposalRevisionDiffField, kind: 'before' | 'after'): string {
  const value = kind === 'before' ? field.before : field.after;
  return value ?? '—';
}

/** Resumo textual do diff: usado no cabecalho do painel de revisoes. */
export function summarizeRevisionDiff(diff: ProposalRevisionDiff | null): string | null {
  if (!diff) {
    return null;
  }
  const parts: string[] = [];
  if (diff.totals.linesAdded > 0) {
    parts.push(`${diff.totals.linesAdded} linha(s) adicionada(s)`);
  }
  if (diff.totals.linesRemoved > 0) {
    parts.push(`${diff.totals.linesRemoved} linha(s) removida(s)`);
  }
  if (diff.totals.linesChanged > 0) {
    parts.push(`${diff.totals.linesChanged} linha(s) alterada(s)`);
  }
  if (diff.fields.length > 0) {
    parts.push(`${diff.fields.length} campo(s) comercial(is) alterado(s)`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nenhuma diferença relevante entre as revisões';
}

export function isProposalVersionTerminal(status: string | null): boolean {
  return (
    status === PROPOSAL_VERSION_STATUSES.Accepted ||
    status === PROPOSAL_VERSION_STATUSES.Rejected ||
    status === PROPOSAL_VERSION_STATUSES.Expired ||
    status === PROPOSAL_VERSION_STATUSES.Cancelled
  );
}
