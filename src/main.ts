import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableCors();
  const apiPrefix = configService.getOrThrow<string>('API_PREFIX');
  const swaggerPath = configService.getOrThrow<string>('SWAGGER_PATH');
  const appHost = configService.getOrThrow<string>('APP_HOST');
  const port = Number(configService.getOrThrow<string>('PORT'));

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Fraud Detection API')
    .setDescription('High-volume transaction fraud detection system.')
    .setVersion('1.0')
    .addTag('fraud')
    .addTag('ingestion')
    .addTag('transactions')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(swaggerPath, app, document);

  await app.listen(port);
  logger.log(`🚀 Running on: http://${appHost}:${port}/${apiPrefix}`);
  logger.log(`📖 Swagger docs: http://${appHost}:${port}/${swaggerPath}`);
}

bootstrap();
