import { describe, expect, it } from 'vitest';
import { SERVICE_ORDER_STATUSES } from '../types/service-order.types';
import { resolvePrimaryAction } from './execution-primary-action';

/**
 * AÇÃO PRIMÁRIA DA EXECUÇÃO — a decisão de concluir é do BACKEND.
 *
 * A versão anterior deste teste chamava `resolvePrimaryAction({ requirementsComplete: true })`
 * e esperava `complete`. Esse contrato foi REMOVIDO: `requirementsComplete` era uma
 * segunda implementação da regra de conclusão, calculada na tela a partir das
 * evidências, e ignorava medidor final, combustível, horas, material, assinatura e
 * situações abertas.
 *
 * O contrato agora é `backendAllowsComplete`, que é `completionGate.canComplete`
 * vindo do servidor.
 */
describe('execution-primary-action', () => {
  it('ordem liberada inicia', () => {
    const action = resolvePrimaryAction({
      status: SERVICE_ORDER_STATUSES.Released,
      backendAllowsComplete: false,
      canMutate: true,
    });
    expect(action.kind).toBe('start');
    expect(action.label).toMatch(/começar/i);
  });

  it('em execução com o backend BLOQUEANDO, registra atividade', () => {
    const action = resolvePrimaryAction({
      status: SERVICE_ORDER_STATUSES.InExecution,
      backendAllowsComplete: false,
      completionBlockedReason: 'Falta o combustível real.',
      canMutate: true,
    });
    expect(action.kind).toBe('record');
    // O motivo exibido é o do BACKEND, não uma frase genérica da tela.
    expect(action.disabledReason).toBe('Falta o combustível real.');
  });

  it('em execução com o backend LIBERANDO, conclui', () => {
    const action = resolvePrimaryAction({
      status: SERVICE_ORDER_STATUSES.InExecution,
      backendAllowsComplete: true,
      canMutate: true,
    });
    expect(action.kind).toBe('complete');
  });

  it('ordem pausada retoma (concluir pausada esconderia tempo não medido)', () => {
    const action = resolvePrimaryAction({
      status: SERVICE_ORDER_STATUSES.Paused,
      backendAllowsComplete: true,
      canMutate: true,
    });
    expect(action.kind).toBe('resume');
  });

  it('sem permissão de mutação a ação é somente leitura', () => {
    const action = resolvePrimaryAction({
      status: SERVICE_ORDER_STATUSES.InExecution,
      backendAllowsComplete: true,
      canMutate: false,
    });
    expect(action.kind).toBe('none');
    expect(action.disabledReason).toBeTruthy();
  });

  it('a decisão NÃO depende de estado de requisito calculado na tela', () => {
    /**
     * Prova de contrato: o único caminho para `complete` é `backendAllowsComplete`.
     * Não existe parâmetro que possa ser inferido localmente para habilitá-lo.
     */
    const inExecution = {
      status: SERVICE_ORDER_STATUSES.InExecution,
      canMutate: true,
    } as const;

    expect(
      resolvePrimaryAction({ ...inExecution, backendAllowsComplete: false }).kind,
    ).toBe('record');
    expect(
      resolvePrimaryAction({ ...inExecution, backendAllowsComplete: true }).kind,
    ).toBe('complete');
  });
});
