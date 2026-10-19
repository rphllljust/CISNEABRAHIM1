-- PROPOSAL CONTACT — referência ao contato do cliente, aditiva e mínima.
--
-- ESCOPO DESTA MIGRATION
--
-- O documento comercial nomeia com quem se fala: "A/C: Sr. Josivan" na proposta da Equador. O
-- CISNE já modela esse fato como ENTIDADE (`pty.client_contacts`, com `purpose` operacional/
-- comercial/faturamento e `role`).
--
-- O que faltava era o VÍNCULO: a proposta não apontava para contato nenhum, então o nome só caberia
-- como texto copiado. Uma cópia textual cria uma segunda fonte para o mesmo fato — envelhece quando
-- o contato muda de nome, e-mail ou papel, e a proposta passa a afirmar algo que o cadastro já não
-- sustenta.
--
-- `com.proposals.contact_id` referencia o cadastro real. ANULÁVEL porque nem toda proposta nomeia
-- contato, e exigir um obrigaria a inventar vínculo. `ON DELETE SET NULL` porque remover o contato
-- do cadastro não deve impedir a proposta de existir: ela perde a referência, não a história.
--
-- NADA É REMOVIDO OU RENOMEADO. Propostas existentes ficam com `contact_id` nulo.

ALTER TABLE "com"."proposals"
  ADD COLUMN IF NOT EXISTS "contact_id" uuid
  REFERENCES "pty"."client_contacts"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposals_contact_id_idx"
  ON "com"."proposals" USING btree ("contact_id");
--> statement-breakpoint
