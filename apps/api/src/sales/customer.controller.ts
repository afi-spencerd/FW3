import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  type CreateCustomer,
  createCustomerSchema,
  PERMISSIONS,
  type UpdateCustomer,
  updateCustomerSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CustomerService } from "./customer.service";

@Controller("customers")
@UseGuards(AuthGuard, PermissionsGuard)
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.customers.list(user.tenantId);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  getById(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.customers.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCustomerSchema)) body: CreateCustomer,
  ) {
    return this.customers.create(user, body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomer,
  ) {
    return this.customers.update(user, id, body);
  }
}
