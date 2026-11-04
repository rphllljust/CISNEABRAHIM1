import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { hasPolicyAndGrantScope } from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { DocumentAssetLinksService } from '../../documents/services/document-asset-links.service';
import { ASSET_ERROR_CODES } from '../errors/asset-error-codes';
import { AssetHttpException } from '../errors/asset-http.exception';
import { PhysicalAssetsAccessService } from './physical-assets-access.service';

/** Resources owns asset authorization; GED owns document authorization and persistence. */
@Injectable()
export class PhysicalAssetDocumentsService {
  constructor(
    private readonly assets: PhysicalAssetsAccessService,
    private readonly links: DocumentAssetLinksService,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
  ) {}

  async list(actor: IdentityAuthzContext, assetId: string) {
    const asset = await this.assets.getById(actor, assetId);
    return this.links.listAuthorized(actor, asset.id, asset.unitId);
  }

  async attach(actor: IdentityAuthzContext, assetId: string, documentId: string) {
    // Read first: untrusted actor cannot discover hidden asset existence or unit.
    const asset = await this.assets.getById(actor, assetId);
    const permitted = await hasPolicyAndGrantScope(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action: AUTHZ_ACTIONS.ResourcesAssetUpdate,
        resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset,
        context: { resourceId: asset.id, unitId: asset.unitId },
      },
    );
    if (!permitted) {
      throw new AssetHttpException(HttpStatus.FORBIDDEN, ASSET_ERROR_CODES.DENIED, 'Access denied.');
    }
    return this.links.attachAuthorized(actor, asset.id, asset.unitId, documentId);
  }
}
