import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { CustomerSessionProvider } from "./lib/customerSession";
import { router } from "./router";
import "./styles/tokens.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <CustomerSessionProvider>
        <RouterProvider router={router} />
      </CustomerSessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
