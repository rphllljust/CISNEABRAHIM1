import { Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { SecurityModule } from '../security/security.module';
import { DocumentsController } from './controllers/documents.controller';
import { DocumentsRepository } from './repositories/documents.repository';
import { DocumentUploadCoordinator } from './services/document-upload-coordinator';
import { DocumentsAccessAuthz } from './services/documents-access.authz';
import { DocumentsAccessService } from './services/documents-access.service';
import { DownloadTokenService } from './storage/download-token.service';
import { ObjectStorageService } from './storage/object-storage.service';
import { DOCUMENT_UPLOAD_LIMITS } from './dto/documents.dto';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule, SecurityModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsRepository,
    DocumentsAccessAuthz,
    DocumentsAccessService,
    DocumentUploadCoordinator,
    ObjectStorageService,
    DownloadTokenService,
  ],
  exports: [DocumentsRepository, DocumentsAccessService, ObjectStorageService, DownloadTokenService],
})
export class DocumentsModule implements OnModuleInit {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  /**
   * Registra o multipart do Fastify — mas SOMENTE quando existe um adapter HTTP.
   *
   * Este modulo tambem e carregado pelo WORKER (`WorkerAppModule` importa
   * `DocumentsModule` indiretamente), e o worker sobe com
   * `NestFactory.createApplicationContext`, que nao cria adapter HTTP. Ali
   * `adapterHost.httpAdapter` e `null`, e a versao anterior derrubava o processo
   * no boot:
   *
   *   TypeError: Cannot read properties of null (reading 'getInstance')
   *       at DocumentsModule.onModuleInit
   *
   * O sintoma era restart-loop do container: `argv` correto
   * (`node apps/api/dist/worker/main.js`), processo morrendo em 1s.
   *
   * O worker nao serve upload HTTP, entao pular o registro e o comportamento
   * correto — nao uma tolerancia. O guard mantem o modulo utilizavel nos dois
   * contextos sem esconder erro em nenhum deles.
   */
  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!fastify || fastify.hasDecorator('multipart')) {
      return;
    }
    await fastify.register(multipart, {
      limits: {
        fileSize: DOCUMENT_UPLOAD_LIMITS.maxFileSizeBytes,
        files: DOCUMENT_UPLOAD_LIMITS.maxFilesPerRequest,
      },
    });
  }
}
