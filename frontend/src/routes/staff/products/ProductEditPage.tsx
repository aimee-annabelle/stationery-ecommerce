// Full product edit page. Not designed yet (HANDOFF.md), so it is built from the S4 panel styles.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { icons } from "../../../components/icons";
import { useStaffSession } from "../../../lib/staffSession";
import { strings } from "../../../strings";
import {
  type Product,
  type Spec,
  useAddPhoto,
  useAddVariant,
  useAdjustStock,
  useProduct,
  useRemovePhoto,
  useRemoveVariant,
  useReorderPhotos,
  useUpdateProduct,
} from "./catalogApi";
import { CategorySelect, errorText, MovementsTable, ReceivePanel, StockBar, toInt } from "./parts";
import { Select } from "../../../components/Select";

const t = strings.products;

export function ProductEditPage() {
  const { productId = "" } = useParams();
  const product = useProduct(productId);
  const { can } = useStaffSession();

  if (product.error) return <p role="alert" className="form-error">{errorText(product.error)}</p>;
  if (!product.data) return <p>{strings.staff.loading}</p>;
  const p = product.data;

  return (
    <>
      <Link className="btn btn-quiet btn-small" to="/staff/products" style={{ alignSelf: "flex-start" }}>
        <icons.back size={16} />
        {t.detail.back}
      </Link>
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <p>
            {p.sku} · {p.category.name}
          </p>
        </div>
        <div style={{ minWidth: 220 }}>
          <StockBar product={p} />
        </div>
      </div>

      {p.low_stock_flag && (
        <div role="status" className="note note-error">
          {t.detail.flaggedBy(p.low_stock_flag.flagged_by)}
        </div>
      )}

      <DetailsForm product={p} />
      <PhotosCard product={p} />
      <VariantsCard product={p} />
      {can("stock.manage") && (
        <>
          <ReceivePanel fixedProduct={p} />
          <AdjustPanel product={p} />
        </>
      )}
      <h2 style={{ margin: "8px 4px 0", fontSize: 22 }}>{t.detail.history}</h2>
      <MovementsTable productId={p.id} showCost={can("costs.view")} />
    </>
  );
}

function DetailsForm({ product: p }: { product: Product }) {
  const f = t.form;
  const update = useUpdateProduct();
  const initial = () => ({
    name: p.name,
    category_id: p.category.id,
    price: String(p.price_rwf),
    cost: p.cost_rwf != null ? String(p.cost_rwf) : "",
    alert: String(p.low_stock_alert),
    sku: p.sku,
    location: p.location ?? "",
    description: p.description,
    is_visible: p.is_visible,
    is_featured: p.is_featured,
    specs: p.specs,
  });
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reset when the product changes elsewhere (for example the in-shop switch).
  useEffect(() => setForm(initial()), [p]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm({ ...form, [key]: e.target.value });
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const price = toInt(form.price);
    if (!form.name.trim() || price === null || !form.sku.trim()) {
      setError(f.required);
      return;
    }
    setError(null);
    update.mutate(
      {
        id: p.id,
        name: form.name,
        category_id: form.category_id,
        price_rwf: price,
        ...(p.cost_rwf !== undefined ? { cost_rwf: toInt(form.cost) } : {}),
        low_stock_alert: toInt(form.alert) ?? 0,
        sku: form.sku,
        location: form.location || null,
        description: form.description,
        is_visible: form.is_visible,
        is_featured: form.is_featured,
        specs: form.specs.filter((spec) => spec.label.trim() && spec.value.trim()),
      },
      { onSuccess: () => setSaved(true), onError: (err) => setError(errorText(err)) },
    );
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>{f.editTitle}</h2>
      <div className="form-grid">
        <label className="field field-wide">
          {f.name}
          <input type="text" value={form.name} onChange={set("name")} required />
        </label>
        <label className="field">
          {f.category}
          <CategorySelect value={form.category_id} onChange={(id) => setForm({ ...form, category_id: id })} />
        </label>
        <label className="field">
          {f.price}
          <input type="number" min={0} inputMode="numeric" value={form.price} onChange={set("price")} required />
        </label>
        {p.cost_rwf !== undefined && (
          <label className="field">
            {f.cost}
            <input type="number" min={0} inputMode="numeric" value={form.cost} onChange={set("cost")} />
          </label>
        )}
        <label className="field">
          {f.alert}
          <input type="number" min={0} inputMode="numeric" value={form.alert} onChange={set("alert")} />
        </label>
        <label className="field">
          {f.sku}
          <input type="text" value={form.sku} onChange={set("sku")} required />
        </label>
        <label className="field">
          {f.location}
          <input type="text" placeholder={f.locationPlaceholder} value={form.location} onChange={set("location")} />
        </label>
        <label className="field field-wide">
          {f.description}
          <textarea rows={3} value={form.description} onChange={set("description")} />
          <span className="field-hint">{f.summaryHint}</span>
        </label>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <button
            className="switch"
            type="button"
            role="switch"
            aria-checked={form.is_visible}
            aria-label={f.inShop}
            onClick={() => {
              setSaved(false);
              setForm({ ...form, is_visible: !form.is_visible });
            }}
          >
            <span />
          </button>
          {f.inShop}
        </label>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <button
            className="switch"
            type="button"
            role="switch"
            aria-checked={form.is_featured}
            aria-label={f.featured}
            onClick={() => {
              setSaved(false);
              setForm({ ...form, is_featured: !form.is_featured });
            }}
          >
            <span />
          </button>
          {f.featured}
        </label>
      </div>
      <SpecsEditor
        specs={form.specs}
        onChange={(specs) => {
          setSaved(false);
          setForm({ ...form, specs });
        }}
      />
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions">
        {saved && <span role="status" className="note note-sage" style={{ padding: "10px 14px" }}>{f.saved}</span>}
        <button className="btn btn-primary" type="submit" disabled={update.isPending}>
          {f.save}
        </button>
      </div>
    </form>
  );
}

