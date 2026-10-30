import { Module } from "@nestjs/common";
import { AnalyticsController, RevenueController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";

@Module({ controllers: [AnalyticsController, RevenueController], providers: [AnalyticsService] })
export class AnalyticsModule {}
