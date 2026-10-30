import {
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { AuditLog } from "../audit/audit-log.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { SecretBox } from "../crypto/secret-box.js";
import { PrismaService } from "../database/prisma.service.js";
import { IntervalJob } from "../jobs/interval-job.js";
import { LiveHub } from "../live/live-hub.js";
import {
  HEALTH_CHECK_INTERVAL_MS,
  IDLE_POLL_EVERY_N_TICKS,
  LiveMonitor,
  POLL_INTERVAL_MS,
} from "../services/live-monitor.js";
import { RouterAccess } from "../services/router-credentials.js";
import { PrismaRouterStore } from "../services/router-provision/prisma-store.js";
import { RouterSync } from "../services/router-sync.js";
import { VoucherExpiry } from "../vouchers/voucher-expiry.js";
import { VoucherReconciler } from "../vouchers/voucher-reconciler.js";
import { backendSettings } from "./backend-settings.js";
import { RoutersController } from "./routers.controller.js";
import { RoutersService } from "./routers.service.js";
import { TUNNEL_ALLOCATOR, TunnelAllocator } from "./tunnel-allocator.js";

const MINUTE = 60_000;

/** Runs the background jobs while the application is up. */
@Injectable()
export class BackgroundJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly jobs: IntervalJob[];
  private tick = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    monitor: LiveMonitor,
    expiry: VoucherExpiry,
    reconciler: VoucherReconciler,
    live: LiveHub,
  ) {
    this.jobs = [
      // Every tick while someone watches the live view; otherwise every Nth, to keep session
      // status honest without polling routers every five seconds.
      new IntervalJob("live-monitor.poll", POLL_INTERVAL_MS, async () => {
        this.tick++;
        if (live.watching() || this.tick % IDLE_POLL_EVERY_N_TICKS === 0) {
          await monitor.pollOnce((update) => live.publishHotspot(update));
        }
      }),
      new IntervalJob("live-monitor.health", HEALTH_CHECK_INTERVAL_MS, () => monitor.healthCheck()),
      new IntervalJob("voucher.expiry", MINUTE, async () => {
        await expiry.runOnce();
      }),
      new IntervalJob("voucher.reconcile", MINUTE, async () => {
        await reconciler.runOnce();
      }),
    ];
  }

  onApplicationBootstrap(): void {
    if (!this.config.jobsEnabled) return;
    // Run at once: catch anything that expired or got stuck while the API was down.
    for (const job of this.jobs) job.start(true);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.jobs.map((job) => job.stop()));
  }
}

@Module({
  providers: [
    {
      provide: RouterAccess,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new RouterAccess(
          new SecretBox(config.encryptionKey),
          config.mikrotik.apiPort,
          config.mikrotik.connectTimeoutSeconds,
        ),
    },
    {
      provide: AuditLog,
      inject: [PrismaService],
      useFactory: (db: PrismaService) => new AuditLog(db),
    },
    {
      provide: RouterSync,
      inject: [PrismaService, RouterAccess, AuditLog],
      useFactory: (db: PrismaService, access: RouterAccess, audit: AuditLog) =>
        new RouterSync(db, access, audit),
    },
    {
      provide: PrismaRouterStore,
      inject: [PrismaService, RouterAccess, RouterSync, APP_CONFIG],
      useFactory: (db: PrismaService, access: RouterAccess, sync: RouterSync, config: AppConfig) =>
        new PrismaRouterStore(db, access, sync, backendSettings(config)),
    },
    {
      provide: LiveMonitor,
      inject: [PrismaService, RouterAccess],
      useFactory: (db: PrismaService, access: RouterAccess) => new LiveMonitor(db, access),
    },
    {
      provide: VoucherExpiry,
      inject: [PrismaService, RouterSync],
      useFactory: (db: PrismaService, sync: RouterSync) => new VoucherExpiry(db, sync),
    },
    {
      provide: VoucherReconciler,
      inject: [PrismaService, RouterSync, AuditLog],
      useFactory: (db: PrismaService, sync: RouterSync, audit: AuditLog) =>
        new VoucherReconciler(db, sync, audit),
    },
    {
      provide: TUNNEL_ALLOCATOR,
      inject: [PrismaService, APP_CONFIG],
      useFactory: (db: PrismaService, config: AppConfig) =>
        config.tunnel === null
          ? null
          : new TunnelAllocator(db, new SecretBox(config.encryptionKey), {
              network: config.tunnel.network,
            }),
    },
    RoutersService,
    LiveHub,
    BackgroundJobs,
  ],
  controllers: [RoutersController],
  exports: [
    LiveHub,
    RouterAccess,
    AuditLog,
    RouterSync,
    PrismaRouterStore,
    LiveMonitor,
    VoucherExpiry,
    VoucherReconciler,
  ],
})
export class RoutersModule {}
