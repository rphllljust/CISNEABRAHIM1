import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile, MultipartValue } from '@fastify/multipart';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  parseCreateDocumentUploadFields,
  parseListDocumentsQuery,
  parseVersionNumberParam,
} from '../dto/documents.dto';
import { DOCUMENT_ERROR_CODES } from '../errors/document-error-codes';
import { DocumentHttpException } from '../errors/document-http.exception';
import { DocumentsAccessService } from '../services/documents-access.service';
import { sanitizeUploadFilename } from '../../security/domain/safe-filename';

type MultipartPart = MultipartFile | MultipartValue<unknown>;

/** Codigos de erro do @fastify/multipart que representam ENTRADA invalida do cliente. */
const MULTIPART_CLIENT_ERROR_CODES = new Set([
  'FST_INVALID_MULTIPART_CONTENT_TYPE',
  'FST_INVALID_MULTIPART',
  'FST_FILES_LIMIT',
  'FST_FIELDS_LIMIT',
  'FST_PARTS_LIMIT',
  'FST_REQ_FILE_TOO_LARGE',
  'FST_PROTO_VIOLATION',
]);

/**
 * Requisicao multipart invalida e erro de validacao (400), nao falha inesperada (500).
 * Erros nao reconhecidos sao propagados para permanecerem visiveis como 500 e logados.
 */
function mapMultipartRequestError(error: unknown): unknown {
  if (error instanceof DocumentHttpException) {
    return error;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && MULTIPART_CLIENT_ERROR_CODES.has(code)) {
    return new DocumentHttpException(
      HttpStatus.BAD_REQUEST,
      DOCUMENT_ERROR_CODES.INVALID_INPUT,
      code === 'FST_INVALID_MULTIPART_CONTENT_TYPE'
        ? 'Content-Type multipart/form-data is required.'
        : 'Malformed multipart upload.',
    );
  }
  return error;
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsAccess: DocumentsAccessService) {}

  @Get('download')
  async downloadByToken(@Query('token') token: string | undefined, @Res() reply: FastifyReply) {
    if (!token) {
      throw new DocumentHttpException(
        HttpStatus.FORBIDDEN,
        DOCUMENT_ERROR_CODES.DOWNLOAD_TOKEN_INVALID,
        'Download token is required.',
      );
    }
    const content = await this.documentsAccess.streamByToken(token);
    reply
      .header('Content-Type', content.mimeType)
      .header('Content-Disposition', `attachment; filename="${content.filename}"`)
      .send(content.buffer);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    const { fields, file } = await this.parseMultipart(request);
    const metadata = parseCreateDocumentUploadFields(fields);
    return this.documentsAccess.createWithUpload(
      { identityId: auth.sub, sessionId: auth.sid },
      metadata,
      file,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    const parsed = parseListDocumentsQuery(query);
    return this.documentsAccess.list({ identityId: auth.sub, sessionId: auth.sid }, parsed);
  }

  @Post(':documentId/versions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async uploadVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('documentId') documentId: string,
    @Req() request: FastifyRequest,
  ) {
    const { file } = await this.parseMultipart(request);
    return this.documentsAccess.uploadVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      documentId,
      file,
    );
  }

  @Get(':documentId')
  @UseGuards(JwtAuthGuard)
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('documentId') documentId: string) {
    return this.documentsAccess.getById({ identityId: auth.sub, sessionId: auth.sid }, documentId);
  }

  @Get(':documentId/versions')
  @UseGuards(JwtAuthGuard)
  listVersions(@CurrentAuth() auth: AccessTokenClaims, @Param('documentId') documentId: string) {
    return this.documentsAccess.listVersions(
      { identityId: auth.sub, sessionId: auth.sid },
      documentId,
    );
  }

  @Get(':documentId/versions/:versionNumber')
  @UseGuards(JwtAuthGuard)
  getVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('documentId') documentId: string,
    @Param('versionNumber') versionNumber: string,
  ) {
    return this.documentsAccess.getVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      documentId,
      parseVersionNumberParam(versionNumber),
    );
  }

  @Get(':documentId/versions/:versionNumber/content')
  @UseGuards(JwtAuthGuard)
  async streamContent(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('documentId') documentId: string,
    @Param('versionNumber') versionNumber: string,
    @Res() reply: FastifyReply,
  ) {
    const content = await this.documentsAccess.streamContent(
      { identityId: auth.sub, sessionId: auth.sid },
      documentId,
      parseVersionNumberParam(versionNumber),
    );
    reply
      .header('Content-Type', content.mimeType)
      .header('Content-Disposition', `attachment; filename="${content.filename}"`)
      .header('X-Content-SHA256', content.sha256)
      .send(content.buffer);
  }

  @Post(':documentId/versions/:versionNumber/download-url')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  issueDownloadUrl(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('documentId') documentId: string,
    @Param('versionNumber') versionNumber: string,
  ) {
    return this.documentsAccess.issueDownloadUrl(
      { identityId: auth.sub, sessionId: auth.sid },
      documentId,
      parseVersionNumberParam(versionNumber),
    );
  }

  private async parseMultipart(request: FastifyRequest): Promise<{
    fields: Record<string, string | undefined>;
    file: { buffer: Buffer; filename: string; mimetype: string };
  }> {
    const fields: Record<string, string | undefined> = {};
    let fileCount = 0;
    let filePayload: { buffer: Buffer; filename: string; mimetype: string } | null = null;

    let parts: AsyncIterable<MultipartPart>;
    try {
      parts = request.parts() as AsyncIterable<MultipartPart>;
    } catch (error) {
      throw mapMultipartRequestError(error);
    }

    let iterator: AsyncIterator<MultipartPart>;
    try {
      iterator = parts[Symbol.asyncIterator]();
    } catch (error) {
      throw mapMultipartRequestError(error);
    }

    while (true) {
      let step: IteratorResult<MultipartPart>;
      try {
        step = await iterator.next();
      } catch (error) {
        // Requisicao nao-multipart (ou multipart malformado) e erro de ENTRADA do cliente,
        // nao falha inesperada do servidor: responde 400 e nao 500.
        throw mapMultipartRequestError(error);
      }
      if (step.done) {
        break;
      }
      const part = step.value;
      if (part.type === 'file') {
        fileCount += 1;
        if (fileCount > 1) {
          throw new DocumentHttpException(
            HttpStatus.BAD_REQUEST,
            DOCUMENT_ERROR_CODES.TOO_MANY_FILES,
            'Only one file per upload is allowed.',
          );
        }
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
        }
        filePayload = {
          buffer: Buffer.concat(chunks),
          filename: sanitizeUploadFilename(part.filename ?? 'upload.bin'),
          mimetype: part.mimetype,
        };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!filePayload) {
      throw new DocumentHttpException(
        HttpStatus.BAD_REQUEST,
        DOCUMENT_ERROR_CODES.INVALID_INPUT,
        'A single file upload is required.',
      );
    }

    return { fields, file: filePayload };
  }
}
