use crate::storage;
use keyring_core::{Entry, Error};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const SERVICE_NAME: &str = "com.kkterm.app";

mod sqlite_store;

use sqlite_store::SqliteSecretStore;

pub struct Secrets {
    state: Mutex<SecretStoreState>,
    operation_lock: Mutex<()>,
    db_path: std::path::PathBuf,
}

struct SecretStoreState {
    store: Option<Box<dyn SecretStore>>,
    backend: Option<String>,
    init_error: Option<String>,
    selected_store: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KeychainStatus {
    available: bool,
    service: &'static str,
    backend: String,
    selected_store: String,
    available_stores: Vec<String>,
    encrypted_store_exists: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSecretStoreStatus {
    selected_store: String,
    backend: String,
    available: bool,
    encrypted_store_exists: bool,
    unlocked: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureEncryptedFileSecretStoreRequest {
    password: String,
    create_if_missing: bool,
    #[serde(default)]
    reset_existing: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEncryptedFileSecretStorePasswordRequest {
    current_password: String,
    new_password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreSecretRequest {
    kind: SecretKind,
    owner_id: String,
    secret: String,
}

impl StoreSecretRequest {
    pub(crate) fn connection_password(owner_id: String, secret: String) -> Self {
        Self {
            kind: SecretKind::ConnectionPassword,
            owner_id,
            secret,
        }
    }

    pub(crate) fn connection_passphrase(owner_id: String, secret: String) -> Self {
        Self {
            kind: SecretKind::ConnectionPassphrase,
            owner_id,
            secret,
        }
    }

    pub(crate) fn url_password(owner_id: String, secret: String) -> Self {
        Self {
            kind: SecretKind::UrlPassword,
            owner_id,
            secret,
        }
    }

    pub(crate) fn ssh_socks_proxy_password(owner_id: String, secret: String) -> Self {
        Self {
            kind: SecretKind::SshSocksProxyPassword,
            owner_id,
            secret,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretReferenceRequest {
    kind: SecretKind,
    owner_id: String,
}

impl SecretReferenceRequest {
    pub(crate) fn connection_password(owner_id: String) -> Self {
        Self {
            kind: SecretKind::ConnectionPassword,
            owner_id,
        }
    }

    pub(crate) fn connection_passphrase(owner_id: String) -> Self {
        Self {
            kind: SecretKind::ConnectionPassphrase,
            owner_id,
        }
    }

    pub(crate) fn ssh_socks_proxy_password(owner_id: String) -> Self {
        Self {
            kind: SecretKind::SshSocksProxyPassword,
            owner_id,
        }
    }

    pub(crate) fn url_password(owner_id: String) -> Self {
        Self {
            kind: SecretKind::UrlPassword,
            owner_id,
        }
    }

    pub(crate) fn ai_api_key(owner_id: String) -> Self {
        Self {
            kind: SecretKind::AiApiKey,
            owner_id,
        }
    }

    pub(crate) fn widget_secret(owner_id: String) -> Self {
        Self {
            kind: SecretKind::WidgetSecret,
            owner_id,
        }
    }

    pub(crate) fn itops_task_secret(owner_id: String) -> Self {
        Self {
            kind: SecretKind::ItopsTaskSecret,
            owner_id,
        }
    }

    pub(crate) fn mcp_server_secret(owner_id: String) -> Self {
        Self {
            kind: SecretKind::McpServerSecret,
            owner_id,
        }
    }

    pub(crate) fn brave_search_api_key(owner_id: String) -> Self {
        Self {
            kind: SecretKind::BraveSearchApiKey,
            owner_id,
        }
    }

    pub(crate) fn tavily_search_api_key(owner_id: String) -> Self {
        Self {
            kind: SecretKind::TavilySearchApiKey,
            owner_id,
        }
    }

    pub(crate) fn email_api_key(owner_id: String) -> Self {
        Self {
            kind: SecretKind::EmailApiKey,
            owner_id,
        }
    }

    pub(crate) fn email_smtp_password(owner_id: String) -> Self {
        Self {
            kind: SecretKind::EmailSmtpPassword,
            owner_id,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretPresence {
    exists: bool,
}

impl SecretPresence {
    pub(crate) fn exists(&self) -> bool {
        self.exists
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SecretKind {
    ConnectionPassword,
    ConnectionPassphrase,
    SshSocksProxyPassword,
    UrlPassword,
    AiApiKey,
    BraveSearchApiKey,
    TavilySearchApiKey,
    EmailApiKey,
    EmailSmtpPassword,
    WidgetSecret,
    ItopsTaskSecret,
    McpServerSecret,
}

trait SecretStore: Send + Sync {
    fn write(&self, reference: &SecretReference, secret: &str) -> Result<(), String>;
    fn read(&self, reference: &SecretReference) -> Result<Option<String>, String>;
    fn delete(&self, reference: &SecretReference) -> Result<(), String>;
    fn exists(&self, reference: &SecretReference) -> Result<bool, String> {
        self.read(reference).map(|secret| secret.is_some())
    }
}

struct KeyringSecretStore {
    backend_name: String,
}

impl KeyringSecretStore {
    fn new(backend_name: String) -> Self {
        Self { backend_name }
    }

    fn entry(&self, reference: &SecretReference) -> Result<Entry, String> {
        Entry::new(SERVICE_NAME, &reference.key()).map_err(to_secret_error)
    }
}

impl SecretStore for KeyringSecretStore {
    fn write(&self, reference: &SecretReference, secret: &str) -> Result<(), String> {
        self.entry(reference)?
            .set_password(secret)
            .map_err(to_secret_error)
    }

    fn read(&self, reference: &SecretReference) -> Result<Option<String>, String> {
        match self.entry(reference)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(to_secret_error(error)),
        }
    }

    fn delete(&self, reference: &SecretReference) -> Result<(), String> {
        match self.entry(reference)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(to_secret_error(error)),
        }
    }

    fn exists(&self, reference: &SecretReference) -> Result<bool, String> {
        self.keyring_secret_exists(reference)
    }
}

impl KeyringSecretStore {
    #[cfg(target_os = "macos")]
    fn keyring_secret_exists(&self, reference: &SecretReference) -> Result<bool, String> {
        use security_framework::item::{ItemClass, ItemSearchOptions};

        if self.backend_name == "Mock keychain" {
            return self.read(reference).map(|secret| secret.is_some());
        }

        let result = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(SERVICE_NAME)
            .account(&reference.key())
            .load_attributes(true)
            .search();

        match result {
            Ok(items) => Ok(!items.is_empty()),
            Err(error) if error.code() == -25300 => Ok(false),
            Err(error) => Err(format!("OS keychain error: {error}")),
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn keyring_secret_exists(&self, reference: &SecretReference) -> Result<bool, String> {
        let _ = &self.backend_name;
        self.read(reference).map(|secret| secret.is_some())
    }
}

struct ConfiguredSecretStore {
    backend: String,
    store: Box<dyn SecretStore>,
}

impl Secrets {
    pub fn new(secret_store: &str, db_path: std::path::PathBuf) -> Self {
        Self {
            state: Mutex::new(configure_state(secret_store, &db_path)),
            operation_lock: Mutex::new(()),
            db_path,
        }
    }

    pub fn status(&self) -> KeychainStatus {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        KeychainStatus {
            available: state.backend.is_some(),
            service: SERVICE_NAME,
            backend: state
                .backend
                .clone()
                .or_else(|| state.init_error.clone())
                .unwrap_or_else(|| "Secret store unavailable".to_string()),
            selected_store: state.selected_store.clone(),
            available_stores: storage::secret_store_options()
                .into_iter()
                .map(str::to_string)
                .collect(),
            encrypted_store_exists: SqliteSecretStore::store_exists(&self.db_path).unwrap_or(false),
        }
    }

    pub fn credential_secret_store_status(&self) -> CredentialSecretStoreStatus {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        CredentialSecretStoreStatus {
            selected_store: state.selected_store.clone(),
            backend: state
                .backend
                .clone()
                .or_else(|| state.init_error.clone())
                .unwrap_or_else(|| "Secret store unavailable".to_string()),
            available: state.backend.is_some(),
            encrypted_store_exists: SqliteSecretStore::store_exists(&self.db_path).unwrap_or(false),
            unlocked: state.selected_store == "file" && state.store.is_some(),
        }
    }

    pub fn lock_encrypted_file_store(&self) -> Result<CredentialSecretStoreStatus, String> {
        let _guard = self.lock()?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "secret store state lock is poisoned".to_string())?;
        if state.selected_store == "file" {
            *state = SecretStoreState {
                store: None,
                backend: None,
                init_error: Some(
                    "Encrypted SQLite secret store is locked until the master password is entered"
                        .to_string(),
                ),
                selected_store: "file".to_string(),
            };
        }
        drop(state);
        Ok(self.credential_secret_store_status())
    }

    pub fn set_secret_store(&self, secret_store: &str) -> Result<KeychainStatus, String> {
        let _guard = self.lock()?;
        let requested = secret_store.trim().to_lowercase();
        let selected_store = if storage::secret_store_options().contains(&requested.as_str()) {
            requested
        } else {
            storage::default_secret_store()
        };
        let already_selected = {
            let state = self
                .state
                .lock()
                .map_err(|_| "secret store state lock is poisoned".to_string())?;
            state.selected_store == selected_store
        };
        if already_selected {
            return Ok(self.status());
        }
        let configured = configure_secret_store(&selected_store, &self.db_path)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "secret store state lock is poisoned".to_string())?;
        *state = SecretStoreState {
            backend: Some(configured.backend),
            store: Some(configured.store),
            init_error: None,
            selected_store,
        };
        drop(state);
        Ok(self.status())
    }

    pub fn configure_encrypted_file_store(
        &self,
        request: ConfigureEncryptedFileSecretStoreRequest,
    ) -> Result<KeychainStatus, String> {
        let _guard = self.lock()?;
        let store = SqliteSecretStore::from_password(self.db_path.clone(), request.password)?;
        if request.reset_existing {
            store.reset()?;
        } else {
            store.initialize_or_verify(request.create_if_missing)?;
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "secret store state lock is poisoned".to_string())?;
        *state = SecretStoreState {
            backend: Some("Encrypted SQLite secret store".to_string()),
            store: Some(Box::new(store)),
            init_error: None,
            selected_store: "file".to_string(),
        };
        drop(state);
        Ok(self.status())
    }

    pub fn change_encrypted_file_store_password(
        &self,
        request: ChangeEncryptedFileSecretStorePasswordRequest,
    ) -> Result<KeychainStatus, String> {
        let _guard = self.lock()?;
        let store =
            SqliteSecretStore::from_password(self.db_path.clone(), request.current_password)?;
        let store = store.rotate_password(request.new_password)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "secret store state lock is poisoned".to_string())?;
        *state = SecretStoreState {
            backend: Some("Encrypted SQLite secret store".to_string()),
            store: Some(Box::new(store)),
            init_error: None,
            selected_store: "file".to_string(),
        };
        drop(state);
        Ok(self.status())
    }

    pub fn store_secret(&self, request: StoreSecretRequest) -> Result<(), String> {
        let reference = SecretReference::new(request.kind, request.owner_id)?;
        let secret = request.secret;
        if secret.is_empty() {
            return Err("secret value is required".to_string());
        }

        let _guard = self.lock()?;
        self.with_store(|store| store.write(&reference, &secret))
    }

    pub(crate) fn store_ai_api_key(&self, owner_id: String, secret: String) -> Result<(), String> {
        self.store_secret(StoreSecretRequest {
            kind: SecretKind::AiApiKey,
            owner_id,
            secret,
        })
    }

    pub fn secret_exists(&self, request: SecretReferenceRequest) -> Result<SecretPresence, String> {
        let reference = SecretReference::new(request.kind, request.owner_id)?;
        let _guard = self.lock()?;

        {
            let state = self
                .state
                .lock()
                .map_err(|_| "secret store state lock is poisoned".to_string())?;
            if state.selected_store == "file" && state.store.is_none() {
                return Ok(SecretPresence {
                    exists: SqliteSecretStore::secret_exists_without_password(
                        &self.db_path,
                        &reference,
                    )?,
                });
            }
        }

        Ok(SecretPresence {
            exists: self.with_store(|store| store.exists(&reference))?,
        })
    }

    pub fn delete_secret(&self, request: SecretReferenceRequest) -> Result<(), String> {
        let reference = SecretReference::new(request.kind, request.owner_id)?;
        let _guard = self.lock()?;

        self.with_store(|store| store.delete(&reference))
    }

    #[allow(dead_code)]
    pub(crate) fn read_secret(
        &self,
        request: SecretReferenceRequest,
    ) -> Result<Option<String>, String> {
        let reference = SecretReference::new(request.kind, request.owner_id)?;
        let _guard = self.lock()?;

        self.with_store(|store| store.read(&reference))
    }

    pub(crate) fn read_connection_password(
        &self,
        owner_id: String,
    ) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest {
            kind: SecretKind::ConnectionPassword,
            owner_id,
        })
    }

    pub(crate) fn read_connection_passphrase(
        &self,
        owner_id: String,
    ) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest::connection_passphrase(owner_id))
    }

    pub(crate) fn read_url_password(&self, owner_id: String) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest {
            kind: SecretKind::UrlPassword,
            owner_id,
        })
    }

    pub(crate) fn read_ssh_socks_proxy_password(
        &self,
        owner_id: String,
    ) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest::ssh_socks_proxy_password(owner_id))
    }

    #[allow(dead_code)]
    pub(crate) fn read_ai_api_key(&self, owner_id: String) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest {
            kind: SecretKind::AiApiKey,
            owner_id,
        })
    }

