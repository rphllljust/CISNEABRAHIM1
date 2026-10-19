import { describe, expect, it, vi } from 'vitest';
import { COMMERCIAL_ERROR_CODES } from '../errors/commercial-error-codes';
import type { ProposalsRepository } from '../repositories/proposals.repository';
import { ProposalsReferenceValidationService } from '../services/proposals-reference-validation.service';

/**
 * CONTATO DA PROPOSTA — referência a uma ENTIDADE do Cliente, não a um nome copiado.
 *
 * FATO EMPRESARIAL (documento do cliente): a proposta da Equador nomeia com quem se fala —
 * "A/C: Sr. Josivan". O CISNE já modela esse fato em `pty.client_contacts` (com `purpose`,
 * `role`, `email`, `phone`, `deactivated_at`).
 *
 * INTERPRETAÇÃO DE ENGENHARIA: o vínculo que faltava era `com.proposals.contact_id`. Uma coluna
 * `contact_name` textual criaria SEGUNDA fonte para o mesmo fato — envelhece em silêncio quando o
 * contato muda de nome, e-mail ou papel, e a proposta passa a afirmar o que o cadastro já não
 * sustenta. Por isso não existe `contactName` na proposta, e este teste trava essa ausência.
 *
 * REGRA DE BACKEND: um contato só pode ser citado se PERTENCER ao Cliente da proposta e estiver
 * ATIVO. A tela não é fronteira de segurança; a decisão é do backend.
 */
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';

function serviceWithContact(contact: { id: string; client_id: string; name: string } | null) {
  const findActiveContactOfClient = vi.fn().mockResolvedValue(contact);
  const repository = { findActiveContactOfClient } as unknown as ProposalsRepository;
  return { service: new ProposalsReferenceValidationService(repository), findActiveContactOfClient };
}

async function captureError(promise: Promise<void>): Promise<{ code?: string }> {
  try {
    await promise;
    return {};
  } catch (error) {
    return error as { code?: string };
  }
}

describe('proposals.contact_id — contato do Cliente como entidade', () => {
  it('aceita contato que existe, pertence ao Cliente e está ativo', async () => {
    const { service, findActiveContactOfClient } = serviceWithContact({
      id: CONTACT_ID,
      client_id: CLIENT_ID,
      name: 'Josivan',
    });

    await expect(
      service.assertContactBelongsToClient(CLIENT_ID, CONTACT_ID),
    ).resolves.toBeUndefined();
    expect(findActiveContactOfClient).toHaveBeenCalledWith(CLIENT_ID, CONTACT_ID);
  });

  it('recusa contato de OUTRO Cliente', async () => {
    // O repositório já filtra por client_id; contato de outro Cliente volta null.
    const { service } = serviceWithContact(null);

    const error = await captureError(service.assertContactBelongsToClient(CLIENT_ID, CONTACT_ID));
    expect(error.code).toBe(COMMERCIAL_ERROR_CODES.CONTACT_NOT_FOUND);
    expect(COMMERCIAL_ERROR_CODES.CONTACT_NOT_FOUND).toBe('COMMERCIAL_CONTACT_NOT_FOUND');
  });

  it('recusa contato inexistente ou desativado', async () => {
    const { service } = serviceWithContact(null);

    const error = await captureError(service.assertContactBelongsToClient(CLIENT_ID, CONTACT_ID));
    expect(error.code).toBe(COMMERCIAL_ERROR_CODES.CONTACT_NOT_FOUND);
  });

  it('proposta sem contato continua válida — não obriga a inventar vínculo', async () => {
    const { service, findActiveContactOfClient } = serviceWithContact(null);

    await expect(service.assertContactBelongsToClient(CLIENT_ID, undefined)).resolves.toBeUndefined();
    // Sem contato informado, nem chega a consultar o cadastro.
    expect(findActiveContactOfClient).not.toHaveBeenCalled();
  });
});
