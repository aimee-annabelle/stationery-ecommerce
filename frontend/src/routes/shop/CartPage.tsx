// 3 · Cart (design/Cart.dc.html). Lines come from the browser; prices and problems from /cart/quote.

import { Link } from "react-router-dom";
import { icons } from "../../components/icons";
import { formatRwf } from "../../lib/format";
import { useCustomerSession } from "../../lib/customerSession";
import { strings } from "../../strings";
import { bag, useBag } from "./bag";
import { Price, ProductArt, Stepper } from "./parts";
import { useBagQuote } from "./shopApi";

const t = strings.shop.bag;

export function CartPage() {
  const lines = useBag();
  const quote = useBagQuote(lines);
  const { customer } = useCustomerSession();
  const data = lines.length ? quote.data : undefined;

  return (
    <section className="mx-auto max-w-[1240px] px-4 pt-4 pb-24 sm:px-6">
      <div className="mb-8 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <h1 className="m-0 font-heading text-[44px] leading-none font-medium sm:text-[60px]">{t.title}</h1>
        {lines.length > 0 && <span className="text-base text-muted">{t.count(data?.units ?? lines.reduce((s, l) => s + l.qty, 0))}</span>}
      </div>

      {lines.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[36px] bg-white px-6 py-[72px] text-center">
          <span className="flex size-24 items-center justify-center rounded-full bg-sage">
            <icons.bag size={36} />
          </span>
          <h2 className="m-0 font-heading text-[34px] font-medium">{t.emptyTitle}</h2>
          <p className="m-0 text-base text-muted">{t.emptyText}</p>
          <Link to="/shop" className="flex min-h-[50px] items-center rounded-full bg-ink px-[26px] text-[15px] font-semibold text-white no-underline">
            {t.goShop}
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-8">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
            {data?.lines.map((line) => {
              const name = line.name;
              const set = (qty: number) => bag.setQty(line.product_id, line.variant_id, qty);
              return (
                <div key={`${line.product_id}:${line.variant_id}`} className="flex flex-wrap items-center gap-[18px] rounded-[28px] bg-white p-3.5">
                  <Link to={line.slug ? `/shop/${line.slug}` : "/shop"} aria-label={t.view(name)} className="shrink-0">
                    <ProductArt image={line.image} tint={line.tint} categorySlug={line.category_slug} className="size-[120px] rounded-[22px]" iconSize={44} />
                  </Link>
                  <div className="flex flex-[1_1_200px] flex-col gap-1.5">
                    {line.category_name && <span className="text-[13px] text-muted">{line.category_name}</span>}
                    {line.slug ? (
                      <Link to={`/shop/${line.slug}`} className="text-[17px] font-semibold no-underline">
                        {name}
                      </Link>
                    ) : (
                      <span className="text-[17px] font-semibold">{name}</span>
                    )}
                    {line.variant_name && <span className="text-sm text-muted">{line.variant_name}</span>}
                    {line.problem && (
                      <span role="alert" className="text-sm font-semibold text-error">
                        {line.problem}
                      </span>
                    )}
                  </div>
                  <Stepper
                    value={line.qty}
                    onChange={set}
                    decreaseLabel={t.decrease(name)}
                    increaseLabel={t.increase(name)}
                    tone="paper"
                  />
                  <div className="min-w-[130px] text-right">
                    <Price amount={line.line_total_rwf} className="text-xl" />
                  </div>
                  <button
                    type="button"
                    aria-label={t.remove(name)}
                    onClick={() => set(0)}
                    className="flex size-11 cursor-pointer items-center justify-center rounded-full text-muted"
                  >
                    <icons.trash size={18} />
                  </button>
                </div>
              );
            })}
            <Link to="/shop" className="flex items-center gap-2 self-start py-3 text-[15px] font-semibold underline">
              <icons.arrowLeft size={16} />
              {t.continue}
            </Link>
            <Link to="/services" className="flex items-center gap-4 rounded-3xl bg-blush px-6 py-5 no-underline">
              <span className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-white">
                <icons.book size={20} />
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-base font-semibold">{t.servicesTitle}</span>
                <span className="text-sm text-[#3C4A42]">{t.servicesText}</span>
              </span>
              <icons.arrowRight size={18} />
            </Link>
          </div>

          <aside className="flex flex-[1_1_340px] flex-col gap-[18px] rounded-[32px] bg-white p-7">
            <h2 className="m-0 font-heading text-[28px] font-medium">{t.summary}</h2>
            <div className="flex justify-between text-[15px]">
              <span className="text-muted">{t.items(data?.units ?? 0)}</span>
              <span>{formatRwf(data?.total_rwf ?? 0)}</span>
            </div>
            <div className="flex justify-between text-[15px]">
              <span className="text-muted">{t.pickup}</span>
              <span className="font-semibold text-[#2F6B45]">{t.free}</span>
            </div>
            <div className="flex items-baseline justify-between border-t border-[#EEEBE4] pt-[18px]">
              <span className="text-base font-semibold">{t.total}</span>
              <Price amount={data?.total_rwf ?? 0} className="text-[28px]" />
            </div>
            {data && !data.can_checkout && (
              <p role="alert" className="m-0 text-sm text-error">
                {t.fixFirst}
              </p>
            )}
            <Link
              to="/checkout"
              aria-disabled={!data?.can_checkout}
              onClick={(e) => !data?.can_checkout && e.preventDefault()}
              className={`flex min-h-14 items-center justify-center gap-2.5 rounded-full bg-ink text-base font-semibold text-white no-underline ${
                data?.can_checkout ? "" : "pointer-events-none opacity-50"
              }`}
            >
              {customer ? strings.shop.checkout.title : t.checkoutGuest}
              <icons.arrowRight size={18} />
            </Link>
            {!customer && (
              <>
                <Link to="/login?next=/checkout" className="flex min-h-14 items-center justify-center rounded-full border-[1.5px] border-ink text-base font-semibold no-underline">
                  {t.logInCheckout}
                </Link>
                <p className="m-0 text-center text-[13px] leading-relaxed text-muted">{t.accountNote}</p>
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
