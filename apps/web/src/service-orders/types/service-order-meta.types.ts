/**
 * Contrato dos endpoints "meta" de service-orders (sessão B4, backend).
 *
 * Tipos escritos À MÃO, seguindo o padrão do projeto: não há OpenAPI/Swagger no backend
 * (verificado em B5/Fase 0 — zero dependências `@nestjs/swagger`/`openapi`), e todos os
 * domínios do front declaram seus tipos em `types/*.types.ts`.
 *
 * Os campos abaixo refletem as respostas REAIS capturadas contra a API em execução
 * (sessão B4, e reconfirmadas em B5/Fase 0 contra o banco de desenvolvimento).
 * Nenhum campo foi inventado, e nenhum foi omitido.
 */

/** Permissão no formato `recurso:acao`, exatamente como o backend entrega. */
export type PermissionLabel = string;

export type MeUser = {
  id: string;
  /**
   * Sempre `null`: `identity.identities` não possui coluna de nome. O backend declara a
   * ausência em vez de inventar (regra de contrato da sessão B4). A UI renderiza vazio.
   */
  nome: string | null;
  /** Sempre `null` pelo mesmo motivo de `nome`. */
  email: string | null;
  identity_id: string;
};

export type ActiveScope = {
  tipo: string;
  resource_id: string | null;
};

export type AvailableScope = ActiveScope & {
  label: string;
};

export type MeResponse = {
  usuario: MeUser;
  permissoes_efetivas: PermissionLabel[];
  /**
   * Sempre `null`: não existe vínculo persistido entre sessão e escopo em
   * `authorization.grants`. Não há como derivar "o escopo ativo" sem inventar.
   */
  escopo_ativo: ActiveScope | null;
  escopos_disponiveis: AvailableScope[];
};

/**
 * Nome canônico de comando, vindo da state machine do backend via `TRANSITIONS`.
 * O front NÃO mantém cópia desta lista: ela é lida do `/command-catalog`.
 */
export type CommandName = string;

export type AvailableAction = {
  comando: CommandName;
  /** Rótulo PT-BR vindo do backend. O front nunca hardcoda este texto. */
  label: string;
  /** Permissão específica exigida por este comando, ex.: `service-orders:service-order:release`. */
  requer_permissao: PermissionLabel;
  usuario_tem_permissao: boolean;
};

export type AvailableActionsResponse = {
  service_order_id: string;
  status_atual: string;
  comandos_validos: AvailableAction[];
  /** Nomes de comando inválidos no status atual. Sem rótulo — ver ressalva de contrato. */
  comandos_invalidos_para_status: CommandName[];
};

export type AuditTimelineEvent = {
  id: string;
  /** ISO-8601. */
  data: string;
  usuario_id: string | null;
  /** Sempre `null`: não há fonte de nome no modelo de identidade. */
  usuario_nome: string | null;
  acao: string;
  status_anterior: string | null;
  status_novo: string | null;
  comando: CommandName | null;
  correlation_id: string;
};

export type AuditTimelineResponse = {
  service_order_id: string;
  eventos: AuditTimelineEvent[];
  /** Total de eventos sem paginação. */
  total: number;
};

export type CommandCatalogEntry = {
  nome: CommandName;
  label: string;
  /** Uma ou mais origens: `cancel` aceita DRAFT/PREPARED/RELEASED. */
  status_origem: string[];
  status_destino: string;
  /**
   * Sempre `false`: a state machine não expõe exigência de justificativa. O único fluxo
   * com justificativa obrigatória é o reopen, que não é comando de `TRANSITIONS`.
   */
  requer_justificativa: boolean;
};

export type CommandCatalogResponse = {
  comandos: CommandCatalogEntry[];
};

/** Limites de paginação da timeline, iguais aos do backend. */
export const AUDIT_TIMELINE_LIMIT_DEFAULT = 100;
export const AUDIT_TIMELINE_LIMIT_MAX = 500;
