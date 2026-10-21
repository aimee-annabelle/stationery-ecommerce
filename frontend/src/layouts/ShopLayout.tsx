import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ShopFooter, ShopHeader } from "../routes/shop/parts";

// Public shop and customer pages: canvas header and footer around each page.
export function ShopLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="min-h-screen bg-paper font-body text-ink">
      <ShopHeader />
      <main>
        <Outlet />
      </main>
      <ShopFooter />
    </div>
  );
}
