import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClientsApiError,
  getClientAuditTrail,
  getClientDataQuality,
  getClientFinancialContext,
  getClientHierarchy,
  setClientHierarchy,
} from '../api/clients-api';
import type {
  Client,
  ClientAuditTrail,
  ClientDataQuality,
  ClientFinancialContext,
  ClientHierarchy,
  ClientHierarchyNode,
} from '../types/client.types';
import {
  auditActionLabel,
  buildHierarchyView,
  countQualityFindings,
  diffAuditEntry,
  qualitySeverityLabel,
  qualitySeverityTone,
} from '../utils/client-360-presentation';
import { formatMoney } from '../utils/client-workspace-presentation';
import { ObjectPanel } from '../../enterprise-object';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { StatusBadge } from '../../ui/StatusBadge';
import { cn } from '../../ui/utils/cn';

/**
 * HIERARQUIA EMPRESARIAL — GRUPO ECONÔMICO, MATRIZ E FILIAIS.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * VÍNCULO DECLARADO, NUNCA INFERIDO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Nada nesta seção deduz hierarquia de nome, de CNPJ ou de endereço. O grupo econômico e a matriz
 * são VÍNCULOS que o operador declara por comando, e o servidor recusa o vínculo que criaria um
 * ciclo (A -> B -> A). Quando não há estrutura declarada, a seção DIZ ISSO — em vez de sugerir uma
 * hierarquia provável.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ÁRVORE PARCIAL É DECLARADA, NÃO ESCONDIDA
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A travessia no servidor tem teto de profundidade e de nós. Quando o teto é atingido, a resposta
 * traz `truncated: true` e a UI AVISA que a estrutura mostrada é parcial. Apresentar uma lista
 * curta como se fosse a árvore completa seria a pior forma de mentir sobre dado empresarial.
 */

export type ClientHierarchyPanelProps = {
  client: Client;
  canManage: boolean;
  onUpdated: (client: Client) => void;
  onError: (message: string) => void;
};

type HierarchyState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error' }
  | { phase: 'ready'; hierarchy: ClientHierarchy };