    pub(crate) fn read_brave_search_api_key(
        &self,
        owner_id: String,
    ) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest::brave_search_api_key(owner_id))
    }

    pub(crate) fn read_tavily_search_api_key(
        &self,
        owner_id: String,
    ) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest::tavily_search_api_key(owner_id))
    }

    pub(crate) fn read_email_api_key(&self, owner_id: String) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest::email_api_key(owner_id))
    }

    pub(crate) fn read_email_smtp_password(
        &self,
        owner_id: String,
    ) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest::email_smtp_password(owner_id))
    }

    pub(crate) fn read_widget_secret(&self, owner_id: String) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest::widget_secret(owner_id))
    }

    pub(crate) fn read_itops_task_secret(
        &self,
        owner_id: String,
    ) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest::itops_task_secret(owner_id))
    }

    pub(crate) fn delete_itops_task_secret(&self, owner_id: String) -> Result<(), String> {
        self.delete_secret(SecretReferenceRequest::itops_task_secret(owner_id))
    }

    pub(crate) fn read_mcp_server_secret(
        &self,
        owner_id: String,
    ) -> Result<Option<String>, String> {
        self.read_secret(SecretReferenceRequest::mcp_server_secret(owner_id))
    }

    pub(crate) fn store_mcp_server_secret(
        &self,
        owner_id: String,
        secret: String,
    ) -> Result<(), String> {
        self.store_secret(StoreSecretRequest {
            kind: SecretKind::McpServerSecret,
            owner_id,
            secret,
        })
    }

    pub(crate) fn delete_mcp_server_secret(&self, owner_id: String) -> Result<(), String> {
        self.delete_secret(SecretReferenceRequest::mcp_server_secret(owner_id))
    }

    fn with_store<T>(
        &self,
        operation: impl FnOnce(&dyn SecretStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "secret store state lock is poisoned".to_string())?;
        let store = state.store.as_deref().ok_or_else(|| {
            state
                .init_error
                .clone()
                .unwrap_or_else(|| "Secret store is unavailable".to_string())
        })?;
        operation(store)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.operation_lock
            .lock()
            .map_err(|_| "secret store operation lock is poisoned".to_string())
    }

    #[cfg(test)]
    fn new_for_test() -> Self {
        keyring_core::set_default_store(keyring_core::mock::Store::new().expect("mock store"));
        Self {
            state: Mutex::new(SecretStoreState {
                store: Some(Box::new(KeyringSecretStore::new(
                    "Mock keychain".to_string(),
                ))),
                backend: Some("Mock keychain".to_string()),
                init_error: None,
                selected_store: "os".to_string(),
            }),
            operation_lock: Mutex::new(()),
            db_path: std::path::PathBuf::new(),
        }
    }
}

