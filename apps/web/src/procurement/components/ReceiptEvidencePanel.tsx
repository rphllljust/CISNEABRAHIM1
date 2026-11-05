import type { ReceiptProvenanceEvidence } from '../../inventory/api/inventory-api';

export type EvidenceState =
  | { phase: 'none' | 'loading' | 'denied' | 'error' }
  | { phase: 'ready'; data: ReceiptProvenanceEvidence };

export function ReceiptEvidencePanel({ evidence }: { evidence: EvidenceState }) {
  if (evidence.phase !== 'ready') {
    const text = evidence.phase === 'denied' ? 'Leitura não autorizada.'
      : evidence.phase === 'error' ? 'Falha na reconciliação do recebimento.'
      : evidence.phase === 'loading' ? 'Consultando certificações…'
      : 'Selecione uma linha.';
    return <p role="status">{text}</p>;
  }
  return <section aria-label="Certificações persistidas">
    <p>Recebido: {evidence.data.receivedQuantity} · Certificado: {evidence.data.allocatedQuantity}</p>
    <ul>{evidence.data.items.map(item => (
      <li key={item.id}>{item.sku} · {item.warehouseCode} · {item.allocatedQuantity}</li>
    ))}</ul>
  </section>;
}
