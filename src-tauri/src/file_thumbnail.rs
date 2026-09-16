//! Disposable, bounded local previews. Never run thumbnail work during directory listing.
use base64::Engine;
use image::{DynamicImage, ImageDecoder, ImageReader};
use sha2::{Digest, Sha256};
use std::{fs, io::{Cursor, Read}, path::Path};

const EDGE: u32 = 128;
const MAX_SOURCE: u64 = 32 * 1024 * 1024;
const MAX_CACHE_ENTRY: u64 = 128 * 1024;
static WORKERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

#[tauri::command]
pub async fn read_local_thumbnail(app: tauri::AppHandle, path: String) -> Option<String> {
    // Bound actual blocking work, including callers outside the browser queue.
    let permit = WORKERS.acquire().await.ok()?;
    let cache = crate::app_paths::cache_dir(&app).ok()?.join("file-thumbnails-v1");
    let result = tauri::async_runtime::spawn_blocking(move || thumbnail(Path::new(&path), &cache))
        .await.ok().flatten();
    drop(permit);
    result
}

fn fingerprint(path: &Path, metadata: &fs::Metadata) -> Option<Vec<u8>> {
    let mut hash = Sha256::new();
    hash.update(path.as_os_str().as_encoded_bytes());
    hash.update(metadata.len().to_le_bytes());
    hash.update(metadata.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos().to_le_bytes());
    Some(hash.finalize().to_vec())
}

fn thumbnail(path: &Path, cache: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "heic" | "avif") {
        return None;
    }
    let path = path.canonicalize().ok()?;
    let metadata = fs::metadata(&path).ok()?;
    if !metadata.is_file() { return None; }
    let key = fingerprint(&path, &metadata)?;
    // 256 direct-mapped slots: bounded disk use without scanning a cache directory.
    // The full digest in each slot prevents a collision returning another file's image.
    let slot = cache.join(format!("{:02x}.thumb", key[0]));
    if let Ok(file) = fs::File::open(&slot) {
        let mut bytes = Vec::new();
        if file.take(MAX_CACHE_ENTRY + 1).read_to_end(&mut bytes).is_ok()
            && bytes.len() <= MAX_CACHE_ENTRY as usize && bytes.starts_with(&key) && bytes.len() > key.len() {
            return Some(data_url(&bytes[key.len()..]));
        }
    }
    let native = cached_windows_thumbnail(&path);
    let image = native.or_else(|| decode_local(&path, &metadata))?;
    let mut png = Cursor::new(Vec::new());
    image.thumbnail(EDGE, EDGE).write_to(&mut png, image::ImageFormat::Png).ok()?;
    let png = png.into_inner();
    if png.len() + key.len() > MAX_CACHE_ENTRY as usize { return None; }
    // Do not cache a preview if the source changed while it was being read.
    if fingerprint(&path, &fs::metadata(&path).ok()?)? != key { return None; }
    if fs::create_dir_all(cache).is_ok() {
        use std::io::Write;
        if let Ok(mut temp) = tempfile::NamedTempFile::new_in(cache) {
            if temp.write_all(&key).and_then(|_| temp.write_all(&png)).is_ok() {
                let _ = temp.persist(&slot);
            }
        }
    }
    Some(data_url(&png))
}

