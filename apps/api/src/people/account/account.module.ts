import { Module } from "@nestjs/common";
import { MeController } from "./me.controller.js";

/** A person's own account: who they are, their sign-in protection and their workspaces. */
@Module({ controllers: [MeController] })
export class AccountModule {}
