import { Link } from "react-router-dom";
import { strings } from "../../strings";

/** A shop page from a later build stage. */
export function ShopPlaceholder({ title, stage }: { title: string; stage: number }) {
  return (
    <section className="mx-auto max-w-[1240px] px-4 py-24 text-center sm:px-6">
      <h1 className="m-0 font-heading text-[44px] font-medium">{title}</h1>
      <p className="mt-3 text-muted">{strings.shop.comingSoon(stage)}</p>
      <Link to="/shop" className="font-semibold underline">
        {strings.shop.home.viewAll}
      </Link>
    </section>
  );
}