/** Label/value lines for the product page "Details" tab. */
function SpecsEditor({ specs, onChange }: { specs: Spec[]; onChange: (specs: Spec[]) => void }) {
  const f = t.form;
  const update = (i: number, key: keyof Spec, value: string) =>
    onChange(specs.map((spec, n) => (n === i ? { ...spec, [key]: value } : spec)));
  const input = "min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 text-[15px] font-medium";
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
      <legend className="text-[13px] font-semibold">{f.specsTitle}</legend>
      <p className="m-0 text-xs text-muted">{f.specsIntro}</p>
      {specs.map((spec, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2.5">
          <label className="min-w-[140px] flex-1">
            <span className="sr-only">{f.specLabel}</span>
            <input className={input} placeholder={f.specLabel} value={spec.label} maxLength={40} onChange={(e) => update(i, "label", e.target.value)} />
          </label>
          <label className="min-w-[180px] flex-[2]">
            <span className="sr-only">{f.specValue}</span>
            <input className={input} placeholder={f.specValue} value={spec.value} maxLength={120} onChange={(e) => update(i, "value", e.target.value)} />
          </label>
          <button
            type="button"
            aria-label={f.removeSpec(i + 1)}
            onClick={() => onChange(specs.filter((_, n) => n !== i))}
            className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-paper-staff"
          >
            <icons.close size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...specs, { label: "", value: "" }])}
        className="min-h-11 cursor-pointer self-start rounded-full border border-line bg-white px-4 text-[13px] font-semibold"
      >
        {f.addSpec}
      </button>
    </fieldset>
  );
}

function PhotosCard({ product: p }: { product: Product }) {
  const ph = t.photos;
  const add = useAddPhoto();
  const remove = useRemovePhoto();
  const reorder = useReorderPhotos();
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    setError(null);
    for (const file of Array.from(files ?? [])) {
      try {
        await add.mutateAsync({ productId: p.id, file });
      } catch (err) {
        setError(`${file.name}: ${errorText(err)}`);
      }
    }
  };

  const makeCover = (imageId: string) =>
    reorder.mutate({ productId: p.id, imageIds: [imageId, ...p.images.map((i) => i.id).filter((id) => id !== imageId)] });

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h2>{ph.title}</h2>
        <p className="field-hint" style={{ margin: "4px 0 0" }}>{ph.intro}</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {p.images.map((image, i) => (
          <figure key={image.id} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6, width: 140 }}>
            <img src={image.url} alt="" style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 20 }} />
            <div style={{ display: "flex", gap: 6 }}>
              {i === 0 ? (
                <span className="note note-sage" style={{ padding: "6px 10px", fontSize: 12, flex: 1 }}>{ph.cover}</span>
              ) : (
                <button className="btn btn-quiet btn-small" style={{ flex: 1 }} type="button" aria-label={ph.moveFirst(i + 1)} onClick={() => makeCover(image.id)}>
                  {ph.cover}
                </button>
              )}
              <button
                className="icon-btn"
                type="button"
                aria-label={ph.remove(i + 1)}
                onClick={() => remove.mutate({ productId: p.id, imageId: image.id })}
              >
                <icons.close size={14} />
              </button>
            </div>
          </figure>
        ))}
        <label className="photo-drop" style={{ flex: "0 0 140px", height: 140 }}>
          <icons.photo size={28} />
          {add.isPending ? ph.uploading : ph.add}
          <input className="visually-hidden" type="file" accept="image/jpeg,image/png" multiple onChange={(e) => onFiles(e.target.files)} />
        </label>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
    </section>
  );
}

