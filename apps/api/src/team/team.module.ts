import { Module } from "@nestjs/common";
import { IssuesModule } from "../issues/issues.module.js";
import { TeamController } from "./team.controller.js";
import { TeamService } from "./team.service.js";

/** HashiNet's team (ADR-0011, 3 and 6). */
@Module({ imports: [IssuesModule], controllers: [TeamController], providers: [TeamService] })
export class TeamModule {}