struct SecretReference {
    kind: SecretKind,
    owner_id: String,
}

impl SecretReference {
    fn new(kind: SecretKind, owner_id: String) -> Result<Self, String> {
        let owner_id = owner_id.trim().to_string();
        if owner_id.is_empty() {
            return Err("secret owner id is required".to_string());
        }
        if owner_id.len() > 128 {
            return Err("secret owner id must be 128 characters or fewer".to_string());
        }
        if owner_id.chars().any(char::is_control) {
            return Err("secret owner id cannot contain control characters".to_string());
        }

        Ok(Self { kind, owner_id })
    }

    fn key(&self) -> String {
        format!("{}:{}", self.kind.as_key(), self.owner_id)
    }
}

impl SecretKind {
    fn as_key(self) -> &'static str {
        match self {
            Self::ConnectionPassword => "connection-password",
            Self::ConnectionPassphrase => "connection-passphrase",
            Self::SshSocksProxyPassword => "ssh-socks-proxy-password",
            Self::UrlPassword => "url-password",
            Self::AiApiKey => "ai-api-key",
            Self::BraveSearchApiKey => "brave-search-api-key",
            Self::TavilySearchApiKey => "tavily-search-api-key",
            Self::EmailApiKey => "email-api-key",
            Self::EmailSmtpPassword => "email-smtp-password",
            Self::WidgetSecret => "widget-secret",
            Self::ItopsTaskSecret => "itops-task-secret",
            Self::McpServerSecret => "mcp-server-secret",
        }
    }
}

