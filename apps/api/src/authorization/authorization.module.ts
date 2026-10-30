import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { SecurityAuditController } from '../audit/controllers/security-audit.controller';
import { AuthzGrantsController, AuthzProbeController } from './controllers/authz.controller';
import { ApprovalMatrixController } from './controllers/approval-matrix.controller';
import { ScopedRecordController } from './controllers/scoped-record.controller';
import { AccessAdminController } from './controllers/access-admin.controller';
import { AuthorizationGuard } from './guards/authorization.guard';
import { AuthorizationRepository } from './repositories/authorization.repository';
import { ApprovalMatrixRepository } from './repositories/approval-matrix.repository';
import { ScopeContextRepository } from './repositories/scope-context.repository';
import { AccessAdminRepository } from './repositories/access-admin.repository';
import { GrantAdminService } from './services/grant-admin.service';
import { ApprovalMatrixAccessService } from './services/approval-matrix-access.service';
import { SodEnforcementService } from './services/sod-enforcement.service';
import { SodExceptionService } from './services/sod-exception.service';
import { PolicyDecisionPointService } from './services/policy-decision-point.service';
import { ScopeEnforcementService } from './services/scope-enforcement.service';
import { ScopeResolverService } from './services/scope-resolver.service';
import { ScopedRecordAccessService } from './services/scoped-record-access.service';
import { AccessAdminService } from './services/access-admin.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [
    AuthzProbeController,
    AuthzGrantsController,
    ApprovalMatrixController,
    ScopedRecordController,
    AccessAdminController,
    SecurityAuditController,
  ],
  providers: [
    AuthorizationRepository,
    ApprovalMatrixRepository,
    ScopeContextRepository,
    AccessAdminRepository,
    PolicyDecisionPointService,
    ScopeResolverService,
    ScopeEnforcementService,
    GrantAdminService,
    ApprovalMatrixAccessService,
    SodEnforcementService,
    SodExceptionService,
    ScopedRecordAccessService,
    AccessAdminService,
    AuthorizationGuard,
  ],
  exports: [
    PolicyDecisionPointService,
    AuthorizationGuard,
    AuthorizationRepository,
    ApprovalMatrixAccessService,
    SodEnforcementService,
    ScopeContextRepository,
    ScopeEnforcementService,
    ScopeResolverService,
  ],
})
export class AuthorizationModule {}
