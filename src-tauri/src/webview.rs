//! Embedded URL-browser backend.
//!
//! URL Connections use stable top-level `WebviewWindow`s instead of Tauri's
//! `unstable` child-webview API. Each browser window is borderless, owned by
//! the main window, skipped from the taskbar, and positioned over the URL Pane's
//! DOM rect. This keeps wry's normal window-content WebView2 focus path for the
//! main terminal webview while still giving URL Connections a real WebView2.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
};

use crate::logging;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent},
};

const HOST_WINDOW_LABEL: &str = "main";
const DEFAULT_PARTITION: &str = "shared";
const HIDDEN_WEBVIEW_POSITION: f64 = -32_000.0;
#[cfg(target_os = "windows")]
const WEBVIEW_HWND_REALIZE_RETRY_DELAYS_MS: &[u64] = &[15, 30, 60, 120, 240, 480, 960];

/// WebView2 browser arguments that keep the renderer alive across RDP session
/// disconnect/reconnect. Passed to the main window and URL overlay windows when
/// the Settings RDP stability option is active; all WebView2 surfaces in one
/// process must agree on these args.
#[cfg(target_os = "windows")]
pub(crate) const REMOTE_SESSION_WEBVIEW2_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-gpu";

/// Wry's default WebView2 additional browser arguments. Supplying explicit
/// arguments makes wry stop generating these, so they are re-included whenever we
/// must inject our own proxy directive (e.g. "No Proxy" → `--no-proxy-server`).
#[cfg(windows)]
pub(crate) const WRY_DEFAULT_WEBVIEW2_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Prevent the browser engine's F5 accelerator from reloading the main app
/// shell. A shell reload destroys frontend-owned live Session chrome while
/// native URL overlay windows can remain alive. URL overlays intentionally do
/// not install this guard, so F5 reloads the page when its surface has focus.
pub(crate) const SUPPRESS_SHELL_F5_RELOAD_SCRIPT: &str = r#"
window.addEventListener("keydown", (event) => {
  if (event.key === "F5") {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
"#;

const AUTOFILL_AGENT: &str = r#"
(() => {
  const TITLE_CHANNEL = "__KKTERM_URL_CREDENTIAL__";

  function publish(payload) {
    const previousTitle = document.title;
    document.title = `${TITLE_CHANNEL}${JSON.stringify(payload)}`;
    window.setTimeout(() => {
      if (document.title.startsWith(TITLE_CHANNEL)) {
        document.title = previousTitle;
      }
    }, 150);
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function usableInput(input) {
    return input instanceof HTMLInputElement && !input.disabled && !input.readOnly && input.type !== "hidden" && isVisible(input);
  }

  function usableText(input) {
    if (input instanceof HTMLTextAreaElement) return !input.disabled && !input.readOnly && isVisible(input);
    if (!usableInput(input)) return false;
    return ["", "text", "email", "tel", "search", "url", "number"].includes((input.getAttribute("type") || "text").toLowerCase());
  }

  function usableSelect(select) {
    return select instanceof HTMLSelectElement && !select.disabled && isVisible(select);
  }

  function usableToggle(input) {
    if (!usableInput(input)) return false;
    const type = (input.getAttribute("type") || "").toLowerCase();
    return type === "checkbox" || type === "radio";
  }

  function queryInput(selector) {
    if (!selector) return undefined;
    try {
      const input = document.querySelector(selector);
      return usableText(input) || usableInput(input) ? input : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function passwordInput(requireValue) {
    return Array.from(document.querySelectorAll("input[type='password']"))
      .filter(usableInput)
      .filter((input) => !requireValue || input.value)
      .sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height))[0];
  }

  function textCandidates(root) {
    return Array.from((root || document).querySelectorAll("input, textarea")).filter(usableText);
  }

  function usernameInput(password) {
    const root = password?.form || password?.closest?.("form") || document;
    const candidates = textCandidates(root).filter((input) => input !== password);
    if (!candidates.length) return undefined;
    return candidates
      .map((input, index) => {
        const label = [input.name, input.id, input.autocomplete, input.getAttribute("aria-label"), input.placeholder].filter(Boolean).join(" ").toLowerCase();
        let score = index;
        if (input.value) score += 40;
        if (/user|email|login|account|name/.test(label)) score += 100;
        if (/one-time|otp|code|search/.test(label)) score -= 100;
        return { input, score };
      })
      .sort((a, b) => b.score - a.score)[0].input;
  }

  function setInputValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setToggleState(input, checked) {
    if (input.checked === checked) return;
    input.checked = checked;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function selectorFor(input) {
    const tag = input.tagName.toLowerCase();
    for (const attr of ["id", "name", "autocomplete", "aria-label", "placeholder"]) {
      const value = input.getAttribute(attr);
      if (!value) continue;
      const selector = `${tag}[${CSS.escape(attr)}=${JSON.stringify(value)}]`;
      try {
        const matches = Array.from(document.querySelectorAll(selector));
        if (matches.includes(input)) return selector;
      } catch (_) {}
    }
    return tag;
  }

  // A field is identified by a stable selector plus the index of this element
  // among that selector's matches. The index keeps non-unique selectors (such as
  // radio groups sharing a name) targeting the exact element that was captured,
  // as long as the form's DOM order is stable between capture and restore.
  function describeField(input) {
    const selector = selectorFor(input);
    let matches;
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch (_) {
      return undefined;
    }
    const index = matches.indexOf(input);
    if (index < 0) return undefined;
    if (usableToggle(input)) {
      return { selector, index, kind: "checked", checked: input.checked };
    }
    return { selector, index, kind: "value", value: input.value };
  }

  function resolveField(field) {
    if (!field || typeof field.selector !== "string") return undefined;
    let matches;
    try {
      matches = document.querySelectorAll(field.selector);
    } catch (_) {
      return undefined;
    }
    const index = typeof field.index === "number" ? field.index : 0;
    return matches[index] || undefined;
  }

  // Collect every restorable, non-secret field on the page. Password inputs are
  // never collected here: their values stay in the OS keychain, never in the
  // durable field map.
  function collectFields(password) {
    const fields = [];
    for (const element of document.querySelectorAll("input, textarea, select")) {
      if (element === password) continue;
      if (element instanceof HTMLInputElement && (element.getAttribute("type") || "").toLowerCase() === "password") continue;
      if (usableToggle(element)) {
        const described = describeField(element);
        if (described) fields.push(described);
        continue;
      }
      if (usableSelect(element)) {
        const described = describeField(element);
        if (described) fields.push(described);
        continue;
      }
      if (usableText(element) && element.value) {
        const described = describeField(element);
        if (described) fields.push(described);
      }
    }
    return fields;
  }

  function parseFieldValues(raw) {
    if (!raw) return [];
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  window.__KKTERM_URL_AUTOFILL__ = {
    fill(credential) {
      let filled = false;
      const password = queryInput(credential.passwordSelector) || passwordInput(false);
      if (password && credential.password && (!credential.automatic || !password.value)) {
        setInputValue(password, credential.password);
        if (!credential.automatic) password.focus({ preventScroll: true });
        filled = true;
      }
      const fields = parseFieldValues(credential.fieldValues);
      for (const field of fields) {
        const element = resolveField(field);
        if (!element) continue;
        if (field.kind === "checked") {
          // Toggles carry deliberate state, so only the manual restore flips them.
          if (credential.automatic) continue;
          setToggleState(element, Boolean(field.checked));
          filled = true;
        } else {
          if (credential.automatic && element.value) continue;
          setInputValue(element, field.value || "");
          filled = true;
        }
      }
      // Credentials saved before the field map existed only carry a username.
      if (!fields.length && credential.username) {
        const username = queryInput(credential.usernameSelector) || (password ? usernameInput(password) : undefined);
        if (username && (!credential.automatic || !username.value)) {
          setInputValue(username, credential.username);
          filled = true;
        }
      }
      return { filled };
    },
    capture(nonce) {
      const password = passwordInput(true);
      const fields = collectFields(password);
      if (!password && fields.length === 0) {
        publish({ ok: false, nonce, reason: "no-fields", url: window.location.href });
        return;
      }
      const username = usernameInput(password);
      const usernameValue = username?.value || window.location.host || window.location.href;
      publish({
        ok: true,
        nonce,
        url: window.location.href,
        username: usernameValue,
        password: password ? (password.value || "") : undefined,
        usernameSelector: username ? selectorFor(username) : undefined,
        passwordSelector: password ? selectorFor(password) : undefined,
        fieldValues: fields,
      });
    },
  };
})();
"#;

const EXTERNAL_LINK_SHORTCUT_AGENT: &str = r#"
(() => {
  const TITLE_CHANNEL = "__KKTERM_URL_EXTERNAL_LINK__";
  const BRIDGE_TOKEN = __KKTERM_EXTERNAL_LINK_BRIDGE_TOKEN__;

  document.addEventListener("click", (event) => {
    if (!event.shiftKey || event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor) return;
    let url;
    try {
      url = new URL(anchor.getAttribute("href"), window.location.href);
    } catch (_) {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    event.preventDefault();
    event.stopPropagation();
    const previousTitle = document.title;
    document.title = `${TITLE_CHANNEL}${JSON.stringify({ url: url.href, token: BRIDGE_TOKEN })}`;
    window.setTimeout(() => {
      if (document.title.startsWith(TITLE_CHANNEL)) {
        document.title = previousTitle;
      }
    }, 150);
  }, true);
})();
"#;

const CONTEXT_MENU_AGENT: &str = r#"
(() => {
  const TITLE_CHANNEL = "__KKTERM_URL_CONTEXT_MENU__";
  const CAPTURE_TITLE_CHANNEL = "__KKTERM_URL_PAGE_CAPTURE__";
  const MESSAGE_CHANNEL = "__KKTERM_URL_CONTEXT_MENU_MESSAGE__";
  const BRIDGE_TOKEN = __KKTERM_CONTEXT_MENU_BRIDGE_TOKEN__;

  function publish(payload) {
    if (window !== window.top) {
      window.top.postMessage({ channel: MESSAGE_CHANNEL, payload }, "*");
      return;
    }
    const previousTitle = document.title;
    document.title = `${TITLE_CHANNEL}${JSON.stringify(payload)}`;
    window.setTimeout(() => {
      if (document.title.startsWith(TITLE_CHANNEL)) {
        document.title = previousTitle;
      }
    }, 150);
  }

  function publishCapture(payload) {
    const previousTitle = document.title;
    document.title = `${CAPTURE_TITLE_CHANNEL}${JSON.stringify(payload)}`;
    window.setTimeout(() => {
      if (document.title.startsWith(CAPTURE_TITLE_CHANNEL)) {
        document.title = previousTitle;
      }
    }, 150);
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.channel !== MESSAGE_CHANNEL || data?.payload?.token !== BRIDGE_TOKEN) return;
    const childFrame = Array.from(document.querySelectorAll("iframe, frame"))
      .find((frame) => frame.contentWindow === event.source);
    if (!childFrame) return;
    const frameBounds = childFrame.getBoundingClientRect();
    publish({
      ...data.payload,
      x: data.payload.x + frameBounds.left,
      y: data.payload.y + frameBounds.top,
    });
  });

  document.addEventListener("contextmenu", (event) => {
    if (event.defaultPrevented) return;
    const anchor = event.target?.closest?.("a[href]");
    let linkUrl;
    if (anchor) {
      try {
        const url = new URL(anchor.getAttribute("href"), window.location.href);
        if (url.protocol === "http:" || url.protocol === "https:") {
          linkUrl = url.href.slice(0, 4096);
        }
      } catch (_) {}
    }
    const selectionText = String(window.getSelection?.() || "").trim().slice(0, 65536);
    event.preventDefault();
    event.stopImmediatePropagation();
    publish({
      token: BRIDGE_TOKEN,
      x: event.clientX,
      y: event.clientY,
      linkUrl,
      selectionText: selectionText || undefined,
    });
  }, true);

  window.__KKTERM_URL_PAGE_CAPTURE__ = {
    report(request) {
      if (Number.isFinite(request?.x) && Number.isFinite(request?.y)) {
        window.scrollTo({ left: request.x, top: request.y, behavior: "instant" });
      }
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          const root = document.documentElement;
          const body = document.body;
          publishCapture({
            token: BRIDGE_TOKEN,
            nonce: request?.nonce,
            x: window.scrollX,
            y: window.scrollY,
            pageWidth: Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0, window.innerWidth),
            pageHeight: Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0, window.innerHeight),
            viewportWidth: root?.clientWidth || window.innerWidth,
            viewportHeight: root?.clientHeight || window.innerHeight,
            captureWidth: window.innerWidth,
            captureHeight: window.innerHeight,
          });
        }, 90);
      }));
    },
  };
})();
"#;