export function ClientHierarchyPanel({
  client,
  canManage,
  onUpdated,
  onError,
}: ClientHierarchyPanelProps) {
  const [state, setState] = useState<HierarchyState>({ phase: 'loading' });
  const [editing, setEditing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    void getClientHierarchy(client.id, controller.signal)
      .then((hierarchy) => {
        if (!controller.signal.aborted) {
          setState({ phase: 'ready', hierarchy });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          phase: error instanceof ClientsApiError && error.kind === 'denied' ? 'denied' : 'error',
        });
      });
    return () => controller.abort();
  }, [client.id, reloadToken]);

  const view = state.phase === 'ready' ? buildHierarchyView(state.hierarchy) : null;

  return (
    <ObjectPanel
      title="Hierarquia empresarial"
      actions={
        canManage && state.phase === 'ready' ? (
          <button
            type="button"
            data-testid="client-hierarchy-edit-toggle"
            className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? 'Cancelar' : 'Declarar vínculo'}
          </button>
        ) : null
      }
    >
      {editing && canManage ? (
        <HierarchyForm
          client={client}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            onUpdated(updated);
            // A árvore é releída porque o vínculo mudou: a estrutura exibida precisa refletir o
            // que o servidor passou a publicar, não o que estava na tela antes do comando.
            setReloadToken((current) => current + 1);
          }}
          onError={onError}
        />
      ) : null}

      {state.phase === 'loading' ? (
        <div aria-busy="true" role="status" className="flex flex-col gap-1">
          <span className="cisne-type-helper">Carregando estrutura…</span>
          <Skeleton lines={2} />
        </div>
      ) : null}

      {/*
        NEGAÇÃO ≠ VAZIO. Sem permissão de leitura do Cliente a árvore não é consultável, e a seção
        diz isso em vez de mostrar "sem estrutura declarada" — que seria uma afirmação sobre dado
        que não se conseguiu ler.
      */}
      {state.phase === 'denied' ? (
        <p className="cisne-type-body m-0" role="alert">
          Você não tem permissão para consultar a estrutura deste Cliente.
        </p>
      ) : null}

      {state.phase === 'error' ? (
        <p className="cisne-type-body m-0 text-red-700" role="alert">
          Não foi possível carregar a estrutura.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setReloadToken((current) => current + 1)}
          >
            Tentar novamente
          </button>
        </p>
      ) : null}

      {view ? (
        <>
          {/*
            O GRUPO ECONÔMICO CONTA COMO VÍNCULO DECLARADO.
            
            A primeira versão desta condição olhava apenas `ancestors` e `children` — os vínculos de
            MATRIZ/FILIAL. Um Cliente que declarou GRUPO mas não tem pai nem filiais caía no ramo
            de "nenhum vínculo declarado", o que é FALSO: o grupo existe, é dado persistido e está
            no payload. Defeito encontrado pelo teste do grupo declarado, não por leitura.
          */}
          {view.ancestors.length === 0 &&
          view.children.length === 0 &&
          !client.groupName &&
          !client.parentClientName ? (
            <p className="cisne-type-body m-0 text-gray-500">
              Nenhum vínculo declarado. Este Cliente não tem grupo econômico nem matriz registrados.
            </p>
          ) : (
            <>
              {view.ancestors.length > 0 ? (
                <div className="mb-2">
                  <h3 className="cisne-meta-label m-0 mb-1">Cadeia até este Cliente</h3>
                  <ol className="m-0 flex list-none flex-col gap-1 p-0">
                    {view.ancestors.map((node) => (
                      <li key={node.id} className="flex min-w-0 items-baseline gap-1.5 pl-2">
                        <span aria-hidden="true" className="cisne-type-helper">
                          ↳
                        </span>
                        <HierarchyNodeLink node={node} />
                      </li>
                    ))}
                    {view.self ? (
                      <li className="flex min-w-0 items-baseline gap-1.5 pl-2">
                        <span aria-hidden="true" className="cisne-type-helper">
                          ●
                        </span>
                        <span className="cisne-type-meta font-semibold">
                          {view.self.legal_name}
                        </span>
                        {client.groupName ? (
                          <span className="cisne-type-helper">{client.groupName}</span>
                        ) : null}
                      </li>
                    ) : null}
                  </ol>
                </div>
              ) : client.groupName || client.parentClientName ? (
                <dl className="m-0 mb-2 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-2 gap-y-1">
                  {client.groupName ? (
                    <>
                      <dt className="cisne-meta-label">Grupo econômico</dt>
                      <dd className="cisne-type-meta m-0">{client.groupName}</dd>
                    </>
                  ) : null}
                  {client.parentClientName ? (
                    <>
                      <dt className="cisne-meta-label">Matriz</dt>
                      <dd className="cisne-type-meta m-0">{client.parentClientName}</dd>
                    </>
                  ) : null}
                </dl>
              ) : null}

              {view.children.length > 0 ? (
                <div>
                  <h3 className="cisne-meta-label m-0 mb-1">
                    Filiais · {view.children.length}
                    {view.truncated ? ' (parcial)' : ''}
                  </h3>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {view.children.map((node) => (
                      <li key={node.id} className="flex min-w-0 items-baseline gap-1.5 pl-2">
                        <span aria-hidden="true" className="cisne-type-helper">
                          ↳
                        </span>
                        <HierarchyNodeLink node={node} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}

          {/*
            AVISO DE TRUNCAMENTO — declarado quando o servidor o publica. A árvore mostrada é
            PARCIAL, e o operador precisa saber disso para não concluir que a estrutura acabou.
          */}
          {view.truncated ? (
            <p className="cisne-type-helper m-0 mt-1.5 text-amber-700" role="note">
              A estrutura exibida é parcial: o limite de profundidade ou de registros foi atingido.
            </p>
          ) : null}
        </>
      ) : null}
    </ObjectPanel>
  );
}

function HierarchyNodeLink({ node }: { node: ClientHierarchyNode }) {
  return (
    <>
      <Link
        to={`/app/clients/${node.id}`}
        className="cisne-type-meta min-w-0 truncate text-brand-800 no-underline hover:underline"
      >
        {node.legal_name}
      </Link>
      {/*
        NOME FANTASIA quando existe — é o rótulo pelo qual a operação reconhece a empresa. O CNPJ
        NÃO é exibido aqui porque o nó da árvore não o publica: inventá-lo a partir do `group_id`
        (que é outra coisa) seria afirmar um dado que o servidor nunca mandou.
      */}
      {node.trade_name ? (
        <span className="cisne-type-helper min-w-0 truncate">{node.trade_name}</span>
      ) : null}
      {node.child_count > 0 ? (
        <span className="cisne-type-helper">
          {node.child_count} {node.child_count === 1 ? 'filial' : 'filiais'}
        </span>
      ) : null}
      {node.status === 'INACTIVE' ? <StatusBadge label="Inativo" tone="error" /> : null}
    </>
  );
}

/**
 * DECLARAÇÃO DO VÍNCULO.
 *
 * `parentClientId` e `groupName` são enviados como `null` quando o operador escolhe REMOVER o
 * vínculo — distinto de não enviar, que deixaria o valor atual intacto. A distinção é o contrato
 * inteiro do comando: sem ela não haveria como desfazer uma declaração.
 */
function HierarchyForm({
  client,
  onCancel,
  onSaved,
  onError,
}: {
  client: Client;
  onCancel: () => void;
  onSaved: (client: Client) => void;
  onError: (message: string) => void;
}) {
  const parentId = useId();
  const groupId = useId();
  const [parentClientId, setParentClientId] = useState(client.parentClientId ?? '');
  const [groupName, setGroupName] = useState(client.groupName ?? '');
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      const updated = await setClientHierarchy(client.id, {
        version: client.version,
        // String vazia significa REMOVER (vira `null`); com valor, declara o vínculo.
        parentClientId: parentClientId.trim() === '' ? null : parentClientId.trim(),
        groupName: groupName.trim() === '' ? null : groupName.trim(),
      });
      onSaved(updated);
    } catch {
      onError('Não foi possível declarar o vínculo. Verifique se ele não criaria um ciclo.');
    } finally {
      setSubmitting(false);
    }
  }, [client.id, client.version, groupName, onError, onSaved, parentClientId]);

  return (
    <div
      data-testid="client-hierarchy-form"
      className="mb-2 flex flex-col gap-1.5 border border-gray-200 bg-gray-50/60 p-2"
    >
      <label className="flex flex-col gap-0.5">
        <span className="cisne-meta-label">Grupo econômico</span>
        <input
          id={groupId}
          data-testid="client-hierarchy-group"
          className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2"
          value={groupName}
          disabled={submitting}
          placeholder="Em branco remove o vínculo"
          onChange={(event) => setGroupName(event.target.value)}
        />
      </label>
      <p className="cisne-type-helper m-0">
        Dois Clientes com o mesmo nome de grupo passam a apontar para o mesmo registro.
      </p>

      <label className="flex flex-col gap-0.5">
        <span className="cisne-meta-label">Matriz (identificador do Cliente)</span>
        <input
          id={parentId}
          data-testid="client-hierarchy-parent"
          className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2 font-mono"
          value={parentClientId}
          disabled={submitting}
          placeholder="Em branco remove o vínculo"
          onChange={(event) => setParentClientId(event.target.value)}
        />
      </label>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="primary"
          loading={submitting}
          loadingText="Declarando…"
          onClick={() => void submit()}
        >
          Declarar vínculo
        </Button>
        <button
          type="button"
          className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/* ── qualidade dos dados ────────────────────────────────────────────────────────────────── */

type QualityState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error' }
  | { phase: 'ready'; quality: ClientDataQuality };

/**
 * QUALIDADE DOS DADOS — APONTAMENTOS, NUNCA UMA NOTA.
 *
 * A seção lista O QUE FALTA e POR QUE IMPORTA. Não existe percentual nem selo de "cadastro
 * completo": uma nota exigiria pesos que nenhuma fonte confirma, esconderia a causa e convidaria a
 * comparar Clientes entre si — o que não tem significado operacional.
 *
 * `isComplete` é AFIRMADO pelo servidor, e é ele que produz a mensagem positiva. Lista vazia
 * sozinha seria ambígua entre "avaliado e completo" e "não avaliado".
 */
export function ClientDataQualityPanel({ clientId }: { clientId: string }) {
  const [state, setState] = useState<QualityState>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    void getClientDataQuality(clientId, controller.signal)
      .then((quality) => {
        if (!controller.signal.aborted) {
          setState({ phase: 'ready', quality });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          phase: error instanceof ClientsApiError && error.kind === 'denied' ? 'denied' : 'error',
        });
      });
    return () => controller.abort();
  }, [clientId]);

  if (state.phase === 'loading') {
    return (
      <ObjectPanel title="Qualidade do cadastro">
        <div aria-busy="true" role="status">
          <Skeleton lines={2} />
        </div>
      </ObjectPanel>
    );
  }

  if (state.phase === 'denied' || state.phase === 'error') {
    // Ausência de avaliação não é "cadastro perfeito": a seção some por inteiro quando não há
    // avaliação a mostrar.
    return null;
  }

  const counts = countQualityFindings(state.quality);

  return (
    <ObjectPanel
      title="Qualidade do cadastro"
      actions={
        state.quality.isComplete ? (
          <StatusBadge label="Sem pendências" tone="success" />
        ) : (
          <span className="flex items-center gap-1">
            {counts.blocking > 0 ? (
              <StatusBadge label={`${counts.blocking} bloqueia`} tone="error" />
            ) : null}
            {counts.attention > 0 ? (
              <StatusBadge label={`${counts.attention} atenção`} tone="warning" />
            ) : null}
            {counts.advisory > 0 ? (
              <span className="cisne-type-helper">{counts.advisory} recomendação</span>
            ) : null}
          </span>
        )
      }
    >
      {state.quality.isComplete ? (
        <p className="cisne-type-body m-0 text-gray-600">
          Nenhum apontamento: os dados obrigatórios do cadastro estão completos.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {state.quality.findings.map((finding) => (
            <li
              key={finding.code}
              data-testid="client-quality-finding"
              data-severity={finding.severity}
              className={cn(
                'border-l-[3px] pl-2',
                qualitySeverityTone(finding.severity) === 'error'
                  ? 'border-l-red-500'
                  : qualitySeverityTone(finding.severity) === 'warning'
                    ? 'border-l-amber-500'
                    : 'border-l-gray-300',
              )}
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                <span className="cisne-type-meta font-semibold">{finding.summary}</span>
                <span className="cisne-type-helper">{qualitySeverityLabel(finding.severity)}</span>
              </div>
              {/*
                A CONSEQUÊNCIA, não uma recomendação genérica. É o que faz o operador agir: "a
                cobrança não tem destinatário" é acionável; "revise o cadastro" não é.
              */}
              <p className="cisne-type-helper m-0">{finding.consequence}</p>
            </li>
          ))}
        </ul>
      )}
    </ObjectPanel>
  );
}