fn configure_state(secret_store: &str, db_path: &std::path::Path) -> SecretStoreState {
    let requested = secret_store.trim().to_lowercase();
    let selected_store = if storage::secret_store_options().contains(&requested.as_str()) {
        requested
    } else {
        storage::default_secret_store()
    };
    match configure_secret_store(&selected_store, db_path) {
        Ok(configured) => SecretStoreState {
            backend: Some(configured.backend),
            store: Some(configured.store),
            init_error: None,
            selected_store,
        },
        Err(error) => SecretStoreState {
            store: None,
            backend: None,
            init_error: Some(error),
            selected_store,
        },
    }
}

fn configure_secret_store(
    secret_store: &str,
    db_path: &std::path::Path,
) -> Result<ConfiguredSecretStore, String> {
    match secret_store {
        "file" => configure_file_store(db_path),
        "os" => configure_os_store(),
        _ => Err("Secret store backend is not configured for this platform yet".to_string()),
    }
}

fn configure_file_store(db_path: &std::path::Path) -> Result<ConfiguredSecretStore, String> {
    let store = SqliteSecretStore::from_environment(db_path.to_path_buf())?;
    Ok(ConfiguredSecretStore {
        backend: "Encrypted SQLite secret store".to_string(),
        store: Box::new(store),
    })
}

