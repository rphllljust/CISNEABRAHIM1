import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader, worklistControlClass } from '../../ui/enterprise-list';
import { cn } from '../../ui/utils/cn';
import { workbenchSecondaryActionClass } from '../../ui/workbench';
import {
  WORK_DOMAIN_LABELS,
  WORK_DOMAINS,
  WORK_KIND_LABELS,
  WORK_KINDS,
  getWorkInbox,
} from '../api/work-inbox-api';
import { WorkspaceQueueSurface } from '../../workspaces/components/WorkspaceQueueSurface';
import {
  ALL_WORKSPACE_QUEUE_SCOPE,
  scopeFromSearchParams,
  scopeToSearchParams,
  type WorkspaceQueueScope,
} from '../../workspaces/api/workspace-queue-model';
import { MyInboxSituationBand } from '../components/MyInboxSituationBand';

/**
 * MY INBOX — a fila unificada de trabalho de todo o ERP.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * NAO E UM DASHBOARD, NAO E UMA GRADE
 *
 * A tela era uma grade com tres `<select>`: o operador abria para descobrir o que fazer e recebia
 * uma tabela. Agora ela e uma FILA — a mesma `WorkspaceQueueSurface` que o workspace financeiro e os
 * workspaces de dominio usam, sobre o mesmo read model (`GET /work-inbox`).
 *
 * A ordem de leitura e a de toda fila do produto: SEVERIDADE -> MOTIVO -> OBJETO -> PRAZO ->
 * PROXIMA ACAO. O que muda entre as superficies e apenas o ESCOPO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE A TELA RESPONDE, NA ORDEM EM QUE O OPERADOR PERGUNTA
 *
 *   1. SITUACAO   — o que exige decisao agora, dito com os numeros do servidor (por natureza, por
 *                   dominio) e com o que NAO pode ser afirmado declarado como tal.
 *   2. FILA       — os itens reais, com contexto lateral e proxima acao autorizada pelo dominio.
 *   3. FILTRO     — recorte governado que permanece na URL: recarregar, voltar e compartilhar
 *                   preservam o conjunto.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * HONESTIDADE
 *
 * - PAGINA NAO E CONJUNTO: a faixa da fila publica `total` (do servidor) e a amostra desta pagina,
 *   sempre na forma "Exibindo N de M".
 * - AUSENCIA NAO E ZERO: durante a carga e depois de uma falha, nenhum contador e publicado.
 * - LEITURA PARCIAL E DITA: dominio que nao respondeu aparece em aviso, e a fila nao e apresentada
 *   como completa.
 * - A prioridade nao e inventada: `byDomain` existe porque o SERVIDOR contou o recorte inteiro. Se o
 *   contrato nao publicar uma dimensao, ela nao e exibida — nao vira zero.
 */

const PAGE_SIZE = 25;

export function MyInboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = scopeFromSearchParams(searchParams) ?? ALL_WORKSPACE_QUEUE_SCOPE;

  /*
   * A LEITURA DA SITUACAO.
   *
   * `byDomain` vem do read model sem filtro — e o MESMO numero que os chips contam, porque e o mesmo
   * payload. A leitura e propria desta tela (a faixa de situacao precisa da contagem por dominio com
   * o recorte aplicado), e falha NAO vira zero: `situation` fica `null` e a faixa declara ausencia.
   */
  const situationLoader = useMemo(
    () => async () => getWorkInbox({ limit: 0, offset: 0 }),
    [],
  );

  const applyScope = (next: WorkspaceQueueScope) => {
    setSearchParams(scopeToSearchParams(next), { replace: true });
  };

  const clearScope = () => setSearchParams(new URLSearchParams(), { replace: true });

  return (
    <ModulePage layout="workspace">
      <WorklistHeader
        title="Minhas pendências"
        context="Fila unificada de trabalho: exceções, bloqueios, aprovações e vencimentos reais de todos os domínios autorizados."
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setSearchParams(new URLSearchParams(searchParams), { replace: true })}
          >
            Recarregar
          </Button>
        }
      />

      <MyInboxSituationBand loader={situationLoader} scope={scope} onScopeChange={applyScope} />

      {/*
        FILTRO GOVERNADO — o recorte que o servidor executa, em controles humanos.
        Ele nao substitui a barra de recortes da fila: aqui o operador escolhe o DOMINIO e a UNIDADE
        (dimensoes de escopo organizacional), la ele escolhe a NATUREZA e o vencimento (dimensoes do
        proprio trabalho). As duas barras sao a mesma pergunta em dois niveis.
      */}
      <div
        aria-label="Recorte por domínio"
        className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-y border-gray-200 bg-gray-50/60 px-2.5 py-1.5"
      >
        <span className="cisne-meta-label">Escopo</span>
        <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
          <li>
            <button
              type="button"
              aria-pressed={scope.domain === null}
              onClick={() => applyScope({ ...scope, domain: null })}
              className={cn(
                worklistControlClass,
                'min-h-0 px-2 py-0.5 text-xs',
                scope.domain === null
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800'
                  : 'bg-white text-gray-600',
              )}
            >
              Todos os domínios
            </button>
          </li>
          {WORK_DOMAINS.map((domain) => (
            <li key={domain}>
              <button
                type="button"
                aria-pressed={scope.domain === domain}
                onClick={() => applyScope({ ...scope, domain: scope.domain === domain ? null : domain })}
                className={cn(
                  worklistControlClass,
                  'min-h-0 px-2 py-0.5 text-xs',
                  scope.domain === domain
                    ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800'
                    : 'bg-white text-gray-600',
                )}
              >
                {WORK_DOMAIN_LABELS[domain]}
              </button>
            </li>
          ))}
        </ul>

        <label className="flex items-center gap-1.5 text-xs text-gray-700">
          <span className="cisne-type-helper">Natureza</span>
          <select
            aria-label="Natureza do trabalho"
            value={scope.kind ?? ''}
            onChange={(event) =>
              applyScope({
                ...scope,
                kind: WORK_KINDS.find((kind) => kind === event.target.value) ?? null,
              })
            }
            className={cn(worklistControlClass, 'min-h-0 py-0.5 text-xs')}
          >
            <option value="">Todas</option>
            {WORK_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {WORK_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={scope.overdue}
            onChange={(event) => applyScope({ ...scope, overdue: event.target.checked })}
          />
          Somente vencidos
        </label>

        {scope.domain !== null || scope.kind !== null || scope.overdue || scope.unitId ? (
          <button type="button" onClick={clearScope} className={workbenchSecondaryActionClass}>
            Limpar escopo
          </button>
        ) : null}
      </div>

      <WorkspaceQueueSurface
        title="Fila de trabalho"
        ariaLabel="Fila unificada de trabalho"
        description="Exceções e decisões reais, preservando o recorte enquanto você investiga e resolve"
        limit={PAGE_SIZE}
        savedViewsScope="work-inbox"
        scopeSource="url"
        showUnitFilter
        paginate
      />
    </ModulePage>
  );
}
