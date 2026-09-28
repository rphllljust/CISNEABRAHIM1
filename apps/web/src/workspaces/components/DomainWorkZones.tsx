import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ContextDrawer, type ContextField } from '../../operator';
import { isTechnicalIdentity } from '../../shell/format-identity';
import {
  WORK_DOMAIN_LABELS,
  WORK_KIND_LABELS,
  type WorkDomain,
  type WorkItem,
  type WorkKind,
} from '../../work-inbox/api/work-inbox-api';
import { DOMAIN_WORKSPACES } from '../domain-workspaces';
import { useDomainWork, type DomainWorkState } from '../api/use-domain-work';
import { WorkspaceZone } from './WorkspaceZone';

/**
 * AS TRES ZONAS DO WORKSPACE DE DOMINIO.
 *
 * 1. AGORA       -> `byDomain[domain]` do read model, sem recorte: o MESMO numero que a Central
 *                   de trabalho exibe no chip do dominio. Clicar abre a fila com o MESMO filtro
 *                   (`/app/work-inbox?domain=<DOMINIO>`), entao o operador cai exatamente no
 *                   conjunto que foi contado.
 * 2. ATENCAO     -> somente BLOCKER e EXCEPTION reais do dominio, filtrados no servidor. Sem
 *                   score, sem urgencia inventada; quando nao ha nada, a zona diz isso.
 * 3. CONTINUAR   -> poucos atalhos densos para listas que ja existem. Nao e menu de cartoes.
 *
 * Regra de honestidade aplicada nas tres: contagem nunca e substituida por zero. Dominio
 * indisponivel no read model, permissao negada ou falha de rede sao DECLARADOS.
 */

/** Plural do excedente por natureza — evita "1 bloqueios". */
const ATTENTION_PLURAL: Record<'BLOCKER' | 'EXCEPTION', string> = {
  BLOCKER: 'bloqueios',
  EXCEPTION: 'exceções',
};

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function attentionPlural(kind: WorkKind): string {
  if (kind === 'BLOCKER' || kind === 'EXCEPTION') {
    return ATTENTION_PLURAL[kind];
  }
  return WORK_KIND_LABELS[kind].toLowerCase();
}

function formatMoment(value: string | null): string {
  if (!value) {
    return 'sem prazo';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'sem prazo';
  }
  return date.toLocaleDateString('pt-BR');
}

/**
 * Fatos do contexto do item — SO o que e humano.
 *
 * `status` do read model e o estado PERSISTIDO do dominio (codigo interno) e nao entra aqui:
 * natureza, motivo e contexto ja dizem o que o operador precisa saber para decidir. A unidade
 * entra apenas quando o proprio dominio publica um codigo legivel; identificador tecnico nao
 * vira rotulo (mesma regra de `isTechnicalIdentity` usada na identidade do shell).
 */
function contextFacts(item: WorkItem): ContextField[] {
  const facts: ContextField[] = [
    { label: 'Domínio', value: WORK_DOMAIN_LABELS[item.domain] },
    { label: 'Natureza', value: WORK_KIND_LABELS[item.kind] },
    { label: 'Motivo', value: item.reason },
    { label: 'Contexto', value: item.contextLabel || '—' },
    { label: 'Prazo', value: formatMoment(item.dueAt) },
  ];

  if (item.unitId && !isTechnicalIdentity(item.unitId)) {
    facts.push({ label: 'Unidade', value: item.unitId });
  }

  return facts;
}

export function DomainWorkZones({ domain }: { domain: WorkDomain }) {
  const config = DOMAIN_WORKSPACES[domain];
  const work = useDomainWork(domain);
  const [selected, setSelected] = useState<WorkItem | null>(null);

  return (
    <>
      <AgoraZone domain={domain} label={config.title} state={work} />
      <AtencaoZone domain={domain} state={work} onSelect={setSelected} />
      <ContinuarZone domain={domain} />

      {/* Contexto do item de atencao: os fatos que a fila ja entregou, sem nova consulta. */}
      <ContextDrawer
        open={selected !== null}
        title="Contexto do trabalho"
        onClose={() => setSelected(null)}
        preview={
          selected
            ? {
                identifier: selected.businessReference,
                subtitle: selected.title,
                facts: contextFacts(selected),
                nextAction: {
                  label: selected.actionLabel,
                  href: selected.targetRoute,
                  kind: 'primary',
                },
              }
            : null
        }
      />
    </>
  );
}

