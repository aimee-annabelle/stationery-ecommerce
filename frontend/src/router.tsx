import { createBrowserRouter, Outlet } from "react-router-dom";
import { ShopLayout } from "./layouts/ShopLayout";
import { StaffLayout } from "./layouts/StaffLayout";
import { StaffSessionProvider } from "./lib/staffSession";
import { AccountPage } from "./routes/account/AccountPage";
import { LoginPage } from "./routes/account/LoginPage";
import { SignupPage } from "./routes/account/SignupPage";
import { NotFound } from "./routes/NotFound";
import { ContactPage } from "./routes/shop/ContactPage";
import { ServicesPage } from "./routes/shop/ServicesPage";
import { RequestsPage } from "./routes/staff/requests/RequestsPage";
import { CartPage } from "./routes/shop/CartPage";
import { CheckoutPage } from "./routes/shop/CheckoutPage";
import { HomePage } from "./routes/shop/HomePage";
import { OrderConfirmedPage, TrackPage } from "./routes/shop/OrderPages";
import { ProductPage } from "./routes/shop/ProductPage";
import { ShopPage } from "./routes/shop/ShopPage";
import { ComingSoon, RequireCapability } from "./routes/staff/guards";
import { DashboardPage } from "./routes/staff/DashboardPage";
import { OrdersPage } from "./routes/staff/orders/OrdersPage";
import { ReceiptPage } from "./routes/staff/orders/ReceiptPage";
import { SalePage } from "./routes/staff/orders/SalePage";
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
      { path: "/services", element: <ServicesPage /> },
      { path: "/contact", element: <ContactPage /> },
      { path: "/account", element: <AccountPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  // Checkout has its own slim header (design/Checkout.dc.html); log-in and sign-up use the arch layout.
  { path: "/checkout", element: <CheckoutPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/reset", element: <LoginPage startWith="forgot" /> },
  { path: "/signup", element: <SignupPage /> },
  {
    path: "/staff",
    element: (
      <StaffSessionProvider>
        <Outlet />
      </StaffSessionProvider>
    ),
    children: [
      { path: "login", element: <StaffLogin /> },
      // Printable receipt: signed-in staff, but outside the staff layout.
      { path: "orders/:orderId/receipt", element: <ReceiptPage /> },
      {
        element: <StaffLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "orders", element: <OrdersPage /> },
          { path: "orders/:orderId", element: <OrdersPage /> },
          { path: "sale", element: <SalePage /> },
          { path: "requests", element: <RequestsPage /> },
          { path: "requests/:requestId", element: <RequestsPage /> },
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
