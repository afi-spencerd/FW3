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
  INVENTORY_DELETE: "inventory:delete",
  FORMULA_READ: "formula:read",
  FORMULA_CREATE: "formula:create",
  FORMULA_UPDATE: "formula:update",
  FORMULA_DELETE: "formula:delete",
  STOCK_ADJUST: "stock:adjust",
  VENDOR_READ: "vendor:read",
  VENDOR_MANAGE: "vendor:manage",
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
  QB_SYNC_RUN: "qb:sync:run",
  QB_SYNC_VIEW: "qb:sync:view",
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
    PERMISSIONS.VENDOR_READ,
    PERMISSIONS.VENDOR_MANAGE,
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
    PERMISSIONS.QB_SYNC_VIEW,
  ],
  viewer: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.FORMULA_READ,
    PERMISSIONS.VENDOR_READ,
    PERMISSIONS.PO_READ,
    PERMISSIONS.CUSTOMER_READ,
    PERMISSIONS.SO_READ,
    PERMISSIONS.QB_SYNC_VIEW,
  ],
} as const satisfies Record<string, readonly Permission[]>;

export type BuiltinRoleName = keyof typeof BUILTIN_ROLES;
