import { useState } from "react";

/** Page number for a list that goes back to page 1 whenever `key` (its filters and search) changes. */
export function usePage(key: string): [number, (page: number) => void] {
  const [state, setState] = useState({ key, page: 1 });
  return [state.key === key ? state.page : 1, (page) => setState({ key, page })];
}
