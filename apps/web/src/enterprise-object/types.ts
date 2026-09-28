import type { ReactNode } from 'react';
import type { BreadcrumbItem } from '../ui/Breadcrumb';
import type { StatusBadgeTone } from '../ui/StatusBadge';

/**
 * CISNE — ENTERPRISE INTERACTION CONTRACT
 *
 * Contrato unico para OBJECT PAGES. Toda pagina de objeto principal responde, nesta ordem:
 *
 *   1. OBJECT HEADER          — do que estamos falando
 *   2. ESTADO / FLUXO         — em que ponto do processo estamos
 *   3. ACOES CONTEXTUAIS      — o que e permitido aqui e agora
 *   4. CONTEXTO EMPRESARIAL   — os fatos que qualificam o objeto
 *   5. SMART RELATIONS        — de onde veio / para onde foi
 *   6. HISTORICO              — fatos persistidos
 *   7. PROXIMA ACAO           — o que normalmente acontece agora
 *   8. DENIED / ERROR / EMPTY — coerentes entre si
 *
 * REGRA DE AUTORIZACAO: `read A != read B`. O adaptador da pagina decide o que entra
 * na lista; o primitivo NUNCA mostra item nao autorizado — nem o rotulo, nem o count,
 * nem a palavra "oculto". O backend continua sendo o boundary.
 */

/** Metadado de cabecalho (fato curto e verificavel). */
export type ObjectMetadataField = {
  label: string;
  value: ReactNode | string | null | undefined;
  /** Realce visual do fato principal (valor, data critica). */
  emphasis?: boolean;
};

/** Acao de objeto. Some quando nao ha permissao — o backend decide, o front representa. */
export type ObjectAction = {
  id: string;
  label: string;
  onSelect?: () => void;
  to?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Motivo real de indisponibilidade (estado do objeto, nao permissao). */
  disabledReason?: string;
};

export type ObjectHeaderStatus = {
  label: string;
  tone?: StatusBadgeTone;
  /** Contexto operacional do estado, ex.: "Aguardando aceite desde 12/09". */
  description?: string;
};

/** Passo REAL da state machine do objeto. Nada aqui e inventado no front. */
export type ObjectStateStep = {
  id: string;
  label: string;
  /** Comentario factual do passo (ex.: "2 de 4 etapas concluidas"). */
  hint?: string;
  /** Estado terminal (encerrado, cancelado) — representado como tal. */
  terminal?: boolean;
};

export type ObjectContextField = {
  label: string;
  value: ReactNode | string | null | undefined;
  /** Destino real do fato (cliente, unidade, responsavel). */
  to?: string;
  hint?: string;
};

/**
 * Relacao empresarial REAL: contagem persistida + destino navegavel.
 *
 * `to` e obrigatorio: nao existe relacao sem destino real. Um numero que nao leva a
 * lugar nenhum e um numero orfao, e numero orfao nao entra na interface.
 */
export type SmartRelation = {
  id: string;
  label: string;
  count: number;
  to: string;
  hint?: string;
};

/** Especificacao de relacao antes da autorizacao. `allowed` e decidido por capability. */
export type SmartRelationSpec = Omit<SmartRelation, 'to'> & {
  to: string;
  allowed: boolean;
};

export type NextActionKind = 'act' | 'waiting';

/**
 * Proxima acao derivada de state machine + capability + dado real.
 * `null` = nao ha o que dizer; a secao inteira desaparece (nunca texto generico).
 */
export type NextAction = {
  kind: NextActionKind;
  label: string;
  description?: string;
  to?: string;
  onSelect?: () => void;
  /** De quem se espera o proximo passo, quando `kind = 'waiting'`. */
  waitingOn?: string;
};

export type CreateSheetSection = {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
};

export type ObjectPagePhase = 'loading' | 'denied' | 'error' | 'empty' | 'ready';

export type EnterpriseObjectPageProps = {
  breadcrumb?: BreadcrumbItem[];
  header: ReactNode;
  stateFlow?: ReactNode;
  nextAction?: ReactNode;
  context?: ReactNode;
  relations?: ReactNode;
  /** Corpo principal do objeto (composicao, itens, planejamento). */
  children?: ReactNode;
  /** Coluna lateral: historico, revisoes, paineis de apoio. */
  aside?: ReactNode;
  /** Estado corrente da pagina. Governa loading/denied/error/empty de forma coerente. */
  phase?: ObjectPagePhase;
  phaseTitle?: string;
  phaseMessage?: string;
  onRetry?: () => void;
  className?: string;
};
