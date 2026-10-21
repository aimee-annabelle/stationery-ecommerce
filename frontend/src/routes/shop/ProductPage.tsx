// 2 · Product (design/Product.dc.html).

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { icons } from "../../components/icons";
import { strings } from "../../strings";
import { bag } from "./bag";
import { availabilityLine, BagBar, Breadcrumb, Price, ProductArt, Stepper, TINT_BG } from "./parts";
import { type ProductDetail, usePublicSettings, useProduct } from "./shopApi";

const t = strings.shop.product;
type Tab = "desc" | "specs" | "pickup";

export function ProductPage() {
  const { slug = "" } = useParams();
  const product = useProduct(slug);

  if (product.error) {
    return (
      <section className="mx-auto max-w-[1240px] px-4 py-24 text-center sm:px-6">
        <h1 className="font-heading text-4xl font-medium">{t.notFound}</h1>
        <Link to="/shop" className="font-semibold underline">
          {t.viewAll}
        </Link>
      </section>
    );
  }
  if (!product.data) return <p className="mx-auto max-w-[1240px] px-6 py-10">{strings.shop.loading}</p>;
  return <ProductView key={product.data.id} product={product.data} />;
}

function ProductView({ product: p }: { product: ProductDetail }) {
  const navigate = useNavigate();
  const settings = usePublicSettings();
  const firstAvailable = p.variants.find((v) => v.availability !== "out_of_stock");
  const [variantId, setVariantId] = useState<string | null>(firstAvailable?.id ?? null);
  const [photo, setPhoto] = useState(0);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<Tab>("desc");
  const [added, setAdded] = useState<number | null>(null);
  useEffect(() => setAdded(null), [variantId, qty]);

  const variant = p.variants.find((v) => v.id === variantId) ?? null;
  const availability = variant ? variant.availability : p.availability;
  const line = availabilityLine(availability);
  const needsVariant = p.variants.length > 0 && !variant;
  const canAdd = availability !== "out_of_stock" && !needsVariant;
  const image = p.images[photo]?.url ?? p.images[0]?.url ?? null;

  const add = () => {
    bag.add(p.id, variant?.id ?? null, qty);
    setAdded(qty);
  };

  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pt-2 pb-16 sm:px-6">
        <div className="mb-5">
          <Breadcrumb
            items={[
              { label: strings.shop.nav.home, to: "/" },
              { label: strings.shop.nav.shop, to: "/shop" },
              { label: p.category.name, to: `/shop?category=${p.category.slug}` },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-start gap-12">
          <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-4">
            <ProductArt
              image={image}
              tint={p.category.tint}
              color={variant?.swatch_hex}
              categorySlug={p.category.slug}
              className="h-[380px] rounded-[999px_999px_40px_40px] sm:h-[560px]"
              iconSize={160}
            />
            {p.images.length > 1 && (
              <div className="grid grid-cols-4 gap-3">
                {p.images.map((img, i) => (
                  <button
                    key={img.id}
                    type="button"
                    aria-label={t.photo(i + 1)}
                    aria-pressed={i === photo}
                    onClick={() => setPhoto(i)}
                    className={`h-24 cursor-pointer overflow-hidden rounded-card-sm border-2 ${
                      i === photo ? "border-ink" : "border-transparent"
                    }`}
                  >
                    <img src={img.url} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-[1_1_400px] flex-col gap-6">
            <div className="flex flex-col gap-3">
              <span className={`self-start rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${TINT_BG[p.category.tint]}`}>
                {p.category.name}
              </span>
              <h1 className="m-0 font-heading text-[36px] leading-[1.08] font-medium sm:text-[48px]">{p.name}</h1>
              <Price amount={p.price_rwf} className="text-[32px]" />
              <div className={`flex items-center gap-2 text-sm font-medium ${line.color}`}>
                <span className={`size-2 rounded-full ${line.dot}`} />
                {line.text}
              </div>
            </div>
            {p.summary && <p className="m-0 text-base leading-[1.7] text-[#3C4A42]">{p.summary}</p>}

            {p.variants.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <div className="text-sm font-semibold">
                  {t.option}: <span className="font-medium text-muted">{variant?.name ?? "—"}</span>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {p.variants.map((v) => {
                    const out = v.availability === "out_of_stock";
                    const label = out ? t.optionOut(v.name) : v.name;
                    return v.swatch_hex ? (
                      <button
                        key={v.id}
                        type="button"
                        aria-label={label}
                        aria-pressed={v.id === variantId}
                        disabled={out}
                        onClick={() => setVariantId(v.id)}
                        className={`size-11 cursor-pointer rounded-full shadow-[inset_0_0_0_3px_#FFFFFF] disabled:cursor-not-allowed disabled:opacity-35 ${
                          v.id === variantId ? "border-[3px] border-ink" : "border border-[#CFC9BC]"
                        }`}
                        style={{ background: v.swatch_hex }}
                      />
                    ) : (
                      <button
                        key={v.id}
                        type="button"
                        aria-pressed={v.id === variantId}
                        disabled={out}
                        onClick={() => setVariantId(v.id)}
                        className={`min-h-11 cursor-pointer rounded-full px-4 text-sm font-semibold disabled:opacity-35 ${
                          v.id === variantId ? "bg-ink text-white" : "border border-line bg-white"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Stepper
                value={qty}
                onChange={(n) => setQty(Math.max(1, n))}
                decreaseLabel={t.decrease}
                increaseLabel={t.increase}
              />
              <button
                type="button"
                disabled={!canAdd}
                onClick={add}
                className="min-h-14 flex-[1_1_200px] cursor-pointer rounded-full bg-ink text-base font-semibold text-white disabled:cursor-default disabled:opacity-50"
              >
                {availability === "out_of_stock" ? t.outOfStock : needsVariant ? t.chooseFirst : added ? t.addAgain : t.add}
              </button>
            </div>
            <button
              type="button"
              disabled={!canAdd}
              onClick={() => {
                add();
                navigate("/checkout");
              }}
              className="min-h-14 cursor-pointer rounded-full border-[1.5px] border-ink text-base font-semibold disabled:cursor-default disabled:opacity-50"
            >
              {t.buyNow}
            </button>
            {added && (
              <p role="status" className="m-0 rounded-2xl bg-sage px-4 py-3 text-sm">
                {t.added(added, variant ? `${p.name} (${variant.name})` : p.name)}
              </p>
            )}

            <div className="flex flex-col gap-3.5 rounded-3xl bg-white p-5">
              <InfoRow icon={<icons.pin size={18} />} tint="bg-sage" title={t.pickupTitle} text={t.pickupText} />
              <InfoRow
                icon={<icons.phone size={18} />}
                tint="bg-blush"
                title={t.bulkTitle}
                text={
                  <>
                    {t.call}{" "}
                    <a href={strings.shop.phoneHref} className="font-semibold underline">
                      {strings.shop.phone}
                    </a>{" "}
                    {t.bulkText}
                  </>
                }
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pb-[72px] sm:px-6">
        <div role="tablist" aria-label={t.tabsLabel} className="mb-7 flex flex-wrap gap-2 border-b border-[#E4E0D6]">
          {(["desc", "specs", "pickup"] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px min-h-12 cursor-pointer border-b-2 px-[18px] text-[15px] font-semibold ${
                tab === id ? "border-ink text-ink" : "border-transparent text-muted"
              }`}
            >
              {t.tabs[id]}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="max-w-[760px]">
          {tab === "desc" &&
            p.description.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="mt-0 mb-4 text-base leading-[1.75] text-[#3C4A42]">
                {para}
              </p>
            ))}
          {tab === "specs" &&
            (p.specs.length ? (
              <dl className="m-0 grid grid-cols-2 overflow-hidden rounded-card-sm bg-white">
                {p.specs.map((s, i) => (
                  <div key={s.label} className="contents">
                    <dt className={`px-5 py-4 text-sm text-muted ${i < p.specs.length - 1 ? "border-b border-[#F0EDE6]" : ""}`}>
                      {s.label}
                    </dt>
                    <dd className={`m-0 px-5 py-4 text-[15px] font-medium ${i < p.specs.length - 1 ? "border-b border-[#F0EDE6]" : ""}`}>
                      {s.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted">{t.noSpecs}</p>
            ))}
          {tab === "pickup" && (
            <div className="flex flex-col gap-3 text-base leading-[1.7] text-[#3C4A42]">
              <p className="m-0">{t.pickupInfo}</p>
              <p className="m-0">{settings.data?.returns_policy ?? t.returnsFallback}</p>
            </div>
          )}
        </div>
      </section>

      {p.related.length > 0 && (
        <section className="mx-auto max-w-[1240px] px-4 pb-20 sm:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <h2 className="m-0 font-heading text-[32px] font-medium sm:text-[40px]">{t.alsoNeed}</h2>
            <Link to="/shop" className="py-3 text-[15px] font-semibold underline">
              {t.viewAll}
            </Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-5">
            {p.related.map((r) => (
              <Link key={r.id} to={`/shop/${r.slug}`} className="flex flex-col gap-3 rounded-[28px] bg-white p-2.5 no-underline">
                <ProductArt image={r.image} tint={r.category.tint} categorySlug={r.category.slug} className="h-[180px] rounded-[22px]" iconSize={56} />
                <span className="flex flex-col gap-1 px-2 pb-2">
                  <span className="text-base font-semibold">{r.name}</span>
                  <Price amount={r.price_rwf} className="text-[19px]" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <BagBar />
    </>
  );
}

function InfoRow({ icon, tint, title, text }: { icon: React.ReactNode; tint: string; title: string; text: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3.5">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tint}`}>{icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-sm text-muted">{text}</span>
      </span>
    </div>
  );
}
