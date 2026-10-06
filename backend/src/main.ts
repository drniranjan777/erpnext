import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const incoming = req.headers['x-request-id'];
      return (typeof incoming === 'string' && incoming.slice(0, 64)) || randomUUID();
    },
  });
  // rawBody: payment-provider webhooks are verified against the exact bytes received.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: false, rawBody: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  await app.register(fastifyCookie);
  // fileSize is 1 byte above the 10 MB attachment limit so StorageService rejects
  // oversize files instead of Fastify silently truncating them.
  await app.register(fastifyMultipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 + 1, fields: 5 } });
  await app.register(fastifyHelmet, {
    // Swagger UI needs inline scripts/styles
    contentSecurityPolicy: config.get('NODE_ENV', { infer: true }) === 'production' ? undefined : false,
  });
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('NextGen ERP API')
    .setDescription('AI-first multi-tenant ERP for Indian manufacturers')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, swagger), {
    jsonDocumentUrl: 'api/docs/openapi.json',
  });

  const port = config.get('PORT', { infer: true });
  await app.listen({ port, host: '0.0.0.0' });
  Logger.log(`API ready on http://localhost:${port}/api/v1  ·  docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();
