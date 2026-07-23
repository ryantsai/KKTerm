import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ensureI18nReady } from "./i18n/config";
import { hydrateDurableUiState } from "./lib/durableUiState";
import {
  parseRemoteFullscreenRoute,
  RemoteFullscreenApp,
} from "./modules/workspace/connections/remote-desktop/RemoteFullscreenApp";

// A detached RDP/VNC full-screen window loads the same bundle with a
// `#/remote-fullscreen/...` route. It attaches to the live Session by id and
// renders only that surface — no Connection Tree, durable state, or app shell.
const fullscreenRoute = parseRemoteFullscreenRoute(window.location.hash);

// Reconcile durable UI state (Quick Commands, Child Connection Tabs, Notes,
// favorites, …) between the SQLite source of truth and the synchronous cache
// before the first render, so synchronous read sites see restored data. The
// full-screen host does not read durable UI state, so it skips hydration.
Promise.all([
  ensureI18nReady(),
  fullscreenRoute ? Promise.resolve() : hydrateDurableUiState(),
]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {fullscreenRoute ? <RemoteFullscreenApp route={fullscreenRoute} /> : <App />}
    </React.StrictMode>,
  );
});
