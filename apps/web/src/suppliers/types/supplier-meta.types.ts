/**
 * Metadados de fornecedor — contratos dos endpoints "meta" (Fase B).
 *
 * Espelha `service-order-meta.types.ts` (B5) por decisão deliberada: o frontend deve poder
 * consumir Fornecedores com o MESMO formato que já consome Ordens de Serviço. Cada campo
 * abaixo tem um equivalente exato no domínio de OS, e é essa simetria que permite que
 * `ServiceOrderRowActions` e `ServiceOrderDetailPage` sejam generalizados depois.
 *
 * Diferença real de domínio: OS usa uma state machine (`TRANSITIONS`) com 7 comandos e
 * múltiplas origens por comando; Fornecedor usa um mapa próprio de status com 3 comandos.
 * Isso é específico, não duplicação.
 */

export type SupplierAvailableAction = {
  comando: string;
  label: string;
  requer_permissao: string;
  usuario_tem_permissao: boolean;
};

export type SupplierAvailableActionsResponse = {
  supplier_id: string;
  status_atual: string;
  comandos_validos: SupplierAvailableAction[];
  comandos_invalidos_para_status: string[];
};

/*
 * REMOVIDO em B6.1: `SupplierCommandCatalogEntry` e `SupplierCommandCatalogResponse`.
 *
 * Não havia consumidor. O rótulo de cada comando já chega em `available-actions`
 * (`SupplierAvailableAction.label`), que é o que as telas renderizam — manter os dois tipos
 * era dead code que sugeria uma segunda fonte de rótulos que não existe.
 */

export type SupplierAuditTimelineEvent = {
  id: string;
  data: string;
  usuario_id: string | null;
  usuario_nome: string | null;
  acao: string;
  status_anterior: string | null;
  status_novo: string | null;
  comando: string | null;
  correlation_id: string;
};

export type SupplierAuditTimelineResponse = {
  supplier_id: string;
  eventos: SupplierAuditTimelineEvent[];
  total: number;
};

export const SUPPLIER_AUDIT_TIMELINE_LIMIT_DEFAULT = 100;
export const SUPPLIER_AUDIT_TIMELINE_LIMIT_MAX = 500;