function VariantsCard({ product: p }: { product: Product }) {
  const v = t.variants;
  const add = useAddVariant();
  const remove = useRemoveVariant();
  const [name, setName] = useState("");
  const [swatch, setSwatch] = useState("#DCE8DF");

  const onAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    add.mutate({ productId: p.id, name, swatch_hex: swatch.toUpperCase() }, { onSuccess: () => setName("") });
  };

  return (
    <form className="card" onSubmit={onAdd} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h2>{v.title}</h2>
        <p className="field-hint" style={{ margin: "4px 0 0" }}>{v.intro}</p>
      </div>
      {p.variants.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {p.variants.map((variant) => (
            <li key={variant.id} className="note" style={{ background: "var(--paper)", padding: "6px 6px 6px 14px" }}>
              {variant.swatch_hex && (
                <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", background: variant.swatch_hex, border: "1px solid #CFC9BC" }} />
              )}
              <strong>{variant.name}</strong>
              <span className="field-hint">{v.stock(variant.stock_qty)}</span>
              <button
                className="icon-btn"
                type="button"
                aria-label={v.remove(variant.name)}
                onClick={() => remove.mutate({ productId: p.id, variantId: variant.id })}
              >
                <icons.close size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="form-row">
        <label className="field" style={{ flex: "2 1 200px" }}>
          {v.name}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field" style={{ flex: "0 0 90px" }}>
          {v.swatch}
          <input type="color" value={swatch} onChange={(e) => setSwatch(e.target.value)} style={{ padding: 4 }} />
        </label>
        <button className="btn btn-outline" type="submit" disabled={add.isPending}>
          {v.add}
        </button>
      </div>
      {(add.error || remove.error) && <p role="alert" className="form-error">{errorText(add.error || remove.error)}</p>}
    </form>
  );
}

function AdjustPanel({ product: p }: { product: Product }) {
  const a = t.adjustForm;
  const adjust = useAdjustStock();
  const [change, setChange] = useState("");
  const [reason, setReason] = useState<"adjusted" | "damaged" | "returned">("adjusted");
  const [variantId, setVariantId] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const amount = toInt(change);
    if (!amount) return;
    adjust.mutate(
      { product_id: p.id, variant_id: variantId || undefined, change_qty: amount, reason, note },
      {
        onSuccess: () => {
          setDone(true);
          setChange("");
          setNote("");
        },
      },
    );
  };

  return (
    <form className="panel" onSubmit={onSubmit} style={{ borderColor: "var(--terracotta)" }}>
      <div>
        <h2>{a.title}</h2>
        <p className="field-hint" style={{ margin: "4px 0 0" }}>{a.intro}</p>
      </div>
      <div className="form-row">
        {p.variants.length > 0 && (
          <label className="field" style={{ flex: "1 1 160px" }}>
            {t.receiveForm.option}
            <Select
              value={variantId}
              onChange={setVariantId}
              required
              placeholder={t.receiveForm.chooseOption}
              options={p.variants.map((variant) => ({ value: variant.id, label: variant.name }))}
            />
          </label>
        )}
        <label className="field" style={{ flex: "1 1 120px" }}>
          {a.change}
          <input type="number" inputMode="numeric" value={change} onChange={(e) => { setDone(false); setChange(e.target.value); }} required />
        </label>
        <label className="field" style={{ flex: "1 1 160px" }}>
          {a.reason}
          <Select
            value={reason}
            onChange={(v) => setReason(v as typeof reason)}
            options={(Object.keys(a.reasons) as (keyof typeof a.reasons)[]).map((key) => ({ value: key, label: a.reasons[key] }))}
          />
        </label>
        <label className="field" style={{ flex: "2 1 240px" }}>
          {a.note}
          <input type="text" placeholder={a.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} required />
        </label>
        <button className="btn btn-primary" type="submit" disabled={adjust.isPending}>
          {a.submit}
        </button>
      </div>
      {adjust.error && <p role="alert" className="form-error">{errorText(adjust.error)}</p>}
      {done && !adjust.error && <p role="status" className="note note-sage">{a.done}</p>}
    </form>
  );
}
