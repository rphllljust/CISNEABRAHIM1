export const CLIENT_ERROR_CODES = {
  VALIDATION_FAILED: 'CLIENT_VALIDATION_FAILED',
  NOT_FOUND: 'CLIENT_NOT_FOUND',
  TAX_ID_CONFLICT: 'CLIENT_TAX_ID_CONFLICT',
  VERSION_CONFLICT: 'CLIENT_VERSION_CONFLICT',
  INVALID_STATE: 'CLIENT_INVALID_STATE',
  INACTIVE: 'CLIENT_INACTIVE',
  DENIED: 'CLIENT_DENIED',
  /** Contato, unidade ou vínculo de hierarquia inexistente para o Cliente informado. */
  CHILD_NOT_FOUND: 'CLIENT_CHILD_NOT_FOUND',
  /**
   * O vínculo de hierarquia criaria um CICLO (A -> B -> A).
   *
   * Código próprio, e não `VALIDATION_FAILED`, porque a causa é ESTRUTURAL: a mensagem precisa
   * dizer exatamente o que impede o vínculo. "Cadastro inválido" mandaria o operador procurar o
   * defeito no lugar errado.
   */
  HIERARCHY_CYCLE: 'CLIENT_HIERARCHY_CYCLE',
} as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES];
