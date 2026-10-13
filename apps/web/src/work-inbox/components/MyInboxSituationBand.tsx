import { useEffect, useState } from 'react';
import {
  WORK_DOMAIN_LABELS,
  WORK_DOMAINS,
  WorkInboxApiError,
  type WorkInboxPage,
} from '../api/work-inbox-api';
import { Button } from '../../ui/Button';
import { WorkbenchMetric, WorkbenchSummaryStrip } from '../../ui/workbench';
import { cn } from '../../ui/utils/cn';
import {
  workInboxHref,
  type WorkspaceQueueScope,
} from '../../workspaces/api/workspace-queue-model';

/**
 * SITUACAO DO MY INBOX — o que exige decisao agora, dito com os numeros do servidor.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE UMA FAIXA E NAO UMA PAREDE DE CARTOES
 *
 * O operador abre "Minhas pendências" para descobrir O QUE FAZER. A resposta precisa estar na
 * primeira dobra e precisa ser verdadeira. Uma parede de cartoes com numeros iguais, todos pintados,
 * nao responde nada: o que responde e a RELACAO entre os numeros — quantos itens existem no total,
 * quantos venceram, e como eles se distribuem entre os dominios que o servidor contou.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * DE ONDE VEM CADA NUMERO
 *
 * `byDomain` e `total` vem do MESMO payload que abastece a fila (`GET /work-inbox`), sem contagem
 * paralela no navegador. O dominio e o proprio filtro: clicar em "Financeiro 4" aplica
 * `domain=FINANCEIRO`, que e exatamente o recorte que o servidor contou.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA FAIXA NAO FAZ
 *
 * - Nao inventa prioridade, score nem criticidade. Os unicos numeros publicados sao os que o
 *   contrato sustenta.
 * - Nao converte ausencia em zero. Durante a carga e depois de falha, NENHUM indicador aparece: um
 *   "0" que significa "nao consegui ler" e pior que a ausencia do numero.
 * - Nao esconde leitura parcial: dominio que nao respondeu e dito, e a contagem daquele dominio nao
 *   e exibida como se fosse conhecida.
 */

type SituationState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; page: WorkInboxPage };

/**
 * A leitura da situacao usa o MESMO cliente do read model (`GET /work-inbox`). O `loader` e
 * injetado pela tela para que a faixa e a fila compartilhem a leitura — a faixa nao tem consulta
 * propria nem contador paralelo.
 */
async function loadSituation(loader: () => Promise<WorkInboxPage>) {
  return loader();
}

