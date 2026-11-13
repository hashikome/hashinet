import { Module } from "@nestjs/common";
import { TeamController } from "./team.controller.js";
import { TeamService } from "./team.service.js";

/** HashiNet's team (ADR-0011, 3 and 6). */
@Module({ controllers: [TeamController], providers: [TeamService] })
export class TeamModule {}
