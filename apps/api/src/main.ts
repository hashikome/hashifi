import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { appModule } from "./app.module.js";
import { authHttpMiddleware } from "./auth/auth-http.js";
import { type Auth, BETTER_AUTH } from "./auth/create-auth.js";
import type { AppConfig } from "./config/config.js";
import type { EmailSender } from "./email/email-sender.js";

export interface BootstrapOptions {
  /** Port to listen on; 0 picks a free one (tests). */
  port: number;
  email: EmailSender | null;
}

/** Builds and starts the HTTP application. Telemetry is already running (entrypoint.ts). */
export async function bootstrap(
  config: AppConfig,
  options: BootstrapOptions = { port: config.port, email: null },
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    appModule(config, options.email),
    // Better Auth reads the raw request, so Nest's parsers are added after its middleware.
    { logger: ["error", "warn"], bodyParser: false, rawBody: true },
  );
  app.disable("x-powered-by");
  app.enableCors({ origin: config.frontendOrigin, credentials: true });
  app.use(authHttpMiddleware(app.get<Auth>(BETTER_AUTH)));
  app.getHttpAdapter().registerParserMiddleware(undefined, true);
  app.enableShutdownHooks();
  await app.listen(options.port, "0.0.0.0");
  return app;
}
