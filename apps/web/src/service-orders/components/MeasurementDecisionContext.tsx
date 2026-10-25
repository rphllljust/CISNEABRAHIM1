import type { ReactNode } from 'react';
import type {
  AvailableCommand,
  BillingEligibilityDecision,
  MeasurementWorkbenchReadModel,
  WorkbenchDocumentFlowStep,
  WorkbenchSituation,
  WorkbenchTimelineEvent,
} from '../types/measurement-workbench.types';
import {
  acceptanceTone,
  billingResultTone,
  commandImpact,
  formatDuration,
  formatInstant,
  formatMoney,
  formatSignedPercent,
  milestoneTone,
  riskTone,
  stateLabel,
} from '../utils/measurement-workbench-format';
import { cn } from '../../ui/utils/cn';

/**
 * CONTEXTO DA DECISÃO — a coluna direita.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * A REGRA DESTA COLUNA
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * O operador deve conseguir DECIDIR sem sair desta tela. Para isso a coluna
 * apresenta, na ordem em que a decisão acontece: contrato → base de execução →
 * regras comerciais → variações → ajustes → evidência → aceite → elegibilidade →
 * próxima ação.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA COLUNA **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não decide se um comando pode ser executado. `enabled` vem do backend. Um
 * comando bloqueado é RENDERIZADO desabilitado, com o MOTIVO que o backend
 * publicou — nunca oculto. Ocultar faria o operador concluir que o comando não
 * existe, quando na verdade ele existe e ele não pode executá-lo.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO
// ═══════════════════════════════════════════════════════════════════════════════

function Block({ title, children, tone = 'default' }: {
  title: string;
  children: ReactNode;
  tone?: 'default' | 'critical' | 'warning';
}) {
  const toneClass = {
    default: 'border-[color:var(--color-border-default)] bg-white',
    critical: 'border-red-300 bg-red-50',
    warning: 'border-amber-300 bg-amber-50',
  }[tone];

  return (
    <section className={cn('mb-2 overflow-hidden rounded-[10px] border', toneClass)}>
      <h2 className="cisne-type-workspace m-0 border-b border-[color:var(--color-divider)] bg-[color:var(--color-surface-header)] px-3 py-1.5">
        {title}
      </h2>
      <div className="px-3 py-2">{children}</div>
    </section>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="m-0 text-[10px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={cn('m-0 truncate text-[11px] font-medium text-gray-900', mono && 'tabular-nums')}>
        {value}
      </dd>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRATO
// ═══════════════════════════════════════════════════════════════════════════════

export function ContractPanel({ workbench }: { workbench: MeasurementWorkbenchReadModel }) {
  const { businessContext, commercialContext } = workbench;
  return (
    <Block title="Contrato e regras comerciais">
      <dl className="m-0 grid grid-cols-2 gap-x-2 gap-y-1">
        <Fact label="Contrato" value={businessContext.contract ?? 'sem contrato vinculado'} />
        <Fact label="Modelo de preço" value={commercialContext.pricing.source ?? 'não declarado'} />
        <Fact label="Política de faturamento" value={commercialContext.billingPolicy} />
        <Fact
          label="Tolerância"
          value={`${commercialContext.tolerance.percentage.toLocaleString('pt-BR')}% · ${commercialContext.tolerance.source}`}
        />
        <Fact label="Ordem de compra" value={businessContext.purchaseOrder ?? 'não exigida'} />
        <Fact label="Condição de pagamento" value={commercialContext.paymentTerms ?? 'não declarada'} />
      </dl>
    </Block>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BASE DE EXECUÇÃO — A LINHAGEM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PROVA A ORIGEM DA MEDIÇÃO: "de onde veio este número?"
 *
 * A cadeia é: execução → fechamento → base publicada → itens de medição. Mostrar
 * os identificadores e o instante da publicação é o que permite contestar a
 * base — e é o que uma tela de conferência precisa ter para não ser apenas
 * números soltos.
 */
