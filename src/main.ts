import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX, API_VERSION } from './common';
import { APP_CONFIG } from './config';
import configuration from './config/configuration';
import { HttpExceptionFilter } from './filters';
import { LoggingInterceptor } from './interceptors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get<ReturnType<typeof configuration>>(APP_CONFIG);

  app.setGlobalPrefix(`${API_PREFIX}/${API_VERSION}`);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.listen(config.app.port);
  console.log(`🚀 Server is running on http://localhost:${config.app.port}`);

    
}


bootstrap();
