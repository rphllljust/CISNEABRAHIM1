import { HttpAdapterHost } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsModule } from './documents.module';

/**
 * REGRESSAO: boot do worker sem adapter HTTP.
 *
 * O `DocumentsModule` tambem e carregado pelo worker, que sobe com
 * `NestFactory.createApplicationContext` (sem HTTP adapter). A versao anterior
 * chamava `this.adapterHost.httpAdapter.getInstance()` sem guarda e derrubava o
 * processo:
 *
 *   TypeError: Cannot read properties of null (reading 'getInstance')
 *
 * Em producao isso apareceu como restart-loop do container do worker, com o
 * `argv` correto e o processo morrendo em ~1s. Estes testes fixam os dois
 * contextos.
 */
describe('DocumentsModule.onModuleInit', () => {
  function moduleWith(adapter: unknown): DocumentsModule {
    const host = { httpAdapter: adapter } as unknown as HttpAdapterHost;
    return new DocumentsModule(host);
  }

  it('nao falha quando nao existe adapter HTTP (contexto do worker)', async () => {
    const sut = moduleWith(null);
    await expect(sut.onModuleInit()).resolves.toBeUndefined();
  });

  it('nao registra multipart quando ja existe o decorator', async () => {
    const register = vi.fn();
    const fastify = { hasDecorator: () => true, register };
    const sut = moduleWith({ getInstance: () => fastify });

    await sut.onModuleInit();

    expect(register).not.toHaveBeenCalled();
  });

  it('registra multipart uma vez quando o adapter HTTP existe e falta o decorator', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const fastify = { hasDecorator: () => false, register };
    const sut = moduleWith({ getInstance: () => fastify });

    await sut.onModuleInit();

    expect(register).toHaveBeenCalledTimes(1);
  });
});
