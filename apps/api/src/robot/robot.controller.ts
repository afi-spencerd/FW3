import { Controller, Get, UseGuards } from "@nestjs/common";
import { type AuthenticatedUser, PERMISSIONS } from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RobotService } from "./robot.service";

@Controller("robot")
@UseGuards(AuthGuard, PermissionsGuard)
export class RobotController {
  constructor(private readonly robot: RobotService) {}

  /** Current robot status + the materials it has loaded (stubbed for now). */
  @Get("status")
  @RequirePermissions(PERMISSIONS.PRODUCTION_READ)
  async status(@CurrentUser() user: AuthenticatedUser) {
    return {
      down: await this.robot.isDown(user.tenantId),
      loadedRawMaterialIds: await this.robot.loadedRawMaterialIds(user.tenantId),
    };
  }
}
