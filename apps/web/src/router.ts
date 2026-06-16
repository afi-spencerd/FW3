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
