-- DEADLINE SEMANTIC KERNEL (Prompt: Deadline Semantic Kernel)
-- Fonte única da semantica de prazo/vencimento de OS por janela operacional:
-- deadline(so) = MIN(operational_end) sobre janelas abertas:
--   so.planned_resources PR com status 'PLANNED'
--   res.resource_allocations RA com status 'ACTIVE'
-- Janelas REMOVED/REALLOCATED nao contribuem prazo (interpretacao de engenharia;
-- nenhuma regra empresarial nova).
-- Comparacoes canonicas (nao embutidas aqui):
--   overdue      = deadline <= NOW() E status nao-terminal (quem consulta filtra terminal)
--   approaching  = deadline >  NOW() E deadline <= NOW() + AGING_APPROACHING_DUE_DAYS
-- Consumidores: analytics, dashboard, reports, alerts, observability, service-orders list.

CREATE FUNCTION so.deadline_for(p_service_order_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $deadline_kernel$
  SELECT MIN(deadline)
  FROM (
    SELECT pr.operational_end AS deadline
    FROM so.planned_resources pr
    WHERE pr.service_order_id = p_service_order_id
      AND pr.status = 'PLANNED'
      AND pr.operational_end IS NOT NULL
    UNION ALL
    SELECT ra.operational_end AS deadline
    FROM res.resource_allocations ra
    WHERE ra.service_order_id = p_service_order_id
      AND ra.status = 'ACTIVE'
      AND ra.operational_end IS NOT NULL
  ) windows
  WHERE deadline IS NOT NULL
$deadline_kernel$;

COMMENT ON FUNCTION so.deadline_for(uuid) IS
'DEADLINE-SEM-001: deadline unica de uma OS = menor fim de janela aberta (PLANNED/ACTIVE). Nao decide vencimento: chamadores filtram status nao-terminal e comparam deadline <= NOW().';
