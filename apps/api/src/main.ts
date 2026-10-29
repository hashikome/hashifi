import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import type { AppConfig } from "./config/config.js";
import { APP_CONFIG } from "./config/config.module.js";

/** Builds and starts the HTTP application. Telemetry is already running (entrypoint.ts). */
export async function bootstrap(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.enableCors({ origin: config.frontendOrigin, credentials: true });
  app.enableShutdownHooks();
  await app.listen(config.port);
  return app;
}
