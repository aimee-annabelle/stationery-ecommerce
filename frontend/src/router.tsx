import { createBrowserRouter, Outlet } from "react-router-dom";
import { ShopLayout } from "./layouts/ShopLayout";
import { StaffLayout } from "./layouts/StaffLayout";
import { StaffSessionProvider } from "./lib/staffSession";
import { NotFound } from "./routes/NotFound";
import { CartPage } from "./routes/shop/CartPage";
import { CheckoutPage } from "./routes/shop/CheckoutPage";
import { HomePage } from "./routes/shop/HomePage";
import { OrderConfirmedPage, TrackPage } from "./routes/shop/OrderPages";
import { ShopPlaceholder } from "./routes/shop/Placeholder";
import { ProductPage } from "./routes/shop/ProductPage";
import { ShopPage } from "./routes/shop/ShopPage";
import { ComingSoon, RequireCapability } from "./routes/staff/guards";
import { CategoriesPage } from "./routes/staff/products/CategoriesPage";
import { ProductEditPage } from "./routes/staff/products/ProductEditPage";
import { ProductsPage } from "./routes/staff/products/ProductsPage";
import { StaffLogin } from "./routes/staff/StaffLogin";
import { strings } from "./strings";

const nav = strings.staff.nav;

// Three areas in one app (HANDOFF.md, "Tech stack"): public shop, customer account, staff back office.
export const router = createBrowserRouter([
  {
    element: <ShopLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/shop", element: <ShopPage /> },
      { path: "/shop/:slug", element: <ProductPage /> },
      { path: "/cart", element: <CartPage /> },
      { path: "/orders/:number/confirmed", element: <OrderConfirmedPage /> },
      { path: "/track", element: <TrackPage /> },
      // Stage 5 pages.
      { path: "/services", element: <ShopPlaceholder title={strings.shop.nav.services} stage={5} /> },
      { path: "/contact", element: <ShopPlaceholder title={strings.shop.nav.contact} stage={5} /> },
      { path: "/login", element: <ShopPlaceholder title={strings.shop.logIn} stage={5} /> },
      { path: "/signup", element: <ShopPlaceholder title={strings.shop.signUp} stage={5} /> },
      { path: "/account", element: <ShopPlaceholder title={strings.shop.logIn} stage={5} /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  // Checkout has its own slim header (design/Checkout.dc.html).
  { path: "/checkout", element: <CheckoutPage /> },
  {
    path: "/staff",
    element: (
      <StaffSessionProvider>
        <Outlet />
      </StaffSessionProvider>
    ),
    children: [
      { path: "login", element: <StaffLogin /> },
      {
        element: <StaffLayout />,
        children: [
          { index: true, element: <ComingSoon title={nav.dashboard} stage={4} /> },
          { path: "orders/*", element: <ComingSoon title={nav.orders} stage={4} /> },
          { path: "sale", element: <ComingSoon title={strings.staff.tabs.sale} stage={4} /> },
          { path: "requests", element: <ComingSoon title={nav.requests} stage={5} /> },
          {
            path: "products",
            element: (
              <RequireCapability capability="products.view">
                <ProductsPage />
              </RequireCapability>
            ),
          },
          {
            path: "products/categories",
            element: (
              <RequireCapability capability="products.edit">
                <CategoriesPage />
              </RequireCapability>
            ),
          },
          {
            path: "products/:productId",
            element: (
              <RequireCapability capability="products.edit">
                <ProductEditPage />
              </RequireCapability>
            ),
          },
          ...(
            [
              ["reports", nav.reports, "reports.view"],
              ["activity", nav.activity, "activity.view"],
              ["team", nav.team, "staff.manage"],
              ["settings", nav.settings, "settings.manage"],
            ] as const
          ).map(([path, title, capability]) => ({
            path,
            element: (
              <RequireCapability capability={capability}>
                <ComingSoon title={title} stage={6} />
              </RequireCapability>
            ),
          })),
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
