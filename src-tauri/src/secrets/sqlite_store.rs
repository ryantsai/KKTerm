use super::{SecretReference, SecretStore};
use aes_gcm::aead::{Aead, Generate, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const PASSWORD_ENV: &str = "KKTERM_SECRET_STORE_PASSWORD";
const STORE_VERSION: u8 = 1;
const AES_GCM_NONCE_LENGTH: usize = 12;
const SENTINEL_KEY: &str = "__kkterm_sqlite_secret_store_check__";
const SENTINEL_PLAINTEXT: &str = "kkterm-sqlite-secret-store-v1";

pub(super) struct SqliteSecretStore {
    db_path: PathBuf,
    password: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedSecretRow {
    version: u8,
    kdf: String,
    cipher: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

impl SqliteSecretStore {
    pub(super) fn new(db_path: PathBuf, password: String) -> Result<Self, String> {
        if password.trim().is_empty() {
            return Err(format!(
                "{PASSWORD_ENV} is required for encrypted SQLite secret storage"
            ));
        }

        Ok(Self { db_path, password })
    }

    pub(super) fn from_environment(db_path: PathBuf) -> Result<Self, String> {
        let password = std::env::var(PASSWORD_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                format!("{PASSWORD_ENV} is required for encrypted SQLite secret storage")
            })?;
        let store = Self::new(db_path, password)?;
        store.initialize_or_verify(false)?;
        Ok(store)
    }

    pub(super) fn from_password(db_path: PathBuf, password: String) -> Result<Self, String> {
        Self::new(db_path, password)
    }

    pub(super) fn store_exists(db_path: &std::path::Path) -> Result<bool, String> {
        let connection = Connection::open(db_path).map_err(|error| {
            format!(
                "Could not open encrypted SQLite secret store {}: {error}",
                db_path.display()
            )
        })?;
        let sentinel_key = storage_key(SENTINEL_KEY);
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM encrypted_secret_store_entries WHERE secret_key = ?1",
                params![sentinel_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Could not query encrypted SQLite secret store: {error}"))?
            .unwrap_or(0);
        Ok(count > 0)
    }

    pub(super) fn secret_exists_without_password(
        db_path: &std::path::Path,
        reference: &SecretReference,
    ) -> Result<bool, String> {
        let connection = Connection::open(db_path).map_err(|error| {
            format!(
                "Could not open encrypted SQLite secret store {}: {error}",
                db_path.display()
            )
        })?;
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM encrypted_secret_store_entries WHERE secret_key = ?1",
                params![storage_key(&reference.key())],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Could not query encrypted SQLite secret store: {error}"))?
            .unwrap_or(0);
        Ok(count > 0)
    }

    pub(super) fn initialize_or_verify(&self, create_if_missing: bool) -> Result<(), String> {
        let sentinel_key = storage_key(SENTINEL_KEY);
        if self.exists_by_key(&sentinel_key)? {
            let plaintext = self.read_by_key(&sentinel_key)?.ok_or_else(|| {
                "Encrypted SQLite secret store verification record is missing".to_string()
            })?;
            if plaintext == SENTINEL_PLAINTEXT {
                return Ok(());
            }
            return Err("Encrypted SQLite secret store verification failed".to_string());
        }

        if create_if_missing {
            return self.write_by_key(&sentinel_key, SENTINEL_PLAINTEXT);
        }

        Err("Encrypted SQLite secret store has not been set up".to_string())
    }

    pub(super) fn reset(&self) -> Result<(), String> {
        let connection = self.open()?;
        connection
            .execute("DELETE FROM encrypted_secret_store_entries", [])
            .map_err(|error| format!("Could not clear encrypted SQLite secrets: {error}"))?;
        drop(connection);
        self.write_by_key(&storage_key(SENTINEL_KEY), SENTINEL_PLAINTEXT)
    }

    pub(super) fn rotate_password(&self, new_password: String) -> Result<Self, String> {
        self.initialize_or_verify(false)?;
        let replacement = Self::new(self.db_path.clone(), new_password)?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|error| {
            format!("Could not start encrypted SQLite secret rotation: {error}")
        })?;
        let rows = {
            let mut statement = transaction
                .prepare(
                    "SELECT secret_key, version, kdf, cipher, salt, nonce, ciphertext
                     FROM encrypted_secret_store_entries",
                )
                .map_err(|error| {
                    format!("Could not read encrypted SQLite secrets for rotation: {error}")
                })?;
            let mapped = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        EncryptedSecretRow {
                            version: row.get::<_, u8>(1)?,
                            kdf: row.get(2)?,
                            cipher: row.get(3)?,
                            salt: row.get(4)?,
                            nonce: row.get(5)?,
                            ciphertext: row.get(6)?,
                        },
                    ))
                })
                .map_err(|error| {
                    format!("Could not read encrypted SQLite secrets for rotation: {error}")
                })?;
            mapped.collect::<Result<Vec<_>, _>>().map_err(|error| {
                format!("Could not read encrypted SQLite secrets for rotation: {error}")
            })?
        };

        for (key, row) in rows {
            let plaintext = decrypt_secret(&self.password, &key, row)?;
            let encrypted = encrypt_secret(&replacement.password, &key, &plaintext)?;
            transaction
                .execute(
                    "UPDATE encrypted_secret_store_entries
                     SET version = ?2, kdf = ?3, cipher = ?4, salt = ?5,
                         nonce = ?6, ciphertext = ?7, updated_at = CURRENT_TIMESTAMP
                     WHERE secret_key = ?1",
                    params![
                        key,
                        encrypted.version,
                        encrypted.kdf,
                        encrypted.cipher,
                        encrypted.salt,
                        encrypted.nonce,
                        encrypted.ciphertext
                    ],
                )
                .map_err(|error| format!("Could not rotate encrypted SQLite secret: {error}"))?;
        }
        transaction.commit().map_err(|error| {
            format!("Could not commit encrypted SQLite secret rotation: {error}")
        })?;
        Ok(replacement)
    }

    fn open(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|error| {
            format!(
                "Could not open encrypted SQLite secret store {}: {error}",
                self.db_path.display()
            )
        })
    }

    fn write_by_key(&self, key: &str, secret: &str) -> Result<(), String> {
        let connection = self.open()?;
        let encrypted = encrypt_secret(&self.password, key, secret)?;
        connection
            .execute(
                "INSERT INTO encrypted_secret_store_entries (
                    secret_key, version, kdf, cipher, salt, nonce, ciphertext, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
                 ON CONFLICT(secret_key) DO UPDATE SET
                    version = excluded.version,
                    kdf = excluded.kdf,
                    cipher = excluded.cipher,
                    salt = excluded.salt,
                    nonce = excluded.nonce,
                    ciphertext = excluded.ciphertext,
                    updated_at = CURRENT_TIMESTAMP",
                params![
                    key,
                    encrypted.version,
                    encrypted.kdf,
                    encrypted.cipher,
                    encrypted.salt,
                    encrypted.nonce,
                    encrypted.ciphertext
                ],
            )
            .map_err(|error| format!("Could not write encrypted SQLite secret: {error}"))?;
        Ok(())
    }

    fn read_by_key(&self, key: &str) -> Result<Option<String>, String> {
        let connection = self.open()?;
        let row = connection
            .query_row(
                "SELECT version, kdf, cipher, salt, nonce, ciphertext
                 FROM encrypted_secret_store_entries
                 WHERE secret_key = ?1",
                params![key],
                |row| {
                    Ok(EncryptedSecretRow {
                        version: row.get::<_, u8>(0)?,
                        kdf: row.get(1)?,
                        cipher: row.get(2)?,
                        salt: row.get(3)?,
                        nonce: row.get(4)?,
                        ciphertext: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("Could not read encrypted SQLite secret: {error}"))?;

        row.map(|row| decrypt_secret(&self.password, key, row))
            .transpose()
    }

    fn delete_by_key(&self, key: &str) -> Result<(), String> {
        let connection = self.open()?;
        connection
            .execute(
                "DELETE FROM encrypted_secret_store_entries WHERE secret_key = ?1",
                params![key],
            )
            .map_err(|error| format!("Could not delete encrypted SQLite secret: {error}"))?;
        Ok(())
    }

    fn exists_by_key(&self, key: &str) -> Result<bool, String> {
        let connection = self.open()?;
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM encrypted_secret_store_entries WHERE secret_key = ?1",
                params![key],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not query encrypted SQLite secret: {error}"))?;
        Ok(count > 0)
    }
}

impl SecretStore for SqliteSecretStore {
    fn write(&self, reference: &SecretReference, secret: &str) -> Result<(), String> {
        self.initialize_or_verify(false)?;
        self.write_by_key(&storage_key(&reference.key()), secret)
    }

    fn read(&self, reference: &SecretReference) -> Result<Option<String>, String> {
        self.initialize_or_verify(false)?;
        self.read_by_key(&storage_key(&reference.key()))
    }

    fn delete(&self, reference: &SecretReference) -> Result<(), String> {
        self.initialize_or_verify(false)?;
        self.delete_by_key(&storage_key(&reference.key()))
    }

    fn exists(&self, reference: &SecretReference) -> Result<bool, String> {
        self.exists_by_key(&storage_key(&reference.key()))
    }
}

fn storage_key(secret_key: &str) -> String {
    let digest = Sha256::digest(secret_key.as_bytes());
    format!("sha256:{}", BASE64.encode(digest))
}

fn encrypt_secret(
    password: &str,
    storage_key: &str,
    secret: &str,
) -> Result<EncryptedSecretRow, String> {
    let salt = rand::random::<[u8; AES_GCM_NONCE_LENGTH]>();
    let nonce = Nonce::generate();
    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "Could not initialize encrypted SQLite secret cipher".to_string())?;
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: secret.as_bytes(),
                aad: storage_key.as_bytes(),
            },
        )
        .map_err(|_| "Could not encrypt SQLite secret".to_string())?;

    Ok(EncryptedSecretRow {
        version: STORE_VERSION,
        kdf: "argon2id".to_string(),
        cipher: "aes-256-gcm".to_string(),
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decrypt_secret(
    password: &str,
    storage_key: &str,
    row: EncryptedSecretRow,
) -> Result<String, String> {
    if row.version != STORE_VERSION {
        return Err(format!(
            "Encrypted SQLite secret version {} is not supported",
            row.version
        ));
    }
    if row.kdf != "argon2id" || row.cipher != "aes-256-gcm" {
        return Err("Encrypted SQLite secret format is not supported".to_string());
    }

    let salt = BASE64
        .decode(row.salt)
        .map_err(|error| format!("Could not decode encrypted SQLite secret salt: {error}"))?;
    let nonce_bytes = BASE64
        .decode(row.nonce)
        .map_err(|error| format!("Could not decode encrypted SQLite secret nonce: {error}"))?;
    if nonce_bytes.len() != AES_GCM_NONCE_LENGTH {
        return Err("Could not decode encrypted SQLite secret nonce: invalid length".to_string());
    }
    let ciphertext = BASE64
        .decode(row.ciphertext)
        .map_err(|error| format!("Could not decode encrypted SQLite secret ciphertext: {error}"))?;

    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "Could not initialize encrypted SQLite secret cipher".to_string())?;
    let nonce = Nonce::try_from(nonce_bytes.as_slice()).map_err(|_| {
        "Could not decode encrypted SQLite secret nonce: invalid length".to_string()
    })?;
    let plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext.as_ref(),
                aad: storage_key.as_bytes(),
            },
        )
        .map_err(|_| {
            "could not decrypt encrypted SQLite secret; check the configured master password"
                .to_string()
        })?;

    String::from_utf8(plaintext)
        .map_err(|error| format!("Could not decode encrypted SQLite secret plaintext: {error}"))
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| format!("Could not derive encrypted SQLite secret key: {error}"))?;
    Ok(key)
}
