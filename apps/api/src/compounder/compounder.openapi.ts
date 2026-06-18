import {
  COMPOUNDER_SETTABLE_STATUSES,
  ITEM_TYPES,
  PRODUCTION_STATUSES,
  UNITS_OF_MEASURE,
} from "@fw3/shared-types";

/**
 * OpenAPI 3.1 contract for the compounder dosing-tool API. Served (unauthenticated)
 * at GET /compounder/openapi.json so tool developers can generate clients. Kept
 * in lockstep with the controller + the @fw3/shared-types zod schemas.
 */

const decimalString = {
  type: "string",
  description: "Decimal value as a string (canonical pounds for weights).",
  example: "12.5000",
} as const;

const Operator = {
  type: "object",
  required: ["id", "displayName", "email"],
  properties: {
    id: { type: "string", format: "uuid" },
    displayName: { type: "string" },
    email: { type: "string" },
  },
} as const;

const InventoryRow = {
  type: "object",
  required: ["itemId", "sku", "name", "itemType", "handlingUnit", "invQuantity", "wipQuantity"],
  properties: {
    itemId: { type: "string", format: "uuid" },
    sku: { type: "string" },
    name: { type: "string" },
    itemType: { type: "string", enum: [...ITEM_TYPES] },
    handlingUnit: {
      type: "string",
      enum: [...UNITS_OF_MEASURE],
      description: "Display/handling unit; stock is stored in pounds.",
    },
    invQuantity: { ...decimalString, description: "Usable (LOT-traceable) on hand, in pounds." },
    wipQuantity: { ...decimalString, description: "Work-in-progress (staged), in pounds." },
  },
} as const;

const WorkOrderLine = {
  type: "object",
  required: [
    "lineId", "componentId", "sku", "name", "handlingUnit",
    "percentage", "requiredQty", "stagedQty", "consumedQty", "wipAvailable",
  ],
  properties: {
    lineId: { type: "string", format: "uuid" },
    componentId: { type: "string", format: "uuid" },
    sku: { type: "string" },
    name: { type: "string" },
    handlingUnit: { type: "string", enum: [...UNITS_OF_MEASURE] },
    percentage: { ...decimalString, description: "Formula percentage of the batch by weight." },
    requiredQty: { ...decimalString, description: "Target amount for this batch (lb)." },
    stagedQty: { ...decimalString, description: "Amount staged into WIP (lb)." },
    consumedQty: { ...decimalString, description: "Amount poured/consumed so far (lb)." },
    wipAvailable: { ...decimalString, description: "Currently available to pour from WIP (lb)." },
  },
} as const;

const WorkOrderSummary = {
  type: "object",
  required: [
    "id", "workOrderNumber", "status", "targetItemId", "targetSku",
    "targetName", "formulaName", "batchSize", "outputQty", "lineCount",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    workOrderNumber: { type: "string" },
    status: { type: "string", enum: [...PRODUCTION_STATUSES] },
    targetItemId: { type: "string", format: "uuid" },
    targetSku: { type: "string" },
    targetName: { type: "string" },
    formulaName: { type: "string" },
    batchSize: { ...decimalString, description: "Batch size in pounds." },
    outputQty: { ...decimalString, description: "Planned finished-good output (lb)." },
    lineCount: { type: "integer" },
  },
} as const;

const WorkOrder = {
  allOf: [
    { $ref: "#/components/schemas/WorkOrderSummary" },
    {
      type: "object",
      required: ["lines"],
      properties: {
        lines: { type: "array", items: { $ref: "#/components/schemas/WorkOrderLine" } },
      },
    },
  ],
} as const;

const PourInput = {
  type: "object",
  required: ["componentId", "quantity"],
  properties: {
    componentId: { type: "string", format: "uuid", description: "A component on the work order's BOM." },
    quantity: { ...decimalString, description: "Amount poured, in pounds (> 0)." },
    note: { type: "string", maxLength: 500 },
  },
} as const;

const Pour = {
  type: "object",
  required: [
    "id", "workOrderId", "workOrderLineId", "componentId",
    "componentSku", "componentName", "quantity", "operator", "note", "occurredAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    workOrderId: { type: "string", format: "uuid" },
    workOrderLineId: { type: "string", format: "uuid" },
    componentId: { type: "string", format: "uuid" },
    componentSku: { type: "string" },
    componentName: { type: "string" },
    quantity: { ...decimalString, description: "Poured amount, in pounds." },
    operator: { $ref: "#/components/schemas/Operator" },
    note: { type: "string", nullable: true },
    occurredAt: { type: "string", format: "date-time" },
  },
} as const;