export function MyInboxSituationBand({
  loader,
  scope,
  onScopeChange,
}: {
  loader: () => Promise<WorkInboxPage>;
  scope: WorkspaceQueueScope;
  onScopeChange: (scope: WorkspaceQueueScope) => void;
}) {
  const [state, setState] = useState<SituationState>({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setState({ phase: 'loading' });
      try {
        const page = await loadSituation(loader);
        if (active) {
          setState({ phase: 'ready', page });
        }
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }
        if (error instanceof WorkInboxApiError && error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        setState({
          phase: 'error',
          message:
            error instanceof WorkInboxApiError && error.kind === 'network'
              ? 'Não foi possível falar com o servidor. A situação da fila é desconhecida nesta leitura.'
              : 'Não foi possível ler a situação da fila.',
        });
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [loader, reloadToken]);

  if (state.phase === 'denied') {
    return (
      <p role="alert" className="m-0 mb-2 border-y border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-800">
        Você não tem permissão para ler a fila de trabalho.
      </p>
    );
  }

  if (state.phase === 'error') {
    return (
      <div
        role="alert"
        className="mb-2 flex flex-wrap items-center justify-between gap-2 border-y border-red-200 bg-red-50 px-2.5 py-2"
      >
        <p className="m-0 text-xs text-red-800">{state.message}</p>
        <Button type="button" variant="secondary" onClick={() => setReloadToken((t) => t + 1)}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  /*
   * DURANTE A CARGA NAO HA INDICADOR.
   *
   * Publicar "0" enquanto o servidor ainda responde e afirmar um fato que nao foi lido. A faixa
   * aparece com o rotulo e sem numero — o operador sabe que a resposta esta em curso, e nao que a
   * fila esta vazia.
   */
  if (state.phase === 'loading') {
    return (
      <WorkbenchSummaryStrip>
        <WorkbenchMetric value="—" label="situação da fila" />
        <span aria-live="polite" className="cisne-type-helper self-center px-2">
          Lendo a fila de trabalho…
        </span>
      </WorkbenchSummaryStrip>
    );
  }

  const { page } = state;
  const unavailable = page.unavailableDomains;
  const knownDomainTotal = WORK_DOMAINS.filter((domain) => !unavailable.includes(domain)).reduce(
    (sum, domain) => sum + (page.byDomain[domain] ?? 0),
    0,
  );

  return (
    <>
      <WorkbenchSummaryStrip>
        <WorkbenchMetric
          value={page.total}
          label="trabalhos no recorte"
          tone={page.total > 0 ? 'info' : 'neutral'}
        />
        <WorkbenchMetric
          value={page.items.length}
          label="nesta página"
        />
        <WorkbenchMetric
          value={knownDomainTotal}
          label="nos domínios que responderam"
          tone={knownDomainTotal > 0 ? 'neutral' : 'neutral'}
        />
        {/*
          A LEITURA PARCIAL NAO VIRA NUMERO.
          Com um dominio indisponivel, a soma por dominio e um PISO — ela cobre apenas os dominios
          que responderam. O indicador diz isso no proprio rotulo, e o aviso abaixo nomeia o que
          faltou. Sem esta distincao, "12 nos dominios" passaria por "12 na fila".
        */}
        {unavailable.length > 0 ? (
          <WorkbenchMetric
            value={unavailable.length}
            label="domínios sem resposta"
            tone="warning"
          />
        ) : null}
      </WorkbenchSummaryStrip>

      {unavailable.length > 0 ? (
        <p
          role="status"
          className="m-0 mb-2 border-y border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
        >
          Fila incompleta: {unavailable.map((d) => WORK_DOMAIN_LABELS[d as never] ?? d).join(', ')}{' '}
          não respondeu nesta leitura. O total acima conta apenas os domínios que responderam — o que
          falta é desconhecido, não é zero.
        </p>
      ) : null}

      {/*
        DISTRIBUICAO POR DOMINIO — o numero do dominio E o filtro.
        Nao existe contador paralelo: `byDomain` e o mesmo payload da fila, e o clique aplica o
        recorte que o servidor contou. Um dominio sem resposta nao recebe botao: oferecer "Fiscal 0"
        quando Fiscal nao respondeu seria afirmar zero.
      */}
      <ul
        aria-label="Trabalho por domínio"
        className="m-0 mb-2 flex list-none flex-wrap items-center gap-1.5 border-b border-gray-200 px-0 pb-2"
      >
        <li>
          <DomainChip
            label="Todos os domínios"
            count={page.total}
            active={scope.domain === null}
            onClick={() => onScopeChange({ ...scope, domain: null })}
          />
        </li>
        {WORK_DOMAINS.map((domain) => {
          if (unavailable.includes(domain)) {
            return (
              <li key={domain}>
                <span
                  className="cisne-type-helper inline-flex items-center gap-1.5 rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-0.5"
                  title="Este domínio não respondeu nesta leitura"
                >
                  {WORK_DOMAIN_LABELS[domain]} <strong className="font-semibold">—</strong>
                </span>
              </li>
            );
          }
          const count = page.byDomain[domain] ?? 0;
          if (count === 0 && scope.domain !== domain) {
            return null;
          }
          return (
            <li key={domain}>
              <DomainChip
                label={WORK_DOMAIN_LABELS[domain]}
                count={count}
                active={scope.domain === domain}
                onClick={() =>
                  onScopeChange({ ...scope, domain: scope.domain === domain ? null : domain })
                }
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * O chip de dominio. Ele nao e um link: e um BOTAO que muda o recorte da fila sem sair da tela —
 * a fila de destino e a propria fila, e navegar recarregaria o que ja esta carregado.
 */
function DomainChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label} ${count}`}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs',
        active
          ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800'
          : 'border-gray-300 bg-white font-medium text-gray-600 hover:bg-gray-50',
      )}
    >
      {label}
      <strong className="font-semibold tabular-nums">{count}</strong>
    </button>
  );
}

/** Rota canonica da fila com um recorte — usada pelos atalhos de dominio de outras superficies. */
export function inboxHrefForDomain(domain: WorkspaceQueueScope['domain']): string {
  return workInboxHref({ domain, kind: null, overdue: false, unitId: null });
}
