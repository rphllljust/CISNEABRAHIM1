-- Corrige o indicador de atraso da Worklist de ordens de serviço.
--
-- `deadline_at` é o prazo operacional autoritativo publicado pela listagem. Usar `updated_at`
-- convertia qualquer OS antiga, inclusive sem prazo, em "dias em atraso". Sem prazo, a UI deve
-- permanecer UNKNOWN (—), e com prazo o cálculo é `today - deadline_at`.
UPDATE "meta"."computed_fields" AS computed
SET formula = '{"op":"diff_days","args":["today","deadline_at"]}'::jsonb
FROM "meta"."entities" AS entity
WHERE computed.entity_id = entity.id
  AND entity.name = 'service-orders'
  AND computed.name = 'aging_days';--> statement-breakpoint
