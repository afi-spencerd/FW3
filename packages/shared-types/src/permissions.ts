/**
 * RBAC permission catalogue. Permissions are the atomic unit of authorization;
 * roles are bundles of permissions. The API guards endpoints by permission, not
 * by role name, so roles can be reshaped without touching endpoint code.
 *
 * Naming: "<resource>:<action>". Keep this list as the single source of truth —
 * the DB seed creates exactly these rows.
 */
export const PERMISSIONS = {
  INVENTORY_READ: "inventory:read",
  INVENTORY_CREATE: "inventory:create",
  INVENTORY_UPDATE: "inventory:update",
  // Inventory items are never hard-deleted (transactions must stay auditable);
  // deactivate via the `active` flag instead. No inventory:delete permission.
  FORMULA_READ: "formula:read",
  FORMULA_CREATE: "formula:create",
  FORMULA_UPDATE: "formula:update",
  FORMULA_DELETE: "formula:delete",
  STOCK_ADJUST: "stock:adjust",
  STOCK_MOVE: "stock:move",
  STOCK_SCRAP: "stock:scrap",
  CYCLE_COUNT_READ: "cycle_count:read",
  CYCLE_COUNT_MANAGE: "cycle_count:manage",
  LOCATION_READ: "location:read",
  LOCATION_MANAGE: "location:manage",
  VENDOR_READ: "vendor:read",
  VENDOR_MANAGE: "vendor:manage",
  VENDOR_RETURN: "vendor:return",
  PO_READ: "po:read",
  PO_CREATE: "po:create",
  PO_UPDATE: "po:update",
  PO_RECEIVE: "po:receive",
  CUSTOMER_READ: "customer:read",
  CUSTOMER_MANAGE: "customer:manage",
  SO_READ: "so:read",
  SO_CREATE: "so:create",
  SO_UPDATE: "so:update",
  SO_SHIP: "so:ship",
  // Override the can't-sell-below-cost guard on a sales order.
  SO_PRICE_OVERRIDE: "so:price-override",
  // Override the customer-credit-limit guard when creating a sales order.
  SO_CREDIT_OVERRIDE: "so:credit-override",
  // Customer service: turn a (paid / net-terms) sales order into work orders.
  SO_REQUEST_PRODUCTION: "so:request-production",
  // Record payments against a sales order.
  SO_RECORD_PAYMENT: "so:record-payment",
  // Customer service: refund overpayments / approved cancellations.
  SO_ISSUE_REFUND: "so:issue-refund",
  PRODUCTION_READ: "production:read",
  PRODUCTION_CREATE: "production:create",
  PRODUCTION_EXECUTE: "production:execute",
  // Scheduler: prioritize the run queue and release work orders to the floor.
  PRODUCTION_SCHEDULE: "production:schedule",
  QC_READ: "qc:read",
  QC_REVIEW: "qc:review",
  QC_SPEC_MANAGE: "qc:spec:manage",
  QB_SYNC_RUN: "qb:sync:run",
  QB_SYNC_VIEW: "qb:sync:view",
  // Tenant business variables (working hours, pours/hour, efficiency, …):
  // everyone can read; only authorized users may change them.
  BUSINESS_VAR_READ: "business_variables:read",
  BUSINESS_VAR_MANAGE: "business_variables:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/**
 * Built-in roles seeded per tenant. `admin` gets everything; `inventory_clerk`
 * is the day-to-day CRUD role; `viewer` is read-only. These are seed defaults —
 * tenants can define their own roles later.
 */
export const BUILTIN_ROLES = {
  admin: ALL_PERMISSIONS,
  inventory_clerk: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_CREATE,
    PERMISSIONS.INVENTORY_UPDATE,
    PERMISSIONS.FORMULA_READ,
    PERMISSIONS.FORMULA_CREATE,
    PERMISSIONS.FORMULA_UPDATE,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.STOCK_MOVE,
    PERMISSIONS.STOCK_SCRAP,
    PERMISSIONS.CYCLE_COUNT_READ,
    PERMISSIONS.CYCLE_COUNT_MANAGE,
    PERMISSIONS.LOCATION_READ,
    PERMISSIONS.LOCATION_MANAGE,
    PERMISSIONS.VENDOR_READ,
    PERMISSIONS.VENDOR_MANAGE,
    PERMISSIONS.VENDOR_RETURN,
    PERMISSIONS.PO_READ,
    PERMISSIONS.PO_CREATE,
    PERMISSIONS.PO_UPDATE,
    PERMISSIONS.PO_RECEIVE,
    PERMISSIONS.CUSTOMER_READ,
    PERMISSIONS.CUSTOMER_MANAGE,
    PERMISSIONS.SO_READ,
    PERMISSIONS.SO_CREATE,
    PERMISSIONS.SO_UPDATE,
    PERMISSIONS.SO_SHIP,
    PERMISSIONS.SO_CREDIT_OVERRIDE,
    PERMISSIONS.SO_REQUEST_PRODUCTION,
    PERMISSIONS.SO_RECORD_PAYMENT,
    PERMISSIONS.SO_ISSUE_REFUND,
    PERMISSIONS.PRODUCTION_READ,
    PERMISSIONS.PRODUCTION_CREATE,
    PERMISSIONS.PRODUCTION_EXECUTE,
    PERMISSIONS.PRODUCTION_SCHEDULE,
    PERMISSIONS.QC_READ,
    PERMISSIONS.QC_REVIEW,
    PERMISSIONS.QC_SPEC_MANAGE,
    PERMISSIONS.QB_SYNC_VIEW,
    PERMISSIONS.BUSINESS_VAR_READ,
  ],
  viewer: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.LOCATION_READ,
    PERMISSIONS.CYCLE_COUNT_READ,
    PERMISSIONS.FORMULA_READ,
    PERMISSIONS.VENDOR_READ,
    PERMISSIONS.PO_READ,
    PERMISSIONS.CUSTOMER_READ,
    PERMISSIONS.SO_READ,
    PERMISSIONS.PRODUCTION_READ,
    PERMISSIONS.QC_READ,
    PERMISSIONS.QB_SYNC_VIEW,
    PERMISSIONS.BUSINESS_VAR_READ,
  ],
} as const satisfies Record<string, readonly Permission[]>;

export type BuiltinRoleName = keyof typeof BUILTIN_ROLES;