pub struct WebviewSessionManager {
    sessions: Mutex<HashMap<String, WebviewSession>>,
    starting_sessions: Mutex<HashSet<String>>,
    clipboard_read_allowed: Arc<AtomicBool>,
    additional_browser_args: Option<&'static str>,
}

struct WebviewSession {
    window: WebviewWindow,
    host_window: WebviewWindow,
    visible: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartWebviewSessionRequest {
    session_id: String,
    url: String,
    data_partition: Option<String>,
    proxy_url: Option<String>,
    user_agent: Option<String>,
    download_folder: Option<String>,
    #[serde(default)]
    ignore_certificate_errors: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewSessionStarted {
    session_id: String,
    label: String,
    partition: String,
    external_link_token: String,
    download_folder: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWebviewBoundsRequest {
    session_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWebviewVisibilityRequest {
    session_id: String,
    visible: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewNavigateRequest {
    session_id: String,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewSimpleRequest {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewCaptureCredentialRequest {
    session_id: String,
    nonce: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewPageCaptureStateRequest {
    session_id: String,
    nonce: String,
    x: Option<f64>,
    y: Option<f64>,
}

pub(crate) struct WebviewFillCredentialRequest {
    pub(crate) session_id: String,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) username_selector: Option<String>,
    pub(crate) password_selector: Option<String>,
    pub(crate) field_values: Option<String>,
    pub(crate) automatic: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewNavigationPayload {
    session_id: String,
    url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewPageLoadPayload {
    session_id: String,
    url: String,
    status: &'static str,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewCertificateErrorPayload {
    session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewTitleChangedPayload {
    session_id: String,
    title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewDownloadPayload {
    session_id: String,
    url: String,
    status: &'static str,
    path: Option<String>,
    success: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebviewNewWindowPayload {
    session_id: String,
    url: String,
}

struct StartingReservation<'a> {
    manager: &'a WebviewSessionManager,
    session_id: String,
    committed: bool,
}

impl StartingReservation<'_> {
    fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for StartingReservation<'_> {
    fn drop(&mut self) {
        if !self.committed {
            self.manager.clear_starting(&self.session_id);
        }
    }
}

impl WebviewSessionManager {
    pub fn new(allow_clipboard_read: bool, additional_browser_args: Option<&'static str>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            starting_sessions: Mutex::new(HashSet::new()),
            clipboard_read_allowed: Arc::new(AtomicBool::new(allow_clipboard_read)),
            additional_browser_args,
        }
    }

    pub fn set_clipboard_read_allowed(&self, allowed: bool) {
        self.clipboard_read_allowed
            .store(allowed, Ordering::Relaxed);
    }

    pub fn clipboard_read_allowed_state(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.clipboard_read_allowed)
    }

    pub fn start_session(
        &self,
        app: &AppHandle,
        request: StartWebviewSessionRequest,
    ) -> Result<WebviewSessionStarted, String> {
        let StartWebviewSessionRequest {
            session_id,
            url,
            data_partition,
            proxy_url,
            user_agent,
            download_folder,
            ignore_certificate_errors,
            x: initial_x,
            y: initial_y,
            width,
            height,
        } = request;

        let session_id = required_id(session_id)?;
        let parsed_url = parse_external_url(&url)?;
        // "direct://" is the global "No Proxy" sentinel: force a direct
        // connection on the WebView2 even when the OS has a system proxy. It has
        // no tauri `proxy_url` equivalent, so it is applied as a browser argument
        // below rather than parsed into a proxy URL.
        let force_direct = matches!(proxy_url.as_deref().map(str::trim), Some("direct://"));
        let proxy_url = if force_direct {
            None
        } else {
            proxy_url.as_deref().map(parse_proxy_url).transpose()?
        };
        let partition = resolve_partition(data_partition);
        let custom_download_folder_configured = download_folder
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
        let download_folder = resolve_download_folder(app, download_folder)?;
        logging::url_connection_debug(
            "backend.session.start.request",
            &json!({
                "sessionId": session_id,
                "url": {
                    "scheme": parsed_url.scheme(),
                    "host": parsed_url.host_str(),
                },
                "partition": partition,
                "ignoreCertificateErrors": ignore_certificate_errors,
                "userAgentConfigured": user_agent.as_ref().is_some_and(|value| !value.trim().is_empty()),
                "customDownloadFolderConfigured": custom_download_folder_configured,
                "proxy": proxy_url.as_ref().map(|proxy| json!({
                    "scheme": proxy.scheme(),
                    "host": proxy.host_str(),
                    "port": proxy.port(),
                })),
                "initialBounds": {
                    "x": initial_x,
                    "y": initial_y,
                    "width": width,
                    "height": height,
                },
            }),
        );

        {
            let sessions = self.lock()?;
            if sessions.contains_key(&session_id) {
                return Err(format!("webview session '{session_id}' is already running"));
            }
        }
        {
            let mut starting_sessions = self.lock_starting()?;
            if !starting_sessions.insert(session_id.clone()) {
                return Err(format!(
                    "webview session '{session_id}' is already starting"
                ));
            }
        }
        let starting_reservation = StartingReservation {
            manager: self,
            session_id: session_id.clone(),
            committed: false,
        };

        let host_window = app
            .get_webview_window(HOST_WINDOW_LABEL)
            .ok_or_else(|| format!("host window '{HOST_WINDOW_LABEL}' is not available"))?;

        let label = webview_label_for(&session_id);
        let navigation_app = app.clone();
        let navigation_session_id = session_id.clone();
        let page_load_app = app.clone();
        let page_load_session_id = session_id.clone();
        let title_app = app.clone();
        let title_session_id = session_id.clone();
        let download_app = app.clone();
        let download_session_id = session_id.clone();
        let download_destination_folder = download_folder.clone();
        let new_window_app = app.clone();
        let new_window_session_id = session_id.clone();
        let defer_initial_navigation =
            (ignore_certificate_errors && cfg!(windows)) || cfg!(target_os = "macos");
        let initial_url = if defer_initial_navigation {
            parse_webview_blank_url()?
        } else {
            parsed_url.clone()
        };
        let external_link_token = external_link_bridge_token();
        let initialization_script = format!(
            "{AUTOFILL_AGENT}\n{}\n{}",
            external_link_shortcut_agent(&external_link_token)?,
            context_menu_agent(&external_link_token)?,
        );

        let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(initial_url))
            .initialization_script(initialization_script)
            .decorations(false)
            .resizable(false)
            .minimizable(false)
            .closable(false)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .position(HIDDEN_WEBVIEW_POSITION, HIDDEN_WEBVIEW_POSITION)
            .inner_size(width.max(1.0), height.max(1.0))
            .on_navigation(move |url| {
                let _ = navigation_app.emit(
                    "webview-navigation",
                    WebviewNavigationPayload {
                        session_id: navigation_session_id.clone(),
                        url: url.to_string(),
                    },
                );
                true
            })
            .on_page_load(move |_window, payload| {
                let status = match payload.event() {
                    PageLoadEvent::Started => "started",
                    PageLoadEvent::Finished => "finished",
                };
                let _ = page_load_app.emit(
                    "webview-page-load",
                    WebviewPageLoadPayload {
                        session_id: page_load_session_id.clone(),
                        url: payload.url().to_string(),
                        status,
                    },
                );
            })
            .on_document_title_changed(move |_window, title| {
                let _ = title_app.emit(
                    "webview-title-changed",
                    WebviewTitleChangedPayload {
                        session_id: title_session_id.clone(),
                        title,
                    },
                );
            })
            .on_new_window(move |url, _features| {
                if matches!(url.scheme(), "http" | "https") {
                    let _ = new_window_app.emit(
                        "webview-new-window",
                        WebviewNewWindowPayload {
                            session_id: new_window_session_id.clone(),
                            url: url.to_string(),
                        },
                    );
                }
                NewWindowResponse::Deny
            })
            .on_download(move |_webview, event| {
                let payload = match event {
                    DownloadEvent::Requested { url, destination } => {
                        let selected_destination = available_download_path(
                            &download_destination_folder,
                            destination.file_name(),
                        );
                        *destination = selected_destination;
                        WebviewDownloadPayload {
                            session_id: download_session_id.clone(),
                            url: url.to_string(),
                            status: "requested",
                            path: Some(destination.display().to_string()),
                            success: None,
                        }
                    }
                    DownloadEvent::Finished { url, path, success } => WebviewDownloadPayload {
                        session_id: download_session_id.clone(),
                        url: url.to_string(),
                        status: "finished",
                        path: path.map(|path| path.display().to_string()),
                        success: Some(success),
                    },
                    _ => WebviewDownloadPayload {
                        session_id: download_session_id.clone(),
                        url: String::new(),
                        status: "unknown",
                        path: None,
                        success: None,
                    },
                };
                let _ = download_app.emit("webview-download", payload);
                true
            });
        #[cfg(windows)]
        {
            builder = builder
                .owner(&host_window)
                .map_err(|error| format!("failed to assign URL webview owner: {error}"))?;
        }
        // On macOS the overlay must be a child (`addChildWindow:`) of the main
        // window. Without it, the borderless WKWebView lives in a standalone
        // window that macOS treats as occluded the moment the app deactivates,
        // blanking the page on focus loss. As a child it shares the parent's
        // activation and z-order, matching the Windows owner relationship above.
        #[cfg(target_os = "macos")]
        {
            builder = builder
                .parent(&host_window)
                .map_err(|error| format!("failed to assign URL webview parent: {error}"))?;
        }
        if let Some(user_agent) = user_agent
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            builder = builder.user_agent(user_agent);
        }

        #[cfg(windows)]
        if let Some(proxy_url) = proxy_url.as_ref() {
            // WebView2 browser arguments belong to an Environment, and
            // Environments sharing one user-data folder must use compatible
            // options. Isolate each effective proxy so direct, HTTP, and SOCKS5
            // URL Sessions can coexist without an argument mismatch.
            let data_directory = crate::app_paths::data_dir(app)?
                .join("url-webview-profiles")
                .join(proxy_data_directory_key(proxy_url.as_str()));
            builder = builder.data_directory(data_directory);
        }
        if let Some(proxy_url) = proxy_url.as_ref() {
            // tauri's cross-platform proxy_url only models HTTP and SOCKS5; an
            // HTTPS proxy is honored on Windows through the --proxy-server browser
            // argument below instead.
            if matches!(proxy_url.scheme(), "http" | "socks5") {
                builder = builder.proxy_url(proxy_url.clone());
            }
        }
        if let Some(additional_browser_args) = self.additional_browser_args {
            #[cfg(windows)]
            {
                // Wry uses explicit additional browser arguments instead of its
                // generated WebView2 arguments. Preserve the proxy directive when
                // remote-session stability arguments are also enabled.
                let browser_args = if force_direct {
                    format!("{additional_browser_args} --no-proxy-server")
                } else {
                    match proxy_url.as_ref() {
                        Some(proxy_url) => {
                            format!("{additional_browser_args} --proxy-server={proxy_url}")
                        }
                        None => additional_browser_args.to_string(),
                    }
                };
                builder = builder.additional_browser_args(&browser_args);
            }
            #[cfg(not(windows))]
            {
                builder = builder.additional_browser_args(additional_browser_args);
            }
        } else {
            // No custom browser args: wry would generate its own. "No Proxy" must
            // still force a direct connection, which has no proxy_url equivalent,
            // so inject --no-proxy-server while preserving wry's default arguments.
            #[cfg(windows)]
            if force_direct {
                let browser_args = format!("{WRY_DEFAULT_WEBVIEW2_ARGS} --no-proxy-server");
                builder = builder.additional_browser_args(&browser_args);
            }
        }

        let window = builder
            .build()
            .map_err(|error| format!("failed to create URL webview window: {error}"))?;
        configure_clipboard_read_permission(&window, Arc::clone(&self.clipboard_read_allowed))?;
        configure_certificate_error_handling(&window, ignore_certificate_errors, app, &session_id)?;
        if defer_initial_navigation {
            window
                .navigate(parsed_url)
                .map_err(|error| format!("failed to navigate webview: {error}"))?;
        }

        let mut sessions = self.lock()?;
        sessions.insert(
            session_id.clone(),
            WebviewSession {
                window,
                host_window,
                visible: false,
            },
        );
        starting_reservation.commit();
        logging::url_connection_debug(
            "backend.session.start.ok",
            &json!({
                "sessionId": session_id,
                "label": label,
                "partition": partition,
                "customDownloadFolderConfigured": custom_download_folder_configured,
            }),
        );

        Ok(WebviewSessionStarted {
            session_id,
            label,
            partition,
            external_link_token,
            download_folder: download_folder.display().to_string(),
        })
    }

    pub fn update_bounds(&self, request: UpdateWebviewBoundsRequest) -> Result<(), String> {
        let sessions = self.lock()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        webview_debug_log(format!(
            "update_bounds session={} tracked_visible={} x={} y={} width={} height={}",
            request.session_id,
            session.visible,
            request.x,
            request.y,
            request.width,
            request.height
        ));
        logging::url_connection_debug(
            "backend.bounds.update",
            &json!({
                "sessionId": request.session_id,
                "trackedVisible": session.visible,
                "bounds": {
                    "x": request.x,
                    "y": request.y,
                    "width": request.width,
                    "height": request.height,
                },
            }),
        );
        if session.visible {
            show_webview(session, request.x, request.y, request.width, request.height)?;
        }
        Ok(())
    }

    pub fn set_visibility(&self, request: SetWebviewVisibilityRequest) -> Result<(), String> {
        let mut sessions = self.lock()?;
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        webview_debug_log(format!(
            "set_visibility session={} visible={} x={} y={} width={} height={}",
            request.session_id,
            request.visible,
            request.x,
            request.y,
            request.width,
            request.height
        ));
        logging::url_connection_debug(
            "backend.visibility.set",
            &json!({
                "sessionId": request.session_id,
                "visible": request.visible,
                "bounds": {
                    "x": request.x,
                    "y": request.y,
                    "width": request.width,
                    "height": request.height,
                },
            }),
        );
        if request.visible {
            show_webview(session, request.x, request.y, request.width, request.height)?;
            session.visible = true;
        } else {
            hide_webview(&session.window)?;
            session.visible = false;
        }
        Ok(())
    }

    pub fn focus(&self, request: WebviewSimpleRequest) -> Result<(), String> {
        let sessions = self.lock()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        if !session.visible {
            return Ok(());
        }
        session
            .window
            .set_focus()
            .map_err(|error| format!("failed to focus webview: {error}"))
    }

    pub fn navigate(&self, request: WebviewNavigateRequest) -> Result<(), String> {
        let url = parse_external_url(&request.url)?;
        let sessions = self.lock()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        session
            .window
            .navigate(url)
            .map_err(|error| format!("failed to navigate webview: {error}"))
    }

    pub fn reload(&self, request: WebviewSimpleRequest) -> Result<(), String> {
        let sessions = self.lock()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        session
            .window
            .reload()
            .map_err(|error| format!("failed to reload webview: {error}"))
    }

    pub fn go_back(&self, request: WebviewSimpleRequest) -> Result<(), String> {
        let sessions = self.lock()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        session
            .window
            .eval("window.history.back();")
            .map_err(|error| format!("failed to navigate webview back: {error}"))
    }

    pub fn go_forward(&self, request: WebviewSimpleRequest) -> Result<(), String> {
        let sessions = self.lock()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        session
            .window
            .eval("window.history.forward();")
            .map_err(|error| format!("failed to navigate webview forward: {error}"))
    }

    pub(crate) fn fill_credential(
        &self,
        request: WebviewFillCredentialRequest,
    ) -> Result<(), String> {
        let payload = serde_json::json!({
            "username": request.username,
            "password": request.password,
            "usernameSelector": request.username_selector,
            "passwordSelector": request.password_selector,
            "fieldValues": request.field_values,
            "automatic": request.automatic,
        });
        let payload = serde_json::to_string(&payload)
            .map_err(|error| format!("failed to prepare URL credential payload: {error}"))?;
        let sessions = self.lock()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        session
            .window
            .eval(format!("window.__KKTERM_URL_AUTOFILL__?.fill({payload});"))
            .map_err(|error| format!("failed to fill webview credential: {error}"))
    }

    pub fn capture_credential(
        &self,
        request: WebviewCaptureCredentialRequest,
    ) -> Result<(), String> {
        let nonce = serde_json::to_string(&request.nonce)
            .map_err(|error| format!("failed to prepare URL credential capture nonce: {error}"))?;
        let sessions = self.lock()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        session
            .window
            .eval(format!("window.__KKTERM_URL_AUTOFILL__?.capture({nonce});"))
            .map_err(|error| format!("failed to capture webview credential: {error}"))
    }

    pub fn request_page_capture_state(
        &self,
        request: WebviewPageCaptureStateRequest,
    ) -> Result<(), String> {
        let payload = serde_json::json!({
            "nonce": request.nonce,
            "x": request.x,
            "y": request.y,
        });
        let payload = serde_json::to_string(&payload)
            .map_err(|error| format!("failed to prepare URL page-capture request: {error}"))?;
        let sessions = self.lock()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("webview session '{}' was not found", request.session_id))?;
        session
            .window
            .eval(format!(
                "window.__KKTERM_URL_PAGE_CAPTURE__?.report({payload});"
            ))
            .map_err(|error| format!("failed to request URL page-capture state: {error}"))
    }

    pub fn close_session(&self, request: WebviewSimpleRequest) -> Result<(), String> {
        let mut sessions = self.lock()?;
        logging::url_connection_debug(
            "backend.session.close.request",
            &json!({
                "sessionId": request.session_id,
                "activeSessionCount": sessions.len(),
            }),
        );
        let Some(session) = sessions.remove(&request.session_id) else {
            logging::url_connection_debug(
                "backend.session.close.missing",
                &json!({
                    "sessionId": request.session_id,
                    "activeSessionCount": sessions.len(),
                }),
            );
            return Ok(());
        };

        if let Err(error) = session.window.close() {
            let message = format!("failed to close webview: {error}");
            logging::url_connection_debug(
                "backend.session.close.error",
                &json!({
                    "sessionId": request.session_id,
                    "error": message,
                    "activeSessionCount": sessions.len(),
                }),
            );
            sessions.insert(request.session_id, session);
            return Err(message);
        }
        logging::url_connection_debug(
            "backend.session.close.ok",
            &json!({
                "sessionId": request.session_id,
                "activeSessionCount": sessions.len(),
            }),
        );
        Ok(())
    }

    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, WebviewSession>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "webview session lock is poisoned".to_string())
    }

    fn lock_starting(&self) -> Result<MutexGuard<'_, HashSet<String>>, String> {
        self.starting_sessions
            .lock()
            .map_err(|_| "webview startup lock is poisoned".to_string())
    }

    fn clear_starting(&self, session_id: &str) {
        if let Ok(mut starting_sessions) = self.starting_sessions.lock() {
            starting_sessions.remove(session_id);
        }
    }
}

fn webview_label_for(session_id: &str) -> String {
    format!("url-session-{session_id}")
}

fn show_webview(
    session: &WebviewSession,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (position, size) = overlay_rect(&session.host_window, x, y, width, height)?;
    logging::url_connection_debug(
        "backend.overlay.show",
        &json!({
            "logicalBounds": {
                "x": x,
                "y": y,
                "width": width,
                "height": height,
            },
            "physicalRect": {
                "x": position.x,
                "y": position.y,
                "width": size.width,
                "height": size.height,
            },
        }),
    );
    position_webview_window(&session.window, position, size)?;
    show_webview_window(&session.window)
}

#[cfg(not(target_os = "windows"))]
fn position_webview_window(
    window: &WebviewWindow,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Result<(), String> {
    logging::url_connection_debug(
        "backend.window.positioned",
        &json!({
            "platform": "non-windows",
            "requestedPhysicalRect": {
                "x": position.x,
                "y": position.y,
                "width": size.width,
                "height": size.height,
            },
        }),
    );
    window
        .set_position(Position::Physical(position))
        .map_err(|error| format!("failed to position webview: {error}"))?;
    window
        .set_size(Size::Physical(size))
        .map_err(|error| format!("failed to size webview: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn position_webview_window(
    window: &WebviewWindow,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos};

    let hwnd = webview_hwnd(window)?;
    let hwnd = HWND(hwnd);
    configure_webview_window_client_chrome(hwnd)?;
    // Establish the native screen rect first so the web content covers the request.
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            position.x,
            position.y,
            size.width as i32,
            size.height as i32,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|error| format!("failed to position URL webview window: {error}"))?;
    }
    webview_debug_log(format!(
        "position_webview_window screen_rect=({},{},{},{})",
        position.x, position.y, size.width, size.height,
    ));
    log_positioned_webview_window(hwnd, position, size);
    Ok(())
}

/// Subclass ID for our `WM_NCCALCSIZE` override. Combined with the callback
/// address, this uniquely identifies the subclass in comctl32's chain.
#[cfg(target_os = "windows")]
const WEBVIEW_NCCALCSIZE_SUBCLASS_ID: usize = 0x4B4B_544F;

/// Subclass callback for URL overlay windows. Returns 0 for `WM_NCCALCSIZE` to
/// force the client area to fill the entire window rect, eliminating the invisible
/// DWM resize border that Windows 10/11 adds to borderless windows. All other
/// messages are forwarded to the next handler via `DefSubclassProc`.
#[cfg(target_os = "windows")]
unsafe extern "system" fn webview_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _uidsubclass: usize,
    _dwrefdata: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::WM_NCCALCSIZE;

    if msg == WM_NCCALCSIZE {
        return windows::Win32::Foundation::LRESULT(0);
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Install a comctl32 subclass on the overlay HWND to intercept `WM_NCCALCSIZE`.
/// `SetWindowSubclass` properly chains with any existing wndproc (winit's, etc.)
/// and `DefSubclassProc` always forwards to the correct next handler — no manual
/// bookkeeping, no risk of infinite recursion.
#[cfg(target_os = "windows")]
fn install_webview_nccalcsize_subclass(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::UI::Shell::SetWindowSubclass;

    unsafe {
        let _ = SetWindowSubclass(
            hwnd,
            Some(webview_subclass_proc),
            WEBVIEW_NCCALCSIZE_SUBCLASS_ID,
            0,
        );
    }
}

#[cfg(target_os = "windows")]
fn configure_webview_window_client_chrome(
    hwnd: windows::Win32::Foundation::HWND,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_STYLE, GetWindowLongPtrW, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos, WS_BORDER, WS_CAPTION, WS_DLGFRAME,
        WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    };

    install_webview_nccalcsize_subclass(hwnd);

    let removable_style = (WS_CAPTION
        | WS_THICKFRAME
        | WS_BORDER
        | WS_DLGFRAME
        | WS_SYSMENU
        | WS_MINIMIZEBOX
        | WS_MAXIMIZEBOX)
        .0 as isize;
    let current_style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
    let next_style = current_style & !removable_style;
    if next_style != current_style {
        unsafe {
            let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, next_style);
            SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
            )
            .map_err(|error| format!("failed to apply URL webview client chrome: {error}"))?;
        }
        logging::url_connection_debug(
            "backend.window.client_chrome_configured",
            &json!({
                "previousStyle": current_style,
                "nextStyle": next_style,
            }),
        );
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn log_positioned_webview_window(
    hwnd: windows::Win32::Foundation::HWND,
    requested_position: PhysicalPosition<i32>,
    requested_size: PhysicalSize<u32>,
) {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect};

    let mut window_rect = RECT::default();
    let mut client_rect = RECT::default();
    let mut client_origin = POINT { x: 0, y: 0 };
    let window_rect_ok = unsafe { GetWindowRect(hwnd, &mut window_rect).is_ok() };
    let client_rect_ok = unsafe { GetClientRect(hwnd, &mut client_rect).is_ok() };
    let client_origin_ok = unsafe { ClientToScreen(hwnd, &mut client_origin).as_bool() };
    logging::url_connection_debug(
        "backend.window.positioned",
        &json!({
            "platform": "windows",
            "requestedPhysicalRect": {
                "x": requested_position.x,
                "y": requested_position.y,
                "width": requested_size.width,
                "height": requested_size.height,
            },
            "windowRect": if window_rect_ok {
                json!({
                    "left": window_rect.left,
                    "top": window_rect.top,
                    "right": window_rect.right,
                    "bottom": window_rect.bottom,
                    "width": window_rect.right - window_rect.left,
                    "height": window_rect.bottom - window_rect.top,
                })
            } else {
                json!(null)
            },
            "clientRect": if client_rect_ok && client_origin_ok {
                json!({
                    "left": client_origin.x,
                    "top": client_origin.y,
                    "right": client_origin.x + client_rect.right - client_rect.left,
                    "bottom": client_origin.y + client_rect.bottom - client_rect.top,
                    "width": client_rect.right - client_rect.left,
                    "height": client_rect.bottom - client_rect.top,
                    "originOffsetX": client_origin.x - requested_position.x,
                    "originOffsetY": client_origin.y - requested_position.y,
                })
            } else {
                json!(null)
            },
        }),
    );
}

fn hide_webview(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_position(Position::Physical(PhysicalPosition::new(-32_000, -32_000)))
        .map_err(|error| format!("failed to hide webview: {error}"))?;
    window
        .set_size(Size::Physical(PhysicalSize::new(1, 1)))
        .map_err(|error| format!("failed to hide webview: {error}"))?;
    window
        .hide()
        .map_err(|error| format!("failed to hide webview: {error}"))
}

/// Shared native-overlay geometry for app-owned child WebViews. Custom Modules
/// deliberately reuse the proven URL Connection placement path without sharing
/// URL Session state or its navigation/authentication lifecycle.
pub(crate) fn set_overlay_bounds(
    host_window: &WebviewWindow,
    window: &WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (position, size) = overlay_rect(host_window, x, y, width, height)?;
    position_webview_window(window, position, size)?;
    show_webview_window(window)
}

pub(crate) fn hide_overlay(window: &WebviewWindow) -> Result<(), String> {
    hide_webview(window)
}

pub(crate) fn show_overlay(window: &WebviewWindow) -> Result<(), String> {
    show_webview_window(window)
}

fn overlay_rect(
    host_window: &WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
    let scale_factor = host_window
        .scale_factor()
        .map_err(|error| format!("failed to read host window scale factor: {error}"))?;
    let host_origin = host_content_origin(host_window)?;
    let left = host_origin.x + (x.max(0.0) * scale_factor).round() as i32;
    let top = host_origin.y + (y.max(0.0) * scale_factor).round() as i32;
    let physical_width = (width.max(1.0) * scale_factor).round().max(1.0) as u32;
    let physical_height = (height.max(1.0) * scale_factor).round().max(1.0) as u32;
    webview_debug_log(format!(
        "overlay_rect scale={scale_factor} host_origin=({host_x},{host_y}) dom=(x={x},y={y},w={width},h={height}) -> pos=({left},{top}) size=({physical_width},{physical_height})",
        host_x = host_origin.x,
        host_y = host_origin.y,
    ));
    logging::url_connection_debug(
        "backend.overlay.rect",
        &json!({
            "scaleFactor": scale_factor,
            "hostOrigin": {
                "x": host_origin.x,
                "y": host_origin.y,
            },
            "logicalBounds": {
                "x": x,
                "y": y,
                "width": width,
                "height": height,
            },
            "physicalRect": {
                "x": left,
                "y": top,
                "width": physical_width,
                "height": physical_height,
            },
        }),
    );
    Ok((
        PhysicalPosition::new(left, top),
        PhysicalSize::new(physical_width, physical_height),
    ))
}

/// Screen-space origin of the host WebView's client area — where DOM `(0, 0)`
/// physically renders. On Windows the host is a borderless, resizable window
/// whose frame insets can make `inner_position` drift a few pixels from the
/// actual content origin, leaving a gap beside the overlay; `ClientToScreen`
/// reports the true client origin instead.
#[cfg(target_os = "windows")]
fn host_content_origin(host_window: &WebviewWindow) -> Result<PhysicalPosition<i32>, String> {
    use windows::Win32::Foundation::{HWND, POINT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;

    let hwnd = host_window
        .hwnd()
        .map_err(|error| format!("failed to read host window HWND: {error}"))?;
    let mut origin = POINT { x: 0, y: 0 };
    let mapped = unsafe { ClientToScreen(HWND(hwnd.0), &mut origin) };
    if mapped.as_bool() {
        return Ok(PhysicalPosition::new(origin.x, origin.y));
    }
    host_window
        .inner_position()
        .map_err(|error| format!("failed to read host window content position: {error}"))
}

#[cfg(not(target_os = "windows"))]
fn host_content_origin(host_window: &WebviewWindow) -> Result<PhysicalPosition<i32>, String> {
    host_window
        .inner_position()
        .map_err(|error| format!("failed to read host window content position: {error}"))
}

#[cfg(target_os = "windows")]
fn webview_hwnd(window: &WebviewWindow) -> Result<*mut std::ffi::c_void, String> {
    if let Ok(hwnd) = window.hwnd() {
        return Ok(hwnd.0);
    }

    window
        .show()
        .map_err(|error| format!("failed to realize URL webview window: {error}"))?;

    let mut elapsed_ms = 0_u64;
    let mut last_error = None;
    for (attempt, delay_ms) in WEBVIEW_HWND_REALIZE_RETRY_DELAYS_MS.iter().enumerate() {
        match window.hwnd() {
            Ok(hwnd) => {
                if attempt > 0 {
                    logging::url_connection_debug(
                        "backend.window.hwnd_realized_after_retry",
                        &json!({
                            "attempt": attempt,
                            "elapsedMs": elapsed_ms,
                        }),
                    );
                }
                return Ok(hwnd.0);
            }
            Err(error) => {
                last_error = Some(error.to_string());
                std::thread::sleep(std::time::Duration::from_millis(*delay_ms));
                elapsed_ms += *delay_ms;
            }
        }
    }

    window
        .hwnd()
        .map(|hwnd| hwnd.0)
        .map_err(|error| {
            let previous_error = last_error.unwrap_or_else(|| "unknown".to_string());
            format!(
                "failed to get URL webview HWND after realize: {error}; previous retry error: {previous_error}"
            )
        })
}

#[cfg(target_os = "windows")]
fn show_webview_window(window: &WebviewWindow) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowPos,
        ShowWindow,
    };

