export const SERVICE_ACCEPTANCE_ERROR_CODES = {
  NOT_COMPLETED: 'ACCEPTANCE_EXECUTION_NOT_COMPLETED',
  ALREADY_RECORDED: 'ACCEPTANCE_ALREADY_RECORDED',
  UNAUTHORIZED: 'ACCEPTANCE_UNAUTHORIZED',
  OBSERVATION_REQUIRED: 'ACCEPTANCE_OBSERVATION_REQUIRED',
  INVALID_RESULT: 'ACCEPTANCE_INVALID_RESULT',
  /**
   * MEASUREMENT → ACCEPTANCE → BILLING READINESS.
   *
   * Os três códigos abaixo nascem da industrialização do aceite. O domínio puro
   * nunca precisou distingui-los porque não tinha política nem faturamento a
   * bloquear. Agora precisa, e cada um responde a uma pergunta diferente:
   *
   *   POLICY_NOT_APPLICABLE      — a política diz que não há aceite a registrar.
   *                                Registrar um assim mesmo criaria decisão sobre
   *                                entrega que ninguém contratou aceitar.
   *   REJECTION_REASON_REQUIRED  — rejeição sem motivo é inutilizável: a correção
   *                                não sabe o que corrigir. `OBSERVATION_REQUIRED`
   *                                não cobre isto (a observação pode existir e o
   *                                motivo não).
   *   EVIDENCE_REQUIRED          — política com evidência obrigatória recusando
   *                                aceite sem documento anexado. A decisão
   *                                existiria SEM o que a sustenta.
   */
  POLICY_NOT_APPLICABLE: 'ACCEPTANCE_POLICY_NOT_APPLICABLE',
  REJECTION_REASON_REQUIRED: 'ACCEPTANCE_REJECTION_REASON_REQUIRED',
  EVIDENCE_REQUIRED: 'ACCEPTANCE_EVIDENCE_REQUIRED',
} as const;

export type ServiceAcceptanceErrorCode =
  (typeof SERVICE_ACCEPTANCE_ERROR_CODES)[keyof typeof SERVICE_ACCEPTANCE_ERROR_CODES];

export class ServiceAcceptanceError extends Error {
  constructor(readonly code: ServiceAcceptanceErrorCode) {
    super(code);
    this.name = 'ServiceAcceptanceError';
  }
}