function AgoraZone({
  domain,
  label,
  state,
}: {
  domain: WorkDomain;
  label: string;
  state: DomainWorkState;
}) {
  const filteredInbox = `/app/work-inbox?domain=${domain}`;

  return (
    <WorkspaceZone
      title="Agora"
      note="Contagem da fila de trabalho deste domínio — o mesmo número da Central de trabalho."
    >
      {state.phase === 'loading' ? (
        <p aria-busy="true" aria-live="polite" className="m-0 text-sm text-gray-500">
          Lendo a fila de trabalho…
        </p>
      ) : null}

      {state.phase === 'denied' || state.phase === 'error' ? (
        <p role="alert" className="m-0 text-sm text-red-700">
          {state.message}
        </p>
      ) : null}

      {state.phase === 'ready' && state.unavailable ? (
        <p role="status" className="m-0 text-sm text-amber-800">
          O domínio {label} não respondeu nesta leitura. A contagem é desconhecida — não é zero, e a
          fila pode estar incompleta.
        </p>
      ) : null}

      {state.phase === 'ready' && !state.unavailable && state.agoraCount === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-sm text-gray-600">Nenhum trabalho pendente neste domínio.</p>
          <Link
            to={filteredInbox}
            aria-label={`Abrir a Central de trabalho filtrada por ${label}`}
            className="text-xs font-semibold text-brand-700 no-underline hover:text-brand-800"
          >
            Abrir a fila deste domínio
          </Link>
        </div>
      ) : null}

      {state.phase === 'ready' &&
      !state.unavailable &&
      state.agoraCount !== null &&
      state.agoraCount > 0 ? (
        <Link
          to={filteredInbox}
          aria-label={`Abrir a Central de trabalho filtrada por ${label}: ${state.agoraCount} ${pluralize(
            state.agoraCount,
            'pendência',
            'pendências',
          )}`}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-1 py-0.5 no-underline ring-1 ring-transparent ring-inset hover:bg-gray-50 hover:ring-gray-200"
        >
          <span className="text-xl font-semibold tabular-nums text-gray-900">
            {state.agoraCount}
          </span>
          <span className="text-xs text-gray-600">
            {pluralize(state.agoraCount, 'pendência aguardando', 'pendências aguardando')} decisão
            neste domínio
          </span>
          <span className="ml-auto text-xs font-semibold text-brand-700">
            Abrir a fila deste domínio →
          </span>
        </Link>
      ) : null}
    </WorkspaceZone>
  );
}

function AtencaoZone({
  domain,
  state,
  onSelect,
}: {
  domain: WorkDomain;
  state: DomainWorkState;
  onSelect: (item: WorkItem) => void;
}) {
  return (
    <WorkspaceZone
      title="Atenção"
      note="Bloqueios e exceções reais deste domínio, sem pontuação nem urgência estimada."
    >
      {state.attentionPhase === 'loading' ? (
        <p aria-busy="true" aria-live="polite" className="m-0 text-sm text-gray-500">
          Lendo bloqueios e exceções…
        </p>
      ) : null}

      {state.attentionPhase === 'denied' || state.attentionPhase === 'error' ? (
        <p role="alert" className="m-0 text-sm text-red-700">
          {state.attentionMessage}
        </p>
      ) : null}

      {state.attentionPhase === 'ready' && state.attention.length === 0 ? (
        <p className="m-0 text-sm text-gray-600">Nenhum bloqueio ou exceção neste domínio agora.</p>
      ) : null}

      {state.attention.length > 0 ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0">
          {state.attention.map((item) => (
            <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-gray-700 uppercase">
                {WORK_KIND_LABELS[item.kind]}
              </span>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="text-left text-[13px] font-semibold text-brand-700 hover:text-brand-800"
              >
                {item.businessReference}
              </button>
              <span className="text-[13px] text-gray-800">{item.title}</span>
              <span className="text-[11px] text-gray-500">{item.reason}</span>
              {item.contextLabel ? (
                <span className="text-[11px] text-gray-500">{item.contextLabel}</span>
              ) : null}
              <span className="text-[11px] text-gray-500 tabular-nums">
                {formatMoment(item.dueAt)}
              </span>
              <Link
                to={item.targetRoute}
                className="ml-auto text-xs font-semibold text-brand-700 no-underline hover:text-brand-800"
              >
                {item.actionLabel}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {state.attentionGaps.length > 0 ? (
        <p className="m-0 mt-1 text-[11px] text-gray-500">
          {state.attentionGaps
            .map((gap) => `${gap.hidden} ${attentionPlural(gap.kind)} além dos listados`)
            .join(' · ')}{' '}
          —{' '}
          <Link
            to={`/app/work-inbox?domain=${domain}`}
            className="font-semibold text-brand-700 no-underline hover:text-brand-800"
          >
            ver tudo na Central de trabalho
          </Link>
        </p>
      ) : null}
    </WorkspaceZone>
  );
}

function ContinuarZone({ domain }: { domain: WorkDomain }) {
  const config = DOMAIN_WORKSPACES[domain];

  return (
    <WorkspaceZone title="Continuar" note="Trabalho em andamento neste domínio.">
      <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0">
        {config.shortcuts.map((shortcut) => (
          <li key={shortcut.to}>
            <Link
              to={shortcut.to}
              className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800"
            >
              {shortcut.label}
            </Link>
          </li>
        ))}
      </ul>
    </WorkspaceZone>
  );
}
