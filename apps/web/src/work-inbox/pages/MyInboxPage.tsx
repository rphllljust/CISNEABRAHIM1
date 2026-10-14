import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { worklistSelectClass } from '../../ui/enterprise-list';
import { WorkspaceHeader } from '../../ui/workspace-frame';
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

  /*
   * O RECORTE ATIVO EM UMA LINHA — vai para o cabeçalho, ao lado da identidade da área.
   * É a mesma informação que o operador precisa para saber QUAL conjunto está lendo; antes ela
   * vivia dentro da faixa de filtros e se perdia entre os controles.
   */
  const scopeLabelText = [
    scope.domain === null ? 'Todos os domínios' : WORK_DOMAIN_LABELS[scope.domain],
    scope.kind === null ? null : WORK_KIND_LABELS[scope.kind],
    scope.overdue ? 'somente vencidos' : null,
    scope.unitId ? 'unidade autorizada' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ModulePage layout="workspace">
      {/*
        ENTERPRISE WORK INBOX — A FILA E A BANCADA, NAO UM FILTRO SOBRE UMA LISTA VAZIA.

        ─────────────────────────────────────────────────────────────────────────────────────────
        O QUE ESTA TELA ERA, MEDIDO

        Em 1600×900, com a fila vazia (o estado mais comum de quem acaba de resolver tudo):

          cabeçalho               40px
          faixa de situação       62px
          chips de domínio        34px
          barra de recorte        43px
          fila (estado vazio)    329px
          conteúdo terminava     y=624
          canvas vazio abaixo    276px  — 31% da viewport

        E com a fila publicada o conteúdo parava em y=690: a mesma bancada, sem altura. A tela era
        um cabeçalho, três faixas de filtro empilhadas e uma lista — o operador que abria "Minhas
        pendências" via um formulário de consulta em cima de um vazio.

        ─────────────────────────────────────────────────────────────────────────────────────────
        O QUE ELA É AGORA

        Uma bancada de trabalho com a mesma gramática de `Clientes`:

          WorkspaceHeader   identidade + situação da fila em uma linha
          WorkspaceToolbar  recorte (domínio, natureza, vencidos) + recarregar
          WorkspaceBody     FILA (altura de viewport) + CONTEXTO DA DECISÃO

        A DIFERENÇA ESTRUTURAL DECISIVA: ZERO ITENS NAO DESMONTA A TELA.

        Antes, a fila vazia colapsava para uma faixa de mensagem e o resto da tela ficava branco.
        Agora a bancada tem altura de viewport, e a coluna de contexto responde — mesmo sem um único
        item — o que o operador precisa saber para confiar no vazio: QUAL recorte foi lido, QUAIS
        domínios responderam, QUANDO foi atualizado e O QUE entra nesta fila. Vazio com contexto é
        uma resposta; vazio sem contexto é um sistema que parece quebrado.

        ─────────────────────────────────────────────────────────────────────────────────────────
        O QUE NAO MUDOU

        Nenhuma chamada, nenhum recorte, nenhuma rota. `scopeSource="url"` continua: recarregar,
        voltar e compartilhar preservam o conjunto. A leitura parcial continua dita, a pagina
        continua separada do conjunto, e a prioridade continua nao sendo inventada.
      */}
      <WorkspaceHeader
        title="Minhas pendências"
        identity="Trabalho que exige decisão ou intervenção"
        scope={scopeLabelText}
        action={
          <button
            type="button"
            className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-[4px] border border-[color:var(--color-border-default)] bg-white px-2.5 text-[color:var(--color-text-secondary)] transition-colors hover:bg-[color:var(--color-surface-hover)]"
            onClick={() => setSearchParams(new URLSearchParams(searchParams), { replace: true })}
          >
            Atualizar
          </button>
        }
      />

      {/*
        FAIXA DE SITUAÇÃO — os números do servidor, acima da bancada.

        Ela continua sendo a PRIMEIRA resposta ("o que exige decisão agora"), e continua vindo do
        MESMO payload da fila: `byDomain` sem contagem paralela no navegador.
      */}
      <MyInboxSituationBand loader={situationLoader} scope={scope} onScopeChange={applyScope} />

      {/*
        RECORTE GOVERNADO — o recorte que o servidor executa, em controles humanos.
        Domínio e unidade são dimensões de ESCOPO organizacional; natureza e vencimento são
        dimensões do PRÓPRIO trabalho e vivem na barra da fila. As duas barras são a mesma pergunta
        em dois níveis.
      */}
      <div
        aria-label="Recorte por domínio"
        className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[color:var(--color-divider)] pb-2"
      >
        <span className="cisne-meta-label">Domínio</span>
        <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
          <li>
            <button
              type="button"
              aria-pressed={scope.domain === null}
              onClick={() => applyScope({ ...scope, domain: null })}
              className={cn(
                'cisne-type-action inline-flex min-h-[24px] items-center rounded-[3px] border px-2 text-[11px]',
                scope.domain === null
                  ? 'border-[color:var(--color-brand-600)] bg-[color:var(--color-brand-50)] font-semibold text-[color:var(--color-brand-800)]'
                  : 'border-[color:var(--color-border-default)] bg-white font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-hover)]',
              )}
            >
              Todos
            </button>
          </li>
          {WORK_DOMAINS.map((domain) => (
            <li key={domain}>
              <button
                type="button"
                aria-pressed={scope.domain === domain}
                onClick={() => applyScope({ ...scope, domain: scope.domain === domain ? null : domain })}
                className={cn(
                  'cisne-type-action inline-flex min-h-[24px] items-center rounded-[3px] border px-2 text-[11px]',
                  scope.domain === domain
                    ? 'border-[color:var(--color-brand-600)] bg-[color:var(--color-brand-50)] font-semibold text-[color:var(--color-brand-800)]'
                    : 'border-[color:var(--color-border-default)] bg-white font-medium text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-hover)]',
                )}
              >
                {WORK_DOMAIN_LABELS[domain]}
              </button>
            </li>
          ))}
        </ul>

        <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--color-text-secondary)]">
          <span className="cisne-meta-label">Natureza</span>
          <select
            aria-label="Natureza do trabalho"
            value={scope.kind ?? ''}
            onChange={(event) =>
              applyScope({
                ...scope,
                kind: WORK_KINDS.find((kind) => kind === event.target.value) ?? null,
              })
            }
            className={worklistSelectClass}
          >
            <option value="">Todas</option>
            {WORK_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {WORK_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--color-text-secondary)]">
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
