// Category management. Not designed yet (HANDOFF.md), so it follows the S4 styles.

import { useState } from "react";
import { Link } from "react-router-dom";
import { icons } from "../../../components/icons";
import { strings } from "../../../strings";
import {
  type StaffCategory,
  type Tint,
  tintVar,
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "./catalogApi";
import { errorText } from "./parts";

const t = strings.categories;
const TINTS: Tint[] = ["butter", "lilac", "blush", "sage"];

export function CategoriesPage() {
  const categories = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const [name, setName] = useState("");
  const [tint, setTint] = useState<Tint>("butter");

  const list = categories.data ?? [];
  const error = create.error || update.error || remove.error;

  // Swap sort_order with the neighbour. Two saves, so give each a distinct value first.
  const move = (index: number, direction: -1 | 1) => {
    const a = list[index];
    const b = list[index + direction];
    if (!a || !b) return;
    update.mutate({ id: a.id, sort_order: index + direction + 1 });
    update.mutate({ id: b.id, sort_order: index + 1 });
  };

  return (
    <>
      <Link className="btn btn-quiet btn-small" to="/staff/products" style={{ alignSelf: "flex-start" }}>
        <icons.back size={16} />
        {t.back}
      </Link>
      <div className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>

      <div className="table-card">
        <table className="table" style={{ minWidth: 520 }}>
          <tbody>
            {list.map((c, i) => (
              <CategoryRow
                key={c.id}
                category={c}
                first={i === 0}
                last={i === list.length - 1}
                onMove={(d) => move(i, d)}
                onSave={(changes) => update.mutate({ id: c.id, ...changes })}
                onRemove={() => window.confirm(t.confirmRemove(c.name)) && remove.mutate(c.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name, tint }, { onSuccess: () => setName("") });
        }}
      >
        <h2>{t.add}</h2>
        <div className="form-row">
          <label className="field" style={{ flex: "2 1 220px" }}>
            {t.name}
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </label>
          <TintPicker value={tint} onChange={setTint} />
          <button className="btn btn-primary" type="submit" disabled={create.isPending}>
            {t.add}
          </button>
        </div>
      </form>
      {error && <p role="alert" className="form-error">{errorText(error)}</p>}
    </>
  );
}

function TintPicker({ value, onChange }: { value: Tint; onChange: (tint: Tint) => void }) {
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ marginBottom: 6 }}>{t.colour}</legend>
      <div style={{ display: "flex", gap: 6 }}>
        {TINTS.map((tint) => (
          <button
            key={tint}
            type="button"
            aria-label={t.tints[tint]}
            aria-pressed={value === tint}
            onClick={() => onChange(tint)}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              cursor: "pointer",
              background: tintVar(tint),
              border: value === tint ? "3px solid var(--ink)" : "1px solid #CFC9BC",
              boxShadow: "inset 0 0 0 3px #FFFFFF",
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function CategoryRow({
  category: c,
  first,
  last,
  onMove,
  onSave,
  onRemove,
}: {
  category: StaffCategory;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onSave: (changes: { name?: string; tint?: Tint }) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(c.name);
  return (
    <tr>
      <td style={{ width: 56 }}>
        <span className="thumb" style={{ display: "block", background: tintVar(c.tint) }} />
      </td>
      <td>
        <label className="field">
          <span className="visually-hidden">{t.name}</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <span className="product-sku">{t.products(c.product_count)}</span>
      </td>
      <td>
        <TintPicker value={c.tint} onChange={(tint) => onSave({ tint })} />
      </td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <button className="btn btn-quiet btn-small" type="button" aria-label={t.moveUp(c.name)} disabled={first} onClick={() => onMove(-1)}>
          ↑
        </button>{" "}
        <button className="btn btn-quiet btn-small" type="button" aria-label={t.moveDown(c.name)} disabled={last} onClick={() => onMove(1)}>
          ↓
        </button>{" "}
        <button className="btn btn-quiet btn-small" type="button" disabled={name.trim() === c.name} onClick={() => onSave({ name })}>
          {t.save}
        </button>{" "}
        {c.product_count === 0 && (
          <button className="btn btn-danger btn-small" type="button" onClick={onRemove}>
            {t.remove}
          </button>
        )}
      </td>
    </tr>
  );
}
