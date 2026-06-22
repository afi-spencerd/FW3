import { Module } from "@nestjs/common";
import { FormPakClient } from "./formpak.client";

@Module({
  providers: [FormPakClient],
  exports: [FormPakClient],
})
export class FormpakModule {}
