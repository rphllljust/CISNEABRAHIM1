import { HttpStatus, Injectable } from '@nestjs/common';
import { PROPOSAL_PRICING_STRUCTURES } from '../domain/proposal';
import { COMMERCIAL_ERROR_CODES } from '../errors/commercial-error-codes';
import { CommercialHttpException } from '../errors/commercial-http.exception';
import { ProposalsRepository } from '../repositories/proposals.repository';
import {
  proposalsAccessDenied,
  proposalsClientNotFound,
  proposalsDocumentNotFound,
  proposalsServiceNotFound,
  proposalsValidationFailed,
} from './proposals-access.errors';

@Injectable()
export class ProposalsReferenceValidationService {
  constructor(private readonly proposalsRepository: ProposalsRepository) {}

  async assertClientActive(clientId: string): Promise<void> {
    const client = await this.proposalsRepository.findClientById(clientId);
    if (!client) {
      throw proposalsClientNotFound();
    }
    if (client.status !== 'ACTIVE') {
      throw new CommercialHttpException(
        HttpStatus.CONFLICT,
        COMMERCIAL_ERROR_CODES.CLIENT_INACTIVE,
        'Client is inactive.',
      );
    }
  }

  /**
   * Contato da proposta e uma ENTIDADE do Cliente (`pty.client_contacts`), nao uma copia textual.
   * Quando informado, o contato precisa existir, pertencer a ESTE Cliente e estar ativo.
   */
  async assertContactBelongsToClient(
    clientId: string,
    contactId: string | undefined,
  ): Promise<void> {
    if (!contactId) {
      return;
    }
    const contact = await this.proposalsRepository.findActiveContactOfClient(clientId, contactId);
    if (!contact) {
      throw new CommercialHttpException(
        HttpStatus.BAD_REQUEST,
        COMMERCIAL_ERROR_CODES.CONTACT_NOT_FOUND,
        'Contact does not belong to the client or is inactive.',
      );
    }
  }

  async assertUnitRegistered(unitId: string): Promise<void> {
    const registered = await this.proposalsRepository.isUnitRegistered(unitId);
    if (!registered) {
      throw new CommercialHttpException(
        HttpStatus.BAD_REQUEST,
        COMMERCIAL_ERROR_CODES.UNIT_NOT_REGISTERED,
        'Unit is not registered.',
      );
    }
  }

  async assertServiceReferences(
    items: Array<{ serviceDefinitionId?: string; serviceDefinitionVersionId?: string }>,
  ): Promise<void> {
    for (const item of items) {
      if (!item.serviceDefinitionId) {
        continue;
      }
      const snapshot = await this.proposalsRepository.findServiceSnapshot(
        item.serviceDefinitionId,
        item.serviceDefinitionVersionId,
      );
      if (!snapshot) {
        throw proposalsServiceNotFound();
      }
    }
  }

  async assertIssueReady(version: {
    id: string;
    pricing_structure: string;
    global_sale_price_amount: string | null;
  }): Promise<void> {
    if (
      version.pricing_structure === PROPOSAL_PRICING_STRUCTURES.GlobalPrice &&
      !version.global_sale_price_amount
    ) {
      throw proposalsValidationFailed();
    }
    if (version.pricing_structure === PROPOSAL_PRICING_STRUCTURES.Itemized) {
      const items = await this.proposalsRepository.listItems(version.id);
      if (items.length === 0 || items.some((item) => !item.line_sale_amount)) {
        throw proposalsValidationFailed();
      }
    }
  }

  async assertDocumentExists(documentId: string): Promise<void> {
    const document = await this.proposalsRepository.findDocumentById(documentId);
    if (!document) {
      throw proposalsDocumentNotFound();
    }
  }

  async assertDocumentUnitMatch(documentId: string, unitId: string): Promise<void> {
    const document = await this.proposalsRepository.findDocumentById(documentId);
    if (!document) {
      throw proposalsDocumentNotFound();
    }
    if (document.unit_id !== unitId) {
      throw proposalsAccessDenied();
    }
  }
}
