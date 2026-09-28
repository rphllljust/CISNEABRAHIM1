import { Link } from 'react-router-dom';
import { DateTime, StatusBadge, type StatusBadgeTone } from '../ui';
import { ObjectPanel } from '../enterprise-object';
import {
  CHAIN_KIND_LABELS,
  CHAIN_RELATION_LABELS,
  type BusinessChain,
  type BusinessChainNode,
} from './types';

/**
 * BUSINESS CHAIN — LINHAGEM DE NEGOCIO.
 *
 * Nao e breadcrumb: breadcrumb diz onde voce esta na arvore de navegacao; a cadeia de negocio
 * diz DE ONDE ESTE REGISTRO VEIO, O QUE ACONTECEU e O QUE FOI GERADO A PARTIR DELE — do pedido
 * ao dinheiro e do dinheiro a contabilidade.
 *
 * Cada item apresenta: natureza do no + referencia HUMANA persistida + status real + data real,
 * e leva ao objeto por CLIQUE (rota autorizada devolvida pelo servidor).
 *
 * NENHUM identificador interno e exibido. NENHUM no nao autorizado aparece — nem o item, nem a
 * contagem, nem a palavra "oculto": o backend simplesmente nao os envia, e a cadeia termina no
 * ultimo no autorizado, como se o resto nao existisse para este ator. E assim mesmo que deve ser.
 */

/** Tom do selo a partir do estado REAL. Estado desconhecido nao vira cor inventada. */
export function chainStatusTone(status: string): StatusBadgeTone {
  switch (status) {
    case 'COMPLETED':
    case 'APPROVED':
    case 'ACCEPTED':
    case 'REGISTERED':
    case 'FINALIZED':
    case 'POSTED':
    case 'AUTHORIZED':
    case 'SETTLED':
    case 'PAID':
    case 'ACTIVE':
      return 'success';
    case 'CANCELLED':
    case 'REVERSED':
    case 'REJECTED':
    case 'VOIDED':
    case 'EXPIRED':
    case 'OVERDUE':
      return 'error';
    case 'IN_EXECUTION':
    case 'RELEASED':
    case 'PREPARED':
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'PARTIALLY_SETTLED':
    case 'CONVERTED':
      return 'warning';
    case 'DRAFT':
    case 'OPEN':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/**
 * Rótulo do estado em linguagem de negocio. Estado sem traducao conhecida e exibido CRU —
 * traduzir por conta propria seria inventar vocabulario que o dominio nao declarou.
 */
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  APPROVED: 'Aprovado',
  ACCEPTED: 'Aceita',
  AUTHORIZED: 'Autorizado',
  CANCELLED: 'Cancelado',
  COMPLETED: 'Concluída',
  CONVERTED: 'Convertida',
  DRAFT: 'Rascunho',
  FINALIZED: 'Emitida',
  IN_EXECUTION: 'Em execução',
  OPEN: 'Em aberto',
  OVERDUE: 'Vencido',
  PARTIALLY_SETTLED: 'Parcialmente liquidado',
  POSTED: 'Contabilizado',
  PREPARED: 'Preparado',
  REGISTERED: 'Registrado',
  REJECTED: 'Rejeitado',
  RELEASED: 'Liberada',
  REVERSED: 'Estornado',
  SETTLED: 'Liquidado',
  SUBMITTED: 'Enviado',
  UNDER_REVIEW: 'Em análise',
  VOIDED: 'Anulado',
};

export function chainStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export type BusinessChainProps = {
  chain: BusinessChain | null;
  phase: 'idle' | 'loading' | 'denied' | 'error' | 'ready';
  message?: string | null;
  onRetry?: () => void;
  title?: string;
};

export function BusinessChain({ chain, phase, message, onRetry, title = 'Cadeia de negócio' }: BusinessChainProps) {
  if (phase === 'loading' || phase === 'idle') {
    return (
      <ObjectPanel title={title}>
        <p className="text-sm text-slate-500" role="status">
          Carregando a linhagem deste registro…
        </p>
      </ObjectPanel>
    );
  }

  if (phase === 'denied') {
    // A cadeia inteira foi negada: nao existe meia-verdade a apresentar.
    return (
      <ObjectPanel title={title}>
        <p className="text-sm text-slate-500" role="status">
          Você não tem permissão para ver a linhagem deste registro.
        </p>
      </ObjectPanel>
    );
  }

  if (phase === 'error') {
    return (
      <ObjectPanel title={title}>
        <p className="text-sm text-slate-500" role="status">
          {message ?? 'Não foi possível carregar a cadeia deste registro.'}
        </p>
        {onRetry ? (
          <button type="button" className="mt-2 text-sm underline" onClick={onRetry}>
            Tentar novamente
          </button>
        ) : null}
      </ObjectPanel>
    );
  }

  const nodes = chain?.nodes ?? [];
  if (nodes.length <= 1) {
    // Cadeia parcial REAL (um registro sem linhagem registrada) nao e erro e nao vira placeholder.
    return (
      <ObjectPanel title={title}>
        <p className="text-sm text-slate-500" role="status">
          Este registro não tem linhagem registrada além dele mesmo.
        </p>
      </ObjectPanel>
    );
  }

  return (
    <ObjectPanel title={title}>
      {chain && chain.milestones.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Resumo da cadeia">
          {chain.milestones.map((milestone) => (
            <li key={`${milestone.label}:${milestone.evidence}`}>
              <span className="font-medium text-slate-800">{milestone.label}</span>
              <span className="ml-1 text-slate-500">· {milestone.evidence}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <ol className="flex flex-col gap-1" aria-label="Linhagem de negócio">
        {nodes.map((node) => (
          <ChainStep key={`${node.kind}:${node.id}`} node={node} />
        ))}
      </ol>
    </ObjectPanel>
  );
}

function ChainStep({ node }: { node: BusinessChainNode }) {
  const isRoot = node.relation === 'ROOT';

  return (
    <li className={isRoot ? 'rounded border border-slate-300 bg-slate-50 p-2' : 'border-l-2 border-slate-200 pl-3 py-1'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {CHAIN_KIND_LABELS[node.kind]}
        </span>
        <Link className="font-medium underline" to={node.route}>
          {node.businessReference}
        </Link>
        <StatusBadge tone={chainStatusTone(node.status)} label={chainStatusLabel(node.status)} />
        {!isRoot ? (
          <span className="text-xs text-slate-500">{CHAIN_RELATION_LABELS[node.relation]}</span>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-slate-600">
        {node.summary} · <DateTime value={node.occurredAt} />
      </p>
    </li>
  );
}
