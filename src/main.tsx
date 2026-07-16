import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ensureI18nReady } from "./i18n/config";
import { hydrateDurableUiState } from "./lib/durableUiState";

// Reconcile durable UI state (Quick Commands, Child Connection Tabs, Notes,
// favorites, …) between the SQLite source of truth and the synchronous cache
// before the first render, so synchronous read sites see restored data.
Promise.all([ensureI18nReady(), hydrateDurableUiState()]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
