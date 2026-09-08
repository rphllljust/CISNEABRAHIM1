import { createHash } from 'node:crypto';

/**
 * ANALYTICS SNAPSHOT SEMANTICS (CISNE) — AN-SEM-001
 *
 * "Snapshot" em query-time NÃO é materialização (nada de MV sem necessidade).
 * É uma resposta consistente dentro de UMA janela lógica de leitura, sempre com:
 *   snapshotId     - id determinístico da janela (correlação/detecta mudanca);
 *   generatedAt    - instante em que a resposta foi montada;
 *   dataAsOf       - instante logico unico usado como janela de leitura;
 *   partial        - false (completa) ou true + reasons (mascarada/indisponivel);
 *   consistency    - SINGLE_WINDOW quando todas as fontes usaram o mesmo dataAsOf.
 */

export type SnapshotConsistency = 'SINGLE_WINDOW' | 'MIXED';

export type SnapshotEnvelope = {
  snapshotId: string;
  generatedAt: string;
  dataAsOf: string;
  partial: boolean;
  partialReasons?: string[];
  consistency: SnapshotConsistency;
};

export function buildSnapshotEnvelope(input: {
  windowKey: string;
  dataAsOf: string;
  generatedAt?: string;
  partial?: boolean;
  partialReasons?: string[];
  consistency?: SnapshotConsistency;
}): SnapshotEnvelope {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const snapshotId = createHash('sha256')
    .update(`${input.windowKey}|${input.dataAsOf}`)
    .digest('hex')
    .slice(0, 24);
  return {
    snapshotId,
    generatedAt,
    dataAsOf: input.dataAsOf,
    partial: input.partial ?? false,
    partialReasons: input.partial ? (input.partialReasons ?? []) : undefined,
    consistency: input.consistency ?? 'SINGLE_WINDOW',
  };
}

/** Mesma janela + dataAsOf => mesmo snapshotId; mudanca na janela/data => novo id. */
export function snapshotIdsDiffer(a: SnapshotEnvelope, b: SnapshotEnvelope): boolean {
  return a.snapshotId !== b.snapshotId;
}
