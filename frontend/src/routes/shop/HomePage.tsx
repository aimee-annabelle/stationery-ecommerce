// Home (design/00-Home.dc.html, option D "Paper Studio Editorial").

import { Link } from "react-router-dom";
import { icons } from "../../components/icons";
import { strings } from "../../strings";
import { categoryIcon, ProductGrid, TINT_BG } from "./parts";
import { useCategories, useProducts } from "./shopApi";

const t = strings.shop.home;

export function HomePage() {
  const categories = useCategories();
  const featured = useProducts({ sort: "featured", page_size: 8 });

  return (
    <>
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-[0.18em] left-1/2 -translate-x-1/2 font-heading text-[clamp(80px,17vw,250px)] leading-none font-semibold tracking-[0.02em] whitespace-nowrap text-ink/6"
        >
          STATIONERY
        </div>
        <div className="relative mx-auto flex max-w-[1240px] flex-wrap items-center gap-12 px-4 pt-10 pb-[120px] sm:px-6">
          <div className="flex flex-[1_1_480px] flex-col gap-7">
            <span className="flex items-center gap-2 self-start rounded-full bg-white py-2 pr-4 pl-2 text-sm font-medium">
              <span className="flex size-[26px] items-center justify-center rounded-full bg-sage">
                <icons.pin size={14} />
              </span>
              {t.badge}
            </span>
            <h1 className="m-0 font-heading text-[44px] leading-[1.02] font-medium tracking-[-0.02em] sm:text-[60px] lg:text-[76px]">
              {t.titleStart} <em className="text-terracotta italic">{t.titleAccent}</em>
              {t.titleEnd}
            </h1>
            <p className="m-0 max-w-[470px] text-lg leading-[1.65] text-muted">{t.intro}</p>
            <div className="flex flex-wrap items-center gap-3.5">
              <Link
                to="/shop"
                className="flex min-h-14 items-center gap-4 rounded-full bg-ink py-1.5 pr-1.5 pl-[26px] text-base font-semibold text-white no-underline"
              >
                {t.explore}
                <span className="flex size-11 items-center justify-center rounded-full bg-sage text-ink">
                  <icons.arrowRight size={18} />
                </span>
              </Link>
              <Link to="/services" className="border-b-[1.5px] border-ink px-1 py-3.5 text-base font-semibold no-underline">
                {t.services}
              </Link>
            </div>
          </div>
          <div className="relative min-h-[420px] flex-[1_1_420px] sm:min-h-[500px]">
            <div className="absolute inset-y-0 right-6 left-6 flex items-center justify-center rounded-[999px_999px_40px_40px] bg-sage text-ink sm:right-10 sm:left-10">
              <icons.note size={200} />
            </div>
            <div className="absolute top-14 right-0 flex items-center gap-3 rounded-[22px] bg-blush px-[18px] py-4 shadow-[0_10px_30px_rgba(34,48,42,0.10)]">
              <icons.headphones size={24} />
              <span className="flex flex-col">
                <span className="text-[13px] text-muted">{t.alsoInStore}</span>
                <span className="text-[15px] font-semibold">{t.electronics}</span>
              </span>
            </div>
            <Link
              to="/services"
              className="absolute bottom-10 left-0 flex max-w-[270px] items-center gap-3.5 rounded-[22px] bg-white px-5 py-[18px] no-underline shadow-[0_10px_30px_rgba(34,48,42,0.10)]"
            >
              <span className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-lilac">
                <icons.book size={20} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{t.madeToOrder}</span>
                <span className="text-[13px] text-muted">{t.madeInTumba}</span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pt-20 pb-6 sm:px-6">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <h2 className="m-0 font-heading text-[34px] font-medium sm:text-[44px]">{t.byCategory}</h2>
          <Link to="/shop" className="py-3 text-[15px] font-semibold underline">
            {t.viewEverything}
          </Link>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-[18px]">
          {categories.data?.map((c) => {
            const Icon = categoryIcon(c.slug);
            return (
              <Link
                key={c.id}
                to={`/shop?category=${c.slug}`}
                className={`flex min-h-[230px] flex-col justify-between rounded-card p-[26px] text-ink no-underline ${TINT_BG[c.tint]}`}
              >
                <span className="flex items-start justify-between">
                  <span className="flex size-[62px] items-center justify-center rounded-full bg-white">
                    <Icon size={28} />
                  </span>
                  <icons.arrowUpRight size={22} />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-heading text-[26px] font-semibold">{c.name}</span>
                  <span className="text-sm text-[#3C4A42]">{t.productCount(c.product_count)}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pt-[72px] pb-24 sm:px-6">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <h2 className="m-0 font-heading text-[38px] font-medium sm:text-[52px]">{t.featured}</h2>
          <Link to="/shop" className="py-3 text-[15px] font-semibold underline">
            {t.viewAll}
          </Link>
        </div>
        <ProductGrid products={featured.data?.items ?? []} min={260} />
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pb-24 sm:px-6">
        <div className="flex flex-col gap-11 rounded-[44px] bg-ink px-6 py-12 text-white sm:px-14 sm:py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="m-0 max-w-[600px] font-heading text-[38px] leading-[1.05] font-medium sm:text-[54px]">
              {t.madeTitle} <em className="text-sage">{t.madeAccent}</em>
            </h2>
            <p className="m-0 max-w-[380px] text-[17px] leading-relaxed text-[#CFDCD3]">{t.madeIntro}</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-5">
            <ServiceCard tint="bg-blush" icon={<icons.mail size={34} />} title={t.invitations} text={t.invitationsText} />
            <ServiceCard tint="bg-sage" icon={<icons.book size={34} />} title={t.binding} text={t.bindingText} />
            <div className="flex flex-col gap-5 rounded-card bg-white/7 p-8">
              <div className="text-sm font-semibold text-[#CFDCD3]">{t.howItWorks}</div>
              {t.steps.map((step, i) => (
                <div key={step} className="flex items-baseline gap-4">
                  <span className="font-heading text-[32px] text-sage italic">{i + 1}</span>
                  <span className="text-base leading-normal">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function ServiceCard({ tint, icon, title, text }: { tint: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className={`flex flex-col gap-3.5 rounded-card p-8 text-ink ${tint}`}>
      {icon}
      <h3 className="m-0 font-heading text-[30px] font-semibold">{title}</h3>
      <p className="m-0 text-[15px] leading-relaxed">{text}</p>
      <Link
        to="/services"
        className="flex min-h-12 items-center self-start rounded-full bg-ink px-[22px] text-[15px] font-semibold text-white no-underline"
      >
        {strings.shop.home.startOrder}
      </Link>
    </div>
  );
}