/* ── financeiro ────────────────────────────────────────────────────────────────────────── */

type FinancialState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error' }
  | { phase: 'ready'; context: ClientFinancialContext };

/**
 * CONTEXTO FINANCEIRO DO CLIENTE — READ MODEL AUTORITATIVO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA SEÇÃO NÃO SOMA NADA NO FRONTEND
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A tentação seria somar as páginas de `GET /finance/receivables?clientId=...`. Isso produziria um
 * total FALSO: página paginada não é conjunto, e o número exibido mudaria conforme o operador
 * paginasse. O servidor agrega sob o escopo do ator e publica o resultado pronto.
 *
 * TRÊS DESFECHOS, TRÊS LEITURAS DIFERENTES:
 *
 *  - valores medidos      → "Em aberto" e, quando houver, "Vencido (n)" em destaque;
 *  - autorizado e vazio   → "Nenhum título a receber", que é um FATO consultado;
 *  - não autorizado (403) → a seção DECLARA a restrição. NÃO mostra zero: "R$ 0,00" afirmaria que
 *    o Cliente não deve nada, quando na verdade o dado não foi lido.
 */
export function ClientFinancialContextPanel({ clientId }: { clientId: string }) {
  const [state, setState] = useState<FinancialState>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    void getClientFinancialContext(clientId, controller.signal)
      .then((context) => {
        if (!controller.signal.aborted) {
          setState({ phase: 'ready', context });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          phase: error instanceof ClientsApiError && error.kind === 'denied' ? 'denied' : 'error',
        });
      });
    return () => controller.abort();
  }, [clientId]);

  if (state.phase === 'loading') {
    return (
      <div aria-busy="true" role="status">
        <Skeleton lines={2} />
      </div>
    );
  }

  /*
   * NEGAÇÃO DE ACESSO É DECLARADA, E NÃO CONFUNDIDA COM AUSÊNCIA DE DÍVIDA.
   * O ator pode ler o Cliente sem ter concessão sobre títulos a receber — e nesse caso o valor é
   * DESCONHECIDO, não zero.
   */
  if (state.phase === 'denied') {
    return (
      <p className="cisne-type-helper m-0" role="note" data-region="financial-denied">
        Sem acesso aos títulos deste Cliente. O valor não é exibido como zero porque ele não foi
        lido.
      </p>
    );
  }

  if (state.phase === 'error') {
    return (
      <p className="cisne-type-helper m-0 text-red-700" role="alert">
        Não foi possível carregar o contexto financeiro. Isso não significa que o Cliente não tenha
        títulos.
      </p>
    );
  }

  const { context } = state;

  /* Sem concessão utilizável: o servidor respondeu, mas nenhum título está ao alcance do ator. */
  if (!context.authorized || context.currencies === null) {
    return (
      <p className="cisne-type-helper m-0" role="note" data-region="financial-unauthorized">
        Os títulos deste Cliente não estão no seu escopo de acesso. O valor não é exibido como zero
        porque ele não foi lido.
      </p>
    );
  }

  if (context.currencies.length === 0) {
    return (
      <p className="cisne-type-meta m-0" data-region="financial-empty">
        Nenhum título a receber para este Cliente.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-region="financial-context">
      {context.currencies.map((totals) => (
        <dl
          key={totals.currencyCode}
          className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1"
        >
          <dt className="cisne-meta-label pt-0.5">Em aberto</dt>
          <dd className="m-0 text-right font-mono text-[13px] tabular-nums text-gray-900">
            {formatMoney(totals.openAmount, totals.currencyCode)}
          </dd>

          {/*
            VENCIDO SÓ APARECE QUANDO EXISTE — um "Vencido R$ 0,00" em toda ficha pintaria de
            vermelho o estado normal e faria a exceção perder significado.
          */}
          {totals.overdueCount > 0 ? (
            <>
              <dt className="cisne-meta-label pt-0.5">Vencido ({totals.overdueCount})</dt>
              <dd className="m-0 text-right font-mono text-[13px] font-semibold tabular-nums text-red-700">
                {formatMoney(totals.overdueAmount, totals.currencyCode)}
              </dd>
            </>
          ) : null}

          {totals.nextDueDate ? (
            <>
              <dt className="cisne-meta-label pt-0.5">Próximo vencimento</dt>
              <dd className="m-0 text-right font-mono text-[13px] tabular-nums text-gray-900">
                {new Date(totals.nextDueDate).toLocaleDateString('pt-BR')}
              </dd>
            </>
          ) : null}

          <dt className="cisne-meta-label pt-0.5">Faturado</dt>
          <dd className="m-0 text-right font-mono text-[13px] tabular-nums text-gray-600">
            {formatMoney(totals.billedAmount, totals.currencyCode)}
          </dd>

          <dt className="cisne-meta-label pt-0.5">Recebido</dt>
          <dd className="m-0 text-right font-mono text-[13px] tabular-nums text-gray-600">
            {formatMoney(totals.receivedAmount, totals.currencyCode)}
          </dd>
        </dl>
      ))}
    </div>
  );
}

