import type { ReactNode } from 'react';
import {
  CLIENT_QUALITY_SEVERITIES,
  type ClientDataQuality,
  type ClientFinancialContext,
  type ClientSummary,
} from '../types/client.types';
import {
  buildClientSituations,
  buildFinancialSummary,
  clientStatusLabel,
  deriveClientAttention,
  deriveClientNextAction,
  formatDate,
  hierarchyLabel,
} from '../utils/client-workspace-presentation';
import { formatCnpjDisplay } from '../utils/format-cnpj';
import { StatusBadge } from '../../ui/StatusBadge';
import { cn } from '../../ui/utils/cn';

/**
 * PAINÉIS DO CUSTOMER WORKSPACE.
 *
 * Estes componentes são a superfície de CONTEXTO da carteira: eles vivem na coluna lateral do
 * workspace e no painel lateral da object page, e por isso são deliberadamente de LEITURA. Nenhum
 * deles busca dado por conta própria — recebem o que o servidor publicou e o apresentam.
 *
 * O QUE ELES NÃO FAZEM, E É O PONTO:
 *  - não derivam indicador;
 *  - não somam coleções para produzir número;
 *  - não transformam ausência em zero;
 *  - não mostram seção quando a fonte não publicou.
 */

/* ── identidade ─────────────────────────────────────────────────────────────────────────── */

export function ClientIdentityBlock({ client }: { client: ClientSummary }) {
  const structure = hierarchyLabel(client);
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-2.5 gap-y-1">
      <dt className="cisne-meta-label pt-0.5">CNPJ</dt>
      <dd className="cisne-type-meta m-0 font-mono tabular-nums">
        {formatCnpjDisplay(client.taxId)}
      </dd>

      <dt className="cisne-meta-label pt-0.5">Situação</dt>
      <dd className="m-0">
        {client.status === 'INACTIVE' ? (
          <StatusBadge label={clientStatusLabel(client.status)} tone="error" />
        ) : (
          <span className="cisne-type-meta">{clientStatusLabel(client.status)}</span>
        )}
      </dd>

      {/* ESTRUTURA SÓ EXISTE QUANDO DECLARADA — a linha some em vez de afirmar "sem grupo". */}
      {structure ? (
        <>
          <dt className="cisne-meta-label pt-0.5">Estrutura</dt>
          <dd className="cisne-type-meta m-0">{structure}</dd>
        </>
      ) : null}

      <dt className="cisne-meta-label pt-0.5">Atualizado</dt>
      <dd className="cisne-type-meta m-0">
        {new Date(client.updatedAt).toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
        })}
      </dd>
    </dl>
  );
}

/* ── próxima ação ───────────────────────────────────────────────────────────────────────── */

/**
 * PRÓXIMA AÇÃO NO CONTEXTO DA FILA.
 *
 * Uma faixa de UMA linha: o que fazer, e se é urgente. O comando real roda na object page, para
 * onde a linha faz drillback — a fila não dispara transição de cadastro.
 */
export function ClientNextActionStrip({
  client,
  capabilities,
  href,
}: {
  client: ClientSummary;
  capabilities: { canActivate: boolean; canDeactivate: boolean; canRead: boolean };
  href: string | null;
}) {
  const next = deriveClientNextAction(client, capabilities);
  return (
    <div
      data-region="context-next-action"
      className={cn(
        'flex items-center justify-between gap-2 border-l-[3px] py-1.5 pl-2',
        next.pending ? 'border-l-red-500 bg-red-50/50' : 'border-l-gray-300',
      )}
    >
      <div className="min-w-0">
        <p className="cisne-meta-label m-0">Próxima ação</p>
        <p className={cn('cisne-type-meta m-0 truncate', next.pending && 'font-semibold')}>
          {next.label}
        </p>
      </div>
      {href ? (
        <a
          href={href}
          className="cisne-type-action shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-700 no-underline hover:bg-gray-50"
        >
          Abrir
        </a>
      ) : null}
    </div>
  );
}

/* ── situações ──────────────────────────────────────────────────────────────────────────── */

/**
 * SITUAÇÕES PUBLICADAS — a faixa de exceções do Cliente.
 *
 * Cada entrada vem de fonte real (situação persistida, apontamento de qualidade avaliado pelo
 * servidor, título vencido autorizado). Sem fonte, a faixa declara que não há exceção publicada —
 * e não "tudo certo", que afirmaria uma avaliação que ninguém fez.
 */
