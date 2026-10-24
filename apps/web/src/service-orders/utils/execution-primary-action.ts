import { SERVICE_ORDER_STATUSES } from '../types/service-order.types';

/**
 * AÇÃO PRIMÁRIA DA EXECUÇÃO.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * A DECISÃO DE CONCLUIR NÃO VIVE AQUI
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A versão anterior recebia `requirementsComplete` — um booleano CALCULADO na tela
 * a partir das evidências — e habilitava "Concluir OS" com ele:
 *
 *     if (status === IN_EXECUTION && requirementsComplete) → complete
 *
 * Esse é exatamente o padrão proibido: uma segunda implementação da regra de
 * conclusão, em outra linguagem, que não conhece medidor final, combustível, horas
 * por pessoa, material, assinatura nem situação aberta. O operador via "Concluir"
 * habilitado e o backend recusava.
 *
 * AGORA a pergunta chega RESOLVIDA: `backendAllowsComplete` é
 * `completionGate.canComplete`, e `completionBlockedReason` é o primeiro motivo
 * declarado pelo domínio. A tela apenas apresenta.
 *
 * `status` continua governando QUAL comando de estado é possível (iniciar, retomar,
 * pausar) — isso é navegação, não regra de conclusão.
 */
export type PrimaryActionKind = 'start' | 'resume' | 'record' | 'complete' | 'none';

export type PrimaryAction = {
  kind: PrimaryActionKind;
  label: string;
  ariaLabel: string;
  disabledReason?: string;
};

export function resolvePrimaryAction(input: {
  status: string;
  /**
   * `completionGate.canComplete` do BACKEND. Não recalcular: este valor é a
   * resposta do domínio, e é o mesmo que o comando aplica.
   */
  backendAllowsComplete: boolean;
  /** Primeiro motivo de bloqueio declarado pelo backend, quando houver. */
  completionBlockedReason?: string | null;
  canMutate: boolean;
}): PrimaryAction {
  const { status, backendAllowsComplete, completionBlockedReason, canMutate } = input;

  if (!canMutate) {
    return {
      kind: 'none',
      label: 'Somente leitura',
      ariaLabel: 'Execução em modo somente leitura',
      disabledReason: 'Sem permissão para alterar esta ordem de serviço.',
    };
  }

  if (status === SERVICE_ORDER_STATUSES.Released) {
    return {
      kind: 'start',
      label: 'Confirmar e começar',
      ariaLabel: 'Confirmar e começar execução da ordem de serviço',
    };
  }

  if (status === SERVICE_ORDER_STATUSES.Paused) {
    return {
      kind: 'resume',
      label: 'Retomar execução',
      ariaLabel: 'Retomar execução da ordem de serviço',
    };
  }

  if (status === SERVICE_ORDER_STATUSES.InExecution) {
    if (backendAllowsComplete) {
      return {
        kind: 'complete',
        label: 'Concluir OS',
        ariaLabel: 'Concluir ordem de serviço',
      };
    }
    return {
      kind: 'record',
      label: 'Registrar atividade',
      ariaLabel: 'Registrar atividade de execução',
      // O motivo é do BACKEND. Quando ele não disse, a tela admite que não sabe.
      disabledReason: completionBlockedReason ?? undefined,
    };
  }

  if (status === SERVICE_ORDER_STATUSES.Completed) {
    return {
      kind: 'none',
      label: 'OS concluída',
      ariaLabel: 'Ordem de serviço já concluída',
      disabledReason: 'Esta ordem de serviço já foi concluída.',
    };
  }

  return {
    kind: 'none',
    label: 'Indisponível',
    ariaLabel: 'Ação indisponível no estado atual',
    disabledReason: 'A ordem de serviço não está pronta para execução.',
  };
}
