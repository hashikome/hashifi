import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { raw } from "express";
import { appModule } from "./app.module.js";
import { authHttpMiddleware } from "./auth/auth-http.js";
import { type Auth, BETTER_AUTH } from "./auth/create-auth.js";
import type { AppConfig } from "./config/config.js";
import type { EmailSender } from "./email/email-sender.js";
import { ErrorEnvelopeFilter } from "./http/error-envelope.js";
import { httpWideEvents, rawBodyErrors, requireTrustedOrigin } from "./http/http-middleware.js";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./portal/portal-images.js";

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
  // The client address for audit records comes from the proxies named here, never a header
  // anyone could write.
  app.set(
    "trust proxy",
    config.auth.trustedProxies.length > 0 ? config.auth.trustedProxies : false,
  );
  // Order matters: the wide event first, so every refusal below it is recorded.
  app.use(httpWideEvents());
  app.enableCors({ origin: config.frontendOrigin, credentials: true });
  app.use(requireTrustedOrigin([config.frontendOrigin]));
  app.use(authHttpMiddleware(app.get<Auth>(BETTER_AUTH)));
  app.getHttpAdapter().registerParserMiddleware(undefined, true);
  app.use(
    "/api/portal/images",
    raw({ type: [...ALLOWED_IMAGE_TYPES], limit: MAX_IMAGE_BYTES }),
    rawBodyErrors,
  );
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.enableShutdownHooks();
  await app.listen(options.port, "0.0.0.0");
  return app;
}
