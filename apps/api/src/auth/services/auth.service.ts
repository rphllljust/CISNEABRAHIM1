import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { verifyPasswordHash } from '@cisne/database';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { generateOpaqueToken, hashOpaqueToken } from '../crypto/token-crypto';
import { AUTH_CONFIG } from '../auth.constants';
import type { AuthConfig } from '../config/auth.config';
import { AUTH_ERROR_CODES } from '../errors/auth-error-codes';
import { AuthHttpException } from '../errors/auth-http.exception';
import type { LoginInput } from '../dto/login.dto';
import type { RefreshInput } from '../dto/refresh.dto';
import type { AuthRequestContext } from '../types/auth-request-context';
import type { RefreshTokenLockedRow } from '../repositories/identity-auth.repository';
import { IdentityAuthRepository } from '../repositories/identity-auth.repository';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { EndpointRateLimitService } from '../../security/services/endpoint-rate-limit.service';
import { SessionValidationService } from './session-validation.service';
import { TokenService } from './token.service';
import {
  toAuthTokenResponse,
  toCurrentSessionResponse,
  type AuthTokenResponseV1,
  type CurrentSessionResponseV1,
} from '../serializers/auth-response.serializer';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly databaseService: DatabaseService,
    private readonly repository: IdentityAuthRepository,
    private readonly tokenService: TokenService,
    private readonly loginRateLimiter: LoginRateLimiterService,
    private readonly endpointRateLimit: EndpointRateLimitService,
    private readonly sessionValidation: SessionValidationService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async login(input: LoginInput, context: AuthRequestContext): Promise<AuthTokenResponseV1> {
    try {
      await this.loginRateLimiter.assertAllowed(context.clientKey);
    } catch {
      await this.securityAudit.record({
        action: SECURITY_AUDIT_ACTIONS.AuthLoginFailure,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Identity,
        outcome: SECURITY_AUDIT_OUTCOMES.Failure,
        reasonCode: AUTH_ERROR_CODES.RATE_LIMITED,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        correlationId: context.correlationId,
        metadata: { client_ip: context.clientIp },
      });
      throw new AuthHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        AUTH_ERROR_CODES.RATE_LIMITED,
        'Too many login attempts. Try again later.',
      );
    }

    const credential = await this.repository.findCredentialByLogin(input.login);
    if (!credential) {
      await this.securityAudit.record({
        action: SECURITY_AUDIT_ACTIONS.AuthLoginFailure,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Identity,
        outcome: SECURITY_AUDIT_OUTCOMES.Failure,
        reasonCode: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        correlationId: context.correlationId,
        metadata: { client_ip: context.clientIp },
      });
      throw new AuthHttpException(
        HttpStatus.UNAUTHORIZED,
        AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        'Invalid credentials.',
      );
    }

    if (credential.identity_status !== 'active') {
      await this.securityAudit.record({
        actorIdentityId: credential.identity_id,
        action: SECURITY_AUDIT_ACTIONS.AuthLoginFailure,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Identity,
        resourceId: credential.identity_id,
        outcome: SECURITY_AUDIT_OUTCOMES.Denied,
        reasonCode: AUTH_ERROR_CODES.ACCOUNT_DISABLED,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        correlationId: context.correlationId,
        metadata: { client_ip: context.clientIp },
      });
      throw new AuthHttpException(
        HttpStatus.UNAUTHORIZED,
        AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        'Invalid credentials.',
      );
    }

    const passwordValid = await verifyPasswordHash(input.password, credential.password_hash);
    if (!passwordValid) {
      await this.securityAudit.record({
        actorIdentityId: credential.identity_id,
        action: SECURITY_AUDIT_ACTIONS.AuthLoginFailure,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Identity,
        resourceId: credential.identity_id,
        outcome: SECURITY_AUDIT_OUTCOMES.Failure,
        reasonCode: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        correlationId: context.correlationId,
        metadata: { client_ip: context.clientIp },
      });
      throw new AuthHttpException(
        HttpStatus.UNAUTHORIZED,
        AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        'Invalid credentials.',
      );
    }

    const tokens = await this.issueSessionTokens(credential.identity_id);
    await this.securityAudit.record({
      actorIdentityId: credential.identity_id,
      actorSessionId: tokens.session.id,
      action: SECURITY_AUDIT_ACTIONS.AuthLogin,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Session,
      resourceId: tokens.session.id,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
      correlationId: context.correlationId,
      metadata: { client_ip: context.clientIp },
    });
    return tokens;
  }

  async refresh(
    input: RefreshInput,
    context: Pick<AuthRequestContext, 'correlationId' | 'clientIp'> & { clientKey?: string } = {},
  ): Promise<AuthTokenResponseV1> {
    if (context.clientKey) {
      try {
        await this.endpointRateLimit.assertAllowed('refresh', context.clientKey);
      } catch {
        throw new AuthHttpException(
          HttpStatus.TOO_MANY_REQUESTS,
          AUTH_ERROR_CODES.RATE_LIMITED,
          'Too many refresh attempts. Try again later.',
        );
      }
    }

    const tokenHash = hashOpaqueToken(input.refreshToken);
    const pool = this.getPool();
    const client = await pool.connect();
    let committed = false;

    try {
      await client.query('BEGIN');
      const stored = await this.repository.findRefreshTokenByHashForUpdate(client, tokenHash);

      if (!stored) {
        throw new AuthHttpException(
          HttpStatus.UNAUTHORIZED,
          AUTH_ERROR_CODES.UNAUTHORIZED,
          'Invalid refresh token.',
        );
      }

      if (stored.revoked_at && stored.replaced_by_token_id) {
        await this.repository.revokeFamily(client, stored.family_id);
        await this.repository.revokeSession(client, stored.session_id);
        await client.query('COMMIT');
        committed = true;
        await this.securityAudit.record({
          actorIdentityId: stored.identity_id,
          actorSessionId: stored.session_id,
          action: SECURITY_AUDIT_ACTIONS.AuthRefreshReuse,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Session,
          resourceId: stored.session_id,
          outcome: SECURITY_AUDIT_OUTCOMES.Denied,
          reasonCode: AUTH_ERROR_CODES.REFRESH_REUSED,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
          correlationId: context.correlationId,
          metadata: { client_ip: context.clientIp },
        });
        throw new AuthHttpException(
          HttpStatus.UNAUTHORIZED,
          AUTH_ERROR_CODES.REFRESH_REUSED,
          'Refresh token reuse detected.',
        );
      }

      this.assertRefreshTokenUsable(stored);

      const session = await this.repository.getSessionByIdForUpdate(client, stored.session_id);
      if (!session || session.status !== 'active') {
        throw new AuthHttpException(
          HttpStatus.UNAUTHORIZED,
          AUTH_ERROR_CODES.SESSION_REVOKED,
          'Session has been revoked.',
        );
      }

      if (new Date(session.expires_at).getTime() <= Date.now()) {
        throw new AuthHttpException(
          HttpStatus.UNAUTHORIZED,
          AUTH_ERROR_CODES.SESSION_EXPIRED,
          'Session expired.',
        );
      }

      const newRefreshPlain = generateOpaqueToken();
      const newRefreshHash = hashOpaqueToken(newRefreshPlain);
      const refreshExpiresAt = new Date(
        Date.now() + this.config.refreshTokenTtlSeconds * 1000,
      ).toISOString();

      const newTokenId = await this.repository.insertRefreshToken(
        client,
        stored.family_id,
        newRefreshHash,
        refreshExpiresAt,
      );

      const rotated = await this.repository.markRefreshTokenRotated(client, stored.id, newTokenId);
      if (!rotated) {
        throw new AuthHttpException(
          HttpStatus.UNAUTHORIZED,
          AUTH_ERROR_CODES.SESSION_REVOKED,
          'Session has been revoked.',
        );
      }

      await client.query('COMMIT');
      committed = true;

      const access = this.tokenService.issueAccessToken(stored.identity_id, stored.session_id);

      return toAuthTokenResponse({
        accessToken: access.token,
        refreshToken: newRefreshPlain,
        expiresIn: access.expiresIn,
        sessionId: stored.session_id,
        sessionExpiresAt: session.expires_at,
      });
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(
    sessionId: string,
    identityId: string,
    context: Pick<AuthRequestContext, 'correlationId'> = {},
  ): Promise<{ success: true }> {
    const pool = this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const session = await this.repository.getSessionByIdForUpdate(client, sessionId);
      if (session && session.status === 'active') {
        await this.repository.revokeSession(client, sessionId);
        const familyResult = await client.query<{ id: string }>(
          `SELECT id FROM identity.refresh_token_families WHERE session_id = $1`,
          [sessionId],
        );
        const familyId = familyResult.rows[0]?.id;
        if (familyId) {
          await this.repository.revokeFamily(client, familyId);
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await this.securityAudit.record({
      actorIdentityId: identityId,
      actorSessionId: sessionId,
      action: SECURITY_AUDIT_ACTIONS.AuthLogout,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Session,
      resourceId: sessionId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      correlationId: context.correlationId,
    });

    return { success: true };
  }

  async logoutAll(
    identityId: string,
    sessionId: string,
    context: Pick<AuthRequestContext, 'correlationId'> = {},
  ): Promise<{ success: true }> {
    await this.repository.revokeAllSessionsForIdentity(identityId);
    await this.securityAudit.record({
      actorIdentityId: identityId,
      actorSessionId: sessionId,
      action: SECURITY_AUDIT_ACTIONS.AuthLogoutAll,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Identity,
      resourceId: identityId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
      correlationId: context.correlationId,
    });
    return { success: true };
  }

  async currentSession(identityId: string, sessionId: string): Promise<CurrentSessionResponseV1> {
    await this.sessionValidation.assertActiveSession(identityId, sessionId);
    const session = await this.repository.getSessionById(sessionId);
    if (!session) {
      throw new AuthHttpException(
        HttpStatus.UNAUTHORIZED,
        AUTH_ERROR_CODES.UNAUTHORIZED,
        'Session is not valid.',
      );
    }

    return toCurrentSessionResponse({
      identityId,
      sessionId: session.id,
      sessionExpiresAt: session.expires_at,
    });
  }

  private assertRefreshTokenUsable(stored: RefreshTokenLockedRow): void {
    if (stored.revoked_at) {
      throw new AuthHttpException(
        HttpStatus.UNAUTHORIZED,
        AUTH_ERROR_CODES.SESSION_REVOKED,
        'Session has been revoked.',
      );
    }

    if (stored.family_revoked_at) {
      throw new AuthHttpException(
        HttpStatus.UNAUTHORIZED,
        AUTH_ERROR_CODES.SESSION_REVOKED,
        'Session has been revoked.',
      );
    }

    if (stored.identity_status !== 'active') {
      throw new AuthHttpException(
        HttpStatus.FORBIDDEN,
        AUTH_ERROR_CODES.ACCOUNT_DISABLED,
        'Account is not active.',
      );
    }

    if (new Date(stored.expires_at).getTime() <= Date.now()) {
      throw new AuthHttpException(
        HttpStatus.UNAUTHORIZED,
        AUTH_ERROR_CODES.SESSION_EXPIRED,
        'Refresh token expired.',
      );
    }
  }

  private async issueSessionTokens(identityId: string): Promise<AuthTokenResponseV1> {
    const pool = this.getPool();
    const client = await pool.connect();

    const sessionExpiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlSeconds * 1000,
    ).toISOString();

    try {
      await client.query('BEGIN');
      const sessionId = await this.repository.createSession(client, identityId, sessionExpiresAt);
      const familyId = await this.repository.createRefreshFamily(client, sessionId, identityId);

      const refreshPlain = generateOpaqueToken();
      const refreshHash = hashOpaqueToken(refreshPlain);
      await this.repository.insertRefreshToken(client, familyId, refreshHash, sessionExpiresAt);
      await client.query('COMMIT');

      const access = this.tokenService.issueAccessToken(identityId, sessionId);

      return toAuthTokenResponse({
        accessToken: access.token,
        refreshToken: refreshPlain,
        expiresIn: access.expiresIn,
        sessionId,
        sessionExpiresAt: sessionExpiresAt,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private getPool() {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }
}