export function ExecutionBasisPanel({ workbench }: { workbench: MeasurementWorkbenchReadModel }) {
  const basis = workbench.measurementBasis;
  return (
    <Block title="Base de execução">
      <dl className="m-0 grid grid-cols-2 gap-x-2 gap-y-1">
        <Fact label="Fechamento" value={basis.executionClosureId ? shortId(basis.executionClosureId) : 'não publicado'} mono />
        <Fact label="Base de medição" value={basis.basisId ? shortId(basis.basisId) : 'não publicada'} mono />
        <Fact label="Publicada em" value={formatInstant(basis.preparedAt) ?? '—'} />
        <Fact label="Linhas" value={String(basis.lineCount)} mono />
        <Fact label="Origem" value={basis.lines[0]?.source ?? '—'} />
        <Fact label="Execução" value={stateLabel(workbench.statuses.execution) ?? workbench.statuses.execution} />
      </dl>
      {basis.lines.length > 0 ? (
        <ul className="m-0 mt-1 list-none p-0 text-[10px] text-gray-600">
          {basis.lines.map((line) => (
            <li key={line.lineKey} className="truncate">
              {line.unitCode}: {line.actualQuantity} ({line.recordCount} registro
              {line.recordCount === 1 ? '' : 's'})
            </li>
          ))}
        </ul>
      ) : null}
    </Block>
  );
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACEITE DO CLIENTE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ACEITE — estado da DIMENSÃO, não status da medição.
 *
 * O prompt é explícito: `CUSTOMER_PENDING` não é estado da medição. Aqui o aceite
 * tem painel próprio, ciclo próprio e histórico próprio — e a tela mostra o
 * CICLO, porque é ele que governa a semântica:
 *
 *   ACEITO    fecha o ciclo e NÃO abre outro
 *   RECUSADO  pode abrir ciclo de correção
 *
 * A tela lê `cycleNumber` do backend e NUNCA calcula `cycle + 1` localmente.
 */
export function AcceptancePanel({
  workbench,
  commands,
  onRecordAcceptance,
  onRecordRejection,
}: {
  workbench: MeasurementWorkbenchReadModel;
  commands: AvailableCommand[];
  onRecordAcceptance: () => void;
  onRecordRejection: () => void;
}) {
  const acceptance = workbench.acceptance;
  const canAccept = findCommand(commands, 'RECORD_ACCEPTANCE')?.enabled === true;
  const canReject = findCommand(commands, 'RECORD_ACCEPTANCE')?.enabled === true;
  const tone = acceptanceTone(acceptance.state);

  return (
    <Block title="Aceite do cliente" tone={tone === 'critical' ? 'critical' : 'default'}>
      <dl className="m-0 grid grid-cols-2 gap-x-2 gap-y-1">
        <Fact label="Exigência" value={acceptance.required ? 'EXIGIDO' : 'NÃO EXIGIDO'} />
        <Fact
          label="Ciclo"
          value={acceptance.latest ? String(acceptance.latest.cycleNumber) : '1'}
          mono
        />
        <Fact label="Estado" value={stateLabel(acceptance.state) ?? acceptance.state} />
        <Fact label="Política" value={acceptance.policySource} />
        {acceptance.latest ? (
          <Fact label="Decidido em" value={formatInstant(acceptance.latest.occurredAt) ?? '—'} />
        ) : null}
        {acceptance.latest?.customerSignerName ? (
          <Fact label="Assinatura" value={acceptance.latest.customerSignerName} />
        ) : null}
      </dl>

      {/* POR QUE ESTA POLÍTICA — texto do backend, não da tela. */}
      <p className="m-0 mt-1 text-[10px] leading-snug text-gray-600">{acceptance.policyReason}</p>

      {acceptance.blockingReason ? (
        <p className="m-0 mt-1 text-[11px] font-medium text-red-800">{acceptance.blockingReason}</p>
      ) : null}

      {acceptance.latest?.rejectionReason ? (
        <p className="m-0 mt-1 text-[11px] text-red-800">
          Motivo da recusa: {acceptance.latest.rejectionReason}
        </p>
      ) : null}

      {acceptance.history.length > 1 ? (
        <ul className="m-0 mt-1 list-none p-0 text-[10px] text-gray-600">
          {acceptance.history.map((entry) => (
            <li key={entry.id} className="truncate">
              Ciclo {entry.cycleNumber}: {stateLabel(entry.result) ?? entry.result}
              {entry.rejectionReason ? ` — ${entry.rejectionReason}` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {acceptance.required ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {/*
           * OS DOIS BOTÕES LEEM O MESMO COMANDO.
           *
           * Aceite e recusa são a MESMA decisão sobre a entrega, com resultados
           * opostos: o backend habilita `RECORD_ACCEPTANCE` uma vez por ciclo, e
           * a tela oferece as duas saídas. Separar em dois comandos no contrato
           * criaria dois caminhos para o mesmo ciclo.
           */}
          <button
            type="button"
            disabled={!canAccept}
            onClick={onRecordAcceptance}
            className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Registrar aceite
          </button>
          <button
            type="button"
            disabled={!canReject}
            onClick={onRecordRejection}
            className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-800 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
          >
            Registrar recusa
          </button>
        </div>
      ) : (
        <p className="m-0 mt-2 text-[10px] text-gray-500">
          A política comercial não exige aceite para esta entrega.
        </p>
      )}
    </Block>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ELEGIBILIDADE DE FATURAMENTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ELEGIBILIDADE COMO MODELO DE DECISÃO.
 *
 * Cada dimensão recebe ✓ ou ✕, com o status que o backend atribuiu. Um operador
 * que vê "Aceite do cliente — Pendente" entende o bloqueio; um que vê só
 * "BLOCKED" precisa abrir outra tela para descobrir o motivo.
 *
 * `READY` mostra o valor elegível — o ponto de entrega desta vertical.
 */
export function BillingEligibilityPanel({ decision }: { decision: BillingEligibilityDecision }) {
  const tone = billingResultTone(decision.result);

  return (
    <Block title="Elegibilidade de faturamento" tone={tone === 'critical' ? 'critical' : 'default'}>
      <dl className="m-0 mb-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
        {decision.dimensions.map((dimension) => (
          <div key={dimension.dimension} className="flex items-baseline justify-between gap-1 text-[11px]">
            <dt className="truncate text-gray-600">{dimension.label}</dt>
            <dd
              className={cn(
                'm-0 shrink-0 font-semibold',
                dimension.status === 'SATISFIED'
                  ? 'text-emerald-700'
                  : dimension.status === 'NOT_APPLICABLE'
                    ? 'text-gray-400'
                    : dimension.status === 'PENDING'
                      ? 'text-amber-700'
                      : 'text-red-700',
              )}
              title={dimension.detail}
            >
              {dimension.status === 'SATISFIED'
                ? '✓'
                : dimension.status === 'NOT_APPLICABLE'
                  ? '—'
                  : '✕'}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-[color:var(--color-divider)] pt-1">
        <p className="m-0 text-[11px]">
          <span className="text-gray-500">Resultado: </span>
          <span
            className={cn(
              'font-semibold',
              tone === 'success'
                ? 'text-emerald-700'
                : tone === 'warning'
                  ? 'text-amber-700'
                  : 'text-red-700',
            )}
          >
            {stateLabel(decision.result) ?? decision.result}
          </span>
        </p>

        {decision.result === 'READY' ? (
          <dl className="m-0 mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
            <Fact
              label="Valor elegível"
              value={formatMoney(decision.totalAmount, decision.currencyCode) ?? 'não apurado'}
              mono
            />
            <Fact label="Moeda" value={decision.currencyCode ?? '—'} />
          </dl>
        ) : null}

        {decision.blockingReasons.length > 0 ? (
          <ul className="m-0 mt-1 list-none p-0 text-[10px] text-red-800">
            {decision.blockingReasons.map((reason) => (
              <li key={reason} className="truncate">
                {reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className="m-0 mt-1 text-[10px] leading-snug text-gray-600">{decision.explanation}</p>
    </Block>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRÓXIMA AÇÃO E COMANDOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PRÓXIMA AÇÃO + COMANDOS DISPONÍVEIS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A TELA NÃO HABILITA NADA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `enabled` vem do backend. Quando está `false`, o botão renderiza desabilitado
 * E O MOTIVO É MOSTRADO: `reasonLabels` traz o texto do motivo, na mesma ordem
 * de `blockingReasons`. Um botão cinza sem explicação obriga o operador a abrir
 * outra tela para descobrir por quê — e ele abre chamado.
 *
 * `nextAction` é a recomendação do sistema. A tela a apresenta **e** a destaca
 * no botão correspondente; ela não escolhe outra.
 */
export function NextActionPanel({
  nextAction,
  commands,
  submitting,
  onExecute,
}: {
  nextAction: MeasurementWorkbenchReadModel['nextAction'];
  commands: AvailableCommand[];
  submitting: boolean;
  onExecute: (code: string) => void;
}) {
  const executable = commands.filter((command) =>
    ['AUTHORIZE_ADJUSTMENT', 'APPROVE', 'RECORD_ACCEPTANCE', 'PREPARE_BILLING', 'SUBMIT', 'START_REVIEW', 'RESUBMIT', 'CREATE_MEASUREMENT'].includes(
      command.code,
    ),
  );

  return (
    <Block
      title="Próxima ação"
      tone={nextAction?.code ? 'default' : 'default'}
    >
      {nextAction?.code ? (
        <>
          <p className="m-0 text-[11px] font-semibold text-gray-900">{nextAction.label}</p>
          {nextAction.explanation ? (
            <p className="m-0 mt-0.5 text-[10px] leading-snug text-gray-600">
              {nextAction.explanation}
            </p>
          ) : null}
        </>
      ) : (
        <p className="m-0 text-[11px] text-gray-600">
          Nenhuma ação recomendada neste momento.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {executable.map((command) => {
          const isRecommended = command.code === nextAction?.code;
          return (
            <button
              key={command.code}
              type="button"
              disabled={!command.enabled || submitting}
              onClick={() => onExecute(command.code)}
              title={command.enabled ? undefined : command.reasonLabels.join(' ')}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium',
                command.enabled && isRecommended
                  ? 'bg-brand-700 text-white'
                  : command.enabled
                    ? 'border border-gray-300 bg-white text-gray-800'
                    : 'cursor-not-allowed bg-gray-200 text-gray-500',
              )}
            >
              {command.label}
              {isRecommended ? ' ●' : ''}
            </button>
          );
        })}
      </div>

      {/*
       * MOTIVOS DE BLOQUEIO — sempre visíveis, nunca em tooltip apenas.
       *
       * Um tooltip não é acessível por teclado em todos os navegadores, e o
       * motivo de um comando estar bloqueado é informação de NEGÓCIO, não dica.
       */}
      {executable
        .filter((command) => !command.enabled && command.reasonLabels.length > 0)
        .map((command) => (
          <div key={`${command.code}-reasons`} className="mt-1">
            <p className="m-0 text-[10px] font-medium text-amber-900">
              {command.label} bloqueado:
            </p>
            <ul className="m-0 list-none p-0 text-[10px] text-amber-900">
              {command.reasonLabels.map((reason, index) => (
                <li key={`${command.code}-${index}`} className="truncate">
                  · {reason}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </Block>
  );
}

function findCommand(commands: AvailableCommand[], code: string): AvailableCommand | undefined {
  return commands.find((command) => command.code === code);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SITUAÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

/** SITUAÇÕES — exceção empresarial persistente, nunca toast. */
export function SituationsPanel({ situations }: { situations: WorkbenchSituation[] }) {
  if (situations.length === 0) {
    return null;
  }
  return (
    <Block title="Situações">
      <ul className="m-0 list-none p-0">
        {situations.map((situation) => (
          <li key={situation.code} className="border-b border-[color:var(--color-divider)] py-1 last:border-b-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-semibold text-gray-900">
                {situation.title}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                  situation.severity === 'P1'
                    ? 'bg-red-100 text-red-800'
                    : situation.severity === 'P2'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800',
                )}
              >
                {situation.severity}
              </span>
            </div>
            <p className="m-0 text-[10px] leading-snug text-gray-600">{situation.detail}</p>
            <p className="m-0 text-[10px] text-gray-500">
              Dono: {situation.ownerRole} · Ação: {situation.nextBestAction}
            </p>
          </li>
        ))}
      </ul>
    </Block>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESSO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * BARRA DE PROCESSO — onde a medição está no macroprocesso Service-to-Cash.
 *
 * Um marco `NOT_APPLICABLE` (aceite não exigido) aparece como traço, nunca como
 * "pendente": um marco que nunca vai acontecer não é dívida.
 */
export function MeasurementProcessBar({ workbench }: { workbench: MeasurementWorkbenchReadModel }) {
  const { processContext } = workbench;
  const health = processContext.health;

  return (
    <Block title="Processo Service-to-Cash">
      <ol className="m-0 flex list-none flex-wrap gap-x-2 gap-y-1 p-0 text-[10px]">
        {processContext.milestones.map((milestone) => {
          const tone = milestoneTone(milestone.state);
          return (
            <li key={milestone.stage} className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className={cn(
                  'font-semibold',
                  tone === 'success'
                    ? 'text-emerald-700'
                    : tone === 'info'
                      ? 'text-brand-700'
                      : milestone.state === 'NOT_APPLICABLE'
                        ? 'text-gray-300'
                        : 'text-gray-400',
                )}
              >
                {milestone.state === 'COMPLETED'
                  ? '✓'
                  : milestone.state === 'CURRENT'
                    ? '●'
                    : milestone.state === 'NOT_APPLICABLE'
                      ? '—'
                      : '○'}
              </span>
              <span
                className={cn(
                  milestone.state === 'CURRENT' ? 'font-semibold text-gray-900' : 'text-gray-600',
                )}
              >
                {milestone.label}
                <span className="sr-only"> ({stateLabel(milestone.state)})</span>
              </span>
            </li>
          );
        })}
      </ol>

      <dl className="m-0 mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
        <Fact label="Estágio atual" value={health.currentStageLabel} />
        <Fact label="Dono" value={health.ownerRole} />
        <Fact label="Decorrido" value={formatDuration(health.elapsedSeconds) ?? '—'} />
        <Fact label="Meta" value={formatDuration(health.targetSeconds) ?? 'sem prazo contratual'} />
        <Fact
          label="Risco"
          value={
            <span
              className={cn(
                'font-semibold',
                riskTone(health.risk) === 'critical'
                  ? 'text-red-700'
                  : riskTone(health.risk) === 'warning'
                    ? 'text-amber-700'
                    : riskTone(health.risk) === 'success'
                      ? 'text-emerald-700'
                      : 'text-gray-600',
              )}
            >
              {stateLabel(health.risk) ?? health.risk}
            </span>
          }
        />
        <Fact label="Próximo marco" value={health.nextMilestone ?? '—'} />
      </dl>

      {health.blockingReason ? (
        <p className="m-0 mt-1 text-[10px] font-medium text-amber-900">
          Bloqueio: {health.blockingReason}
        </p>
      ) : null}
      <p className="m-0 mt-0.5 text-[10px] leading-snug text-gray-600">{health.riskReason}</p>
    </Block>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLUXO DE DOCUMENTOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * DOCUMENT FLOW — quais artefatos EXISTEM.
 *
 * Responde uma pergunta diferente do processo: o processo diz em que ESTÁGIO
 * estamos; o fluxo diz QUAIS documentos existem. `ABSENT` é um fato declarado —
 * o artefato não foi criado —, não um erro.
 *
 * O link só aparece quando o artefato existe E o backend publicou `href`: a tela
 * não inventa destino para documento que ela não pode mostrar.
 */
export function DocumentFlowPanel({ steps }: { steps: WorkbenchDocumentFlowStep[] }) {
  return (
    <Block title="Fluxo de documentos">
      <ol className="m-0 list-none p-0 text-[10px]">
        {steps.map((step) => (
          <li key={step.kind} className="flex items-baseline justify-between gap-2 py-0.5">
            <span className="truncate text-gray-600">{step.label}</span>
            {step.state === 'EXISTS' && step.href ? (
              <a href={step.href} className="shrink-0 font-medium text-brand-700 underline">
                {step.reference ? shortId(step.reference) : 'abrir'}
              </a>
            ) : step.state === 'EXISTS' ? (
              <span className="shrink-0 font-medium text-gray-800">
                {step.reference ? shortId(step.reference) : 'existe'}
              </span>
            ) : (
              <span className="shrink-0 text-gray-400">não criado</span>
            )}
          </li>
        ))}
      </ol>
    </Block>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRILHA
// ═══════════════════════════════════════════════════════════════════════════════

/** TIMELINE unificada: quando, o que, quem e o detalhe que o fato carregou. */
export function MeasurementTimelinePanel({ events }: { events: WorkbenchTimelineEvent[] }) {
  if (events.length === 0) {
    return null;
  }
  return (
    <Block title="Trilha da medição">
      <ol className="m-0 list-none p-0">
        {events.map((event, index) => (
          <li
            key={`${event.at}-${event.kind}-${index}`}
            className="border-b border-[color:var(--color-divider)] py-1 last:border-b-0"
          >
            <p className="m-0 text-[11px] font-medium text-gray-900">{event.label}</p>
            <p className="m-0 text-[10px] text-gray-500">
              {formatInstant(event.at) ?? event.at}
              {event.actorIdentityId ? ` · ${shortId(event.actorIdentityId)}` : ''}
            </p>
            {event.detail ? (
              <p className="m-0 text-[10px] leading-snug text-gray-600">{event.detail}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </Block>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AJUSTES
// ═══════════════════════════════════════════════════════════════════════════════

/** AJUSTES — decisões registradas, com motivo, autor e impacto. */
export function AdjustmentsPanel({ workbench }: { workbench: MeasurementWorkbenchReadModel }) {
  if (workbench.adjustments.length === 0) {
    return null;
  }
  return (
    <Block title="Ajustes autorizados">
      <ul className="m-0 list-none p-0">
        {workbench.adjustments.map((adjustment) => (
          <li
            key={adjustment.id}
            className="border-b border-[color:var(--color-divider)] py-1 last:border-b-0"
          >
            <p className="m-0 text-[11px] font-medium text-gray-900">
              +{adjustment.adjustmentQuantity} {adjustment.unitCode}
              {adjustment.financialImpact
                ? ` · ${formatMoney(adjustment.financialImpact, workbench.economics.currency) ?? adjustment.financialImpact}`
                : ''}
            </p>
            <p className="m-0 text-[10px] leading-snug text-gray-600">{adjustment.reason}</p>
            <p className="m-0 text-[10px] text-gray-500">
              {formatInstant(adjustment.decidedAt ?? adjustment.createdAt) ?? adjustment.createdAt}
            </p>
          </li>
        ))}
      </ul>
    </Block>
  );
}

/** Resumo de impacto exibido nos diálogos de comando. */
export function CommandImpactList({ code }: { code: string }) {
  const impact = commandImpact(code);
  if (impact.length === 0) {
    return null;
  }
  return (
    <div>
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Impacto</p>
      <ul className="m-0 mt-0.5 list-none p-0 text-[11px] text-gray-700">
        {impact.map((line) => (
          <li key={line}>→ {line}</li>
        ))}
      </ul>
    </div>
  );
}

/** Diferença de tolerância em texto — usada no painel de variação do diálogo. */
export function toleranceText(percentage: number, source: string): string {
  return `${formatSignedPercent(percentage)?.replace('+', '') ?? String(percentage)} (${source})`;
}
