// "Add product" panel from S4. Photos picked here upload once the product is saved.

import { useState } from "react";
import { icons } from "../../../components/icons";
import { useStaffSession } from "../../../lib/staffSession";
import { strings } from "../../../strings";
import { usePublicSettings } from "../../shop/shopApi";
import { type ProductInput, useAddPhoto, useCreateProduct } from "./catalogApi";
import { CategorySelect, errorText, toInt } from "./parts";

const f = strings.products.form;

export function AddProductPanel({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: string) => void }) {
  const { can } = useStaffSession();
  const create = useCreateProduct();
  const addPhoto = useAddPhoto();
  const settings = usePublicSettings();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    category_id: "",
    price: "",
    cost: "",
    opening: "",
    alert: "",
    sku: "",
    location: "",
    description: "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const save = async (isVisible: boolean) => {
    const price = toInt(form.price);
    if (!form.name.trim() || !form.category_id || price === null || !form.sku.trim()) {
      setError(f.required);
      return;
    }
    setError(null);
    const body: ProductInput = {
      name: form.name,
      category_id: form.category_id,
      price_rwf: price,
      cost_rwf: toInt(form.cost),
      sku: form.sku,
      opening_stock: toInt(form.opening) ?? 0,
      // Empty means the S8 default.
      low_stock_alert: toInt(form.alert) ?? settings.data?.default_low_stock_alert ?? 0,
      description: form.description,
      location: form.location || null,
      is_visible: isVisible,
    };
    try {
      const product = await create.mutateAsync(body);
      for (const file of files) await addPhoto.mutateAsync({ productId: product.id, file });
      onCreated?.(product.id);
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const busy = create.isPending || addPhoto.isPending;

  return (
    <form className="panel" onSubmit={(e) => e.preventDefault()}>
      <div className="panel-head">
        <h2>{f.addTitle}</h2>
        <button className="icon-btn" type="button" aria-label={f.close} onClick={onClose}>
          <icons.close size={14} />
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <label className="photo-drop">
          <icons.photo size={28} />
          {files.length ? `${files.length} × ${f.photos.toLowerCase()}` : f.photos}
          <span className="field-hint">{f.photosHint}</span>
          <input
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        <div className="form-grid">
          <label className="field field-wide">
            {f.name}
            <input type="text" placeholder={f.namePlaceholder} value={form.name} onChange={set("name")} required />
          </label>
          <label className="field">
            {f.category}
            <CategorySelect value={form.category_id} onChange={(id) => setForm({ ...form, category_id: id })} />
          </label>
          <label className="field">
            {f.price}
            <input type="number" min={0} inputMode="numeric" value={form.price} onChange={set("price")} required />
          </label>
          <label className="field">
            {f.cost}
            <input type="number" min={0} inputMode="numeric" value={form.cost} onChange={set("cost")} />
          </label>
          {can("stock.manage") && (
            <label className="field">
              {f.openingStock}
              <input type="number" min={0} inputMode="numeric" value={form.opening} onChange={set("opening")} />
            </label>
          )}
          <label className="field">
            {f.alert}
            <input type="number" min={0} inputMode="numeric" placeholder={settings.data ? String(settings.data.default_low_stock_alert) : f.alertPlaceholder} value={form.alert} onChange={set("alert")} />
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
            <textarea rows={2} value={form.description} onChange={set("description")} />
          </label>
        </div>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => save(false)}>
          {f.saveDraft}
        </button>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => save(true)}>
          {f.publish}
        </button>
      </div>
    </form>
  );
}
