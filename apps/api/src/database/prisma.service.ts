import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { PrismaClient } from "../generated/prisma/client";
import { mssqlConfigFromUrl } from "./mssql-config";

/**
 * The single Prisma client for the app, wired to SQL Server through the
 * Prisma 7 driver adapter. Inject this everywhere; never `new PrismaClient`.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    super({ adapter: new PrismaMssql(mssqlConfigFromUrl(url)) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Prisma connected to SQL Server via mssql adapter");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