const StatusUpdate = {
  type: "object",
  required: ["status"],
  properties: {
    status: {
      type: "string",
      enum: [...COMPOUNDER_SETTABLE_STATUSES],
      description:
        "IN_PROGRESS = start pouring; ON_HOLD = pause; COMPLETED = finish the batch (outputs the FG to FG_WIP and opens its QC lot).",
    },
  },
} as const;

const ErrorResponse = {
  type: "object",
  required: ["statusCode", "message"],
  properties: {
    statusCode: { type: "integer" },
    message: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    error: { type: "string" },
  },
} as const;

const jsonArray = (ref: string) => ({
  description: "Success",
  content: { "application/json": { schema: { type: "array", items: { $ref: ref } } } },
});
const jsonObj = (ref: string) => ({
  description: "Success",
  content: { "application/json": { schema: { $ref: ref } } },
});
const errResponses = {
  "400": { description: "Validation or state error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "401": { description: "Not authenticated" },
  "403": { description: "Missing permission" },
  "404": { description: "Not found" },
};

export const compounderOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "fw3 Compounder Dosing-Tool API",
    version: "1.0.0",
    description:
      "Machine-facing API for the compounder dosing tool: read the work-order " +
      "queue, each order's bill of materials, and available inventory; report " +
      "pours (which consume from WIP), drive work-order status, and identify the " +
      "operator. Pack-off is handled by a separate tool feature and is not part " +
      "of this API. All weights are canonical pounds.",
  },
  servers: [{ url: "/", description: "Same-origin API" }],
  security: [{ sessionCookie: [] }],
  tags: [{ name: "Compounder", description: "Compounder dosing-tool integration" }],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "connect.sid",
        description:
          "Session cookie from the standard user login (POST /auth/dev-login in " +
          "dev, or OIDC). The tool reuses a user session; that user is recorded " +
          "as the operator on each pour.",
      },
    },
    schemas: {
      Operator,
      InventoryRow,
      WorkOrderLine,
      WorkOrderSummary,
      WorkOrder,
      PourInput,
      Pour,
      StatusUpdate,
      Error: ErrorResponse,
    },
  },
  paths: {
    "/compounder/me": {
      get: {
        tags: ["Compounder"],
        summary: "Current operator",
        description: "The signed-in user the tool is acting as (operator of record).",
        responses: { "200": jsonObj("#/components/schemas/Operator"), ...errResponses },
      },
    },
    "/compounder/inventory": {
      get: {
        tags: ["Compounder"],
        summary: "Available inventory",
        description: "Usable (INV) and work-in-progress (WIP) quantities per item, in pounds.",
        parameters: [
          { name: "search", in: "query", required: false, schema: { type: "string" }, description: "Match SKU or name." },
          { name: "itemType", in: "query", required: false, schema: { type: "string", enum: [...ITEM_TYPES] } },
        ],
        responses: { "200": jsonArray("#/components/schemas/InventoryRow"), ...errResponses },
      },
    },
    "/compounder/work-orders": {
      get: {
        tags: ["Compounder"],
        summary: "List work orders",
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: { type: "string", enum: [...PRODUCTION_STATUSES] },
            description: "Filter by status (e.g. STAGED, IN_PROGRESS, ON_HOLD).",
          },
        ],
        responses: { "200": jsonArray("#/components/schemas/WorkOrderSummary"), ...errResponses },
      },
    },
    "/compounder/work-orders/{id}": {
      get: {
        tags: ["Compounder"],
        summary: "Work order detail (with BOM)",
        description: "Header plus BOM lines: formula percentage, required/staged/consumed, and WIP available to pour.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": jsonObj("#/components/schemas/WorkOrder"), ...errResponses },
      },
    },
    "/compounder/work-orders/{id}/pours": {
      get: {
        tags: ["Compounder"],
        summary: "List pours for a work order",
        description: "Who poured what, how much, and when.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": jsonArray("#/components/schemas/Pour"), ...errResponses },
      },
      post: {
        tags: ["Compounder"],
        summary: "Report a pour",
        description:
          "Dose a component into the batch. Consumes the amount from WIP and, on " +
          "the first pour, moves a STAGED order to IN_PROGRESS. Requires the " +
          "production:execute permission. The operator is the authenticated user.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PourInput" } } },
        },
        responses: { "201": jsonObj("#/components/schemas/Pour"), ...errResponses },
      },
    },
    "/compounder/work-orders/{id}/status": {
      post: {
        tags: ["Compounder"],
        summary: "Set work-order status",
        description:
          "Start (IN_PROGRESS), pause (ON_HOLD), or finish (COMPLETED) the batch. " +
          "COMPLETED outputs the finished good to FG_WIP against the actual poured " +
          "value and opens its QC lot. Requires the production:execute permission.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/StatusUpdate" } } },
        },
        responses: { "200": jsonObj("#/components/schemas/WorkOrder"), ...errResponses },
      },
    },
  },
} as const;