    let hwnd = webview_hwnd(window)?;
    unsafe {
        SetWindowPos(
            HWND(hwnd),
            None,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
        .map_err(|error| format!("failed to show webview without activation: {error}"))?;
        let _ = ShowWindow(HWND(hwnd), SW_SHOWNOACTIVATE);
    }
    Ok(())
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn show_webview_window(window: &WebviewWindow) -> Result<(), String> {
    window
        .show()
        .map_err(|error| format!("failed to show webview: {error}"))
}

#[cfg(target_os = "macos")]
fn show_webview_window(window: &WebviewWindow) -> Result<(), String> {
    let ns_window = window
        .ns_window()
        .map_err(|error| format!("failed to read URL webview NSWindow: {error}"))?;
    // Tauri's generic show path calls Tao's macOS set_visible(true), which
    // makes the overlay key. URL overlays must reveal without stealing clicks
    // from the main Connection Tree and app chrome.
    let ns_window: &objc2_app_kit::NSWindow = unsafe { &*ns_window.cast() };
    ns_window.orderFront(None);
    Ok(())
}

fn webview_debug_log(message: String) {
    if std::env::var("KKTERM_WEBVIEW_DEBUG").ok().as_deref() == Some("1") {
        eprintln!("[kkterm:webview] {message}");
    }
}

fn configure_certificate_error_handling(
    webview: &WebviewWindow,
    enabled: bool,
    app: &AppHandle,
    session_id: &str,
) -> Result<(), String> {
    configure_platform_certificate_error_handling(webview, enabled, app, session_id)
}

#[cfg(windows)]
pub(crate) fn configure_shell_refresh_shortcut(webview: &WebviewWindow) -> Result<(), String> {
    use webview2_com::{
        AcceleratorKeyPressedEventHandler,
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_F5;

    let setup_error = Arc::new(Mutex::new(None::<String>));
    let setup_error_for_callback = Arc::clone(&setup_error);

    webview
        .with_webview(move |platform_webview| {
            let result = (|| -> Result<(), String> {
                unsafe {
                    let controller = platform_webview.controller();
                    let handler = AcceleratorKeyPressedEventHandler::create(Box::new(
                        move |_sender, args| {
                            if let Some(args) = args {
                                let mut event_kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
                                let mut virtual_key = 0;
                                args.KeyEventKind(&mut event_kind)?;
                                args.VirtualKey(&mut virtual_key)?;
                                if event_kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                                    && virtual_key == VK_F5.0 as u32
                                {
                                    args.SetHandled(true)?;
                                }
                            }
                            Ok(())
                        },
                    ));
                    let mut token = 0;
                    controller
                        .add_AcceleratorKeyPressed(&handler, &mut token)
                        .map_err(|error| error.to_string())?;
                }
                Ok::<(), String>(())
            })();
            if let Err(error) = result {
                if let Ok(mut setup_error) = setup_error_for_callback.lock() {
                    *setup_error = Some(error);
                }
            }
        })
        .map_err(|error| format!("failed to access WebView2 for F5 suppression: {error}"))?;

    if let Ok(mut setup_error) = setup_error.lock() {
        if let Some(error) = setup_error.take() {
            return Err(format!(
                "failed to suppress WebView2 F5 browser reload: {error}"
            ));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn configure_shell_refresh_shortcut(_webview: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

pub(crate) fn configure_shell_clipboard_read_permission(
    webview: &tauri::WebviewWindow,
    allowed: Arc<AtomicBool>,
) -> Result<(), String> {
    configure_webview2_clipboard_permission(webview, allowed)
}

fn configure_clipboard_read_permission(
    webview: &WebviewWindow,
    allowed: Arc<AtomicBool>,
) -> Result<(), String> {
    configure_webview2_clipboard_permission(webview, allowed)
}

#[cfg(windows)]
fn configure_webview2_clipboard_permission(
    webview: &WebviewWindow,
    allowed: Arc<AtomicBool>,
) -> Result<(), String> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
            ICoreWebView2PermissionRequestedEventArgs2,
        },
        PermissionRequestedEventHandler,
    };
    use windows_core::Interface;

    let setup_error = Arc::new(Mutex::new(None::<String>));
    let setup_error_for_callback = Arc::clone(&setup_error);

    webview
        .with_webview(move |platform_webview| {
            let result = (|| -> Result<(), String> {
                unsafe {
                    let webview2 = platform_webview
                        .controller()
                        .CoreWebView2()
                        .map_err(|error| error.to_string())?;
                    let handler =
                        PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
                            if let Some(args) = args {
                                let mut permission_kind =
                                    COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ;
                                args.PermissionKind(&mut permission_kind)?;
                                if permission_kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ {
                                    if allowed.load(Ordering::Relaxed) {
                                        args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                                    }
                                    if let Ok(args2) =
                                        args.cast::<ICoreWebView2PermissionRequestedEventArgs2>()
                                    {
                                        args2.SetHandled(true)?;
                                    }
                                }
                            }
                            Ok(())
                        }));
                    let mut token = 0;
                    webview2
                        .add_PermissionRequested(&handler, &mut token)
                        .map_err(|error| error.to_string())?;
                }
                Ok::<(), String>(())
            })();
            if let Err(error) = result {
                if let Ok(mut setup_error) = setup_error_for_callback.lock() {
                    *setup_error = Some(error);
                }
            }
        })
        .map_err(|error| format!("failed to access WebView2 for clipboard settings: {error}"))?;

    if let Ok(mut setup_error) = setup_error.lock() {
        if let Some(error) = setup_error.take() {
            return Err(format!(
                "failed to configure clipboard paste permission for WebView2: {error}"
            ));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn configure_webview2_clipboard_permission(
    _webview: &WebviewWindow,
    _allowed: Arc<AtomicBool>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn configure_platform_certificate_error_handling(
    webview: &WebviewWindow,
    enabled: bool,
    _app: &AppHandle,
    _session_id: &str,
) -> Result<(), String> {
    if !enabled {
        return Ok(());
    }
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW, ICoreWebView2_14,
        },
        ServerCertificateErrorDetectedEventHandler,
    };
    use windows_core::Interface;

    let setup_error = Arc::new(Mutex::new(None::<String>));
    let setup_error_for_callback = Arc::clone(&setup_error);

    webview
        .with_webview(move |platform_webview| {
            let result = (|| -> Result<(), String> {
                unsafe {
                    let webview2 = platform_webview
                        .controller()
                        .CoreWebView2()
                        .map_err(|error| error.to_string())?;
                    let webview2 = webview2
                        .cast::<ICoreWebView2_14>()
                        .map_err(|error| error.to_string())?;
                    let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(
                        move |_sender, args| {
                            if let Some(args) = args {
                                args.SetAction(
                                    COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                                )?;
                            }
                            Ok(())
                        },
                    ));
                    let mut token = 0;
                    webview2
                        .add_ServerCertificateErrorDetected(&handler, &mut token)
                        .map_err(|error| error.to_string())?;
                }
                Ok::<(), String>(())
            })();
            if let Err(error) = result {
                if let Ok(mut setup_error) = setup_error_for_callback.lock() {
                    *setup_error = Some(error);
                }
            }
        })
        .map_err(|error| format!("failed to access WebView2 for certificate settings: {error}"))?;

    if let Ok(mut setup_error) = setup_error.lock() {
        if let Some(error) = setup_error.take() {
            return Err(format!(
                "failed to enable URL certificate bypass for WebView2: {error}"
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_platform_certificate_error_handling(
    webview: &WebviewWindow,
    enabled: bool,
    app: &AppHandle,
    session_id: &str,
) -> Result<(), String> {
    // WKWebView does not expose Safari's manual certificate-warning page to
    // embedded apps. The app-owned equivalent of WebView2's certificate-error
    // callback is the navigation delegate authentication challenge below.
    configure_wkwebview_certificate_error_handling(webview, enabled, app, session_id)
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn configure_platform_certificate_error_handling(
    _webview: &WebviewWindow,
    _enabled: bool,
    _app: &AppHandle,
    _session_id: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_wkwebview_certificate_error_handling(
    webview: &WebviewWindow,
    enabled: bool,
    app: &AppHandle,
    session_id: &str,
) -> Result<(), String> {
    use std::ffi::{c_char, c_void};
    use std::sync::OnceLock;

    use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
    use objc2::{msg_send, sel};
    use objc2_foundation::NSString;
    type ChallengeCompletionHandler = block2::Block<dyn Fn(isize, *mut AnyObject)>;

    const ASSOCIATION_ASSIGN: usize = 0;
    const ASSOCIATION_RETAIN_NONATOMIC: usize = 1;
    const SEC_TRUST_RESULT_PROCEED: u32 = 1;
    const SEC_TRUST_RESULT_UNSPECIFIED: u32 = 4;
    const NS_URL_ERROR_SERVER_CERTIFICATE_HAS_BAD_DATE: isize = -1201;
    const NS_URL_ERROR_SERVER_CERTIFICATE_UNTRUSTED: isize = -1202;
    const NS_URL_ERROR_SERVER_CERTIFICATE_HAS_UNKNOWN_ROOT: isize = -1203;
    const NS_URL_ERROR_SERVER_CERTIFICATE_NOT_YET_VALID: isize = -1204;
    static BYPASS_ASSOCIATED_KEY: u8 = 0;
    static SESSION_ASSOCIATED_KEY: u8 = 0;
    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

    unsafe extern "C-unwind" fn certificate_challenge_handler(
        _delegate: *mut AnyObject,
        _selector: Sel,
        webview: *mut AnyObject,
        _challenge: *mut AnyObject,
        completion_handler: *mut AnyObject,
    ) {
        unsafe {
            let bypass_enabled: *mut c_void = objc_getAssociatedObject(
                webview.cast(),
                (&BYPASS_ASSOCIATED_KEY as *const u8).cast(),
            );
            let disposition = 1isize; // NSURLSessionAuthChallengePerformDefaultHandling
            let protection_space: *mut AnyObject = msg_send![_challenge, protectionSpace];
            let server_trust: *mut c_void = msg_send![protection_space, serverTrust];
            if server_trust.is_null() {
                let block = &*(completion_handler.cast::<ChallengeCompletionHandler>());
                block.call((disposition, std::ptr::null_mut::<AnyObject>()));
                return;
            }

            if bypass_enabled.is_null() {
                let mut trust_result = 0u32;
                let trust_status = sec_trust_evaluate(server_trust, &mut trust_result);
                let trusted = trust_status == 0
                    && matches!(
                        trust_result,
                        SEC_TRUST_RESULT_PROCEED | SEC_TRUST_RESULT_UNSPECIFIED
                    );
                if !trusted {
                    let session_id = objc_getAssociatedObject(
                        webview.cast(),
                        (&SESSION_ASSOCIATED_KEY as *const u8).cast(),
                    );
                    if !session_id.is_null()
                        && let Some(app) = APP_HANDLE.get()
                    {
                        let session_id = &*session_id.cast::<NSString>();
                        let _ = app.emit(
                            "webview-certificate-error",
                            WebviewCertificateErrorPayload {
                                session_id: session_id.to_string(),
                            },
                        );
                    }
                }
                let block = &*(completion_handler.cast::<ChallengeCompletionHandler>());
                block.call((disposition, std::ptr::null_mut::<AnyObject>()));
                return;
            }

            let credential_class =
                AnyClass::get(c"NSURLCredential").expect("NSURLCredential class");
            let credential: *mut AnyObject =
                msg_send![credential_class, credentialForTrust: server_trust];
            let use_credential = 0isize; // NSURLSessionAuthChallengeUseCredential
            let block = &*(completion_handler.cast::<ChallengeCompletionHandler>());
            block.call((use_credential, credential));
        }
    }

    unsafe extern "C-unwind" fn certificate_navigation_failure_handler(
        _delegate: *mut AnyObject,
        _selector: Sel,
        webview: *mut AnyObject,
        _navigation: *mut AnyObject,
        error: *mut AnyObject,
    ) {
        unsafe {
            if error.is_null() {
                return;
            }
            let bypass_enabled: *mut c_void = objc_getAssociatedObject(
                webview.cast(),
                (&BYPASS_ASSOCIATED_KEY as *const u8).cast(),
            );
            let error_code: isize = msg_send![error, code];
            let domain: *mut NSString = msg_send![error, domain];
            let is_certificate_error = !domain.is_null()
                && (&*domain).to_string() == "NSURLErrorDomain"
                && matches!(
                    error_code,
                    NS_URL_ERROR_SERVER_CERTIFICATE_HAS_BAD_DATE
                        | NS_URL_ERROR_SERVER_CERTIFICATE_UNTRUSTED
                        | NS_URL_ERROR_SERVER_CERTIFICATE_HAS_UNKNOWN_ROOT
                        | NS_URL_ERROR_SERVER_CERTIFICATE_NOT_YET_VALID
                );
            if bypass_enabled.is_null() && is_certificate_error {
                let session_id = objc_getAssociatedObject(
                    webview.cast(),
                    (&SESSION_ASSOCIATED_KEY as *const u8).cast(),
                );
                if !session_id.is_null()
                    && let Some(app) = APP_HANDLE.get()
                {
                    let session_id = &*session_id.cast::<NSString>();
                    let _ = app.emit(
                        "webview-certificate-error",
                        WebviewCertificateErrorPayload {
                            session_id: session_id.to_string(),
                        },
                    );
                }
            }
        }
    }

    unsafe extern "C" {
        fn class_addMethod(
            cls: *const AnyClass,
            name: Sel,
            imp: unsafe extern "C-unwind" fn(
                *mut AnyObject,
                Sel,
                *mut AnyObject,
                *mut AnyObject,
                *mut AnyObject,
            ),
            types: *const c_char,
        ) -> Bool;
        fn objc_setAssociatedObject(
            object: *const c_void,
            key: *const c_void,
            value: *const c_void,
            policy: usize,
        );
        fn objc_getAssociatedObject(object: *const c_void, key: *const c_void) -> *mut c_void;
        fn object_getClass(object: *const c_void) -> *const AnyClass;
        #[link_name = "SecTrustEvaluate"]
        fn sec_trust_evaluate(trust: *const c_void, result: *mut u32) -> i32;
    }

    let _ = APP_HANDLE.set(app.clone());

    let session_id = session_id.to_string();
    webview
        .with_webview(move |platform_webview| {
            let webview: *mut AnyObject = platform_webview.inner().cast();
            if webview.is_null() {
                webview_debug_log(
                    "cannot configure URL certificate handling: WKWebView handle is unavailable"
                        .to_string(),
                );
                return;
            }
            unsafe {
                // objc2 gives Wry-defined classes an auto-generated runtime name
                // (module path + type + crate version). Discover the delegate that
                // Wry attached to this WKWebView instead of depending on that private
                // name, which changes independently of KKTerm.
                let navigation_delegate: *mut AnyObject = msg_send![webview, navigationDelegate];
                if navigation_delegate.is_null() {
                    webview_debug_log(
                        "cannot configure URL certificate handling: WKWebView navigation delegate is unavailable"
                            .to_string(),
                    );
                    return;
                }
                let delegate_class = object_getClass(navigation_delegate.cast());
                if delegate_class.is_null() {
                    webview_debug_log(
                        "cannot configure URL certificate handling: WKWebView navigation delegate class is unavailable"
                            .to_string(),
                    );
                    return;
                }
                let _ = class_addMethod(
                    delegate_class,
                    sel!(webView:didReceiveAuthenticationChallenge:completionHandler:),
                    certificate_challenge_handler,
                    c"v@:@@@".as_ptr(),
                );
                let _ = class_addMethod(
                    delegate_class,
                    sel!(webView:didFailProvisionalNavigation:withError:),
                    certificate_navigation_failure_handler,
                    c"v@:@@@".as_ptr(),
                );
                let _ = class_addMethod(
                    delegate_class,
                    sel!(webView:didFailNavigation:withError:),
                    certificate_navigation_failure_handler,
                    c"v@:@@@".as_ptr(),
                );
                let session_id = NSString::from_str(&session_id);
                objc_setAssociatedObject(
                    webview.cast(),
                    (&SESSION_ASSOCIATED_KEY as *const u8).cast(),
                    (&*session_id as *const NSString).cast(),
                    ASSOCIATION_RETAIN_NONATOMIC,
                );
                objc_setAssociatedObject(
                    webview.cast(),
                    (&BYPASS_ASSOCIATED_KEY as *const u8).cast(),
                    if enabled {
                        (&BYPASS_ASSOCIATED_KEY as *const u8).cast()
                    } else {
                        std::ptr::null()
                    },
                    ASSOCIATION_ASSIGN,
                );
                // WebKit snapshots optional navigation-delegate capabilities when
                // the delegate is attached. The first URL WebView is created before
                // KKTerm adds these runtime methods, so reattach Wry's retained
                // delegate once to make the callbacks visible immediately. Later
                // URL WebViews already see the methods when Wry attaches it.
                let _: () = msg_send![webview, setNavigationDelegate: std::ptr::null_mut::<AnyObject>()];
                let _: () = msg_send![webview, setNavigationDelegate: navigation_delegate];
            }
        })
        .map_err(|error| format!("failed to access WKWebView for certificate settings: {error}"))?;
    Ok(())
}

fn required_id(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("webview session id is required".to_string());
    }
    if trimmed.len() > 96 {
        return Err("webview session id must be 96 characters or fewer".to_string());
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("webview session id may only contain letters, digits, '-' or '_'".to_string());
    }
    Ok(trimmed.to_string())
}

fn parse_webview_blank_url() -> Result<url::Url, String> {
    url::Url::parse("about:blank").map_err(|error| format!("blank URL is not valid: {error}"))
}

fn parse_external_url(value: &str) -> Result<url::Url, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("URL is required".to_string());
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed =
        url::Url::parse(&candidate).map_err(|error| format!("URL is not valid: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("URL scheme must be http or https, got {other}")),
    }
}

fn parse_proxy_url(value: &str) -> Result<url::Url, String> {
    let normalized = crate::storage::normalize_app_proxy_url(Some(value.to_string()))?
        .ok_or_else(|| "URL proxy is required".to_string())?;
    url::Url::parse(&normalized).map_err(|error| format!("URL proxy is invalid: {error}"))
}

fn proxy_data_directory_key(proxy_url: &str) -> String {
    let digest = Sha256::digest(proxy_url.as_bytes());
    digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn resolve_partition(data_partition: Option<String>) -> String {
    data_partition
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_PARTITION.to_string())
}

fn resolve_download_folder(
    app: &AppHandle,
    configured_folder: Option<String>,
) -> Result<PathBuf, String> {
    let folder = match configured_folder
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            let path = PathBuf::from(value);
            if !path.is_absolute() {
                return Err("URL download folder must be an absolute path".to_string());
            }
            path
        }
        None => app
            .path()
            .download_dir()
            .map_err(|error| format!("failed to resolve the system Downloads folder: {error}"))?,
    };
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "failed to create URL download folder {}: {error}",
            folder.display()
        )
    })?;
    folder.canonicalize().map_err(|error| {
        format!(
            "failed to resolve URL download folder {}: {error}",
            folder.display()
        )
    })
}

fn available_download_path(folder: &Path, suggested_name: Option<&std::ffi::OsStr>) -> PathBuf {
    let suggested_name = suggested_name
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| std::ffi::OsStr::new("download"));
    let candidate = folder.join(suggested_name);
    if !candidate.exists() {
        return candidate;
    }

    let suggested = Path::new(suggested_name);
    let stem = suggested
        .file_stem()
        .filter(|stem| !stem.is_empty())
        .unwrap_or(suggested_name)
        .to_string_lossy();
    let extension = suggested.extension().map(|value| value.to_string_lossy());
    for index in 1.. {
        let file_name = match extension.as_deref() {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = folder.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("the download filename suffix space is exhausted")
}

fn external_link_bridge_token() -> String {
    let mut random = [0_u8; 16];
    rand::rng().fill_bytes(&mut random);
    random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn external_link_shortcut_agent(token: &str) -> Result<String, String> {
    let token = serde_json::to_string(token)
        .map_err(|error| format!("failed to prepare URL external-link token: {error}"))?;
    Ok(EXTERNAL_LINK_SHORTCUT_AGENT.replace("__KKTERM_EXTERNAL_LINK_BRIDGE_TOKEN__", &token))
}

fn context_menu_agent(token: &str) -> Result<String, String> {
    let token = serde_json::to_string(token)
        .map_err(|error| format!("failed to prepare URL context-menu token: {error}"))?;
    Ok(CONTEXT_MENU_AGENT.replace("__KKTERM_CONTEXT_MENU_BRIDGE_TOKEN__", &token))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_urls_accept_http_https_and_socks5_endpoints() {
        assert_eq!(
            parse_proxy_url("http://proxy.example:3128")
                .expect("HTTP proxy parses")
                .as_str(),
            "http://proxy.example:3128/"
        );
        assert_eq!(
            parse_proxy_url("https://proxy.example:443")
                .expect("HTTPS proxy parses")
                .scheme(),
            "https"
        );
        assert_eq!(
            parse_proxy_url("socks5://127.0.0.1:1080")
                .expect("SOCKS5 proxy parses")
                .scheme(),
            "socks5"
        );
        assert!(parse_proxy_url("ftp://proxy.example:21").is_err());
        assert!(parse_proxy_url("http://proxy.example").is_err());
    }

    #[test]
    fn proxy_data_directory_keys_are_stable_and_do_not_expose_endpoints() {
        let first = proxy_data_directory_key("http://proxy.example:3128");
        let repeated = proxy_data_directory_key("http://proxy.example:3128");
        let other = proxy_data_directory_key("socks5://127.0.0.1:1080");

        assert_eq!(first, repeated);
        assert_ne!(first, other);
        assert_eq!(first.len(), 24);
        assert!(!first.contains("proxy.example"));
    }

    #[test]
    fn download_paths_keep_the_suggested_name_and_avoid_overwriting() {
        let folder = std::env::temp_dir().join(format!(
            "kkterm-webview-download-test-{}",
            external_link_bridge_token()
        ));
        fs::create_dir_all(&folder).expect("test folder is created");
        let first = available_download_path(&folder, Some(std::ffi::OsStr::new("report.pdf")));
        assert_eq!(first, folder.join("report.pdf"));
        fs::write(&first, b"existing").expect("existing download is written");
        assert_eq!(
            available_download_path(&folder, Some(std::ffi::OsStr::new("report.pdf"))),
            folder.join("report (1).pdf")
        );
        fs::remove_dir_all(folder).expect("test folder is removed");
    }
}
