/**
 * CISNE — UNIFIED WORK INBOX: WORK ITEM CONTRACT
 *
 * A fila de trabalho responde "o que exige minha atencao agora?" a partir de FATOS
 * PERSISTIDOS e ja autorizados. Nada aqui e inferido, pontuado ou inventado:
 *
 * - `domain` e `kind` sao vocabulario fechado.
 * - `reason` descreve a obrigacao real que existe no dominio de origem.
 * - `priority` e DERIVADA de `kind` + atraso real (`dueAt`), nunca de score.
 * - `id` e a CHAVE LOGICA de deduplicacao: a mesma obrigacao nunca entra duas vezes.
 *
 * REGRA DE AUTORIZACAO (absoluta): `read A != read B`. Cada fonte aplica a autorizacao do
 * proprio dominio e, quando o ator nao pode ler o objeto de origem, o item NAO EXISTE —
 * sem contagem, sem titulo, sem referencia e sem sinal de existencia.
 */

/** Dominio empresarial de origem do trabalho. */
export const WORK_DOMAINS = [
  'FINANCEIRO',
  'FISCAL',
  'CONTABILIDADE',
  'OPERACOES',
  'COMERCIAL',
  'SUPRIMENTOS',
] as const;

export type WorkDomain = (typeof WORK_DOMAINS)[number];

/**
 * Natureza do trabalho. A ordem da lista E a ordem de precedencia da fila.
 *
 * BLOCKER     -> impede outro processo de andar (ex.: fechamento bloqueado).
 * OVERDUE     -> prazo real vencido.
 * APPROVAL    -> decisao humana pendente.
 * EXCEPTION   -> divergencia/erro persistido que exige tratamento.
 * CONTINUITY  -> o processo parou no meio e a proxima etapa nao aconteceu.
 */
export const WORK_KINDS = ['BLOCKER', 'OVERDUE', 'APPROVAL', 'EXCEPTION', 'CONTINUITY'] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

const KIND_WEIGHT: Record<WorkKind, number> = {
  BLOCKER: 0,
  OVERDUE: 1,
  APPROVAL: 2,
  EXCEPTION: 3,
  CONTINUITY: 4,
};

export type WorkItem = {
  /** Chave logica estavel — tambem a chave de deduplicacao. */
  id: string;
  domain: WorkDomain;
  kind: WorkKind;
  /** Referencia humana do objeto (nunca uuid). */
  businessReference: string;
  /** O que aconteceu, em linguagem de negocio. */
  title: string;
  /** Contexto humano que qualifica o item (cliente, unidade, parte). */
  contextLabel: string;
  /** Situacao real persistida no dominio de origem. */
  status: string;
  /** Por que isto exige atencao. */
  reason: string;
  /** ISO 8601 — quando o fato ocorreu/foi disparado (persistido). */
  occurredAt: string;
  /** ISO 8601 — prazo real quando ele existe de verdade; `null` quando nao ha prazo. */
  dueAt: string | null;
  /** Rotulo da acao mais provavel. A execucao continua sendo do dominio. */
  actionLabel: string;
  /** Rota real do objeto de origem (deep link). */
  targetRoute: string;
  /** Unidade quando o dominio a expoe (escopo real). */
  unitId: string | null;
};

/** Calcula a precedencia derivada — nenhum score, apenas fato + regra declarada. */
export function workItemRank(item: Pick<WorkItem, 'kind' | 'dueAt'>): {
  kindWeight: number;
  overdueWeight: number;
} {
  const overdueWeight = item.dueAt && new Date(item.dueAt).getTime() < Date.now() ? 0 : 1;
  return { kindWeight: KIND_WEIGHT[item.kind], overdueWeight };
}

/**
 * Ordem DETERMINISTICA:
 *   1. precedencia da natureza (BLOCKER -> OVERDUE -> APPROVAL -> EXCEPTION -> CONTINUITY)
 *   2. vencido antes de nao vencido
 *   3. prazo mais antigo primeiro (quando existe)
 *   4. referencia humana, e o id logico como desempate final
 *
 * Os dois ultimos criterios garantem paginacao estavel: dois itens nunca trocam de lugar
 * entre paginas.
 */
export function compareWorkItems(left: WorkItem, right: WorkItem): number {
  const leftRank = workItemRank(left);
  const rightRank = workItemRank(right);

  if (leftRank.kindWeight !== rightRank.kindWeight) {
    return leftRank.kindWeight - rightRank.kindWeight;
  }
  if (leftRank.overdueWeight !== rightRank.overdueWeight) {
    return leftRank.overdueWeight - rightRank.overdueWeight;
  }

  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (leftDue !== rightDue) {
    return leftDue - rightDue;
  }

  const byReference = left.businessReference.localeCompare(right.businessReference, 'pt-BR');
  if (byReference !== 0) {
    return byReference;
  }
  return left.id.localeCompare(right.id, 'pt-BR');
}

/**
 * Deduplicacao por chave logica.
 *
 * A MESMA obrigacao nao pode aparecer tres vezes (ex.: "OS concluida aguardando medicao"
 * nao pode vir como "OS pendente" + "medicao necessaria"). Quem monta o item declara a
 * chave logica no `id`; aqui apenas garantimos que a primeira ocorrencia vence.
 */
export function deduplicateWorkItems(items: WorkItem[]): WorkItem[] {
  const seen = new Set<string>();
  const unique: WorkItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }

  return unique;
}