/* ── trilha de auditoria ───────────────────────────────────────────────────────────────── */

type AuditState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error' }
  | { phase: 'ready'; trail: ClientAuditTrail };

/**
 * HISTÓRICO DE ALTERAÇÕES — A TRILHA DE VALOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA SEÇÃO SUBSTITUI
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Antes, o "Histórico" da ficha era derivado de TRÊS TIMESTAMPS (`createdAt`, `updatedAt`,
 * `deactivatedAt`) e dizia "Cadastro criado / atualizado / desativado" — sem dizer QUEM nem O QUE
 * mudou. Isso é uma inferência sobre carimbos de data, não uma trilha.
 *
 * Agora a seção lê o canal AUDIT_TRAIL do servidor, que publica o PAR (valor anterior, valor novo)
 * por alteração, com autor e correlação. Cada linha mostra o que efetivamente mudou.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * CAPABILITY PRÓPRIA — E A SEÇÃO SABE DISSO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A trilha exige `client:audit:read`, separada de `client:client:read`. Quando o servidor responde
 * 403, a seção DECLARA a restrição em vez de aparecer vazia — "não há alterações" e "não posso ver
 * as alterações" são fatos diferentes.
 *
 * NENHUM SEGREDO É RENDERIZADO: o servidor já aplica um allow-list fechado no snapshot (contatos e
 * endereços de terceiros ficam de fora), e esta seção apenas traduz os rótulos.
 */
