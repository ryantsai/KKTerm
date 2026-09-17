# ADR 0014: Cloud Storage Connection Type and Provider Model

## Status

Accepted

## Context

KKTerm shipped SFTP (launched from an SSH Connection) and a standalone
FTP/FTPS Connection type, both driving the same file-browser surface through
the protocol-agnostic adapter in `src/lib/fileBrowserCommands.ts`. S3-compatible
object storage and Azure Blob Storage are the next requested storage targets.

The design question was whether to add one Connection type or several. The costs
that pushed toward a single type:

- `connections.connection_type` carries a SQLite `CHECK` constraint, and SQLite
  cannot alter a `CHECK` in place. Adding a type value requires a full table
  rebuild migration, so each additional type is a second rebuild for every
  upgrading database.
- The value is threaded through the frontend `ConnectionType` union,
  `normalize_connection_type`, the Connection dialog's type switches, the
  connection-tree labels/icons/subtitles, the new-connection picker, and the
  workspace copy-import statement.
- `ftp` already demonstrates the alternative: one Connection type with a
  `protocol` discriminator (`sftp | ftp | ftps`) inside its persisted options,
  including per-protocol authentication fields.

Provider differences are real but they are not Connection-*type* differences.
Azure Blob pages listings at a different size than S3; both lack a POSIX
permission model, lack an empty-folder primitive, and rename as
copy-then-delete. Those are capability differences, and
`FileBrowserCapabilities` already exists to express them.

Two further constraints shaped the decision:

- **Library.** `object_store` 0.14.2 (Apache-2.0, Apache Arrow project) covers
  both providers behind one trait with SigV4 signing, SharedKey/SAS
  authentication, pagination, retries, and multipart upload. Its five new
  transitive crates were already almost entirely present in KKTerm's tree.
- **Credentials.** Saved Credentials are a label/username/password bundle, and
  the providers do not share a credential shape: S3 is an access key id plus
  secret access key, and Azure is an account name plus either an account key or
  an opaque SAS token.

## Decision

Add **one** Connection type, `cloudStorage`, whose `cloudStorageOptions` JSON
column carries a `provider` discriminator (`s3 | azureBlob`).

- **Provider parameters are provider-scoped by normalization.**
  `normalize_cloud_storage_options` requires the fields the selected provider
  needs and **clears every field belonging to the other**, so switching provider
  in the edit dialog can never persist contradictory parameters.
- **The dialog swaps field groups, not fields.** The provider segmented control
  replaces the whole parameter group below it, following the FTP protocol
  control, instead of rendering the union of both providers.
- **One Connection type, one transport.** A `CloudStorageSessionManager`
  dispatches on the provider to `object_store`; the `CloudStorageTransport` enum
  keeps the dispatch seam explicit for a future provider that needs its own
  client, mirroring how `ftp.rs` refuses the SFTP sub-protocol and delegates to
  the SFTP manager rather than merging transports.
- **Capabilities reflect object-storage semantics.** The POSIX permissions
  editor and the New Folder action are both withheld. Folder creation is not
  faked with a placeholder object because `object_store`'s `Path` strips
  trailing slashes and refuses to represent an object key ending in `/`.
  `create_cloud_storage_folder` remains as an always-erroring guard so a stale
  frontend or a direct caller gets a clear reason rather than a silent no-op.
- **Credentials reuse the existing model.** The provider principal (S3 access
  key id, Azure account name) is the Connection `username`; the secret (S3
  secret access key, Azure account key or SAS token) lives in the OS keychain
  under the Connection's secret owner id, exactly like FTP. Azure SAS tokens
  therefore occupy the password slot with an empty username.
- **The credentials table keeps its original CHECK.** Cloud Storage does not
  participate in Saved Credentials, and `ensure_connection_password_type`
  already rejects unsupported types. Widening
  `connection_password_credentials.connection_type` would have added a second
  parent-table rebuild to the migration for no behavioural gain.
- **Provider binding is required per Connection.** A Connection addresses
  exactly one S3 bucket or Azure container, because object stores have no
  portable bucket-listing permission model.
- **The app proxy applies.** The `object_store` client options honour the
  resolved app proxy, consistent with every other request path in KKTerm.

## Considered and dropped: WebDAV

An earlier revision of this change shipped WebDAV as a third provider, with a
hand-written `reqwest` client (PROPFIND listing, MKCOL, MOVE, DELETE, GET/PUT),
because no maintained license-compatible WebDAV crate exists. It was removed
before release. Reasons, recorded so the option is understood if it returns:

- It was the only provider with an empty-folder primitive (`MKCOL`), so its
  removal is what makes `createFolder` uniformly false for Cloud Storage.
  Restoring folder creation for object stores would require writing placeholder
  objects, which is deliberately not done.
- It was the only consumer of the direct `quick-xml` dependency, which is now
  removed from `Cargo.toml` (`object_store` still pulls it transitively for its
  own XML parsing).
- Removing it deleted roughly 500 lines of XML parsing, percent-encoding,
  HTTP-date parsing, and Digest-auth-free request plumbing that would otherwise
  need its own correctness and security attention.
- WebDAV remains the protocol Nextcloud, ownCloud, and SharePoint speak. If
  those targets matter more than the object-storage vendors, WebDAV should be
  reinstated as a provider: the single-type model means doing so costs no schema
  work, and the `CloudStorageTransport` enum is where its client would slot back
  in.

## Consequences

- `SCHEMA_USER_VERSION` moves to 66 with a `connections` table rebuild that adds
  the `cloudStorage` CHECK value and the `cloud_storage_options` column. The
  rebuild drops the indexes attached to `connections`, and the FK-repair helper
  drops the child tables' indexes, so the migration re-asserts the v61 index
  shapes after the repair. Regression coverage for that path is the existing
  `v61_query_indexes_upgrade_and_current_reopen_preserve_schema_fast_path` test.
- Adding Azure Blob later was free; adding a *provider* now costs no schema
  work, which was the point of the single type.
- Object-storage directory listings are paged by the provider. The shared
  listing result carries an optional `truncated` flag and the browser raises a
  Status Bar warning instead of silently hiding objects. Incremental
  "load more" pagination is deliberately deferred.
- Not yet supported, in rough priority order: S3 session tokens (STS) and Azure
  AD/OAuth credentials; Saved Credential linking for cloud Connections; and
  multipart upload progress granularity beyond what `object_store`'s `BufWriter`
  reports.
- `object_store` is a comparatively large dependency. It is confined to the
  Cloud Storage transport, so replacement stays local if maintenance,
  interoperability, or licensing proves inadequate.
