import { Module } from "@nestjs/common";
import { BusinessesController } from "./businesses.controller.js";

@Module({ controllers: [BusinessesController] })
export class BusinessesModule {}
