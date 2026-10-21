import { useIsPhone } from "../../../lib/useMediaQuery";
import { ProductLookup } from "./ProductLookup";
import { ProductsDesktop } from "./ProductsDesktop";

/** /staff/products: S4 on desktop, M4 on a phone (same route, HANDOFF.md "Screens to build"). */
export function ProductsPage() {
  return useIsPhone() ? <ProductLookup /> : <ProductsDesktop />;
}
