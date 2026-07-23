#[cfg(target_os = "windows")]
mod platform {
    use std::{
        collections::{BTreeSet, HashMap},
        ffi::c_void,
        mem::ManuallyDrop,
        sync::{Arc, Mutex, MutexGuard, OnceLock, mpsc},
        time::{Duration, Instant},
    };

    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use tauri::{AppHandle, Manager};

    use crate::logging::{rdp_debug, ui_debug};
    use windows::{
        Win32::{
            Foundation::{
                HANDLE, HGLOBAL, HINSTANCE, HWND, LPARAM, POINT, RECT, VARIANT_BOOL, VARIANT_FALSE,
                VARIANT_TRUE, WPARAM,
            },
            Graphics::Gdi::ClientToScreen,
            System::{
                Com::{
                    DISPATCH_METHOD, DISPATCH_PROPERTYGET, DISPATCH_PROPERTYPUT, DISPPARAMS,
                    IDispatch,
                },
                DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
                LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW},
                Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
                Ole::{CF_UNICODETEXT, DISPID_PROPERTYPUT, IOleInPlaceObject, OleInitialize},
                Threading::{AttachThreadInput, GetCurrentThreadId},
                Variant::{
                    VARIANT, VT_BOOL, VT_BSTR, VT_DISPATCH, VT_I2, VT_I4, VT_UI4, VariantClear,
                },
            },
            UI::{
                Input::KeyboardAndMouse::{
                    GetFocus, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT,
                    KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, MAPVK_VK_TO_VSC_EX, MapVirtualKeyW,
                    SendInput, SetFocus, VIRTUAL_KEY, VkKeyScanW,
                },
                WindowsAndMessaging::{
                    CallNextHookEx, CreateWindowExW, DestroyWindow, GetClientRect,
                    GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, HC_ACTION, HHOOK,
                    HMENU, IsChild, MSLLHOOKSTRUCT, SW_SHOWNOACTIVATE, SWP_NOACTIVATE,
                    SWP_NOZORDER, SendMessageW, SetForegroundWindow, SetWindowPos,
                    SetWindowsHookExW, ShowWindow, UnhookWindowsHookEx, WH_MOUSE_LL,
                    WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_RBUTTONDOWN, WM_XBUTTONDOWN,
                    WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
                    WS_VISIBLE, WindowFromPoint,
                },
            },
        },
        core::{BSTR, GUID, IUnknown, IUnknown_Vtbl, Interface, PCSTR, PCWSTR},
    };

    const HOST_WINDOW_LABEL: &str = "main";
    const HIDDEN_RDP_POSITION: i32 = -32_000;
    const LOCALE_USER_DEFAULT: u32 = 0x0400;
    const RDP_MIN_DESKTOP_WIDTH: i32 = 200;
    const RDP_MIN_DESKTOP_HEIGHT: i32 = 200;
    const RDP_UNKNOWN_PHYSICAL_SIZE_MM: i32 = 0;
    const RDP_DISPLAY_ORIENTATION_LANDSCAPE: i32 = 0;
    const RDP_DISPLAY_SCALE_FACTOR_PERCENT: i32 = 100;
    const RDP_CONNECTED_STATE: i32 = 1;
    const RDP_ESTABLISHING_STATE: i32 = 2;
    const RDP_STANDARD_SAS_SEQUENCE: i32 = 0xaa03;
    const VK_CONTROL_KEY: usize = 0x11;
    const VK_ALT_KEY: usize = 0x12;
    const VK_END_KEY: usize = 0x23;
    const VK_RETURN_KEY: usize = 0x0D;
    const VK_ESCAPE_KEY: usize = 0x1B;
    const VK_BACKSPACE_KEY: usize = 0x08;
    const VK_DELETE_KEY: usize = 0x2E;
    const VK_TAB_KEY: usize = 0x09;
    const VK_SHIFT_KEY: usize = 0x10;
    const VK_V_KEY: usize = 0x56;
    const VK_SPACE_KEY: usize = 0x20;
    const VK_HOME_KEY: usize = 0x24;
    const VK_LEFT_KEY: usize = 0x25;
    const VK_UP_KEY: usize = 0x26;
    const VK_RIGHT_KEY: usize = 0x27;
    const VK_DOWN_KEY: usize = 0x28;
    const VK_PAGE_UP_KEY: usize = 0x21;
    const VK_PAGE_DOWN_KEY: usize = 0x22;
    const WM_LBUTTONDOWN_MSG: u32 = 0x0201;
    const WM_LBUTTONUP_MSG: u32 = 0x0202;
    const WM_RBUTTONDOWN_MSG: u32 = 0x0204;
    const WM_RBUTTONUP_MSG: u32 = 0x0205;
    const WM_MBUTTONDOWN_MSG: u32 = 0x0207;
    const WM_MBUTTONUP_MSG: u32 = 0x0208;
    const MK_LBUTTON_WPARAM: usize = 0x0001;
    const MK_RBUTTON_WPARAM: usize = 0x0002;
    const MK_MBUTTON_WPARAM: usize = 0x0010;
    const RDP_TEXT_MODE_CLIPBOARD: &str = "clipboard";
    const RDP_TEXT_MODE_SEND_KEYS: &str = "sendKeys";
    const RDP_TEXT_LIMIT: usize = 64 * 1024;
    const RDP_SEND_KEYS_LIMIT: usize = 20;
    const RDP_MAIN_THREAD_WARN_AFTER: Duration = Duration::from_secs(2);
    const RDP_MAIN_THREAD_TIMEOUT: Duration = Duration::from_secs(15);
    const RDP_PROGIDS: &[&str] = &[
        "MsTscAx.MsTscAx.13",
        "MsTscAx.MsTscAx.12",
        "MsTscAx.MsTscAx.11",
        "MsTscAx.MsTscAx.10",
        "MsTscAx.MsTscAx.9",
        "MsTscAx.MsTscAx.8",
        "MsTscAx.MsTscAx.7",
        "MsTscAx.MsTscAx.6",
        "MsTscAx.MsTscAx.5",
        "MsTscAx.MsTscAx.4",
        "MsTscAx.MsTscAx.3",
        "MsTscAx.MsTscAx.2",
        "MsTscAx.MsTscAx.1",
        "MsTscAx.MsTscAx",
    ];
    const ADVANCED_SETTINGS_PROPERTIES: &[&str] = &[
        "AdvancedSettings12",
        "AdvancedSettings11",
        "AdvancedSettings10",
        "AdvancedSettings9",
        "AdvancedSettings8",
        "AdvancedSettings7",
        "AdvancedSettings6",
        "AdvancedSettings5",
        "AdvancedSettings4",
        "AdvancedSettings3",
        "AdvancedSettings2",
        "AdvancedSettings",
    ];
    const EXTENDED_SETTINGS_PROPERTIES: &[&str] = &["ExtendedSettings"];
    const SECURED_SETTINGS_PROPERTIES: &[&str] = &["SecuredSettings", "SecuredSettings2"];

    #[repr(transparent)]
    #[derive(Clone)]
    struct IMsRdpClientNonScriptable(windows::core::IUnknown);

    unsafe impl Interface for IMsRdpClientNonScriptable {
        type Vtable = IMsRdpClientNonScriptableVtbl;
        const IID: GUID = GUID::from_u128(0x2f079c4c_87b2_4afd_97ab_20cdb43038ae);
    }

    #[repr(C)]
    struct IMsRdpClientNonScriptableVtbl {
        base__: IUnknown_Vtbl,
        put_clear_text_password:
            unsafe extern "system" fn(*mut c_void, BSTR) -> windows::core::HRESULT,
        put_portable_password:
            unsafe extern "system" fn(*mut c_void, BSTR) -> windows::core::HRESULT,
        get_portable_password:
            unsafe extern "system" fn(*mut c_void, *mut BSTR) -> windows::core::HRESULT,
        put_portable_salt: unsafe extern "system" fn(*mut c_void, BSTR) -> windows::core::HRESULT,
        get_portable_salt:
            unsafe extern "system" fn(*mut c_void, *mut BSTR) -> windows::core::HRESULT,
        put_binary_password: unsafe extern "system" fn(*mut c_void, BSTR) -> windows::core::HRESULT,
        get_binary_password:
            unsafe extern "system" fn(*mut c_void, *mut BSTR) -> windows::core::HRESULT,
        put_binary_salt: unsafe extern "system" fn(*mut c_void, BSTR) -> windows::core::HRESULT,
        get_binary_salt:
            unsafe extern "system" fn(*mut c_void, *mut BSTR) -> windows::core::HRESULT,
        reset_password: unsafe extern "system" fn(*mut c_void) -> windows::core::HRESULT,
        notify_redirect_device_change:
            unsafe extern "system" fn(*mut c_void, WPARAM, LPARAM) -> windows::core::HRESULT,
        send_keys: unsafe extern "system" fn(
            *mut c_void,
            i32,
            *mut VARIANT_BOOL,
            *mut i32,
        ) -> windows::core::HRESULT,
    }

    #[repr(transparent)]
    #[derive(Clone)]
    struct IMsRdpClientNonScriptable3(windows::core::IUnknown);

    unsafe impl Interface for IMsRdpClientNonScriptable3 {
        type Vtable = IMsRdpClientNonScriptable3Vtbl;
        const IID: GUID = GUID::from_u128(0xb3378d90_0728_45c7_8ed7_b6159fb92219);
    }

    #[repr(C)]
    struct IMsRdpClientNonScriptable3Vtbl {
        base__: IMsRdpClientNonScriptableVtbl,
        ui_parent_window_handle_put: usize,
        ui_parent_window_handle_get: usize,
        show_redirection_warning_dialog_put: usize,
        show_redirection_warning_dialog_get: usize,
        prompt_for_credentials_put: usize,
        prompt_for_credentials_get: usize,
        negotiate_security_layer_put: usize,
        negotiate_security_layer_get: usize,
        enable_cred_ssp_support_put: usize,
        enable_cred_ssp_support_get: usize,
        redirect_dynamic_drives_put: usize,
        redirect_dynamic_drives_get: usize,
        redirect_dynamic_devices_put: usize,
        redirect_dynamic_devices_get: usize,
        device_collection_get: usize,
        drive_collection_get:
            unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> windows::core::HRESULT,
        warn_about_sending_credentials_put: usize,
        warn_about_sending_credentials_get: usize,
        warn_about_clipboard_redirection_put: usize,
        warn_about_clipboard_redirection_get: usize,
        connection_bar_text_put:
            unsafe extern "system" fn(*mut c_void, BSTR) -> windows::core::HRESULT,
        connect_to_administer_server_get: usize,
    }

    #[repr(transparent)]
    #[derive(Clone)]
    struct IMsRdpDriveCollection(windows::core::IUnknown);

    unsafe impl Interface for IMsRdpDriveCollection {
        type Vtable = IMsRdpDriveCollectionVtbl;
        const IID: GUID = GUID::from_u128(0x7ff17599_da2c_4677_ad35_f60c04fe1585);
    }

    #[repr(C)]
    struct IMsRdpDriveCollectionVtbl {
        base__: IUnknown_Vtbl,
        rescan_drives:
            unsafe extern "system" fn(*mut c_void, VARIANT_BOOL) -> windows::core::HRESULT,
        drive_by_index:
            unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> windows::core::HRESULT,
        drive_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> windows::core::HRESULT,
    }

    #[repr(transparent)]
    #[derive(Clone)]
    struct IMsRdpDrive(windows::core::IUnknown);

    unsafe impl Interface for IMsRdpDrive {
        type Vtable = IMsRdpDriveVtbl;
        const IID: GUID = GUID::from_u128(0xd28b5458_f694_47a8_8e61_40356a767e46);
    }

    #[repr(C)]
    struct IMsRdpDriveVtbl {
        base__: IUnknown_Vtbl,
        name_get: unsafe extern "system" fn(*mut c_void, *mut BSTR) -> windows::core::HRESULT,
        redirection_state_put:
            unsafe extern "system" fn(*mut c_void, VARIANT_BOOL) -> windows::core::HRESULT,
        redirection_state_get:
            unsafe extern "system" fn(*mut c_void, *mut VARIANT_BOOL) -> windows::core::HRESULT,
    }

    type AtlAxWinInit = unsafe extern "system" fn() -> i32;
    type AtlAxGetControl =
        unsafe extern "system" fn(HWND, *mut *mut c_void) -> windows::core::HRESULT;

    struct AtlFunctions {
        ax_win_init: AtlAxWinInit,
        ax_get_control: AtlAxGetControl,
    }

    #[derive(Clone)]
    pub struct RdpSessionManager {
        sessions: Arc<Mutex<HashMap<String, RdpSession>>>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct StartRdpSessionRequest {
        session_id: String,
        host: String,
        user: String,
        port: Option<u16>,
        secret_owner_id: Option<String>,
        password: Option<String>,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        scale_factor: Option<f64>,
        options: Option<RdpSessionOptions>,
    }

    #[derive(Clone, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpSessionOptions {
        #[serde(default = "default_color_depth")]
        color_depth: u16,
        #[serde(default)]
        administrative_session: bool,
        #[serde(default = "default_true")]
        redirect_clipboard: bool,
        #[serde(default)]
        redirect_drives: bool,
        #[serde(default)]
        drive_selection: RdpDriveSelection,
        #[serde(default = "default_true")]
        bitmap_cache: bool,
        #[serde(default = "default_performance_profile")]
        performance_profile: String,
        #[serde(default = "default_remote_resolution")]
        remote_resolution: String,
    }

    #[derive(Clone, Deserialize, Serialize)]
    #[serde(tag = "mode", rename_all = "camelCase")]
    enum RdpDriveSelection {
        All,
        Selected { drives: Vec<String> },
    }

    impl Default for RdpDriveSelection {
        fn default() -> Self {
            Self::All
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum RemoteResolutionMode {
        Automatic,
        SmartSizing,
        DpiZoom,
        Fixed { width: i32, height: i32 },
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct RdpDisplaySettings {
        desktop_width: i32,
        desktop_height: i32,
        physical_width: i32,
        physical_height: i32,
        desktop_scale_factor: i32,
        device_scale_factor: i32,
    }

    impl RemoteResolutionMode {
        pub fn parse(value: &str) -> Self {
            match value.trim() {
                "automatic" | "" => Self::Automatic,
                "smartSizing" => Self::SmartSizing,
                "dpiZoom" => Self::DpiZoom,
                other => other
                    .split_once('x')
                    .and_then(|(w, h)| {
                        let width: i32 = w.parse().ok()?;
                        let height: i32 = h.parse().ok()?;
                        if width > 0 && height > 0 {
                            Some(Self::Fixed { width, height })
                        } else {
                            None
                        }
                    })
                    .unwrap_or(Self::Automatic),
            }
        }

        pub fn smart_sizing(&self) -> bool {
            matches!(self, Self::SmartSizing | Self::Fixed { .. })
        }

        pub fn tracks_pane_size(&self) -> bool {
            matches!(self, Self::Automatic | Self::DpiZoom)
        }

        fn applies_host_dpi(&self) -> bool {
            matches!(self, Self::Automatic | Self::DpiZoom)
        }

        pub fn desktop_size(
            &self,
            _logical_w: f64,
            _logical_h: f64,
            physical_w: i32,
            physical_h: i32,
        ) -> (i32, i32) {
            match self {
                // Automatic and DpiZoom render at the pane's physical pixel
                // resolution so the bitmap is 1:1 with the host surface. They
                // additionally pass the host scale factor so the remote
                // re-renders UI at the host's DPI instead of relying on local
                // SmartSizing, which makes high-DPI desktops look tiny and can
                // skew pointer transforms on FreeRDP servers such as GNOME
                // Remote Desktop. The explicit SmartSizing mode seeds the same
                // initial desktop size but then scales the bitmap locally.
                Self::Automatic | Self::SmartSizing | Self::DpiZoom => (
                    desktop_width_for(physical_w),
                    desktop_height_for(physical_h),
                ),
                Self::Fixed { width, height } => {
                    (desktop_width_for(*width), desktop_height_for(*height))
                }
            }
        }

        fn display_settings(
            &self,
            logical_w: f64,
            logical_h: f64,
            physical_w: i32,
            physical_h: i32,
            scale_factor: f64,
        ) -> RdpDisplaySettings {
            let (desktop_width, desktop_height) =
                self.desktop_size(logical_w, logical_h, physical_w, physical_h);
            let (display_physical_width, display_physical_height) =
                self.display_physical_size(desktop_width, desktop_height, physical_w, physical_h);
            RdpDisplaySettings {
                desktop_width,
                desktop_height,
                physical_width: display_physical_width,
                physical_height: display_physical_height,
                desktop_scale_factor: self.desktop_scale_factor(scale_factor),
                device_scale_factor: self.device_scale_factor(scale_factor),
            }
        }

        fn display_physical_size(
            &self,
            _desktop_width: i32,
            _desktop_height: i32,
            _physical_w: i32,
            _physical_h: i32,
        ) -> (i32, i32) {
            // MS-RDPEDISP defines physical size as millimeters, not pixels.
            // The pane only gives us logical/native pixel bounds, so send an
            // invalid small value and let the server ignore the physical-size
            // hint instead of deriving scale/input transforms from bogus mm.
            (RDP_UNKNOWN_PHYSICAL_SIZE_MM, RDP_UNKNOWN_PHYSICAL_SIZE_MM)
        }

        fn desktop_scale_factor(&self, scale_factor: f64) -> i32 {
            if !self.applies_host_dpi() {
                return RDP_DISPLAY_SCALE_FACTOR_PERCENT;
            }
            let raw = (scale_factor * 100.0).round() as i32;
            raw.clamp(100, 500)
        }

        fn device_scale_factor(&self, scale_factor: f64) -> i32 {
            if !self.applies_host_dpi() {
                return RDP_DISPLAY_SCALE_FACTOR_PERCENT;
            }
            let raw = (scale_factor * 100.0).round() as i32;
            if raw >= 160 {
                180
            } else if raw >= 120 {
                140
            } else {
                100
            }
        }
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpSessionStarted {
        session_id: String,
        host: String,
        port: u16,
        control: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpSessionStatus {
        session_id: String,
        connection_state: i32,
        connected: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct UpdateRdpBoundsRequest {
        session_id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        scale_factor: Option<f64>,
        // When set, re-issue the remote desktop resize even if the cached
        // desktop size/scale already matches. Used by the post-connect settle
        // passes: the ActiveX control often ignores the first resize, so we
        // re-apply it (while keeping the control on-screen) once the session
        // is interactive, instead of relying on a manual pane nudge.
        #[serde(default)]
        force: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SetRdpVisibilityRequest {
        session_id: String,
        visible: bool,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        scale_factor: Option<f64>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SyncRdpDisplaySizeRequest {
        session_id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        scale_factor: Option<f64>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpDisplaySizeSync {
        session_id: String,
        connection_state: i32,
        connected: bool,
        display_synced: bool,
        desktop_width: i32,
        desktop_height: i32,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpSimpleRequest {
        pub(crate) session_id: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SendRdpTextRequest {
        session_id: String,
        text: String,
        mode: Option<String>,
        press_enter: Option<bool>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SendRdpKeyPressRequest {
        session_id: String,
        key: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SendRdpMouseClickRequest {
        session_id: String,
        x: u16,
        y: u16,
        button: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpTextSent {
        session_id: String,
        mode: String,
        fell_back: bool,
        char_count: u32,
    }

    struct RdpSession {
        session_id: String,
        hwnd: HWND,
        owner: HWND,
        dispatch: IDispatch,
        desktop_width: i32,
        desktop_height: i32,
        desktop_scale_factor: i32,
        device_scale_factor: i32,
        dynamic_resize_failures: u32,
        resolution_mode: RemoteResolutionMode,
    }

    // These values are always created, used, and destroyed through closures
    // dispatched onto Tauri's main thread. The marker lets the session map live
    // behind app state while preserving that thread-affinity by convention.
    unsafe impl Send for RdpSession {}

    struct VariantArg(VARIANT);

    fn rdp_request_scale_factor(requested: Option<f64>, host_scale_factor: f64) -> f64 {
        requested
            .filter(|scale| scale.is_finite() && *scale >= 0.25 && *scale <= 8.0)
            .unwrap_or(host_scale_factor)
    }

    impl RdpSessionManager {
        pub fn new() -> Self {
            Self {
                sessions: Arc::new(Mutex::new(HashMap::new())),
            }
        }

        pub fn start_session(
            &self,
            app: AppHandle,
            request: StartRdpSessionRequest,
        ) -> Result<RdpSessionStarted, String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("start_rdp_session", app, move |app| {
                start_session_on_main_thread(sessions, &app, request)
            })
        }

        pub fn update_bounds(
            &self,
            app: AppHandle,
            request: UpdateRdpBoundsRequest,
        ) -> Result<(), String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("update_rdp_bounds", app, move |app| {
                let host_window = app
                    .get_webview_window(HOST_WINDOW_LABEL)
                    .ok_or_else(|| format!("host window '{HOST_WINDOW_LABEL}' is not available"))?;
                let host_scale_factor = host_window
                    .scale_factor()
                    .map_err(|error| format!("failed to read host window scale factor: {error}"))?;
                let scale_factor =
                    rdp_request_scale_factor(request.scale_factor, host_scale_factor);
                let mut sessions = lock_sessions(&sessions)?;
                let session = sessions
                    .get_mut(&request.session_id)
                    .ok_or_else(|| format!("RDP session '{}' was not found", request.session_id))?;
                if is_native_fullscreen(session) {
                    // ActiveX owns its native full-screen window; ignore Pane bounds.
                    return Ok(());
                }
                show_and_resize_rdp(
                    session,
                    scale_factor,
                    request.x,
                    request.y,
                    request.width,
                    request.height,
                    request.force,
                )
            })
        }

        pub fn set_visibility(
            &self,
            app: AppHandle,
            request: SetRdpVisibilityRequest,
        ) -> Result<(), String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("set_rdp_visibility", app, move |app| {
                let host_window = app
                    .get_webview_window(HOST_WINDOW_LABEL)
                    .ok_or_else(|| format!("host window '{HOST_WINDOW_LABEL}' is not available"))?;
                let host_scale_factor = host_window
                    .scale_factor()
                    .map_err(|error| format!("failed to read host window scale factor: {error}"))?;
                let scale_factor =
                    rdp_request_scale_factor(request.scale_factor, host_scale_factor);
                let sessions = lock_sessions(&sessions)?;
                // A session in ActiveX full screen owns its native host; the Pane
                // must not reposition or park its windowed host.
                if sessions
                    .get(&request.session_id)
                    .is_some_and(is_native_fullscreen)
                {
                    return Ok(());
                }
                if request.visible {
                    let mut parked_other_sessions = 0;
                    for (other_session_id, other_session) in sessions.iter() {
                        if other_session_id != &request.session_id
                            && !is_native_fullscreen(other_session)
                        {
                            park_rdp_at_current_size(other_session.hwnd)?;
                            parked_other_sessions += 1;
                        }
                    }
                    let session = sessions.get(&request.session_id).ok_or_else(|| {
                        format!("RDP session '{}' was not found", request.session_id)
                    })?;
                    let connection_state =
                        get_property_i32(&session.dispatch, "Connected").unwrap_or(-1);
                    let rect = show_rdp_for_session(
                        session,
                        scale_factor,
                        request.x,
                        request.y,
                        request.width,
                        request.height,
                    )?;
                    rdp_debug(
                        "visibility.set",
                        &json!({
                            "sessionId": &request.session_id,
                            "visible": true,
                            "connectionState": connection_state,
                            "connectionStateLabel": rdp_connection_state_label(connection_state),
                            "scaleFactor": scale_factor,
                            "hostScaleFactor": host_scale_factor,
                            "requestBounds": {
                                "x": request.x,
                                "y": request.y,
                                "width": request.width,
                                "height": request.height,
                            },
                            "nativeRect": {
                                "x": rect.0,
                                "y": rect.1,
                                "width": rect.2,
                                "height": rect.3,
                            },
                            "parkedOtherSessions": parked_other_sessions,
                        }),
                    );
                    set_rdp_overlay_focus_targets(
                        Some(session.hwnd),
                        Some(session.owner),
                        hosted_rdp_object_window(&session.dispatch).or(Some(session.hwnd)),
                    );
                    Ok(())
                } else {
                    let session = sessions.get(&request.session_id).ok_or_else(|| {
                        format!("RDP session '{}' was not found", request.session_id)
                    })?;
                    let connection_state =
                        get_property_i32(&session.dispatch, "Connected").unwrap_or(-1);
                    let rect = stage_rdp(
                        session.hwnd,
                        scale_factor,
                        request.x,
                        request.y,
                        request.width,
                        request.height,
                    )?;
                    rdp_debug(
                        "visibility.set",
                        &json!({
                            "sessionId": &request.session_id,
                            "visible": false,
                            "connectionState": connection_state,
                            "connectionStateLabel": rdp_connection_state_label(connection_state),
                            "scaleFactor": scale_factor,
                            "hostScaleFactor": host_scale_factor,
                            "requestBounds": {
                                "x": request.x,
                                "y": request.y,
                                "width": request.width,
                                "height": request.height,
                            },
                            "nativeRect": {
                                "x": rect.0,
                                "y": rect.1,
                                "width": rect.2,
                                "height": rect.3,
                            },
                        }),
                    );
                    set_rdp_overlay_focus_targets(None, None, None);
                    Ok(())
                }
            })
        }

        /// Ask the Microsoft RDP ActiveX control to enter its own full-screen
        /// mode. The control owns both the top-level host and connection bar,
        /// matching mstsc/RDCMan and avoiding cross-window WebView2 airspace.
        pub fn enter_fullscreen(
            &self,
            app: AppHandle,
            request: RdpSimpleRequest,
        ) -> Result<(), String> {
            let sessions = Arc::clone(&self.sessions);
            let session_id = request.session_id;
            run_on_main_thread("enter_rdp_fullscreen", app, move |_app| {
                let sessions = lock_sessions(&sessions)?;
                let session = sessions
                    .get(&session_id)
                    .ok_or_else(|| format!("RDP session '{session_id}' was not found"))?;
                configure_native_fullscreen(&session.dispatch)?;
                set_property_bool(&session.dispatch, "FullScreen", true)?;
                Ok(())
            })
        }

        /// Return the ActiveX control to its existing windowed host. The Pane's
        /// HWND and bounds never moved, so no parking/reveal cycle is needed.
        pub fn exit_fullscreen(
            &self,
            app: AppHandle,
            request: RdpSimpleRequest,
        ) -> Result<(), String> {
            let sessions = Arc::clone(&self.sessions);
            let session_id = request.session_id;
            run_on_main_thread("exit_rdp_fullscreen", app, move |_app| {
                let sessions = lock_sessions(&sessions)?;
                let session = sessions
                    .get(&session_id)
                    .ok_or_else(|| format!("RDP session '{session_id}' was not found"))?;
                set_property_bool(&session.dispatch, "FullScreen", false)?;
                Ok(())
            })
        }

        /// Called only from Tauri's native shortcut callback, which runs on the
        /// UI thread that owns the ActiveX controls.
        pub fn exit_active_fullscreen(&self) -> Result<bool, String> {
            let sessions = lock_sessions(&self.sessions)?;
            for session in sessions.values() {
                if is_native_fullscreen(session) {
                    set_property_bool(&session.dispatch, "FullScreen", false)?;
                    rdp_debug(
                        "fullscreen.shortcut.exit",
                        &json!({ "sessionId": &session.session_id }),
                    );
                    return Ok(true);
                }
            }
            Ok(false)
        }

        /// Called by shortcut focus registration on Tauri's UI thread.
        pub fn has_active_fullscreen(&self) -> Result<bool, String> {
            let sessions = lock_sessions(&self.sessions)?;
            Ok(sessions.values().any(is_native_fullscreen))
        }

        pub fn sync_display_size(
            &self,
            app: AppHandle,
            request: SyncRdpDisplaySizeRequest,
        ) -> Result<RdpDisplaySizeSync, String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("sync_rdp_display_size", app, move |app| {
                let host_window = app
                    .get_webview_window(HOST_WINDOW_LABEL)
                    .ok_or_else(|| format!("host window '{HOST_WINDOW_LABEL}' is not available"))?;
                let host_scale_factor = host_window
                    .scale_factor()
                    .map_err(|error| format!("failed to read host window scale factor: {error}"))?;
                let scale_factor =
                    rdp_request_scale_factor(request.scale_factor, host_scale_factor);
                let mut sessions = lock_sessions(&sessions)?;
                let session = sessions
                    .get_mut(&request.session_id)
                    .ok_or_else(|| format!("RDP session '{}' was not found", request.session_id))?;
                let tracks_pane_size = session.resolution_mode.tracks_pane_size();
                let (rect, geometry_source) = if tracks_pane_size {
                    (
                        stage_rdp(
                            session.hwnd,
                            scale_factor,
                            request.x,
                            request.y,
                            request.width,
                            request.height,
                        )?,
                        "staged",
                    )
                } else {
                    (
                        scaled_rect(
                            request.x,
                            request.y,
                            request.width,
                            request.height,
                            scale_factor,
                        ),
                        "computed",
                    )
                };
                let display_settings = session.resolution_mode.display_settings(
                    request.width,
                    request.height,
                    rect.2,
                    rect.3,
                    scale_factor,
                );
                let connection_state = get_property_i32(&session.dispatch, "Connected")?;
                let connected = is_rdp_active_state(connection_state);
                let display_sync_attempted =
                    tracks_pane_size && is_rdp_displayable_state(connection_state);
                let display_sync_completed = display_sync_attempted
                    && sync_remote_desktop_size(session, display_settings, false);
                let display_synced =
                    rdp_display_ready_after_sync(connection_state, display_sync_completed);
                rdp_debug(
                    "display.sync.state",
                    &json!({
                        "sessionId": &request.session_id,
                        "connectionState": connection_state,
                        "connectionStateLabel": rdp_connection_state_label(connection_state),
                        "active": connected,
                        "displayable": is_rdp_displayable_state(connection_state),
                        "tracksPaneSize": tracks_pane_size,
                        "geometrySource": geometry_source,
                        "displaySyncAttempted": display_sync_attempted,
                        "displaySyncCompleted": display_sync_completed,
                        "displaySynced": display_synced,
                        "scaleFactor": scale_factor,
                        "hostScaleFactor": host_scale_factor,
                        "requestBounds": {
                            "x": request.x,
                            "y": request.y,
                            "width": request.width,
                            "height": request.height,
                        },
                        "nativeRect": {
                            "x": rect.0,
                            "y": rect.1,
                            "width": rect.2,
                            "height": rect.3,
                        },
                        "displaySettings": {
                            "desktopWidth": display_settings.desktop_width,
                            "desktopHeight": display_settings.desktop_height,
                            "physicalWidth": display_settings.physical_width,
                            "physicalHeight": display_settings.physical_height,
                            "desktopScaleFactor": display_settings.desktop_scale_factor,
                            "deviceScaleFactor": display_settings.device_scale_factor,
                        },
                        "storedDesktop": {
                            "width": session.desktop_width,
                            "height": session.desktop_height,
                            "desktopScaleFactor": session.desktop_scale_factor,
                            "deviceScaleFactor": session.device_scale_factor,
                        },
                    }),
                );
                Ok(RdpDisplaySizeSync {
                    session_id: request.session_id,
                    connection_state,
                    connected,
                    display_synced,
                    desktop_width: session.desktop_width,
                    desktop_height: session.desktop_height,
                })
            })
        }

        pub fn close_session(
            &self,
            app: AppHandle,
            request: RdpSimpleRequest,
        ) -> Result<(), String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("close_rdp_session", app, move |_app| {
                let mut sessions = lock_sessions(&sessions)?;
                if let Some(session) = sessions.remove(&request.session_id) {
                    let _ = invoke_method(&session.dispatch, "Disconnect");
                    unsafe {
                        DestroyWindow(session.hwnd).map_err(|error| {
                            format!("failed to destroy RDP host window: {error}")
                        })?;
                    }
                }
                if sessions.is_empty() {
                    uninstall_rdp_overlay_focus_hook();
                } else {
                    set_rdp_overlay_focus_targets(None, None, None);
                }
                Ok(())
            })
        }

        pub fn session_status(
            &self,
            app: AppHandle,
            request: RdpSimpleRequest,
        ) -> Result<RdpSessionStatus, String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("get_rdp_session_status", app, move |_app| {
                let sessions = lock_sessions(&sessions)?;
                let session = sessions
                    .get(&request.session_id)
                    .ok_or_else(|| format!("RDP session '{}' was not found", request.session_id))?;
                let connection_state = get_property_i32(&session.dispatch, "Connected")?;
                Ok(RdpSessionStatus {
                    session_id: request.session_id,
                    connection_state,
                    connected: is_rdp_connected_state(connection_state),
                })
            })
        }

        pub fn send_ctrl_alt_delete(
            &self,
            app: AppHandle,
            request: RdpSimpleRequest,
        ) -> Result<(), String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("send_rdp_ctrl_alt_delete", app, move |_app| {
                let sessions = lock_sessions(&sessions)?;
                let session = sessions
                    .get(&request.session_id)
                    .ok_or_else(|| format!("RDP session '{}' was not found", request.session_id))?;
                let connection_state =
                    get_property_i32(&session.dispatch, "Connected").unwrap_or(0);
                if !is_rdp_connected_state(connection_state) {
                    return Err(
                        "RDP session is not connected; cannot send Ctrl+Alt+Delete to remote desktop"
                            .to_string(),
                    );
                }
                send_ctrl_alt_end_via_windows_input(session.owner, session.hwnd)
                    .or_else(|_| send_ctrl_alt_end_to_rdp(&session.dispatch))
                    .or_else(|_| invoke_method(&session.dispatch, "SendCtrlAltDel"))
            })
        }

        pub fn send_text(
            &self,
            app: AppHandle,
            request: SendRdpTextRequest,
        ) -> Result<RdpTextSent, String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("send_rdp_text", app, move |_app| {
                if request.text.len() > RDP_TEXT_LIMIT {
                    return Err(format!(
                        "RDP text payload is {} bytes which exceeds the {RDP_TEXT_LIMIT}-byte limit",
                        request.text.len()
                    ));
                }
                let press_enter = request.press_enter.unwrap_or(false);
                let requested_mode = request
                    .mode
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(RDP_TEXT_MODE_CLIPBOARD)
                    .to_string();
                let sessions = lock_sessions(&sessions)?;
                let session = sessions
                    .get(&request.session_id)
                    .ok_or_else(|| format!("RDP session '{}' was not found", request.session_id))?;
                let connection_state =
                    get_property_i32(&session.dispatch, "Connected").unwrap_or(0);
                if !is_rdp_connected_state(connection_state) {
                    return Err(
                        "RDP session is not connected; cannot send text to remote desktop"
                            .to_string(),
                    );
                }
                let char_count = request.text.chars().count() as u32;
                if char_count == 0 && !press_enter {
                    return Ok(RdpTextSent {
                        session_id: request.session_id,
                        mode: requested_mode,
                        fell_back: false,
                        char_count: 0,
                    });
                }
                focus_rdp_control(session.owner, session.hwnd);
                match requested_mode.as_str() {
                    RDP_TEXT_MODE_SEND_KEYS => {
                        send_text_via_keys(&session.dispatch, &request.text, press_enter)?;
                        Ok(RdpTextSent {
                            session_id: request.session_id,
                            mode: RDP_TEXT_MODE_SEND_KEYS.to_string(),
                            fell_back: false,
                            char_count,
                        })
                    }
                    _ => match send_text_via_clipboard(
                        &session.dispatch,
                        session.hwnd,
                        &request.text,
                        press_enter,
                    ) {
                        Ok(()) => Ok(RdpTextSent {
                            session_id: request.session_id,
                            mode: RDP_TEXT_MODE_CLIPBOARD.to_string(),
                            fell_back: false,
                            char_count,
                        }),
                        Err(_) => {
                            send_text_via_keys(&session.dispatch, &request.text, press_enter)?;
                            Ok(RdpTextSent {
                                session_id: request.session_id,
                                mode: RDP_TEXT_MODE_SEND_KEYS.to_string(),
                                fell_back: true,
                                char_count,
                            })
                        }
                    },
                }
            })
        }

        pub fn send_key_press(
            &self,
            app: AppHandle,
            request: SendRdpKeyPressRequest,
        ) -> Result<(), String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("send_rdp_key_press", app, move |_app| {
                let sessions = lock_sessions(&sessions)?;
                let session = sessions
                    .get(&request.session_id)
                    .ok_or_else(|| format!("RDP session '{}' was not found", request.session_id))?;
                let connection_state =
                    get_property_i32(&session.dispatch, "Connected").unwrap_or(0);
                if !is_rdp_connected_state(connection_state) {
                    return Err(
                        "RDP session is not connected; cannot send key press to remote desktop"
                            .to_string(),
                    );
                }
                focus_rdp_control(session.owner, session.hwnd);
                if normalize_remote_key_name(&request.key) == "ctrlaltdelete" {
                    return send_ctrl_alt_end_via_windows_input(session.owner, session.hwnd)
                        .or_else(|_| send_ctrl_alt_end_to_rdp(&session.dispatch))
                        .or_else(|_| invoke_method(&session.dispatch, "SendCtrlAltDel"));
                }
                let vk = rdp_virtual_key_for_name(&request.key)?;
                send_key_chord(&session.dispatch, &[KeyEvent::press(vk)])
            })
        }

        pub fn send_mouse_click(
            &self,
            app: AppHandle,
            request: SendRdpMouseClickRequest,
        ) -> Result<(), String> {
            let sessions = Arc::clone(&self.sessions);
            run_on_main_thread("send_rdp_mouse_click", app, move |_app| {
                let sessions = lock_sessions(&sessions)?;
                let session = sessions
                    .get(&request.session_id)
                    .ok_or_else(|| format!("RDP session '{}' was not found", request.session_id))?;
                let connection_state =
                    get_property_i32(&session.dispatch, "Connected").unwrap_or(0);
                if !is_rdp_connected_state(connection_state) {
                    return Err(
                        "RDP session is not connected; cannot send mouse click to remote desktop"
                            .to_string(),
                    );
                }
                let (down_message, up_message, button_mask) =
                    rdp_mouse_messages_for_button(&request.button)?;
                focus_rdp_control(session.owner, session.hwnd);
                send_rdp_mouse_click_messages(
                    session.hwnd,
                    request.x,
                    request.y,
                    down_message,
                    up_message,
                    button_mask,
                );
                Ok(())
            })
        }
    }

    impl StartRdpSessionRequest {
        pub(crate) fn secret_owner_id(&self) -> Option<&str> {
            self.secret_owner_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        }

        pub(crate) fn password(&self) -> Option<&str> {
            self.password.as_deref().filter(|value| !value.is_empty())
        }

        pub(crate) fn set_password(&mut self, password: Option<String>) {
            self.password = password;
        }
    }

    fn start_session_on_main_thread(
        sessions: Arc<Mutex<HashMap<String, RdpSession>>>,
        app: &AppHandle,
        request: StartRdpSessionRequest,
    ) -> Result<RdpSessionStarted, String> {
        let password_supplied = request.password().is_some();
        let secret_owner_id_present = request.secret_owner_id().is_some();
        let session_id = required_id(request.session_id)?;
        let host = required_field("RDP host", request.host)?;
        let user = request.user.trim().to_string();
        let port = request.port.unwrap_or(3389);
        if port == 0 {
            return Err("RDP port must be between 1 and 65535".to_string());
        }
        let requested_bounds = json!({
            "x": request.x,
            "y": request.y,
            "width": request.width,
            "height": request.height,
        });

        {
            let sessions = lock_sessions(&sessions)?;
            if sessions.contains_key(&session_id) {
                return Err(format!("RDP session '{session_id}' is already running"));
            }
        }

        rdp_debug(
            "session.start.request",
            &json!({
                "sessionId": &session_id,
                "host": &host,
                "user": &user,
                "port": port,
                "keychainOwnerPresent": secret_owner_id_present,
                "passwordSupplied": password_supplied,
                "bounds": requested_bounds,
                "options": &request.options,
            }),
        );

        let atl = atl_functions()?;
        unsafe {
            OleInitialize(None)
                .map_err(|error| format!("failed to initialize OLE for RDP hosting: {error}"))?;
            if (atl.ax_win_init)() == 0 {
                return Err("failed to initialize ATL ActiveX hosting".to_string());
            }
        }

        let host_window = app
            .get_webview_window(HOST_WINDOW_LABEL)
            .ok_or_else(|| format!("host window '{HOST_WINDOW_LABEL}' is not available"))?;
        let parent_hwnd = host_window
            .hwnd()
            .map_err(|error| format!("failed to get host window handle: {error}"))?;

        let parent_hwnd = HWND(parent_hwnd.0);
        let host_scale_factor = host_window
            .scale_factor()
            .map_err(|error| format!("failed to read host window scale factor: {error}"))?;
        let scale_factor = rdp_request_scale_factor(request.scale_factor, host_scale_factor);
        let size = scaled_rect(
            request.x,
            request.y,
            request.width,
            request.height,
            scale_factor,
        );
        let initial_rect = staged_rect(size.2, size.3);
        rdp_debug(
            "session.start.geometry",
            &json!({
                "sessionId": &session_id,
                "scaleFactor": scale_factor,
                "hostScaleFactor": host_scale_factor,
                "scaledRect": {
                    "x": size.0,
                    "y": size.1,
                    "width": size.2,
                    "height": size.3,
                },
                "initialStagedRect": {
                    "x": initial_rect.0,
                    "y": initial_rect.1,
                    "width": initial_rect.2,
                    "height": initial_rect.3,
                },
            }),
        );
        let (hwnd, dispatch, control) = create_rdp_control(parent_hwnd, initial_rect)?;
        let options = request.options.unwrap_or_default();
        let resolution_mode = RemoteResolutionMode::parse(&options.remote_resolution);
        let display_settings = resolution_mode.display_settings(
            request.width,
            request.height,
            size.2,
            size.3,
            scale_factor,
        );
        let smart_sizing = smart_sizing_for_physical_bounds(resolution_mode, size.2, size.3);
        rdp_debug(
            "session.start.display_settings",
            &json!({
                "sessionId": &session_id,
                "control": &control,
                "resolutionMode": resolution_mode_name(resolution_mode),
                "desktopWidth": display_settings.desktop_width,
                "desktopHeight": display_settings.desktop_height,
                "physicalWidth": display_settings.physical_width,
                "physicalHeight": display_settings.physical_height,
                "desktopScaleFactor": display_settings.desktop_scale_factor,
                "deviceScaleFactor": display_settings.device_scale_factor,
            }),
        );

        configure_rdp_control(
            &dispatch,
            &host,
            &user,
            port,
            request.password.as_deref(),
            display_settings,
            smart_sizing,
            &options,
        )?;
        rdp_debug(
            "session.start.configured",
            &json!({
                "sessionId": &session_id,
                "control": &control,
                "host": &host,
                "user": &user,
                "port": port,
                "passwordSupplied": password_supplied,
                "options": &options,
            }),
        );
        invoke_method(&dispatch, "Connect")?;
        rdp_debug(
            "session.start.connect_invoked",
            &json!({
                "sessionId": &session_id,
                "control": &control,
            }),
        );

        let mut sessions = lock_sessions(&sessions)?;
        sessions.insert(
            session_id.clone(),
            RdpSession {
                session_id: session_id.clone(),
                hwnd,
                owner: parent_hwnd,
                dispatch,
                // DesktopWidth/DesktopHeight seed the initial connection, but the
                // ActiveX control may not apply dynamic sizing until after Connect
                // has progressed. Keep the initial values as the best known
                // remote desktop aspect if the server later rejects display
                // control updates.
                desktop_width: display_settings.desktop_width,
                desktop_height: display_settings.desktop_height,
                desktop_scale_factor: display_settings.desktop_scale_factor,
                device_scale_factor: display_settings.device_scale_factor,
                dynamic_resize_failures: 0,
                resolution_mode,
            },
        );

        rdp_debug(
            "session.start.ok",
            &json!({
                "sessionId": &session_id,
                "host": &host,
                "port": port,
                "control": &control,
            }),
        );

        Ok(RdpSessionStarted {
            session_id,
            host,
            port,
            control,
        })
    }

    fn create_rdp_control(
        owner_hwnd: HWND,
        rect: (i32, i32, i32, i32),
    ) -> Result<(HWND, IDispatch, String), String> {
        let mut last_error = String::new();
        for progid in RDP_PROGIDS {
            rdp_debug(
                "control.create.try",
                &json!({
                    "progid": progid,
                    "rect": {
                        "x": rect.0,
                        "y": rect.1,
                        "width": rect.2,
                        "height": rect.3,
                    },
                }),
            );
            let class_name = wide_null("AtlAxWin");
            let control_name = wide_null(progid);
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                    PCWSTR(class_name.as_ptr()),
                    PCWSTR(control_name.as_ptr()),
                    WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                    rect.0,
                    rect.1,
                    rect.2,
                    rect.3,
                    Some(owner_hwnd),
                    Option::<HMENU>::None,
                    None,
                    None,
                )
            };

            let hwnd = match hwnd {
                Ok(hwnd) => hwnd,
                Err(error) => {
                    last_error = format!("{progid}: {error}");
                    rdp_debug(
                        "control.create.window_error",
                        &json!({
                            "progid": progid,
                            "error": error.to_string(),
                        }),
                    );
                    continue;
                }
            };

            match control_dispatch(hwnd).and_then(|dispatch| {
                get_dispid(&dispatch, "Server")?;
                Ok(dispatch)
            }) {
                Ok(dispatch) => {
                    rdp_debug("control.create.ok", &json!({ "progid": progid }));
                    return Ok((hwnd, dispatch, (*progid).to_string()));
                }
                Err(error) => {
                    last_error = format!("{progid}: {error}");
                    rdp_debug(
                        "control.create.dispatch_error",
                        &json!({
                            "progid": progid,
                            "error": &error,
                        }),
                    );
                    unsafe {
                        let _ = DestroyWindow(hwnd);
                    }
                }
            }
        }

        Err(format!(
            "failed to create Microsoft RDP ActiveX control from mstscax.dll ({last_error})"
        ))
    }

    /// Process-wide state for the RDP overlay keyboard-focus hook.
    ///
    /// The RDP ActiveX overlay is a separate top-level `WS_POPUP` window created
    /// `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` (see `create_rdp_control`) and only
    /// ever shown/moved with `SWP_NOACTIVATE` / `SW_SHOWNOACTIVATE` so it never
    /// steals activation from the main KKTerm frame. The side effect is that
    /// clicking the remote desktop neither brings KKTerm to the foreground nor
    /// routes keyboard focus into the control: mouse messages still reach the
    /// control (Windows delivers them to the window under the cursor - so the
    /// remote cursor moves and text can even be selected) but keystrokes keep
    /// going to whatever window held OS focus, e.g. another app on a second
    /// monitor. The user had to click the connection tab first.
    ///
    /// `WM_MOUSEACTIVATE` is *not* the answer here: for a `WS_EX_NOACTIVATE`
    /// top-level window Windows suppresses activation entirely on click and never
    /// generates `WM_MOUSEACTIVATE` (it only fires for such a window via the
    /// "hover-to-activate" accessibility feature - where a previous attempt at a
    /// `WM_MOUSEACTIVATE` subclass actually turned the overlay into a focus-stealer
    /// on mere hover). A thread-local `WH_MOUSE` hook also proved too optimistic:
    /// the real click can be delivered to an mstscax-owned child HWND whose queue is
    /// not the Tauri main thread. Instead we install a low-level `WH_MOUSE_LL` hook,
    /// which observes button-down globally before the message is posted. The hook
    /// resolves the screen point with `WindowFromPoint`, verifies it is inside the
    /// visible overlay subtree, foregrounds the no-activate overlay programmatically,
    /// focuses the clicked/hosted ActiveX child HWND, and then forwards the click so
    /// the remote session still receives it.
    ///
    /// All hook state is created, installed, and uninstalled on Tauri's main
    /// thread (every entry point dispatches through `run_on_main_thread`), which
    /// is the only thread that ever owns an RDP overlay window. Only one overlay
    /// is visible at a time, so a single hook guarded by the current targets is
    /// sufficient and there is no per-HWND bookkeeping.
    struct RdpOverlayFocusHook {
        hook: Option<HHOOK>,
        overlay: Option<HWND>,
        owner: Option<HWND>,
        focus: Option<HWND>,
    }

    impl RdpOverlayFocusHook {
        const fn new() -> Self {
            Self {
                hook: None,
                overlay: None,
                owner: None,
                focus: None,
            }
        }
    }

    // The hook handle and overlay/owner HWNDs are raw pointers, which are not
    // `Send`/`Sync` by default. The state lives behind a `Mutex` in a static and
    // is only ever read/written from the Tauri main thread (the single thread
    // that owns the overlay window), exactly like `RdpSession`'s own `Send`
    // impl, so sharing it across threads is sound.
    unsafe impl Send for RdpOverlayFocusHook {}
    unsafe impl Sync for RdpOverlayFocusHook {}

    static RDP_OVERLAY_FOCUS_HOOK: OnceLock<Mutex<RdpOverlayFocusHook>> = OnceLock::new();

    fn rdp_overlay_focus_hook() -> &'static Mutex<RdpOverlayFocusHook> {
        RDP_OVERLAY_FOCUS_HOOK.get_or_init(|| Mutex::new(RdpOverlayFocusHook::new()))
    }

    /// `WH_MOUSE_LL` hook. `wParam` is the mouse message; `lParam` points to an
    /// `MSLLHOOKSTRUCT` with the screen point for the click. We foreground KKTerm,
    /// foreground the no-activate overlay explicitly, and focus the actual child HWND
    /// under the cursor (or the hosted ActiveX HWND as a fallback), then always call
    /// `CallNextHookEx` so the click still reaches the remote session.
    unsafe extern "system" fn rdp_overlay_focus_hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> windows::Win32::Foundation::LRESULT {
        if code == HC_ACTION as i32 {
            let down = matches!(
                wparam.0 as u32,
                WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN
            );
            if down {
                let mut grab = None;
                {
                    let state = rdp_overlay_focus_hook()
                        .lock()
                        .expect("RDP overlay focus hook mutex poisoned");
                    if let (Some(overlay), Some(owner)) = (state.overlay, state.owner) {
                        let target = if lparam.0 != 0 {
                            let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
                            let target = unsafe { WindowFromPoint(info.pt) };
                            (!target.0.is_null()).then_some(target)
                        } else {
                            None
                        };
                        let inside = target
                            .map(|target| {
                                target == overlay || unsafe { IsChild(overlay, target) }.as_bool()
                            })
                            .unwrap_or(false);
                        if inside {
                            let focus = target
                                .filter(|target| *target != overlay)
                                .or(state.focus)
                                .unwrap_or(overlay);
                            grab = Some((owner, overlay, focus));
                        }
                    }
                }
                if let Some((owner, overlay, focus)) = grab {
                    focus_rdp_window(owner, overlay, focus);
                }
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    /// Record which overlay/owner should grab focus on click, installing the
    /// low-level mouse hook lazily on first use. Must be called on the main
    /// thread, which owns the RDP overlay window and receives the hook callback.
    fn set_rdp_overlay_focus_targets(
        overlay: Option<HWND>,
        owner: Option<HWND>,
        focus: Option<HWND>,
    ) {
        let mut state = rdp_overlay_focus_hook()
            .lock()
            .expect("RDP overlay focus hook mutex poisoned");
        state.overlay = overlay;
        state.owner = owner;
        state.focus = focus;
        if overlay.is_some() && state.hook.is_none() {
            unsafe {
                let module = GetModuleHandleW(PCWSTR::null())
                    .ok()
                    .map(|handle| HINSTANCE(handle.0));
                match SetWindowsHookExW(WH_MOUSE_LL, Some(rdp_overlay_focus_hook_proc), module, 0) {
                    Ok(hook) => {
                        state.hook = Some(hook);
                    }
                    Err(error) => {
                        rdp_debug(
                            "focus_hook.install_error",
                            &json!({ "error": error.to_string() }),
                        );
                    }
                }
            }
        }
    }

    /// Remove the focus hook entirely, e.g. when no RDP sessions remain.
    fn uninstall_rdp_overlay_focus_hook() {
        let mut state = rdp_overlay_focus_hook()
            .lock()
            .expect("RDP overlay focus hook mutex poisoned");
        if let Some(hook) = state.hook.take() {
            unsafe {
                let _ = UnhookWindowsHookEx(hook);
            }
        }
        state.overlay = None;
        state.owner = None;
        state.focus = None;
    }

    fn control_dispatch(hwnd: HWND) -> Result<IDispatch, String> {
        let mut unknown = std::ptr::null_mut();
        let atl = atl_functions()?;
        unsafe {
            (atl.ax_get_control)(hwnd, &mut unknown)
                .ok()
                .map_err(|error| format!("failed to get RDP ActiveX control: {error}"))?;
            let unknown = windows::core::IUnknown::from_raw(unknown);
            unknown
                .cast::<IDispatch>()
                .map_err(|error| format!("RDP ActiveX control does not expose IDispatch: {error}"))
        }
    }

    fn configure_rdp_control(
        dispatch: &IDispatch,
        host: &str,
        user: &str,
        port: u16,
        password: Option<&str>,
        display_settings: RdpDisplaySettings,
        smart_sizing: bool,
        options: &RdpSessionOptions,
    ) -> Result<(), String> {
        let (domain, username) = split_windows_user(user);
        set_property_string(dispatch, "Server", host)?;
        if !username.is_empty() {
            set_property_string(dispatch, "UserName", &username)?;
        }
        if let Some(domain) = domain.as_deref() {
            set_property_string(dispatch, "Domain", domain)?;
        }
        set_property_i32(dispatch, "ColorDepth", i32::from(options.color_depth))?;
        set_property_i32(dispatch, "DesktopWidth", display_settings.desktop_width)?;
        set_property_i32(dispatch, "DesktopHeight", display_settings.desktop_height)?;
        set_optional_property_bool(dispatch, "PromptForCredentials", password.is_none())?;
        set_optional_property_string(dispatch, "ConnectingText", "Connecting to remote desktop")?;
        set_optional_property_string(dispatch, "DisconnectedText", "Remote desktop disconnected")?;
        if let Some(password) = password.filter(|value| !value.is_empty()) {
            set_clear_text_password(dispatch, password);
        }

        if let Some(advanced) = get_advanced_settings(dispatch) {
            let _ = set_property_bool(&advanced, "AllowPromptingForCredentials", true);
            let _ = set_property_i32(&advanced, "RDPPort", i32::from(port));
            let _ = set_property_bool(
                &advanced,
                "ConnectToAdministerServer",
                options.administrative_session,
            );
            let _ = set_property_bool(&advanced, "EnableCredSspSupport", true);
            // The embedded MsRdpClient ActiveX has no UI to show the server-auth
            // certificate-trust warning that mstsc.exe displays on first contact.
            // With the default AuthenticationLevel of 2 ("Warn"), the control stalls
            // silently at a blank pre-login screen until mstsc has been used once to
            // persist the cert hash under HKCU\...\Terminal Server Client\Servers.
            // 0 = connect even if server authentication fails, matching the posture
            // used by embedded RDP hosts (RDWeb, FreeRDP).
            let _ = set_property_i32(&advanced, "AuthenticationLevel", 0);
            let _ = set_property_bool(&advanced, "NegotiateSecurityLayer", true);
            // Match mstsc's Local Resources defaults closely enough for embedded sessions:
            // Windows shortcut replacements (including Ctrl+Alt+End for SAS) must be routed to
            // the remote host, while higher-risk device redirects stay disabled until KKTerm
            // exposes durable Connection settings for them.
            let _ = set_property_bool(&advanced, "RedirectClipboard", options.redirect_clipboard);
            let redirect_all_drives = options.redirect_drives
                && matches!(&options.drive_selection, RdpDriveSelection::All);
            let _ = set_property_bool(&advanced, "RedirectDrives", redirect_all_drives);
            let _ = set_property_bool(&advanced, "RedirectPorts", false);
            let _ = set_property_bool(&advanced, "RedirectPrinters", false);
            let _ = set_property_bool(&advanced, "RedirectSmartCards", false);
            let _ = set_property_i32(&advanced, "SasSequence", RDP_STANDARD_SAS_SEQUENCE);
            let _ = set_property_i32(&advanced, "HotKeyCtrlAltDel", VK_END_KEY as i32);
            let _ = set_property_bool(&advanced, "SmartSizing", smart_sizing);
            let _ = set_property_bool(&advanced, "BitmapPersistence", options.bitmap_cache);
            let _ = set_property_bool(&advanced, "CachePersistenceActive", options.bitmap_cache);
            let _ = set_property_i32(
                &advanced,
                "PerformanceFlags",
                performance_flags_for(&options.performance_profile),
            );
        }
        if options.redirect_drives {
            match configure_drive_collection(dispatch, &options.drive_selection) {
                Ok(()) => {}
                Err(_) if matches!(&options.drive_selection, RdpDriveSelection::All) => {}
                Err(error) => return Err(error),
            }
        }
        if display_settings.desktop_scale_factor != RDP_DISPLAY_SCALE_FACTOR_PERCENT {
            if let Some(extended) = get_extended_settings(dispatch) {
                let _ = set_extended_setting_u32(
                    &extended,
                    "DesktopScaleFactor",
                    display_settings.desktop_scale_factor as u32,
                );
                let _ = set_extended_setting_u32(
                    &extended,
                    "DeviceScaleFactor",
                    display_settings.device_scale_factor as u32,
                );
            }
        }
        if let Some(secured) = get_secured_settings(dispatch) {
            let _ = set_property_i32(&secured, "KeyboardHookMode", 1);
        }

        Ok(())
    }

    impl Default for RdpSessionOptions {
        fn default() -> Self {
            Self {
                color_depth: default_color_depth(),
                administrative_session: false,
                redirect_clipboard: true,
                redirect_drives: false,
                drive_selection: RdpDriveSelection::All,
                bitmap_cache: true,
                performance_profile: default_performance_profile(),
                remote_resolution: default_remote_resolution(),
            }
        }
    }

    fn default_remote_resolution() -> String {
        "automatic".to_string()
    }

    fn default_color_depth() -> u16 {
        32
    }

    fn default_true() -> bool {
        true
    }

    fn default_performance_profile() -> String {
        "balanced".to_string()
    }

    fn performance_flags_for(profile: &str) -> i32 {
        match profile {
            "quality" => 0,
            "speed" => 0x0000_0001 | 0x0000_0002 | 0x0000_0004 | 0x0000_0008 | 0x0000_0020,
            _ => 0x0000_0001 | 0x0000_0004 | 0x0000_0008,
        }
    }

    fn resolution_mode_name(mode: RemoteResolutionMode) -> &'static str {
        match mode {
            RemoteResolutionMode::Automatic => "automatic",
            RemoteResolutionMode::SmartSizing => "smartSizing",
            RemoteResolutionMode::DpiZoom => "dpiZoom",
            RemoteResolutionMode::Fixed { .. } => "fixed",
        }
    }

    fn split_windows_user(user: &str) -> (Option<String>, String) {
        let trimmed = user.trim();
        if let Some((domain, username)) = trimmed.split_once('\\') {
            let domain = domain.trim();
            let username = username.trim();
            if !domain.is_empty() && !username.is_empty() {
                return (Some(domain.to_string()), username.to_string());
            }
        }
        (None, trimmed.to_string())
    }

    fn get_dispid(dispatch: &IDispatch, name: &str) -> Result<i32, String> {
        let wide = wide_null(name);
        let mut name_ptr = PCWSTR(wide.as_ptr());
        let mut dispid = 0;
        unsafe {
            dispatch
                .GetIDsOfNames(
                    &windows::core::GUID::zeroed(),
                    &mut name_ptr,
                    1,
                    LOCALE_USER_DEFAULT,
                    &mut dispid,
                )
                .map_err(|error| format!("RDP ActiveX member '{name}' was not found: {error}"))?;
        }
        Ok(dispid)
    }

    fn set_property_string(dispatch: &IDispatch, name: &str, value: &str) -> Result<(), String> {
        invoke_property_put(dispatch, name, VariantArg::bstr(value))
    }

    fn set_optional_property_string(
        dispatch: &IDispatch,
        name: &str,
        value: &str,
    ) -> Result<(), String> {
        match set_property_string(dispatch, name, value) {
            Ok(()) => Ok(()),
            Err(_) => Ok(()),
        }
    }

    fn set_property_i32(dispatch: &IDispatch, name: &str, value: i32) -> Result<(), String> {
        invoke_property_put(dispatch, name, VariantArg::i4(value))
    }

    fn set_property_bool(dispatch: &IDispatch, name: &str, value: bool) -> Result<(), String> {
        invoke_property_put(dispatch, name, VariantArg::bool(value))
    }

    fn set_optional_property_bool(
        dispatch: &IDispatch,
        name: &str,
        value: bool,
    ) -> Result<(), String> {
        match set_property_bool(dispatch, name, value) {
            Ok(()) => Ok(()),
            Err(_) => Ok(()),
        }
    }

    fn set_clear_text_password(dispatch: &IDispatch, password: &str) {
        if set_property_string(dispatch, "ClearTextPassword", password).is_ok() {
            return;
        }
        if let Some(advanced) = get_advanced_settings(dispatch) {
            let _ = set_property_string(&advanced, "ClearTextPassword", password);
        }
    }

    fn set_connection_bar_text(dispatch: &IDispatch, text: &str) -> Result<(), String> {
        let nonscriptable = dispatch
            .cast::<IMsRdpClientNonScriptable3>()
            .map_err(|error| {
                format!("RDP ActiveX does not expose native connection-bar settings: {error}")
            })?;
        unsafe {
            (nonscriptable.vtable().connection_bar_text_put)(
                Interface::as_raw(&nonscriptable),
                BSTR::from(text),
            )
            .ok()
            .map_err(|error| format!("failed to set the RDP connection-bar text: {error}"))
        }
    }

    fn configure_native_fullscreen(dispatch: &IDispatch) -> Result<(), String> {
        set_connection_bar_text(dispatch, "KKTerm")?;
        let advanced = get_advanced_settings(dispatch)
            .ok_or_else(|| "RDP ActiveX advanced settings are unavailable".to_string())?;
        set_property_bool(&advanced, "DisplayConnectionBar", true)?;
        set_property_bool(&advanced, "PinConnectionBar", false)?;
        let _ = set_property_bool(&advanced, "ConnectionBarShowRestoreButton", true);
        let _ = set_property_bool(&advanced, "ConnectionBarShowMinimizeButton", false);
        Ok(())
    }

    fn get_advanced_settings(dispatch: &IDispatch) -> Option<IDispatch> {
        ADVANCED_SETTINGS_PROPERTIES
            .iter()
            .find_map(|name| get_dispatch_property(dispatch, name).ok())
    }

    fn get_extended_settings(dispatch: &IDispatch) -> Option<IDispatch> {
        EXTENDED_SETTINGS_PROPERTIES
            .iter()
            .find_map(|name| get_dispatch_property(dispatch, name).ok())
    }

    fn get_secured_settings(dispatch: &IDispatch) -> Option<IDispatch> {
        SECURED_SETTINGS_PROPERTIES
            .iter()
            .find_map(|name| get_dispatch_property(dispatch, name).ok())
    }

    fn configure_drive_collection(
        dispatch: &IDispatch,
        selection: &RdpDriveSelection,
    ) -> Result<(), String> {
        let nonscriptable = dispatch
            .cast::<IMsRdpClientNonScriptable3>()
            .map_err(|error| format!("RDP ActiveX does not support selecting drives: {error}"))?;
        let mut raw_collection = std::ptr::null_mut();
        unsafe {
            (nonscriptable.vtable().drive_collection_get)(
                Interface::as_raw(&nonscriptable),
                &mut raw_collection,
            )
            .ok()
            .map_err(|error| format!("failed to read the RDP drive collection: {error}"))?;
        }
        if raw_collection.is_null() {
            return Err("RDP ActiveX returned an empty drive collection".to_string());
        }
        let collection = IMsRdpDriveCollection(unsafe { IUnknown::from_raw(raw_collection) });
        unsafe {
            let _ =
                (collection.vtable().rescan_drives)(Interface::as_raw(&collection), VARIANT_FALSE);
        }
        let mut count = 0;
        unsafe {
            (collection.vtable().drive_count)(Interface::as_raw(&collection), &mut count)
                .ok()
                .map_err(|error| format!("failed to count local drives for RDP: {error}"))?;
        }
        let selected = match selection {
            RdpDriveSelection::All => None,
            RdpDriveSelection::Selected { drives } => Some(
                drives
                    .iter()
                    .filter_map(|drive| normalize_drive_root(drive))
                    .collect::<BTreeSet<_>>(),
            ),
        };
        for index in 0..count {
            let mut raw_drive = std::ptr::null_mut();
            unsafe {
                (collection.vtable().drive_by_index)(
                    Interface::as_raw(&collection),
                    index,
                    &mut raw_drive,
                )
                .ok()
                .map_err(|error| format!("failed to read local RDP drive {index}: {error}"))?;
            }
            if raw_drive.is_null() {
                continue;
            }
            let drive = IMsRdpDrive(unsafe { IUnknown::from_raw(raw_drive) });
            let mut name = BSTR::new();
            unsafe {
                (drive.vtable().name_get)(Interface::as_raw(&drive), &mut name)
                    .ok()
                    .map_err(|error| format!("failed to read an RDP drive name: {error}"))?;
            }
            let normalized = normalize_drive_root(&name.to_string());
            let redirect = selected.as_ref().is_none_or(|selected| {
                normalized
                    .as_ref()
                    .is_some_and(|name| selected.contains(name))
            });
            unsafe {
                (drive.vtable().redirection_state_put)(
                    Interface::as_raw(&drive),
                    if redirect {
                        VARIANT_TRUE
                    } else {
                        VARIANT_FALSE
                    },
                )
                .ok()
                .map_err(|error| format!("failed to update RDP drive redirection: {error}"))?;
            }
        }
        Ok(())
    }

    fn normalize_drive_root(value: &str) -> Option<String> {
        let trimmed = value.trim();
        let bytes = trimmed.as_bytes();
        if bytes.len() < 2 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
            return None;
        }
        Some(format!("{}:", char::from(bytes[0]).to_ascii_uppercase()))
    }

    fn set_extended_setting_u32(
        dispatch: &IDispatch,
        name: &str,
        value: u32,
    ) -> Result<(), String> {
        let dispid = get_dispid(dispatch, "Property")?;
        let mut args = [variant_u4(value), variant_bstr(name)];
        let mut named_arg = DISPID_PROPERTYPUT;
        let mut params = DISPPARAMS {
            rgvarg: args.as_mut_ptr(),
            rgdispidNamedArgs: &mut named_arg,
            cArgs: args.len() as u32,
            cNamedArgs: 1,
        };
        unsafe {
            let result = dispatch.Invoke(
                dispid,
                &windows::core::GUID::zeroed(),
                LOCALE_USER_DEFAULT,
                DISPATCH_PROPERTYPUT,
                &mut params,
                None,
                None,
                None,
            );
            for arg in args.iter_mut() {
                let _ = VariantClear(arg);
            }
            result.map_err(|error| {
                format!("failed to set RDP ActiveX extended property '{name}': {error}")
            })
        }
    }

    fn invoke_property_put(
        dispatch: &IDispatch,
        name: &str,
        mut arg: VariantArg,
    ) -> Result<(), String> {
        let dispid = get_dispid(dispatch, name)?;
        let mut named_arg = DISPID_PROPERTYPUT;
        let mut params = DISPPARAMS {
            rgvarg: &mut arg.0,
            rgdispidNamedArgs: &mut named_arg,
            cArgs: 1,
            cNamedArgs: 1,
        };
        unsafe {
            dispatch
                .Invoke(
                    dispid,
                    &windows::core::GUID::zeroed(),
                    LOCALE_USER_DEFAULT,
                    DISPATCH_PROPERTYPUT,
                    &mut params,
                    None,
                    None,
                    None,
                )
                .map_err(|error| format!("failed to set RDP ActiveX property '{name}': {error}"))
        }
    }

    fn get_dispatch_property(dispatch: &IDispatch, name: &str) -> Result<IDispatch, String> {
        let dispid = get_dispid(dispatch, name)?;
        let mut result = VARIANT::default();
        let params = DISPPARAMS::default();
        unsafe {
            dispatch
                .Invoke(
                    dispid,
                    &windows::core::GUID::zeroed(),
                    LOCALE_USER_DEFAULT,
                    DISPATCH_PROPERTYGET,
                    &params,
                    Some(&mut result),
                    None,
                    None,
                )
                .map_err(|error| {
                    format!("failed to read RDP ActiveX property '{name}': {error}")
                })?;
            let variant_data = &*result.Anonymous.Anonymous;
            if variant_data.vt != VT_DISPATCH {
                return Err(format!(
                    "RDP ActiveX property '{name}' did not return IDispatch"
                ));
            }
            let dispatch = (*variant_data.Anonymous.pdispVal)
                .clone()
                .ok_or_else(|| format!("RDP ActiveX property '{name}' did not return IDispatch"))?;
            Ok(dispatch)
        }
    }

    fn get_property_i32(dispatch: &IDispatch, name: &str) -> Result<i32, String> {
        let dispid = get_dispid(dispatch, name)?;
        let mut result = VARIANT::default();
        let params = DISPPARAMS::default();
        unsafe {
            dispatch
                .Invoke(
                    dispid,
                    &windows::core::GUID::zeroed(),
                    LOCALE_USER_DEFAULT,
                    DISPATCH_PROPERTYGET,
                    &params,
                    Some(&mut result),
                    None,
                    None,
                )
                .map_err(|error| {
                    format!("failed to read RDP ActiveX property '{name}': {error}")
                })?;
            let variant_data = &*result.Anonymous.Anonymous;
            let value = match variant_data.vt {
                VT_I2 => i32::from(variant_data.Anonymous.iVal),
                VT_I4 => variant_data.Anonymous.lVal,
                VT_BOOL => {
                    if variant_data.Anonymous.boolVal.as_bool() {
                        1
                    } else {
                        0
                    }
                }
                _ => {
                    let _ = VariantClear(&mut result);
                    return Err(format!(
                        "RDP ActiveX property '{name}' did not return an integer state"
                    ));
                }
            };
            let _ = VariantClear(&mut result);
            Ok(value)
        }
    }

    fn invoke_method(dispatch: &IDispatch, name: &str) -> Result<(), String> {
        invoke_method_with_i32_args(dispatch, name, &[])
    }

    fn send_text_via_clipboard(
        dispatch: &IDispatch,
        hwnd: HWND,
        text: &str,
        press_enter: bool,
    ) -> Result<(), String> {
        if !text.is_empty() {
            write_unicode_clipboard(hwnd, text)?;
            send_key_chord(
                dispatch,
                &[
                    KeyEvent::down(VK_CONTROL_KEY),
                    KeyEvent::press(VK_V_KEY),
                    KeyEvent::up(VK_CONTROL_KEY),
                ],
            )?;
        }
        if press_enter {
            send_key_chord(dispatch, &[KeyEvent::press(VK_RETURN_KEY)])?;
        }
        Ok(())
    }

    fn write_unicode_clipboard(hwnd: HWND, text: &str) -> Result<(), String> {
        let mut wide: Vec<u16> = text.encode_utf16().collect();
        wide.push(0);
        let bytes = wide.len() * std::mem::size_of::<u16>();
        unsafe {
            OpenClipboard(Some(hwnd))
                .map_err(|error| format!("failed to open clipboard for RDP paste: {error}"))?;
            let result = (|| -> Result<(), String> {
                EmptyClipboard()
                    .map_err(|error| format!("failed to empty clipboard for RDP paste: {error}"))?;
                let hmem: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(|error| {
                    format!("failed to allocate clipboard memory for RDP paste: {error}")
                })?;
                let dst = GlobalLock(hmem) as *mut u16;
                if dst.is_null() {
                    return Err("failed to lock clipboard memory for RDP paste".to_string());
                }
                std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
                let _ = GlobalUnlock(hmem);
                let handle = HANDLE(hmem.0);
                if SetClipboardData(CF_UNICODETEXT.0 as u32, Some(handle)).is_err() {
                    return Err("failed to set clipboard data for RDP paste".to_string());
                }
                Ok(())
            })();

            let _ = CloseClipboard();
            result
        }
    }

    fn send_text_via_keys(
        dispatch: &IDispatch,
        text: &str,
        press_enter: bool,
    ) -> Result<(), String> {
        let mut events = Vec::new();
        for ch in text.chars() {
            match ch {
                '\r' => {}
                '\n' => push_key_press(&mut events, VK_RETURN_KEY),
                '\t' => push_key_press(&mut events, VK_TAB_KEY),
                _ => append_unicode_char_key_events(&mut events, ch)?,
            }
        }
        if press_enter {
            push_key_press(&mut events, VK_RETURN_KEY);
        }
        send_key_events(dispatch, &events)
    }

    fn append_unicode_char_key_events(events: &mut Vec<KeyEvent>, ch: char) -> Result<(), String> {
        let code = ch as u32;
        if code > u16::MAX as u32 {
            return Err(format!(
                "character U+{code:04X} cannot be typed via SendKeys: only BMP characters are supported"
            ));
        }
        let scan = unsafe { VkKeyScanW(code as u16) };
        if scan == -1 {
            return Err(format!(
                "character '{ch}' cannot be typed via SendKeys on the active keyboard layout; switch to clipboard mode"
            ));
        }
        let vk = (scan & 0xff) as usize;
        let modifiers = (scan >> 8) & 0xff;
        let need_shift = modifiers & 0x01 != 0;
        let need_ctrl = modifiers & 0x02 != 0;
        let need_alt = modifiers & 0x04 != 0;
        if need_shift {
            events.push(KeyEvent::down(VK_SHIFT_KEY));
        }
        if need_ctrl {
            events.push(KeyEvent::down(VK_CONTROL_KEY));
        }
        if need_alt {
            events.push(KeyEvent::down(VK_ALT_KEY));
        }
        push_key_press(events, vk);
        if need_alt {
            events.push(KeyEvent::up(VK_ALT_KEY));
        }
        if need_ctrl {
            events.push(KeyEvent::up(VK_CONTROL_KEY));
        }
        if need_shift {
            events.push(KeyEvent::up(VK_SHIFT_KEY));
        }
        Ok(())
    }

    fn push_key_press(events: &mut Vec<KeyEvent>, vk: usize) {
        events.push(KeyEvent::down(vk));
        events.push(KeyEvent::up(vk));
    }

    fn focus_rdp_control(owner: HWND, hwnd: HWND) {
        focus_rdp_window(owner, hwnd, hwnd);
    }

    fn format_hwnd(hwnd: HWND) -> String {
        format!("{:p}", hwnd.0)
    }

    fn focus_rdp_window(owner: HWND, active: HWND, focus: HWND) {
        // Bring KKTerm forward, foreground the no-activate overlay explicitly, and
        // give keyboard focus to the ActiveX child/control HWND that should receive
        // subsequent keystrokes. Ignore errors: foreground-lock rules can deny the
        // raise in some paths, but best-effort focus still keeps programmatic input
        // routed to the in-process control when Windows permits it.
        unsafe {
            let current_thread = GetCurrentThreadId();
            let owner_thread = GetWindowThreadProcessId(owner, None);
            let active_thread = GetWindowThreadProcessId(active, None);
            let focus_thread = GetWindowThreadProcessId(focus, None);
            let foreground = GetForegroundWindow();
            let foreground_thread = if foreground.0.is_null() {
                0
            } else {
                GetWindowThreadProcessId(foreground, None)
            };
            let attached_owner = owner_thread != 0
                && owner_thread != current_thread
                && AttachThreadInput(current_thread, owner_thread, true).as_bool();
            let attached_active = active_thread != 0
                && active_thread != current_thread
                && active_thread != owner_thread
                && AttachThreadInput(current_thread, active_thread, true).as_bool();
            let attached_focus = focus_thread != 0
                && focus_thread != current_thread
                && focus_thread != owner_thread
                && focus_thread != active_thread
                && AttachThreadInput(current_thread, focus_thread, true).as_bool();
            let attached_foreground = foreground_thread != 0
                && foreground_thread != current_thread
                && foreground_thread != owner_thread
                && foreground_thread != active_thread
                && foreground_thread != focus_thread
                && AttachThreadInput(current_thread, foreground_thread, true).as_bool();

            let foreground_owner = SetForegroundWindow(owner).as_bool();
            let foreground_active = SetForegroundWindow(active).as_bool();
            let previous_focus = GetFocus();
            let _ = SetFocus(Some(focus));
            let resulting_focus = GetFocus();
            let set_focus_succeeded = resulting_focus == focus;
            rdp_debug(
                "focus.apply",
                &json!({
                    "ownerHwnd": format_hwnd(owner),
                    "activeHwnd": format_hwnd(active),
                    "focusHwnd": format_hwnd(focus),
                    "foregroundHwnd": format_hwnd(foreground),
                    "currentThread": current_thread,
                    "ownerThread": owner_thread,
                    "activeThread": active_thread,
                    "focusThread": focus_thread,
                    "foregroundThread": foreground_thread,
                    "attachedOwnerThread": attached_owner,
                    "attachedActiveThread": attached_active,
                    "attachedFocusThread": attached_focus,
                    "attachedForegroundThread": attached_foreground,
                    "setForegroundOwner": foreground_owner,
                    "setForegroundActive": foreground_active,
                    "setFocusSucceeded": set_focus_succeeded,
                    "previousFocusHwnd": format_hwnd(previous_focus),
                    "resultingFocusHwnd": format_hwnd(resulting_focus),
                }),
            );

            if attached_foreground {
                let _ = AttachThreadInput(current_thread, foreground_thread, false);
            }
            if attached_focus {
                let _ = AttachThreadInput(current_thread, focus_thread, false);
            }
            if attached_active {
                let _ = AttachThreadInput(current_thread, active_thread, false);
            }
            if attached_owner {
                let _ = AttachThreadInput(current_thread, owner_thread, false);
            }
        }
    }

    fn send_ctrl_alt_end_via_windows_input(owner: HWND, hwnd: HWND) -> Result<(), String> {
        focus_rdp_control(owner, hwnd);
        let mut inputs = [
            keyboard_input(VK_CONTROL_KEY, false),
            keyboard_input(VK_ALT_KEY, false),
            keyboard_input(VK_END_KEY, false),
            keyboard_input(VK_END_KEY, true),
            keyboard_input(VK_ALT_KEY, true),
            keyboard_input(VK_CONTROL_KEY, true),
        ];
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent == inputs.len() as u32 {
            Ok(())
        } else {
            // Release the modifiers if Windows accepted only a partial sequence.
            inputs = [
                keyboard_input(VK_END_KEY, true),
                keyboard_input(VK_ALT_KEY, true),
                keyboard_input(VK_CONTROL_KEY, true),
                keyboard_input(VK_END_KEY, true),
                keyboard_input(VK_ALT_KEY, true),
                keyboard_input(VK_CONTROL_KEY, true),
            ];
            let _ = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
            Err(format!(
                "failed to send Ctrl+Alt+End to RDP control: Windows accepted {sent} of {} inputs",
                inputs.len()
            ))
        }
    }

    fn keyboard_input(vk: usize, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk as u16),
                    wScan: 0,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    #[derive(Clone, Copy)]
    struct KeyEvent {
        vk: usize,
        up: bool,
    }

    impl KeyEvent {
        fn down(vk: usize) -> Self {
            Self { vk, up: false }
        }

        fn up(vk: usize) -> Self {
            Self { vk, up: true }
        }

        fn press(vk: usize) -> Self {
            Self::down(vk)
        }
    }

    fn send_ctrl_alt_end_to_rdp(dispatch: &IDispatch) -> Result<(), String> {
        send_key_chord(
            dispatch,
            &[
                KeyEvent::down(VK_CONTROL_KEY),
                KeyEvent::down(VK_ALT_KEY),
                KeyEvent::press(VK_END_KEY),
                KeyEvent::up(VK_ALT_KEY),
                KeyEvent::up(VK_CONTROL_KEY),
            ],
        )
    }

    fn normalize_remote_key_name(value: &str) -> String {
        value
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric())
            .flat_map(|ch| ch.to_lowercase())
            .collect()
    }

    fn rdp_virtual_key_for_name(value: &str) -> Result<usize, String> {
        match normalize_remote_key_name(value).as_str() {
            "enter" | "return" => Ok(VK_RETURN_KEY),
            "tab" => Ok(VK_TAB_KEY),
            "escape" | "esc" => Ok(VK_ESCAPE_KEY),
            "backspace" => Ok(VK_BACKSPACE_KEY),
            "delete" | "del" => Ok(VK_DELETE_KEY),
            "arrowup" | "up" => Ok(VK_UP_KEY),
            "arrowdown" | "down" => Ok(VK_DOWN_KEY),
            "arrowleft" | "left" => Ok(VK_LEFT_KEY),
            "arrowright" | "right" => Ok(VK_RIGHT_KEY),
            "home" => Ok(VK_HOME_KEY),
            "end" => Ok(VK_END_KEY),
            "pageup" | "pgup" => Ok(VK_PAGE_UP_KEY),
            "pagedown" | "pgdn" => Ok(VK_PAGE_DOWN_KEY),
            "space" => Ok(VK_SPACE_KEY),
            _ => Err(format!("unsupported RDP key press: {value}")),
        }
    }

    fn rdp_mouse_messages_for_button(value: &str) -> Result<(u32, u32, usize), String> {
        match normalize_remote_key_name(value).as_str() {
            "left" => Ok((WM_LBUTTONDOWN_MSG, WM_LBUTTONUP_MSG, MK_LBUTTON_WPARAM)),
            "right" => Ok((WM_RBUTTONDOWN_MSG, WM_RBUTTONUP_MSG, MK_RBUTTON_WPARAM)),
            "middle" => Ok((WM_MBUTTONDOWN_MSG, WM_MBUTTONUP_MSG, MK_MBUTTON_WPARAM)),
            _ => Err(format!("unsupported RDP mouse button: {value}")),
        }
    }

    fn send_rdp_mouse_click_messages(
        hwnd: HWND,
        x: u16,
        y: u16,
        down_message: u32,
        up_message: u32,
        button_mask: usize,
    ) {
        let lparam = LPARAM((((y as u32) << 16) | x as u32) as isize);
        unsafe {
            let _ = SendMessageW(hwnd, down_message, Some(WPARAM(button_mask)), Some(lparam));
            let _ = SendMessageW(hwnd, up_message, Some(WPARAM(0)), Some(lparam));
        }
    }

    fn send_key_chord(dispatch: &IDispatch, key_events: &[KeyEvent]) -> Result<(), String> {
        let mut expanded = Vec::with_capacity(key_events.len() * 2);
        for event in key_events {
            if event.up {
                expanded.push(*event);
            } else if matches!(event.vk, VK_CONTROL_KEY | VK_ALT_KEY | VK_SHIFT_KEY) {
                expanded.push(*event);
            } else {
                expanded.push(KeyEvent::down(event.vk));
                expanded.push(KeyEvent::up(event.vk));
            }
        }
        send_key_events(dispatch, &expanded)
    }

    fn send_key_events(dispatch: &IDispatch, key_events: &[KeyEvent]) -> Result<(), String> {
        if key_events.is_empty() {
            return Ok(());
        }
        let nonscriptable = dispatch
            .cast::<IMsRdpClientNonScriptable>()
            .map_err(|error| format!("RDP ActiveX control does not expose SendKeys: {error}"))?;
        for chunk in key_events.chunks(RDP_SEND_KEYS_LIMIT) {
            let mut key_up: Vec<VARIANT_BOOL> = chunk
                .iter()
                .map(|event| {
                    if event.up {
                        VARIANT_TRUE
                    } else {
                        VARIANT_FALSE
                    }
                })
                .collect();
            let mut key_data: Vec<i32> = chunk
                .iter()
                .map(|event| rdp_key_lparam(event.vk, event.up))
                .collect();
            unsafe {
                (nonscriptable.vtable().send_keys)(
                    Interface::as_raw(&nonscriptable),
                    chunk.len() as i32,
                    key_up.as_mut_ptr(),
                    key_data.as_mut_ptr(),
                )
                .ok()
                .map_err(|error| {
                    format!("failed to send keystrokes to RDP ActiveX control: {error}")
                })?;
            }
        }
        Ok(())
    }

    fn rdp_key_lparam(vk: usize, up: bool) -> i32 {
        let map_type = if is_extended_key(vk) {
            MAPVK_VK_TO_VSC_EX
        } else {
            MAPVK_VK_TO_VSC
        };
        let scan_code = unsafe { MapVirtualKeyW(vk as u32, map_type) };
        let scan_code = if scan_code == 0 { 0 } else { scan_code & 0xff };
        let mut value = 1 | ((scan_code as i32) << 16);
        if is_extended_key(vk) {
            value |= 1 << 24;
        }
        if up {
            value |= 1 << 30;
            value |= 1u32.wrapping_shl(31) as i32;
        }
        value
    }

    fn is_extended_key(vk: usize) -> bool {
        matches!(
            vk,
            VK_END_KEY
                | VK_DELETE_KEY
                | VK_HOME_KEY
                | VK_LEFT_KEY
                | VK_UP_KEY
                | VK_RIGHT_KEY
                | VK_DOWN_KEY
                | VK_PAGE_UP_KEY
                | VK_PAGE_DOWN_KEY
        )
    }

    fn invoke_method_with_i32_args(
        dispatch: &IDispatch,
        name: &str,
        args: &[i32],
    ) -> Result<(), String> {
        let dispid = get_dispid(dispatch, name)?;
        let mut variants: Vec<VARIANT> =
            args.iter().rev().map(|value| variant_i4(*value)).collect();
        let mut params = DISPPARAMS {
            rgvarg: if variants.is_empty() {
                std::ptr::null_mut()
            } else {
                variants.as_mut_ptr()
            },
            rgdispidNamedArgs: std::ptr::null_mut(),
            cArgs: variants.len() as u32,
            cNamedArgs: 0,
        };
        let mut result = VARIANT::default();
        unsafe {
            let invoke_result = dispatch
                .Invoke(
                    dispid,
                    &windows::core::GUID::zeroed(),
                    LOCALE_USER_DEFAULT,
                    DISPATCH_METHOD,
                    &mut params,
                    Some(&mut result),
                    None,
                    None,
                )
                .map_err(|error| format!("failed to invoke RDP ActiveX method '{name}': {error}"));
            for variant in variants.iter_mut() {
                let _ = VariantClear(variant);
            }
            let _ = VariantClear(&mut result);
            invoke_result
        }
    }

    fn variant_i4(value: i32) -> VARIANT {
        let mut variant = VARIANT::default();
        unsafe {
            let variant_data = &mut *variant.Anonymous.Anonymous;
            variant_data.vt = VT_I4;
            variant_data.Anonymous.lVal = value;
        }
        variant
    }

    fn show_and_resize_rdp(
        session: &mut RdpSession,
        scale_factor: f64,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        force: bool,
    ) -> Result<(), String> {
        let rect = show_rdp_for_session(session, scale_factor, x, y, width, height)?;
        if !session.resolution_mode.tracks_pane_size() {
            return Ok(());
        }
        let display_settings =
            session
                .resolution_mode
                .display_settings(width, height, rect.2, rect.3, scale_factor);
        let display_sync_completed = sync_remote_desktop_size(session, display_settings, force);
        if !display_sync_completed && force {
            return Err(
                "failed to update RDP remote display size; the remote desktop may already be past the dynamic resize window"
                    .to_string(),
            );
        }
        Ok(())
    }

    fn sync_remote_desktop_size(
        session: &mut RdpSession,
        display_settings: RdpDisplaySettings,
        force: bool,
    ) -> bool {
        let connection_state = get_property_i32(&session.dispatch, "Connected").unwrap_or(-1);
        if !force
            && !should_resize_remote_desktop(
                session.desktop_width,
                session.desktop_height,
                session.desktop_scale_factor,
                session.device_scale_factor,
                display_settings.desktop_width,
                display_settings.desktop_height,
                display_settings.desktop_scale_factor,
                display_settings.device_scale_factor,
            )
        {
            rdp_debug(
                "display.resize.skipped",
                &json!({
                    "reason": "unchanged",
                    "force": force,
                    "connectionState": connection_state,
                    "connectionStateLabel": rdp_connection_state_label(connection_state),
                    "desktopWidth": display_settings.desktop_width,
                    "desktopHeight": display_settings.desktop_height,
                    "physicalWidth": display_settings.physical_width,
                    "physicalHeight": display_settings.physical_height,
                    "desktopScaleFactor": display_settings.desktop_scale_factor,
                    "deviceScaleFactor": display_settings.device_scale_factor,
                }),
            );
            return true;
        }
        let resize_method = match resize_remote_desktop(&session.dispatch, display_settings) {
            Ok(method) => method,
            Err(error) => {
                session.dynamic_resize_failures = session.dynamic_resize_failures.saturating_add(1);
                rdp_debug(
                    "display.resize.error",
                    &json!({
                        "error": error,
                        "force": force,
                        "failures": session.dynamic_resize_failures,
                        "connectionState": connection_state,
                        "connectionStateLabel": rdp_connection_state_label(connection_state),
                        "desktopWidth": display_settings.desktop_width,
                        "desktopHeight": display_settings.desktop_height,
                        "physicalWidth": display_settings.physical_width,
                        "physicalHeight": display_settings.physical_height,
                        "desktopScaleFactor": display_settings.desktop_scale_factor,
                        "deviceScaleFactor": display_settings.device_scale_factor,
                    }),
                );
                return false;
            }
        };
        if session.dynamic_resize_failures > 0 {
            rdp_debug(
                "display.resize.recovered",
                &json!({
                    "previousFailures": session.dynamic_resize_failures,
                    "connectionState": connection_state,
                    "connectionStateLabel": rdp_connection_state_label(connection_state),
                    "desktopWidth": display_settings.desktop_width,
                    "desktopHeight": display_settings.desktop_height,
                    "physicalWidth": display_settings.physical_width,
                    "physicalHeight": display_settings.physical_height,
                    "desktopScaleFactor": display_settings.desktop_scale_factor,
                    "deviceScaleFactor": display_settings.device_scale_factor,
                }),
            );
        }
        session.dynamic_resize_failures = 0;
        session.desktop_width = display_settings.desktop_width;
        session.desktop_height = display_settings.desktop_height;
        session.desktop_scale_factor = display_settings.desktop_scale_factor;
        session.device_scale_factor = display_settings.device_scale_factor;
        rdp_debug(
            "display.resize.ok",
            &json!({
                "method": resize_method,
                "force": force,
                "connectionState": connection_state,
                "connectionStateLabel": rdp_connection_state_label(connection_state),
                "desktopWidth": display_settings.desktop_width,
                "desktopHeight": display_settings.desktop_height,
                "physicalWidth": display_settings.physical_width,
                "physicalHeight": display_settings.physical_height,
                "desktopScaleFactor": display_settings.desktop_scale_factor,
                "deviceScaleFactor": display_settings.device_scale_factor,
            }),
        );
        true
    }

    #[allow(clippy::too_many_arguments)]
    fn should_resize_remote_desktop(
        current_width: i32,
        current_height: i32,
        current_desktop_scale_factor: i32,
        current_device_scale_factor: i32,
        desktop_width: i32,
        desktop_height: i32,
        desktop_scale_factor: i32,
        device_scale_factor: i32,
    ) -> bool {
        // Compare the DPI scale factors alongside the pixel dimensions: the RDP
        // ActiveX control can land at the right resolution but the wrong scale
        // (the first UpdateSessionDisplaySettings after Connect is frequently
        // ignored), and a scale-only correction must still re-issue the resize.
        current_width != desktop_width
            || current_height != desktop_height
            || current_desktop_scale_factor != desktop_scale_factor
            || current_device_scale_factor != device_scale_factor
    }

    fn resize_remote_desktop(
        dispatch: &IDispatch,
        display_settings: RdpDisplaySettings,
    ) -> Result<&'static str, String> {
        invoke_method_with_i32_args(
            dispatch,
            "UpdateSessionDisplaySettings",
            &[
                display_settings.desktop_width,
                display_settings.desktop_height,
                display_settings.physical_width,
                display_settings.physical_height,
                RDP_DISPLAY_ORIENTATION_LANDSCAPE,
                display_settings.desktop_scale_factor,
                display_settings.device_scale_factor,
            ],
        )
        .map(|()| "UpdateSessionDisplaySettings")
    }

    fn show_rdp_for_session(
        session: &RdpSession,
        scale_factor: f64,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(i32, i32, i32, i32), String> {
        let physical_rect = scaled_rect(x, y, width, height, scale_factor);
        let smart_sizing = smart_sizing_for_physical_bounds(
            session.resolution_mode,
            physical_rect.2,
            physical_rect.3,
        );
        apply_smart_sizing(&session.dispatch, smart_sizing);
        let object_hwnd = hosted_rdp_object_window(&session.dispatch);
        set_rdp_overlay_focus_targets(
            Some(session.hwnd),
            Some(session.owner),
            object_hwnd.or(Some(session.hwnd)),
        );
        let rect = show_rdp(
            session.hwnd,
            session.owner,
            scale_factor,
            x,
            y,
            width,
            height,
        )?;
        ui_debug(
            "rdp.geometry.native",
            &json!({
                "sessionId": &session.session_id,
                "resolutionMode": resolution_mode_name(session.resolution_mode),
                "smartSizing": smart_sizing,
                "scaleFactor": scale_factor,
                "requestedLogicalBounds": {
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                },
                "requestedPhysicalBounds": {
                    "x": physical_rect.0,
                    "y": physical_rect.1,
                    "width": physical_rect.2,
                    "height": physical_rect.3,
                },
                "positionedHostRect": {
                    "x": rect.0,
                    "y": rect.1,
                    "width": rect.2,
                    "height": rect.3,
                },
                "actualHostWindow": native_window_geometry_payload(session.hwnd),
                "actualObjectWindow": object_hwnd.map(native_window_geometry_payload),
                "remoteDesktop": {
                    "width": session.desktop_width,
                    "height": session.desktop_height,
                    "desktopScaleFactor": session.desktop_scale_factor,
                    "deviceScaleFactor": session.device_scale_factor,
                },
            }),
        );
        Ok(rect)
    }

    fn apply_smart_sizing(dispatch: &IDispatch, enabled: bool) {
        let Some(advanced) = get_advanced_settings(dispatch) else {
            rdp_debug(
                "display.smart_sizing.unavailable",
                &json!({ "enabled": enabled }),
            );
            return;
        };
        if let Err(error) = set_property_bool(&advanced, "SmartSizing", enabled) {
            rdp_debug(
                "display.smart_sizing.error",
                &json!({
                    "enabled": enabled,
                    "error": error,
                }),
            );
        }
    }

    fn show_rdp(
        hwnd: HWND,
        owner: HWND,
        scale_factor: f64,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(i32, i32, i32, i32), String> {
        let rect = scaled_rect(x, y, width, height, scale_factor);
        let origin = client_to_screen_point(owner, rect.0, rect.1)?;
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                origin.0,
                origin.1,
                rect.2,
                rect.3,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
            .map_err(|error| format!("failed to position RDP control: {error}"))?;
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        Ok((origin.0, origin.1, rect.2, rect.3))
    }

    fn stage_rdp(
        hwnd: HWND,
        scale_factor: f64,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(i32, i32, i32, i32), String> {
        let rect = scaled_rect(x, y, width, height, scale_factor);
        let staged = staged_rect(rect.2, rect.3);
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                staged.0,
                staged.1,
                staged.2,
                staged.3,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
            .map_err(|error| format!("failed to stage RDP control: {error}"))?;
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        Ok(staged)
    }

    fn is_native_fullscreen(session: &RdpSession) -> bool {
        get_property_i32(&session.dispatch, "FullScreen").is_ok_and(|value| value != 0)
    }

    fn staged_rect(width: i32, height: i32) -> (i32, i32, i32, i32) {
        (
            HIDDEN_RDP_POSITION,
            HIDDEN_RDP_POSITION,
            width.max(1),
            height.max(1),
        )
    }

    fn hosted_rdp_object_window(dispatch: &IDispatch) -> Option<HWND> {
        let in_place_object = dispatch.cast::<IOleInPlaceObject>().ok()?;
        unsafe { in_place_object.GetWindow().ok() }
    }

    fn rect_payload(rect: &RECT) -> serde_json::Value {
        json!({
            "left": rect.left,
            "top": rect.top,
            "right": rect.right,
            "bottom": rect.bottom,
            "width": rect.right - rect.left,
            "height": rect.bottom - rect.top,
        })
    }

    fn native_window_geometry_payload(hwnd: HWND) -> serde_json::Value {
        let mut window_rect = RECT::default();
        let mut client_rect = RECT::default();
        let window_rect = unsafe { GetWindowRect(hwnd, &mut window_rect) }
            .ok()
            .map(|()| rect_payload(&window_rect));
        let client_rect = unsafe { GetClientRect(hwnd, &mut client_rect) }
            .ok()
            .map(|()| rect_payload(&client_rect));
        json!({
            "windowRect": window_rect,
            "clientRect": client_rect,
        })
    }

    fn client_to_screen_point(owner: HWND, x: i32, y: i32) -> Result<(i32, i32), String> {
        let mut point = POINT { x, y };
        let ok = unsafe { ClientToScreen(owner, &mut point) };
        if !ok.as_bool() {
            return Err("failed to translate RDP host coordinates to screen space".to_string());
        }
        Ok((point.x, point.y))
    }

    fn park_rdp_at_current_size(hwnd: HWND) -> Result<(), String> {
        let mut rect = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut rect)
                .map_err(|error| format!("failed to read RDP control bounds: {error}"))?;
        }
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                HIDDEN_RDP_POSITION,
                HIDDEN_RDP_POSITION,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
            .map_err(|error| format!("failed to park RDP control: {error}"))?;
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        Ok(())
    }

    fn scaled_rect(
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        scale_factor: f64,
    ) -> (i32, i32, i32, i32) {
        let scale_factor = if scale_factor.is_finite() && scale_factor > 0.0 {
            scale_factor
        } else {
            1.0
        };
        (
            (x.max(0.0) * scale_factor).round() as i32,
            (y.max(0.0) * scale_factor).round() as i32,
            (width.max(1.0) * scale_factor).round() as i32,
            (height.max(1.0) * scale_factor).round() as i32,
        )
    }

    fn desktop_width_for(width: i32) -> i32 {
        width.max(RDP_MIN_DESKTOP_WIDTH)
    }

    fn desktop_height_for(height: i32) -> i32 {
        height.max(RDP_MIN_DESKTOP_HEIGHT)
    }

    fn smart_sizing_for_physical_bounds(
        resolution_mode: RemoteResolutionMode,
        physical_width: i32,
        physical_height: i32,
    ) -> bool {
        resolution_mode.smart_sizing()
            || physical_width < RDP_MIN_DESKTOP_WIDTH
            || physical_height < RDP_MIN_DESKTOP_HEIGHT
    }

    fn is_rdp_connected_state(connection_state: i32) -> bool {
        connection_state == RDP_CONNECTED_STATE
    }

    fn is_rdp_displayable_state(connection_state: i32) -> bool {
        connection_state == RDP_CONNECTED_STATE || connection_state == RDP_ESTABLISHING_STATE
    }

    fn rdp_connection_state_label(connection_state: i32) -> &'static str {
        match connection_state {
            0 => "notConnected",
            RDP_CONNECTED_STATE => "connected",
            RDP_ESTABLISHING_STATE => "establishing",
            _ => "unknown",
        }
    }

    fn rdp_display_ready_after_sync(connection_state: i32, _display_sync_completed: bool) -> bool {
        // Some servers keep ActiveX in the establishing state while showing
        // interactive prompts, and some reject dynamic display updates after
        // those prompts. Reveal active controls at their current size instead
        // of leaving the pane stuck preparing off-screen.
        is_rdp_displayable_state(connection_state)
    }

    fn is_rdp_active_state(connection_state: i32) -> bool {
        connection_state == RDP_CONNECTED_STATE || connection_state == RDP_ESTABLISHING_STATE
    }

    fn run_on_main_thread<F, T>(operation: &'static str, app: AppHandle, f: F) -> Result<T, String>
    where
        F: FnOnce(AppHandle) -> Result<T, String> + Send + 'static,
        T: Send + 'static,
    {
        let app_for_closure = app.clone();
        let (sender, receiver) = mpsc::channel();
        app.run_on_main_thread(move || {
            let started = Instant::now();
            let result = f(app_for_closure);
            let elapsed = started.elapsed();
            match &result {
                Ok(_) => rdp_debug(
                    "main_thread.operation.ok",
                    &json!({
                        "operation": operation,
                        "elapsedMs": elapsed.as_millis(),
                    }),
                ),
                Err(error) => rdp_debug(
                    "main_thread.operation.error",
                    &json!({
                        "operation": operation,
                        "elapsedMs": elapsed.as_millis(),
                        "error": error,
                    }),
                ),
            }
            if elapsed >= RDP_MAIN_THREAD_WARN_AFTER {
                eprintln!(
                    "RDP main-thread operation '{operation}' took {} ms; nested RDP, WebView2, or ActiveX stalls may be blocking the UI thread",
                    elapsed.as_millis()
                );
            }
            let _ = sender.send(result);
        })
        .map_err(|error| format!("failed to dispatch RDP work to main thread: {error}"))?;
        receiver
            .recv_timeout(RDP_MAIN_THREAD_TIMEOUT)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => format!(
                    "RDP main-thread operation '{operation}' did not complete within {} seconds; the Microsoft RDP ActiveX control may be stalled",
                    RDP_MAIN_THREAD_TIMEOUT.as_secs()
                ),
                mpsc::RecvTimeoutError::Disconnected => {
                    "RDP main-thread task did not return".to_string()
                }
            })?
    }

    fn atl_functions() -> Result<&'static AtlFunctions, String> {
        static ATL_FUNCTIONS: OnceLock<Result<AtlFunctions, String>> = OnceLock::new();
        ATL_FUNCTIONS
            .get_or_init(load_atl_functions)
            .as_ref()
            .map_err(Clone::clone)
    }

    fn load_atl_functions() -> Result<AtlFunctions, String> {
        let module = unsafe { LoadLibraryW(PCWSTR(wide_null("atl.dll").as_ptr())) }
            .map_err(|error| format!("failed to load atl.dll for ActiveX hosting: {error}"))?;
        let ax_win_init = unsafe { GetProcAddress(module, PCSTR(b"AtlAxWinInit\0".as_ptr())) }
            .ok_or_else(|| "atl.dll does not export AtlAxWinInit".to_string())?;
        let ax_get_control =
            unsafe { GetProcAddress(module, PCSTR(b"AtlAxGetControl\0".as_ptr())) }
                .ok_or_else(|| "atl.dll does not export AtlAxGetControl".to_string())?;
        Ok(AtlFunctions {
            ax_win_init: unsafe { std::mem::transmute::<_, AtlAxWinInit>(ax_win_init) },
            ax_get_control: unsafe { std::mem::transmute::<_, AtlAxGetControl>(ax_get_control) },
        })
    }

    fn lock_sessions(
        sessions: &Arc<Mutex<HashMap<String, RdpSession>>>,
    ) -> Result<MutexGuard<'_, HashMap<String, RdpSession>>, String> {
        sessions
            .lock()
            .map_err(|_| "RDP session lock is poisoned".to_string())
    }

    fn required_id(value: String) -> Result<String, String> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err("RDP session id is required".to_string());
        }
        if trimmed.len() > 96 {
            return Err("RDP session id must be 96 characters or fewer".to_string());
        }
        if !trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        {
            return Err("RDP session id may only contain letters, digits, '-' or '_'".to_string());
        }
        Ok(trimmed.to_string())
    }

    fn required_field(label: &str, value: String) -> Result<String, String> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(format!("{label} is required"));
        }
        Ok(trimmed.to_string())
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    impl VariantArg {
        fn bstr(value: &str) -> Self {
            Self(variant_bstr(value))
        }

        fn i4(value: i32) -> Self {
            let mut variant = VARIANT::default();
            unsafe {
                let variant_data = &mut *variant.Anonymous.Anonymous;
                variant_data.vt = VT_I4;
                variant_data.Anonymous.lVal = value;
            }
            Self(variant)
        }

        fn bool(value: bool) -> Self {
            let mut variant = VARIANT::default();
            unsafe {
                let variant_data = &mut *variant.Anonymous.Anonymous;
                variant_data.vt = VT_BOOL;
                variant_data.Anonymous.boolVal = if value { VARIANT_TRUE } else { VARIANT_FALSE };
            }
            Self(variant)
        }
    }

    fn variant_bstr(value: &str) -> VARIANT {
        let mut variant = VARIANT::default();
        unsafe {
            let variant_data = &mut *variant.Anonymous.Anonymous;
            variant_data.vt = VT_BSTR;
            variant_data.Anonymous.bstrVal = ManuallyDrop::new(BSTR::from(value));
        }
        variant
    }

    fn variant_u4(value: u32) -> VARIANT {
        let mut variant = VARIANT::default();
        unsafe {
            let variant_data = &mut *variant.Anonymous.Anonymous;
            variant_data.vt = VT_UI4;
            variant_data.Anonymous.ulVal = value;
        }
        variant
    }

    impl Drop for VariantArg {
        fn drop(&mut self) {
            unsafe {
                let _ = VariantClear(&mut self.0);
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn splits_domain_qualified_windows_users() {
            assert_eq!(
                split_windows_user("DOMAIN\\admin"),
                (Some("DOMAIN".to_string()), "admin".to_string())
            );
            assert_eq!(
                split_windows_user("admin@example.com"),
                (None, "admin@example.com".to_string())
            );
        }

        #[test]
        fn uses_registered_mstscax_progids_for_activex_creation() {
            assert_eq!(RDP_PROGIDS.first().copied(), Some("MsTscAx.MsTscAx.13"));
            assert!(RDP_PROGIDS.contains(&"MsTscAx.MsTscAx.12"));
            assert!(RDP_PROGIDS.contains(&"MsTscAx.MsTscAx"));
            assert!(
                RDP_PROGIDS
                    .iter()
                    .all(|progid| !progid.starts_with("MsRdpClient")),
                "RDP creation must use registered ProgIDs, not Microsoft Learn class names"
            );
        }

        #[test]
        fn tries_newest_advanced_settings_dispatch_before_fallback_names() {
            let names = ADVANCED_SETTINGS_PROPERTIES;
            assert_eq!(names.first().copied(), Some("AdvancedSettings12"));
            assert!(names.contains(&"AdvancedSettings2"));
            assert_eq!(names.last().copied(), Some("AdvancedSettings"));
        }

        #[test]
        fn validates_session_ids_for_native_window_labels() {
            assert_eq!(
                required_id("rdp-session_1".to_string()).as_deref(),
                Ok("rdp-session_1")
            );
            assert!(required_id("bad/session".to_string()).is_err());
        }

        #[test]
        fn ctrl_alt_end_windows_inputs_match_hardware_order() {
            let inputs = [
                keyboard_input(VK_CONTROL_KEY, false),
                keyboard_input(VK_ALT_KEY, false),
                keyboard_input(VK_END_KEY, false),
                keyboard_input(VK_END_KEY, true),
                keyboard_input(VK_ALT_KEY, true),
                keyboard_input(VK_CONTROL_KEY, true),
            ];

            let observed: Vec<(u16, bool)> = inputs
                .iter()
                .map(|input| {
                    let key = unsafe { input.Anonymous.ki };
                    (key.wVk.0, key.dwFlags == KEYEVENTF_KEYUP)
                })
                .collect();

            assert_eq!(
                observed,
                vec![
                    (VK_CONTROL_KEY as u16, false),
                    (VK_ALT_KEY as u16, false),
                    (VK_END_KEY as u16, false),
                    (VK_END_KEY as u16, true),
                    (VK_ALT_KEY as u16, true),
                    (VK_CONTROL_KEY as u16, true),
                ]
            );
        }

        #[test]
        fn scales_logical_bounds_to_physical_pixels() {
            assert_eq!(
                scaled_rect(10.0, 20.0, 800.0, 600.0, 1.5),
                (15, 30, 1200, 900)
            );
            assert_eq!(scaled_rect(-10.0, -20.0, 0.0, 0.0, 1.25), (0, 0, 1, 1));
            assert_eq!(
                scaled_rect(10.0, 20.0, 800.0, 600.0, 0.0),
                (10, 20, 800, 600)
            );
        }

        #[test]
        fn enforces_rdp_desktop_minimum_size() {
            assert_eq!(desktop_width_for(199), RDP_MIN_DESKTOP_WIDTH);
            assert_eq!(desktop_height_for(199), RDP_MIN_DESKTOP_HEIGHT);
            assert_eq!(desktop_width_for(320), 320);
            assert_eq!(desktop_height_for(240), 240);
            assert_eq!(desktop_width_for(1200), 1200);
            assert_eq!(desktop_height_for(900), 900);
        }

        #[test]
        fn forces_smart_sizing_below_rdp_desktop_minimum_size() {
            assert!(!smart_sizing_for_physical_bounds(
                RemoteResolutionMode::Automatic,
                RDP_MIN_DESKTOP_WIDTH,
                RDP_MIN_DESKTOP_HEIGHT,
            ));
            assert!(smart_sizing_for_physical_bounds(
                RemoteResolutionMode::Automatic,
                RDP_MIN_DESKTOP_WIDTH - 1,
                RDP_MIN_DESKTOP_HEIGHT,
            ));
            assert!(smart_sizing_for_physical_bounds(
                RemoteResolutionMode::DpiZoom,
                RDP_MIN_DESKTOP_WIDTH,
                RDP_MIN_DESKTOP_HEIGHT - 1,
            ));
            assert!(smart_sizing_for_physical_bounds(
                RemoteResolutionMode::Fixed {
                    width: 1440,
                    height: 900,
                },
                1200,
                900,
            ));
        }

        #[test]
        fn automatic_resolution_tracks_physical_desktop_without_smart_sizing() {
            assert_eq!(
                RemoteResolutionMode::Automatic.desktop_size(1200.0, 800.0, 1800, 1200),
                (1800, 1200)
            );
            assert!(!RemoteResolutionMode::Automatic.smart_sizing());
            assert!(RemoteResolutionMode::Automatic.tracks_pane_size());
            assert!(RemoteResolutionMode::DpiZoom.tracks_pane_size());
        }

        #[test]
        fn automatic_display_settings_apply_host_dpi_with_unknown_physical_size() {
            let settings =
                RemoteResolutionMode::Automatic.display_settings(1200.0, 800.0, 1800, 1200, 1.5);

            assert_eq!(settings.desktop_width, 1800);
            assert_eq!(settings.desktop_height, 1200);
            assert_eq!(settings.physical_width, RDP_UNKNOWN_PHYSICAL_SIZE_MM);
            assert_eq!(settings.physical_height, RDP_UNKNOWN_PHYSICAL_SIZE_MM);
            assert_eq!(settings.desktop_scale_factor, 150);
            assert_eq!(settings.device_scale_factor, 140);
        }

        #[test]
        fn automatic_display_settings_pass_through_native_dpi() {
            let settings =
                RemoteResolutionMode::Automatic.display_settings(1920.0, 1080.0, 1920, 1080, 1.0);

            assert_eq!(settings.desktop_width, 1920);
            assert_eq!(settings.desktop_height, 1080);
            assert_eq!(settings.desktop_scale_factor, 100);
            assert_eq!(settings.device_scale_factor, 100);
        }

        #[test]
        fn fixed_display_settings_stretch_selected_resolution_with_smart_sizing() {
            let settings = RemoteResolutionMode::Fixed {
                width: 1440,
                height: 900,
            }
            .display_settings(1200.0, 800.0, 1800, 1200, 1.5);

            assert_eq!(settings.desktop_width, 1440);
            assert_eq!(settings.desktop_height, 900);
            assert_eq!(settings.physical_width, RDP_UNKNOWN_PHYSICAL_SIZE_MM);
            assert_eq!(settings.physical_height, RDP_UNKNOWN_PHYSICAL_SIZE_MM);
            assert_eq!(settings.desktop_scale_factor, 100);
        }

        #[test]
        fn dpi_zoom_display_settings_apply_local_scale_factor() {
            let settings =
                RemoteResolutionMode::DpiZoom.display_settings(1200.0, 800.0, 1800, 1200, 1.5);

            assert_eq!(settings.desktop_width, 1800);
            assert_eq!(settings.desktop_height, 1200);
            assert_eq!(settings.physical_width, RDP_UNKNOWN_PHYSICAL_SIZE_MM);
            assert_eq!(settings.physical_height, RDP_UNKNOWN_PHYSICAL_SIZE_MM);
            assert_eq!(settings.desktop_scale_factor, 150);
            assert_eq!(settings.device_scale_factor, 140);
        }

        #[test]
        fn treats_unknown_desktop_size_as_needing_resize() {
            // (current_w, current_h, current_desktop_scale, current_device_scale,
            //  target_w, target_h, target_desktop_scale, target_device_scale)
            assert!(should_resize_remote_desktop(
                0, 0, 0, 0, 1920, 1080, 100, 100
            ));
            assert!(should_resize_remote_desktop(
                1920, 1080, 100, 100, 2048, 1080, 100, 100
            ));
            assert!(!should_resize_remote_desktop(
                1920, 1080, 100, 100, 1920, 1080, 100, 100
            ));
        }

        #[test]
        fn treats_scale_factor_change_as_needing_resize() {
            // Same pixel dimensions, but a corrected DPI scale still re-applies:
            // the early post-Connect display sync often lands at 100% before the
            // session is interactive enough to honor the host scale factor.
            assert!(should_resize_remote_desktop(
                1920, 1080, 100, 100, 1920, 1080, 150, 140
            ));
            assert!(should_resize_remote_desktop(
                1920, 1080, 150, 100, 1920, 1080, 150, 140
            ));
            assert!(!should_resize_remote_desktop(
                1920, 1080, 150, 140, 1920, 1080, 150, 140
            ));
        }

        #[test]
        fn stages_rdp_control_offscreen_at_requested_size() {
            assert_eq!(
                staged_rect(1920, 1080),
                (HIDDEN_RDP_POSITION, HIDDEN_RDP_POSITION, 1920, 1080)
            );
            assert_eq!(
                staged_rect(0, -10),
                (HIDDEN_RDP_POSITION, HIDDEN_RDP_POSITION, 1, 1)
            );
        }

        #[test]
        fn treats_only_connected_rdp_state_as_connected() {
            assert!(!is_rdp_connected_state(0));
            assert!(is_rdp_connected_state(1));
            assert!(!is_rdp_connected_state(2));
        }

        #[test]
        fn treats_active_rdp_states_as_displayable() {
            assert!(!is_rdp_displayable_state(0));
            assert!(is_rdp_displayable_state(1));
            assert!(is_rdp_displayable_state(2));
        }

        #[test]
        fn labels_rdp_connection_states_for_debug_logs() {
            assert_eq!(rdp_connection_state_label(0), "notConnected");
            assert_eq!(rdp_connection_state_label(1), "connected");
            assert_eq!(rdp_connection_state_label(2), "establishing");
            assert_eq!(rdp_connection_state_label(99), "unknown");
        }

        #[test]
        fn treats_active_rdp_as_display_ready_when_dynamic_sync_fails() {
            assert!(rdp_display_ready_after_sync(1, true));
            assert!(rdp_display_ready_after_sync(1, false));
            assert!(rdp_display_ready_after_sync(2, true));
            assert!(rdp_display_ready_after_sync(2, false));
            assert!(!rdp_display_ready_after_sync(0, true));
        }

        #[test]
        fn treats_establishing_rdp_state_as_active_not_disconnected() {
            assert!(!is_rdp_active_state(0));
            assert!(is_rdp_active_state(1));
            assert!(is_rdp_active_state(2));
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use serde::{Deserialize, Serialize};
    use tauri::AppHandle;

    #[derive(Clone)]
    pub struct RdpSessionManager;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct StartRdpSessionRequest {
        pub session_id: String,
        pub host: String,
        pub user: String,
        pub port: Option<u16>,
        pub secret_owner_id: Option<String>,
        pub password: Option<String>,
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
        pub scale_factor: Option<f64>,
        pub options: Option<RdpSessionOptions>,
    }

    #[derive(Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpSessionOptions {
        pub color_depth: u16,
        #[serde(default)]
        pub administrative_session: bool,
        pub redirect_clipboard: bool,
        pub redirect_drives: bool,
        pub bitmap_cache: bool,
        pub performance_profile: String,
        #[serde(default)]
        pub remote_resolution: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpSessionStarted {
        session_id: String,
        host: String,
        port: u16,
        control: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpSessionStatus {
        session_id: String,
        connection_state: i32,
        connected: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct UpdateRdpBoundsRequest {
        pub session_id: String,
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
        pub scale_factor: Option<f64>,
        #[serde(default)]
        pub force: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SetRdpVisibilityRequest {
        pub session_id: String,
        pub visible: bool,
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
        pub scale_factor: Option<f64>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SyncRdpDisplaySizeRequest {
        pub session_id: String,
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
        pub scale_factor: Option<f64>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpDisplaySizeSync {
        session_id: String,
        connection_state: i32,
        connected: bool,
        display_synced: bool,
        desktop_width: i32,
        desktop_height: i32,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpSimpleRequest {
        pub session_id: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SendRdpTextRequest {
        pub session_id: String,
        pub text: String,
        pub mode: Option<String>,
        pub press_enter: Option<bool>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SendRdpKeyPressRequest {
        pub session_id: String,
        pub key: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SendRdpMouseClickRequest {
        pub session_id: String,
        pub x: u16,
        pub y: u16,
        pub button: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RdpTextSent {
        session_id: String,
        mode: String,
        fell_back: bool,
        char_count: u32,
    }

    impl RdpSessionManager {
        pub fn new() -> Self {
            Self
        }

        pub fn start_session(
            &self,
            _app: AppHandle,
            _request: StartRdpSessionRequest,
        ) -> Result<RdpSessionStarted, String> {
            Err("RDP sessions require Windows and the Microsoft RDP ActiveX control".to_string())
        }

        pub fn update_bounds(
            &self,
            _app: AppHandle,
            _request: UpdateRdpBoundsRequest,
        ) -> Result<(), String> {
            Ok(())
        }

        pub fn set_visibility(
            &self,
            _app: AppHandle,
            _request: SetRdpVisibilityRequest,
        ) -> Result<(), String> {
            Ok(())
        }

        pub fn enter_fullscreen(
            &self,
            _app: AppHandle,
            _request: RdpSimpleRequest,
        ) -> Result<(), String> {
            Err(
                "RDP full screen requires Windows and the Microsoft RDP ActiveX control"
                    .to_string(),
            )
        }

        pub fn exit_fullscreen(
            &self,
            _app: AppHandle,
            _request: RdpSimpleRequest,
        ) -> Result<(), String> {
            Ok(())
        }

        pub fn exit_active_fullscreen(&self) -> Result<bool, String> {
            Ok(false)
        }

        pub fn has_active_fullscreen(&self) -> Result<bool, String> {
            Ok(false)
        }

        pub fn sync_display_size(
            &self,
            _app: AppHandle,
            request: SyncRdpDisplaySizeRequest,
        ) -> Result<RdpDisplaySizeSync, String> {
            Ok(RdpDisplaySizeSync {
                session_id: request.session_id,
                connection_state: 0,
                connected: false,
                display_synced: false,
                desktop_width: 0,
                desktop_height: 0,
            })
        }

        pub fn close_session(
            &self,
            _app: AppHandle,
            _request: RdpSimpleRequest,
        ) -> Result<(), String> {
            Ok(())
        }

        pub fn session_status(
            &self,
            _app: AppHandle,
            request: RdpSimpleRequest,
        ) -> Result<RdpSessionStatus, String> {
            Ok(RdpSessionStatus {
                session_id: request.session_id,
                connection_state: 0,
                connected: is_rdp_connected_state(0),
            })
        }

        pub fn send_ctrl_alt_delete(
            &self,
            _app: AppHandle,
            _request: RdpSimpleRequest,
        ) -> Result<(), String> {
            Err(
                "RDP Ctrl+Alt+Delete requires Windows and the Microsoft RDP ActiveX control"
                    .to_string(),
            )
        }

        pub fn send_text(
            &self,
            _app: AppHandle,
            _request: SendRdpTextRequest,
        ) -> Result<RdpTextSent, String> {
            Err(
                "RDP text injection requires Windows and the Microsoft RDP ActiveX control"
                    .to_string(),
            )
        }

        pub fn send_key_press(
            &self,
            _app: AppHandle,
            _request: SendRdpKeyPressRequest,
        ) -> Result<(), String> {
            Err(
                "RDP key injection requires Windows and the Microsoft RDP ActiveX control"
                    .to_string(),
            )
        }

        pub fn send_mouse_click(
            &self,
            _app: AppHandle,
            _request: SendRdpMouseClickRequest,
        ) -> Result<(), String> {
            Err(
                "RDP mouse injection requires Windows and the Microsoft RDP ActiveX control"
                    .to_string(),
            )
        }
    }

    fn is_rdp_connected_state(connection_state: i32) -> bool {
        connection_state == 1
    }

    fn is_rdp_displayable_state(connection_state: i32) -> bool {
        connection_state == 1 || connection_state == 2
    }

    impl StartRdpSessionRequest {
        pub(crate) fn secret_owner_id(&self) -> Option<&str> {
            self.secret_owner_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        }

        pub(crate) fn password(&self) -> Option<&str> {
            self.password.as_deref().filter(|value| !value.is_empty())
        }

        pub(crate) fn set_password(&mut self, password: Option<String>) {
            self.password = password;
        }
    }
}

pub use platform::*;