export function ClientAuditTrailPanel({ clientId }: { clientId: string }) {
  const [state, setState] = useState<AuditState>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    void getClientAuditTrail(clientId, { limit: 20, offset: 0 }, controller.signal)
      .then((trail) => {
        if (!controller.signal.aborted) {
          setState({ phase: 'ready', trail });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          phase: error instanceof ClientsApiError && error.kind === 'denied' ? 'denied' : 'error',
        });
      });
    return () => controller.abort();
  }, [clientId]);

  return (
    <ObjectPanel title="Histórico de alterações">
      {state.phase === 'loading' ? (
        <div aria-busy="true" role="status">
          <Skeleton lines={3} />
        </div>
      ) : null}

      {state.phase === 'denied' ? (
        <p className="cisne-type-helper m-0" role="note">
          Você não tem permissão para consultar o histórico de alterações deste Cliente.
        </p>
      ) : null}

      {state.phase === 'error' ? (
        <p className="cisne-type-helper m-0 text-red-700" role="alert">
          Não foi possível carregar o histórico.
        </p>
      ) : null}

      {state.phase === 'ready' ? (
        state.trail.items.length === 0 ? (
          <p className="cisne-type-helper m-0">
            Nenhuma alteração registrada para este cadastro.
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {state.trail.items.map((entry) => {
              const changes = diffAuditEntry(entry);
              return (
                <li
                  key={entry.id}
                  data-testid="client-audit-entry"
                  data-action={entry.action}
                  className="border-b border-gray-100 pb-1.5 last:border-b-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                    <strong className="cisne-type-meta">{auditActionLabel(entry.action)}</strong>
                    <span className="cisne-type-helper">
                      {new Date(entry.occurredAt).toLocaleString('pt-BR')}
                    </span>
                  </div>

                  {changes.length > 0 ? (
                    <ul className="m-0 mt-0.5 flex list-none flex-col gap-0.5 p-0">
                      {changes.map((change) => (
                        <li key={change.field} className="cisne-type-helper">
                          <span className="font-medium">{change.label}:</span>{' '}
                          {/*
                            "não havia valor" é a leitura honesta de `null` no snapshot: na criação
                            não existe estado anterior, e imprimir uma string vazia faria parecer
                            que o campo estava em branco no cadastro.
                          */}
                          <span className="text-gray-400">
                            {change.before ?? 'não havia valor'}
                          </span>{' '}
                          → <span className="text-gray-900">{change.after ?? 'removido'}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cisne-type-helper m-0">Sem alteração de campo registrada.</p>
                  )}
                </li>
              );
            })}
          </ol>
        )
      ) : null}
    </ObjectPanel>
  );
}