fn data_url(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn decode_local(path: &Path, metadata: &fs::Metadata) -> Option<DynamicImage> {
    if metadata.len() > MAX_SOURCE { return None; }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        // Do not hydrate OneDrive/offline placeholders just to draw a thumbnail.
        if metadata.file_attributes() & (0x1000 | 0x40000 | 0x400000) != 0 { return None; }
    }
    let mut bytes = Vec::new();
    fs::File::open(path).ok()?.take(MAX_SOURCE + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_SOURCE { return None; }
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format().ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().ok()?;
    if decoder.total_bytes() > 128 * 1024 * 1024 { return None; }
    if u64::from(decoder.dimensions().0) * u64::from(decoder.dimensions().1) > 32_000_000 { return None; }
    let orientation = decoder.orientation().ok()?;
    let mut image = DynamicImage::from_decoder(decoder).ok()?;
    image.apply_orientation(orientation);
    Some(image)
}

#[cfg(not(windows))]
fn cached_windows_thumbnail(_: &Path) -> Option<DynamicImage> { None }

#[cfg(windows)]
fn cached_windows_thumbnail(path: &Path) -> Option<DynamicImage> {
    use std::{mem::size_of, os::windows::ffi::OsStrExt};
    use windows::{core::PCWSTR, Win32::{System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED}, UI::Shell::{IThumbnailCache, IShellItem, LocalThumbnailCache, SHCreateItemFromParsingName, WTS_INCACHEONLY, WTSAT_ARGB}}};
    use windows_sys::Win32::Graphics::Gdi::{BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, GetDC, GetDIBits, ReleaseDC};
    struct Com;
    impl Drop for Com { fn drop(&mut self) { unsafe { CoUninitialize() } } }
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()?;
        let _com = Com;
        let cache: IThumbnailCache = CoCreateInstance(&LocalThumbnailCache, None, CLSCTX_INPROC_SERVER).ok()?;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;
        let mut bitmap = None;
        cache.GetThumbnail(&item, EDGE, WTS_INCACHEONLY, Some(&mut bitmap), None, None).ok()?;
        let bitmap = bitmap?;
        let size = bitmap.GetSize().ok()?;
        if size.cx <= 0 || size.cy <= 0 || size.cx > 1024 || size.cy > 1024 { return None; }
        let handle = bitmap.GetSharedBitmap().ok()?;
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER { biSize: size_of::<BITMAPINFOHEADER>() as u32, biWidth: size.cx, biHeight: -size.cy, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB, ..Default::default() };
        let mut pixels = vec![0u8; (size.cx * size.cy * 4) as usize];
        let dc = GetDC(std::ptr::null_mut());
        if dc.is_null() { return None; }
        let rows = GetDIBits(dc, handle.0, 0, size.cy as u32, pixels.as_mut_ptr().cast(), &mut info, DIB_RGB_COLORS);
        ReleaseDC(std::ptr::null_mut(), dc);
        if rows != size.cy { return None; }
        let alpha = bitmap.GetFormat().ok()? == WTSAT_ARGB;
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            if !alpha { pixel[3] = 255; }
        }
        // ISharedBitmap owns the HBITMAP; never DeleteObject it.
        Some(DynamicImage::ImageRgba8(image::RgbaImage::from_raw(size.cx as u32, size.cy as u32, pixels)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    #[ignore = "requires the Windows Shell thumbnail service; run explicitly on desktop"]
    fn reads_the_windows_shell_cache() {
        use windows::{core::PCWSTR, Win32::{System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED}, UI::Shell::{IThumbnailCache, IShellItem, LocalThumbnailCache, SHCreateItemFromParsingName, WTS_EXTRACT}}};
        use std::os::windows::ffi::OsStrExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shell-preview.png");
        DynamicImage::new_rgb8(240, 120).save(&path).unwrap();
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().unwrap();
            {
                let cache: IThumbnailCache = CoCreateInstance(&LocalThumbnailCache, None, CLSCTX_INPROC_SERVER).unwrap();
                let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
                let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).unwrap();
                let mut bitmap = None;
                cache.GetThumbnail(&item, EDGE, WTS_EXTRACT, Some(&mut bitmap), None, None).unwrap();
            }
            CoUninitialize();
        }
        let preview = cached_windows_thumbnail(&path).expect("Shell cache hit without fallback decoding");
        assert!(preview.width() > 0 && preview.width() <= 1024);
        assert_eq!(preview.width(), preview.height() * 2);
    }
    #[test]
    fn previews_are_small_cached_and_invalidated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("photo.png");
        let cache = dir.path().join("cache");
        DynamicImage::new_rgb8(400, 200).save(&path).unwrap();
        let first = thumbnail(&path, &cache).unwrap();
        assert_eq!(thumbnail(&path, &cache).unwrap(), first);
        let bytes = base64::engine::general_purpose::STANDARD.decode(first.split(',').nth(1).unwrap()).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (128, 64));
        DynamicImage::new_rgb8(30, 60).save(&path).unwrap();
        assert_ne!(thumbnail(&path, &cache).unwrap(), first);
        let large = fs::File::create(&path).unwrap();
        large.set_len(MAX_SOURCE + 1).unwrap();
        assert!(decode_local(&path, &large.metadata().unwrap()).is_none());
        drop(large);
        fs::write(&path, b"broken image").unwrap();
        assert!(thumbnail(&path, &cache).is_none());
        assert!(thumbnail(dir.path(), &cache).is_none());
    }
}
