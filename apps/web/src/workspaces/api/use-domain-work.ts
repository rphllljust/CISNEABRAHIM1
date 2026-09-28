import { useCallback, useEffect, useState } from 'react';
import {
  WorkInboxApiError,
  getWorkInbox,
  type WorkDomain,
  type WorkItem,
  type WorkKind,
} from '../../work-inbox/api/work-inbox-api';

/**
 * LEITURA DO WORKSPACE — a fila de trabalho e a UNICA fonte de verdade da contagem.
 *
 * Tres leituras, um unico endpoint (`GET /work-inbox`). Nenhuma lista por dominio e buscada
 * no browser e nenhum numero e recalculado a partir de itens:
 *
 *   1. `{ limit: 1 }`, SEM filtro de dominio -> `byDomain[domain]` e a zona AGORA.
 *      E a mesma consulta que abastece os chips da Central de trabalho, entao o numero do
 *      workspace e o numero da fila sao literalmente o mesmo valor do mesmo payload.
 *   2. `{ domain, kind: 'BLOCKER' }` -> bloqueios reais do dominio (zona ATENCAO).
 *   3. `{ domain, kind: 'EXCEPTION' }` -> excecoes reais do dominio (zona ATENCAO).
 *
 * Por que o recorte por `kind` e consultado no servidor em vez de filtrar a lista no browser:
 * a lista que o browser recebe e paginada; filtrar no cliente esconderia bloqueios que ficaram
 * fora da pagina e apresentaria uma lista parcial como se fosse completa.
 *
 * Qualquer falha de leitura e DITA. Nunca existe "0" como sinônimo de "não consegui ler":
 * zero inventado e pior que erro visivel.
 */

/** Naturezas que compõem ATENÇÃO: bloqueio real e exceção persistida. */
const ATTENTION_KINDS = ['BLOCKER', 'EXCEPTION'] as const;

/** Teto de itens de ATENÇÃO por natureza. O excedente é divulgado, nunca escondido. */
const ATTENTION_LIMIT = 5;

export type WorkZonePhase = 'loading' | 'ready' | 'denied' | 'error';

export type AttentionGap = {
  kind: WorkKind;
  /** Itens reais que existem no servidor além dos exibidos. */
  hidden: number;
};

export type DomainWorkState = {
  /** Fase da leitura de AGORA. */
  phase: WorkZonePhase;
  /** Motivo humano quando AGORA não pôde ser lida. */
  message: string | null;
  /** `byDomain[domain]` do read model. `null` enquanto a contagem é desconhecida. */
  agoraCount: number | null;
  /** O próprio read model declarou o domínio indisponível nesta leitura. */
  unavailable: boolean;
  attention: WorkItem[];
  attentionGaps: AttentionGap[];
  /** Fase da leitura de ATENÇÃO — independente de AGORA. */
  attentionPhase: WorkZonePhase;
  attentionMessage: string | null;
  reload: () => void;
};

type FailureCopy = { phase: WorkZonePhase; message: string };

function failureCopy(reason: unknown, subject: 'count' | 'attention'): FailureCopy {
  if (reason instanceof WorkInboxApiError && reason.kind === 'denied') {
    return {
      phase: 'denied',
      message:
        subject === 'count'
          ? 'Você não tem permissão para ler a fila de trabalho deste domínio.'
          : 'Você não tem permissão para ler bloqueios e exceções deste domínio.',
    };
  }

  if (reason instanceof WorkInboxApiError && reason.kind === 'network') {
    return {
      phase: 'error',
      message:
        subject === 'count'
          ? 'Não foi possível falar com o servidor: a contagem deste domínio é desconhecida — não é zero.'
          : 'Não foi possível falar com o servidor: bloqueios e exceções deste domínio podem estar incompletos.',
    };
  }

  return {
    phase: 'error',
    message:
      subject === 'count'
        ? 'Não foi possível ler a fila deste domínio.'
        : 'Não foi possível ler bloqueios e exceções deste domínio.',
  };
}

async function loadAgora(
  domain: WorkDomain,
  signal: AbortSignal,
): Promise<{ count: number; unavailable: boolean }> {
  const page = await getWorkInbox({ limit: 1 }, signal);
  return {
    count: page.byDomain[domain] ?? 0,
    unavailable: page.unavailableDomains.includes(domain),
  };
}

async function loadAttention(
  domain: WorkDomain,
  signal: AbortSignal,
): Promise<{ items: WorkItem[]; gaps: AttentionGap[] }> {
  // `Promise.all`: se UMA das naturezas falhar, a zona inteira é declarada ilegível. Listar só
  // metade e apresentá-la como o quadro completo de bloqueios esconderia trabalho real.
  const pages = await Promise.all(
    ATTENTION_KINDS.map((kind) => getWorkInbox({ domain, kind, limit: ATTENTION_LIMIT }, signal)),
  );

  const items: WorkItem[] = [];
  const gaps: AttentionGap[] = [];

  ATTENTION_KINDS.forEach((kind, index) => {
    const page = pages[index];
    if (!page) {
      return;
    }
    items.push(...page.items);
    const hidden = page.total - page.items.length;
    if (hidden > 0) {
      gaps.push({ kind, hidden });
    }
  });

  return { items, gaps };
}

export function useDomainWork(domain: WorkDomain): DomainWorkState {
  const [phase, setPhase] = useState<WorkZonePhase>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [agoraCount, setAgoraCount] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [attention, setAttention] = useState<WorkItem[]>([]);
  const [attentionGaps, setAttentionGaps] = useState<AttentionGap[]>([]);
  const [attentionPhase, setAttentionPhase] = useState<WorkZonePhase>('loading');
  const [attentionMessage, setAttentionMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setPhase('loading');
      setMessage(null);
      setAttentionPhase('loading');
      setAttentionMessage(null);

      const [countResult, attentionResult] = await Promise.allSettled([
        loadAgora(domain, controller.signal),
        loadAttention(domain, controller.signal),
      ]);

      if (!active) {
        return;
      }

      if (countResult.status === 'fulfilled') {
        setAgoraCount(countResult.value.count);
        setUnavailable(countResult.value.unavailable);
        setPhase('ready');
      } else {
        const failure = failureCopy(countResult.reason, 'count');
        setAgoraCount(null);
        setUnavailable(false);
        setPhase(failure.phase);
        setMessage(failure.message);
      }

      if (attentionResult.status === 'fulfilled') {
        setAttention(attentionResult.value.items);
        setAttentionGaps(attentionResult.value.gaps);
        setAttentionPhase('ready');
      } else {
        const failure = failureCopy(attentionResult.reason, 'attention');
        setAttention([]);
        setAttentionGaps([]);
        setAttentionPhase(failure.phase);
        setAttentionMessage(failure.message);
      }
    }

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [domain, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    phase,
    message,
    agoraCount,
    unavailable,
    attention,
    attentionGaps,
    attentionPhase,
    attentionMessage,
    reload,
  };
}
