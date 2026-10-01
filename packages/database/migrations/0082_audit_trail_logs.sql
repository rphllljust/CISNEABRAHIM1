CREATE TYPE "audit"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'TRANSITION');--> statement-breakpoint
CREATE TABLE "audit"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tabela" varchar(100) NOT NULL,
	"registro_id" uuid NOT NULL,
	"acao" "audit"."audit_action" NOT NULL,
	"dados_antigos" jsonb,
	"dados_novos" jsonb,
	"usuario_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_tabela_not_empty_chk" CHECK (length(trim("audit"."audit_logs"."tabela")) > 0)
);
--> statement-breakpoint
CREATE INDEX "audit_logs_tabela_registro_id_idx" ON "audit"."audit_logs" USING btree ("tabela","registro_id");--> statement-breakpoint
CREATE INDEX "audit_logs_usuario_id_idx" ON "audit"."audit_logs" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit"."audit_logs" USING btree ("created_at" DESC NULLS LAST);
