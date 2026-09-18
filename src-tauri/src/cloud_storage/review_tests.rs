use super::*;
use object_store::memory::InMemory;

fn memory_store() -> Arc<dyn ObjectStore> {
    Arc::new(InMemory::new())
}

fn connection(store: Arc<dyn ObjectStore>) -> CloudStorageConnection {
    CloudStorageConnection {
        runtime: tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap(),
        transport: CloudStorageTransport::ObjectStore {
            store,
            provider: CloudStorageProvider::S3,
        },
        options: CloudStorageOptions::default(),
    }
}

async fn put(store: &Arc<dyn ObjectStore>, key: &str, contents: &'static [u8]) {
    store
        .put(&path_from_key(key).unwrap(), Bytes::from_static(contents).into())
        .await
        .unwrap();
}

async fn read(store: &Arc<dyn ObjectStore>, key: &str) -> Bytes {
    store
        .get(&path_from_key(key).unwrap())
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap()
}

#[tokio::test]
async fn file_rename_moves_instead_of_copying_and_preserves_literal_keys() {
    let store = memory_store();
    put(&store, "reports/測試 %2F.txt", b"report").await;
    object_store_rename(&store, "/reports/測試 %2F.txt", "/reports/renamed %2F.txt")
        .await
        .unwrap();
    assert!(!object_store_file_exists(&store, &path_from_key("reports/測試 %2F.txt").unwrap()).await.unwrap());
    assert_eq!(read(&store, "reports/renamed %2F.txt").await.as_ref(), b"report");
    object_store_rename(&store, "/reports/renamed %2F.txt", "/reports/renamed %2F.txt")
        .await
        .unwrap();
    assert_eq!(read(&store, "reports/renamed %2F.txt").await.as_ref(), b"report");
}

#[tokio::test]
async fn folder_rename_preserves_nested_paths_without_touching_prefix_neighbors() {
    let store = memory_store();
    put(&store, "old/one.txt", b"one").await;
    put(&store, "old/nested/測試 %2F.txt", b"two").await;
    put(&store, "older/keep.txt", b"keep").await;
    object_store_rename(&store, "/old", "/new").await.unwrap();
    assert_eq!(read(&store, "new/one.txt").await.as_ref(), b"one");
    assert_eq!(read(&store, "new/nested/測試 %2F.txt").await.as_ref(), b"two");
    assert_eq!(read(&store, "older/keep.txt").await.as_ref(), b"keep");
    assert!(!object_store_file_exists(&store, &path_from_key("old/one.txt").unwrap()).await.unwrap());
    assert!(!object_store_file_exists(&store, &path_from_key("old/nested/測試 %2F.txt").unwrap()).await.unwrap());
}

#[test]
fn recursive_download_uses_one_runtime_and_keeps_nested_contents() {
    let store = memory_store();
    let connection = connection(store.clone());
    let temporary = tempfile::tempdir().unwrap();
    let destination = temporary.path().join("download");
    let cancel = Arc::new(AtomicBool::new(false));
    connection.runtime.block_on(async {
        put(&store, "folder/one.txt", b"one").await;
        put(&store, "folder/nested/測試 %2F.txt", b"two").await;
        put(&store, "folder/empty.txt", b"").await;
        assert!(remote_is_folder(&connection, "/folder").await.unwrap());
        let bytes = download_object_tree(
            &connection, "/folder", &destination, &cancel,
            OverwriteBehavior::Fail, &|_, _| {},
        ).await.unwrap();
        assert_eq!(bytes, 6);
    });
    assert_eq!(std::fs::read(destination.join("one.txt")).unwrap(), b"one");
    assert_eq!(std::fs::read(destination.join("nested/測試 %2F.txt")).unwrap(), b"two");
    assert_eq!(std::fs::read(destination.join("empty.txt")).unwrap(), b"");
}

#[tokio::test]
async fn cancellation_preserves_existing_destination_and_cleans_staging_file() {
    let store = memory_store();
    put(&store, "file.txt", b"replacement").await;
    let temporary = tempfile::tempdir().unwrap();
    let destination = temporary.path().join("file.txt");
    std::fs::write(&destination, b"original").unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    let error = object_store_download(
        &store, "/file.txt", &destination, &cancel,
        OverwriteBehavior::Overwrite,
        &|_, _| cancel.store(true, Ordering::SeqCst),
    ).await.unwrap_err();
    assert_eq!(error, TRANSFER_CANCELED);
    assert_eq!(std::fs::read(&destination).unwrap(), b"original");
    assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn no_clobber_handles_a_destination_created_during_download() {
    let store = memory_store();
    put(&store, "file.txt", b"download").await;
    let temporary = tempfile::tempdir().unwrap();
    let destination = temporary.path().join("file.txt");
    let cancel = Arc::new(AtomicBool::new(false));
    let error = object_store_download(
        &store, "/file.txt", &destination, &cancel,
        OverwriteBehavior::Fail,
        &|_, _| std::fs::write(&destination, b"other writer").unwrap(),
    ).await.unwrap_err();
    assert!(error.contains("destination already exists"), "{error}");
    assert_eq!(std::fs::read(&destination).unwrap(), b"other writer");
    assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn successful_download_replaces_only_after_completion_and_supports_empty_files() {
    let store = memory_store();
    put(&store, "file.txt", b"replacement").await;
    put(&store, "empty.txt", b"").await;
    let temporary = tempfile::tempdir().unwrap();
    let destination = temporary.path().join("file.txt");
    std::fs::write(&destination, b"original").unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    assert_eq!(object_store_download(
        &store, "/file.txt", &destination, &cancel,
        OverwriteBehavior::Overwrite, &|_, _| {},
    ).await.unwrap(), 11);
    assert_eq!(std::fs::read(&destination).unwrap(), b"replacement");
    assert_eq!(object_store_download(
        &store, "/empty.txt", &destination, &cancel,
        OverwriteBehavior::Overwrite, &|_, _| {},
    ).await.unwrap(), 0);
    assert_eq!(std::fs::read(&destination).unwrap(), b"");
}

#[tokio::test]
async fn missing_object_does_not_modify_existing_destination() {
    let store = memory_store();
    let temporary = tempfile::tempdir().unwrap();
    let destination = temporary.path().join("file.txt");
    std::fs::write(&destination, b"original").unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    assert!(object_store_download(
        &store, "/missing.txt", &destination, &cancel,
        OverwriteBehavior::Overwrite, &|_, _| {},
    ).await.is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), b"original");
    assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 1);
}

#[test]
fn download_names_cannot_be_interpreted_as_local_paths() {
    let parent = Path::new("downloads");
    for name in ["", ".", "..", "../outside", "..\\outside", "C:outside", "file:stream", "bad\0name"] {
        assert!(download_child_path(parent, name).is_err(), "accepted {name:?}");
    }
    assert_eq!(download_child_path(parent, "測試 %2F.txt").unwrap(), parent.join("測試 %2F.txt"));
}
