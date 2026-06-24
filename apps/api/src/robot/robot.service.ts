import { Injectable } from "@nestjs/common";

/**
 * Robot (automated pour station) integration — STUB.
 *
 * These are the inputs pour routing needs from the robot. They are intentionally
 * stubbed so the rest of fw3 can query them today; wire them to the real robot
 * integration when it lands.
 */
@Injectable()
export class RobotService {
  /**
   * Raw-material item ids currently loaded in the robot (available for it to pour).
   * TODO: query the robot's live carousel / its integration table. Empty until wired.
   */
  async loadedRawMaterialIds(_tenantId: string): Promise<string[]> {
    return [];
  }

  /**
   * Whether the robot is currently down (unavailable for pours).
   * TODO: query the robot's health/availability. Assumed up until wired.
   */
  async isDown(_tenantId: string): Promise<boolean> {
    return false;
  }
}
