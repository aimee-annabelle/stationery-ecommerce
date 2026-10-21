import { createBrowserRouter } from "react-router-dom";
import { ShopLayout } from "./layouts/ShopLayout";
import { StaffLayout } from "./layouts/StaffLayout";
import { AccountHome } from "./routes/account/AccountHome";
import { NotFound } from "./routes/NotFound";
import { ShopHome } from "./routes/shop/ShopHome";
import { StaffHome } from "./routes/staff/StaffHome";

// Three areas in one app (HANDOFF.md, "Tech stack"): public shop, customer account, staff back office.
export const router = createBrowserRouter([
  {
    element: <ShopLayout />,
    children: [
      { path: "/", element: <ShopHome /> },
      { path: "/account", element: <AccountHome /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  {
    path: "/staff",
    element: <StaffLayout />,
    children: [{ index: true, element: <StaffHome /> }],
  },
]);
