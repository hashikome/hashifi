import { Module } from "@nestjs/common";
import { RoutersModule } from "../routers/routers.module.js";
import { VenuesController } from "./venues.controller.js";
import { VenuesService } from "./venues.service.js";

@Module({ imports: [RoutersModule], controllers: [VenuesController], providers: [VenuesService] })
export class VenuesModule {}
