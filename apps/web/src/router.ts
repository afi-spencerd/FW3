import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "./stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("./views/LoginView.vue"),
    },
    {
      path: "/",
      name: "inventory",
      component: () => import("./views/InventoryListView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/inventory/new",
      name: "inventory-new",
      component: () => import("./views/InventoryFormView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/inventory/:id",
      name: "inventory-edit",
      component: () => import("./views/InventoryFormView.vue"),
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/formulas",
      name: "formulas",
      component: () => import("./views/FormulaListView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/quality",
      name: "quality",
      component: () => import("./views/QualityQueueView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/quality/:id",
      name: "quality-lot",
      component: () => import("./views/QualityLotView.vue"),
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/production",
      name: "production",
      component: () => import("./views/ProductionListView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/production/new",
      name: "production-new",
      component: () => import("./views/ProductionFormView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/production/:id",
      name: "production-detail",
      component: () => import("./views/ProductionDetailView.vue"),
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/formulas/new",
      name: "formula-new",
      component: () => import("./views/FormulaFormView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/formulas/:id",
      name: "formula-edit",
      component: () => import("./views/FormulaFormView.vue"),
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/vendors",
      name: "vendors",
      component: () => import("./views/VendorsView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/purchase-orders",
      name: "purchase-orders",
      component: () => import("./views/PurchaseOrderListView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/purchase-orders/new",
      name: "purchase-order-new",
      component: () => import("./views/PurchaseOrderFormView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/purchase-orders/:id",
      name: "purchase-order-detail",
      component: () => import("./views/PurchaseOrderDetailView.vue"),
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/customers",
      name: "customers",
      component: () => import("./views/CustomersView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/sales-orders",
      name: "sales-orders",
      component: () => import("./views/SalesOrderListView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/sales-orders/new",
      name: "sales-order-new",
      component: () => import("./views/SalesOrderFormView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/sales-orders/:id",
      name: "sales-order-detail",
      component: () => import("./views/SalesOrderDetailView.vue"),
      meta: { requiresAuth: true },
      props: true,
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) await auth.init();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: "login" };
  }
  if (to.name === "login" && auth.isAuthenticated) {
    return { name: "inventory" };
  }
  return true;
});