#[cfg(target_os = "windows")]
fn configure_os_store() -> Result<ConfiguredSecretStore, String> {
    keyring_core::set_default_store(
        windows_native_keyring_store::Store::new().map_err(to_secret_error)?,
    );
    let backend = "Windows Credential Manager".to_string();
    Ok(ConfiguredSecretStore {
        store: Box::new(KeyringSecretStore::new(backend.clone())),
        backend,
    })
}

#[cfg(target_os = "macos")]
fn configure_os_store() -> Result<ConfiguredSecretStore, String> {
    keyring_core::set_default_store(
        apple_native_keyring_store::keychain::Store::new().map_err(to_secret_error)?,
    );
    let backend = "macOS Keychain".to_string();
    Ok(ConfiguredSecretStore {
        store: Box::new(KeyringSecretStore::new(backend.clone())),
        backend,
    })
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn configure_os_store() -> Result<ConfiguredSecretStore, String> {
    Err("OS keystore backend is not configured for this platform".to_string())
}

fn to_secret_error(error: Error) -> String {
    format!("OS keychain error: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn test_keychain_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn stores_checks_reads_and_deletes_secret_without_sqlite() {
        let _guard = test_keychain_lock().lock().expect("test keychain lock");
        let secrets = Secrets::new_for_test();
        let owner_id = "connection-test-secret".to_string();

        secrets
            .store_secret(StoreSecretRequest {
                kind: SecretKind::ConnectionPassword,
                owner_id: owner_id.clone(),
                secret: "not-for-sqlite".to_string(),
            })
            .expect("secret is stored");

        let presence = secrets
            .secret_exists(SecretReferenceRequest {
                kind: SecretKind::ConnectionPassword,
                owner_id: owner_id.clone(),
            })
            .expect("presence check succeeds");
        assert!(presence.exists);

        let secret = secrets
            .read_secret(SecretReferenceRequest {
                kind: SecretKind::ConnectionPassword,
                owner_id: owner_id.clone(),
            })
            .expect("secret can be read by backend");
        assert_eq!(secret.as_deref(), Some("not-for-sqlite"));

        secrets
            .delete_secret(SecretReferenceRequest {
                kind: SecretKind::ConnectionPassword,
                owner_id,
            })
            .expect("secret is deleted");
    }

    #[test]
    fn stores_ai_api_keys_under_their_own_secret_kind() {
        let _guard = test_keychain_lock().lock().expect("test keychain lock");
        let secrets = Secrets::new_for_test();
        let owner_id = "openai-compatible-provider".to_string();

        secrets
            .store_secret(StoreSecretRequest {
                kind: SecretKind::AiApiKey,
                owner_id: owner_id.clone(),
                secret: "sk-test-key".to_string(),
            })
            .expect("AI API key is stored");

        let presence = secrets
            .secret_exists(SecretReferenceRequest {
                kind: SecretKind::AiApiKey,
                owner_id: owner_id.clone(),
            })
            .expect("presence check succeeds");
        assert!(presence.exists);

        let secret = secrets
            .read_ai_api_key(owner_id)
            .expect("AI API key can be read by backend");
        assert_eq!(secret.as_deref(), Some("sk-test-key"));
    }

    #[test]
    fn stores_url_passwords_under_their_own_secret_kind() {
        let _guard = test_keychain_lock().lock().expect("test keychain lock");
        let secrets = Secrets::new_for_test();
        let owner_id = "url-connection-test-secret".to_string();

        secrets
            .store_secret(StoreSecretRequest {
                kind: SecretKind::UrlPassword,
                owner_id: owner_id.clone(),
                secret: "browser-login-password".to_string(),
            })
            .expect("URL password is stored");

        let presence = secrets
            .secret_exists(SecretReferenceRequest {
                kind: SecretKind::UrlPassword,
                owner_id: owner_id.clone(),
            })
            .expect("presence check succeeds");
        assert!(presence.exists);

        let secret = secrets
            .read_url_password(owner_id)
            .expect("URL password can be read by backend");
        assert_eq!(secret.as_deref(), Some("browser-login-password"));
    }

    #[test]
    fn stores_connection_passphrases_separately_from_login_passwords() {
        let _guard = test_keychain_lock().lock().expect("test keychain lock");
        let secrets = Secrets::new_for_test();
        let owner_id = "ssh-key-connection".to_string();

        secrets
            .store_secret(StoreSecretRequest {
                kind: SecretKind::ConnectionPassphrase,
                owner_id: owner_id.clone(),
                secret: "key-passphrase".to_string(),
            })
            .expect("passphrase is stored");

        assert_eq!(
            secrets
                .read_connection_passphrase(owner_id.clone())
                .expect("passphrase can be read")
                .as_deref(),
            Some("key-passphrase")
        );
        assert_eq!(
            secrets
                .read_connection_password(owner_id)
                .expect("login password lookup succeeds"),
            None
        );
    }

    #[test]
    fn stores_ssh_socks_proxy_passwords_under_their_own_secret_kind() {
        let _guard = test_keychain_lock().lock().expect("test keychain lock");
        let secrets = Secrets::new_for_test();
        let owner_id = "ssh-socks-proxy-connection".to_string();

        secrets
            .store_secret(StoreSecretRequest {
                kind: SecretKind::SshSocksProxyPassword,
                owner_id: owner_id.clone(),
                secret: "proxy-login-password".to_string(),
            })
            .expect("SOCKS proxy password is stored");

        let presence = secrets
            .secret_exists(SecretReferenceRequest {
                kind: SecretKind::SshSocksProxyPassword,
                owner_id: owner_id.clone(),
            })
            .expect("presence check succeeds");
        assert!(presence.exists);

        let secret = secrets
            .read_ssh_socks_proxy_password(owner_id)
            .expect("SOCKS proxy password can be read by backend");
        assert_eq!(secret.as_deref(), Some("proxy-login-password"));
    }

    #[test]
    fn stores_widget_secrets_under_their_own_secret_kind() {
        let _guard = test_keychain_lock().lock().expect("test keychain lock");
        let secrets = Secrets::new_for_test();
        let owner_id = "dashboard-widget-secret:inst-test:apiKey".to_string();

        secrets
            .store_secret(StoreSecretRequest {
                kind: SecretKind::WidgetSecret,
                owner_id: owner_id.clone(),
                secret: "widget-api-key".to_string(),
            })
            .expect("widget secret is stored");

        let secret = secrets
            .read_widget_secret(owner_id)
            .expect("widget secret can be read by backend");
        assert_eq!(secret.as_deref(), Some("widget-api-key"));
    }

    #[test]
    fn encrypted_sqlite_store_round_trips_without_plaintext() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("kkterm.sqlite3");
        crate::storage::Storage::open(path.clone()).expect("storage opens");
        let store =
            super::sqlite_store::SqliteSecretStore::new(path.clone(), "test-password".to_string())
                .expect("sqlite store");
        let reference = SecretReference::new(
            SecretKind::ConnectionPassword,
            "sqlite-secret-owner".to_string(),
        )
        .expect("reference");

        store
            .initialize_or_verify(true)
            .expect("store sentinel is created");
        store
            .write(&reference, "sqlite-password")
            .expect("secret is stored");

        assert!(store.exists(&reference).expect("presence check"));
        assert_eq!(
            store.read(&reference).expect("secret read").as_deref(),
            Some("sqlite-password")
        );

        let db_bytes = std::fs::read(&path).expect("database exists");
        let db_text = String::from_utf8_lossy(&db_bytes);
        assert!(!db_text.contains("sqlite-password"));
        assert!(!db_text.contains("connection-password:sqlite-secret-owner"));

        let wrong_password_store =
            super::sqlite_store::SqliteSecretStore::new(path, "wrong-password".to_string())
                .expect("sqlite store");
        let error = wrong_password_store
            .read(&reference)
            .expect_err("wrong password should not decrypt sqlite secret");
        assert!(error.contains("could not decrypt"));
    }

    #[test]
    fn encrypted_sqlite_store_presence_check_does_not_require_unlock_key() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("kkterm.sqlite3");
        crate::storage::Storage::open(path.clone()).expect("storage opens");
        let store = super::sqlite_store::SqliteSecretStore::new(
            path.clone(),
            "correct-password".to_string(),
        )
        .expect("sqlite store");
        let reference =
            SecretReference::new(SecretKind::AiApiKey, "sqlite-ai-provider".to_string())
                .expect("reference");

        store
            .initialize_or_verify(true)
            .expect("store sentinel is created");
        store.write(&reference, "sk-sqlite").expect("secret stored");

        let wrong_password_store =
            super::sqlite_store::SqliteSecretStore::new(path, "wrong-password".to_string())
                .expect("sqlite store");
        assert!(
            wrong_password_store
                .exists(&reference)
                .expect("presence check should only query metadata")
        );
    }

    #[test]
    fn encrypted_sqlite_store_reset_clears_existing_credentials() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("kkterm.sqlite3");
        crate::storage::Storage::open(path.clone()).expect("storage opens");
        let secrets = Secrets::new("os", path);

        secrets
            .configure_encrypted_file_store(ConfigureEncryptedFileSecretStoreRequest {
                password: "old-password".to_string(),
                create_if_missing: true,
                reset_existing: false,
            })
            .expect("encrypted sqlite store is created");
        secrets
            .store_secret(StoreSecretRequest {
                kind: SecretKind::ConnectionPassword,
                owner_id: "credential-to-clear".to_string(),
                secret: "discard-me".to_string(),
            })
            .expect("secret is stored");

        let status = secrets
            .configure_encrypted_file_store(ConfigureEncryptedFileSecretStoreRequest {
                password: "new-password".to_string(),
                create_if_missing: true,
                reset_existing: true,
            })
            .expect("encrypted sqlite store is reset");

        assert!(status.encrypted_store_exists);
        assert!(
            !secrets
                .secret_exists(SecretReferenceRequest {
                    kind: SecretKind::ConnectionPassword,
                    owner_id: "credential-to-clear".to_string(),
                })
                .expect("presence check succeeds")
                .exists()
        );
    }

    #[test]
    fn encrypted_sqlite_store_password_rotation_preserves_credentials() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("kkterm.sqlite3");
        crate::storage::Storage::open(path.clone()).expect("storage opens");
        let old_store =
            super::sqlite_store::SqliteSecretStore::new(path, "old-password".to_string())
                .expect("old store");
        let connection_password = SecretReference::new(
            SecretKind::ConnectionPassword,
            "rotation-connection".to_string(),
        )
        .expect("connection password reference");
        let api_key = SecretReference::new(SecretKind::AiApiKey, "rotation-api-key".to_string())
            .expect("api key reference");

        old_store
            .initialize_or_verify(true)
            .expect("store sentinel is created");
        old_store
            .write(&connection_password, "connection-secret")
            .expect("connection password is stored");
        old_store
            .write(&api_key, "api-secret")
            .expect("api key is stored");

        let new_store = old_store
            .rotate_password("new-password".to_string())
            .expect("password rotation succeeds");

        assert_eq!(
            new_store
                .read(&connection_password)
                .expect("connection password can be read")
                .as_deref(),
            Some("connection-secret")
        );
        assert_eq!(
            new_store
                .read(&api_key)
                .expect("api key can be read")
                .as_deref(),
            Some("api-secret")
        );
        assert!(old_store.read(&connection_password).is_err());
    }

    #[test]
    fn encrypted_sqlite_store_password_rotation_rejects_wrong_current_password() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("kkterm.sqlite3");
        crate::storage::Storage::open(path.clone()).expect("storage opens");
        let store = super::sqlite_store::SqliteSecretStore::new(
            path.clone(),
            "current-password".to_string(),
        )
        .expect("store");
        let reference = SecretReference::new(
            SecretKind::ConnectionPassword,
            "unchanged-after-failed-rotation".to_string(),
        )
        .expect("reference");
        store
            .initialize_or_verify(true)
            .expect("store sentinel is created");
        store
            .write(&reference, "keep-me")
            .expect("secret is stored");

        let wrong_store =
            super::sqlite_store::SqliteSecretStore::new(path, "wrong-password".to_string())
                .expect("wrong-password store");
        assert!(
            wrong_store
                .rotate_password("unused-new-password".to_string())
                .is_err()
        );
        assert_eq!(
            store
                .read(&reference)
                .expect("original store still works")
                .as_deref(),
            Some("keep-me")
        );
    }

    #[test]
    fn setting_selected_encrypted_sqlite_store_again_keeps_dialog_unlock() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("kkterm.sqlite3");
        crate::storage::Storage::open(path.clone()).expect("storage opens");
        let secrets = Secrets::new("os", path);

        secrets
            .configure_encrypted_file_store(ConfigureEncryptedFileSecretStoreRequest {
                password: "dialog-password".to_string(),
                create_if_missing: true,
                reset_existing: false,
            })
            .expect("encrypted sqlite store is unlocked from dialog password");

        let previous_env = std::env::var("KKTERM_SECRET_STORE_PASSWORD").ok();
        unsafe {
            std::env::remove_var("KKTERM_SECRET_STORE_PASSWORD");
        }

        let result = secrets.set_secret_store("file");

        if let Some(value) = previous_env {
            unsafe {
                std::env::set_var("KKTERM_SECRET_STORE_PASSWORD", value);
            }
        }
        result
            .expect("selecting the already active encrypted store should not require env password");
        assert!(secrets.credential_secret_store_status().unlocked);
    }

    #[test]
    fn locked_encrypted_sqlite_store_allows_presence_checks_without_secret_reads() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("kkterm.sqlite3");
        crate::storage::Storage::open(path.clone()).expect("storage opens");
        let secrets = Secrets::new("os", path);

        secrets
            .configure_encrypted_file_store(ConfigureEncryptedFileSecretStoreRequest {
                password: "master-password".to_string(),
                create_if_missing: true,
                reset_existing: false,
            })
            .expect("encrypted sqlite store is created");
        secrets
            .store_secret(StoreSecretRequest {
                kind: SecretKind::ConnectionPassword,
                owner_id: "locked-presence-check".to_string(),
                secret: "still-encrypted".to_string(),
            })
            .expect("secret is stored");

        let status = secrets
            .lock_encrypted_file_store()
            .expect("encrypted store can be locked");
        assert!(!status.unlocked);
        assert!(
            secrets
                .secret_exists(SecretReferenceRequest {
                    kind: SecretKind::ConnectionPassword,
                    owner_id: "locked-presence-check".to_string(),
                })
                .expect("presence check uses metadata")
                .exists()
        );
        assert!(
            secrets
                .read_connection_password("locked-presence-check".to_string())
                .expect_err("secret reads still require unlock")
                .contains("locked")
        );
    }
}