export function ClientSituationStrip({
  status,
  quality,
  financial,
}: {
  status: ClientSummary['status'];
  quality: ClientDataQuality | null;
  financial: ClientFinancialContext | null;
}) {
  const situations = buildClientSituations({ status, quality, financial });

  if (situations.length === 0) {
    return (
      <p className="cisne-type-helper m-0" data-region="context-no-situation">
        Nenhuma exceção publicada para este Cliente.
      </p>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-region="context-situations">
      {situations.map((situation) => (
        <li
          key={situation.id}
          data-situation-tone={situation.tone}
          className={cn(
            'border-l-[3px] pl-2',
            situation.tone === 'critical'
              ? 'border-l-red-500'
              : situation.tone === 'attention'
                ? 'border-l-amber-500'
                : 'border-l-gray-300',
          )}
        >
          <p className="cisne-type-meta m-0 font-semibold">{situation.label}</p>
          <p className="cisne-type-helper m-0">{situation.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/* ── qualidade ──────────────────────────────────────────────────────────────────────────── */

export function ClientQualitySummary({ quality }: { quality: ClientDataQuality | null }) {
  if (!quality?.evaluated) {
    return (
      <p className="cisne-type-helper m-0">
        Avaliação de cadastro não carregada para este registro.
      </p>
    );
  }

  const blocking = quality.findings.filter(
    (finding) => finding.severity === CLIENT_QUALITY_SEVERITIES[0],
  ).length;
  const attention = quality.findings.filter(
    (finding) => finding.severity === CLIENT_QUALITY_SEVERITIES[1],
  ).length;

  if (quality.isComplete) {
    return (
      <p className="cisne-type-meta m-0" data-region="context-quality-complete">
        Sem apontamentos: os dados obrigatórios estão completos.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-region="context-quality">
      {blocking > 0 ? <StatusBadge label={`${blocking} bloqueia`} tone="error" /> : null}
      {attention > 0 ? <StatusBadge label={`${attention} atenção`} tone="warning" /> : null}
      {blocking === 0 && attention === 0 ? (
        <span className="cisne-type-helper">
          {quality.findings.length} recomendação{quality.findings.length === 1 ? '' : 'ões'}
        </span>
      ) : null}
    </div>
  );
}

/* ── financeiro ─────────────────────────────────────────────────────────────────────────── */

/**
 * CONTEXTO FINANCEIRO — SOMENTE O QUE O SERVIDOR AUTORIZOU.
 *
 * Três estados distintos e todos declarados:
 *   autorizado + títulos  → os valores medidos;
 *   autorizado + vazio    → "sem títulos", que é um fato consultado;
 *   não autorizado        → "não disponível para o seu acesso", que NÃO é zero.
 */
export function ClientFinancialSummary({ context }: { context: ClientFinancialContext | null }) {
  const summary = buildFinancialSummary(context);

  if (!summary.evaluated) {
    return <p className="cisne-type-helper m-0">Contexto financeiro não carregado.</p>;
  }
  if (!summary.authorized) {
    return (
      <p className="cisne-type-helper m-0" data-region="context-financial-denied">
        Sem acesso aos títulos deste Cliente. O valor não é exibido como zero: ele não foi lido.
      </p>
    );
  }
  if (summary.empty) {
    return (
      <p className="cisne-type-helper m-0" data-region="context-financial-empty">
        Nenhum título a receber para este Cliente.
      </p>
    );
  }

  return (
    <dl
      className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1"
      data-region="context-financial"
    >
      {summary.lines.map((line) => (
        <FinancialRow key={line.label} label={line.label} value={line.value} tone={line.tone} />
      ))}
    </dl>
  );
}

function FinancialRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'neutral' | 'critical';
}) {
  return (
    <>
      <dt className="cisne-meta-label pt-0.5">{label}</dt>
      <dd
        className={cn(
          'm-0 text-right font-mono text-[13px] tabular-nums',
          tone === 'critical' ? 'font-semibold text-red-700' : 'text-gray-900',
        )}
      >
        {value}
      </dd>
    </>
  );
}

/* ── estruturas de layout ───────────────────────────────────────────────────────────────── */

/**
 * SEÇÃO DO PAINEL DE CONTEXTO.
 *
 * Título de 10px em caixa alta e conteúdo denso: o painel lateral tem MUITAS seções curtas, e um
 * `<h2>` de peso de página em cada uma transformaria o contexto em uma pilha de títulos. A
 * hierarquia aqui vem do rótulo pequeno + regra, não de caixas.
 */
export function ContextSection({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b border-gray-100 pb-2.5 last:border-b-0 last:pb-0', className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="cisne-meta-label m-0">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Cabeçalho do drawer de contexto: identidade humana antes de qualquer metadado. */
export function ContextIdentityHeader({
  client,
  attentionReason,
}: {
  client: ClientSummary;
  attentionReason: string | null;
}) {
  return (
    <header className="border-b border-gray-200 pb-2">
      <h2 className="cisne-type-workspace m-0 truncate" title={client.legalName}>
        {client.tradeName ?? client.legalName}
      </h2>
      {client.tradeName ? (
        <p className="cisne-type-helper m-0 truncate">{client.legalName}</p>
      ) : null}
      {attentionReason ? (
        <p className="cisne-type-helper m-0 mt-0.5 font-medium text-red-700">{attentionReason}</p>
      ) : null}
    </header>
  );
}

/** Rótulo de data em leitura curta, sem inventar recência. */
export function shortDate(value: string | null): string | null {
  return value ? formatDate(value) : null;
}

/** Reexportado para os painéis que já usam a derivação de atenção. */
export { deriveClientAttention };
