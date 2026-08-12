//! Backend file-reading primitives for the Document Connection (kind
//! `fileView`). These are pure, blocking filesystem helpers; every Tauri
//! command that calls them must do so from a background worker
//! (`run_blocking_command`/`spawn_blocking`) per the UI-liveness invariant —
//! filesystem reads must never run on the foreground command runtime.
//!
//! The viewer reads local files through a cheap metadata/type probe, bounded
//! text or base64 chunks, and a sparse large-text line index. Large-text search
//! follows that index one capped page at a time. All reads are explicitly
//! bounded so a multi-gigabyte file cannot exhaust memory.

use base64::Engine;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

use crate::installer::detect::github_release_install_dir;
use crate::installer::proc::no_window;

/// Number of leading bytes sampled for the text/binary heuristic and magic-byte
/// signature detection.
const PROBE_SAMPLE_BYTES: usize = 8192;

/// Hard upper bound on a single text or byte read regardless of the requested
/// size, so a viewer bug or hostile request cannot allocate unbounded memory.
const READ_HARD_CAP_BYTES: u64 = 64 * 1024 * 1024;

/// Sparse large-text index cadence. The frontend loads one bounded page between
/// adjacent checkpoints and keeps only nearby pages in memory.
const LARGE_TEXT_LINE_STRIDE: u64 = 256;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewProbeRequest {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewTextRequest {
    pub path: String,
    /// Maximum number of bytes to read; clamped to `READ_HARD_CAP_BYTES`.
    pub max_bytes: u64,
    /// When true, read the trailing `max_bytes` of the file (used by the log
    /// viewer's follow/tail mode) instead of the leading bytes.
    #[serde(default)]
    pub from_end: bool,
    /// `encoding_rs` label (e.g. `utf-8`, `gbk`, `shift_jis`, `windows-1252`)
    /// to decode the bytes with. `None` (or an unknown label) auto-detects the
    /// charset with `chardetng`.
    #[serde(default)]
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewTextIndexRequest {
    pub path: String,
    /// The encoding selected/detected by the initial bounded text read.
    #[serde(default)]
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewTextPageRequest {
    pub path: String,
    /// Exact byte range from two adjacent sparse-index checkpoints.
    pub start_offset: u64,
    pub end_offset: u64,
    /// The encoding selected/detected by the initial bounded text read.
    #[serde(default)]
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewTextSearchRequest {
    pub path: String,
    pub query: String,
    /// Sparse offsets returned by `index_text`. Search consumes one bounded
    /// page at a time and never copies the complete file into memory.
    pub checkpoint_offsets: Vec<u64>,
    pub total_size: u64,
    pub total_lines: u64,
    pub line_stride: u64,
    pub expected_mtime_ms: i64,
    /// Zero-based viewer cursor used as the next/previous search origin.
    pub cursor_line: u64,
    pub cursor_column: u64,
    #[serde(default)]
    pub backwards: bool,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewBytesRequest {
    pub path: String,
    pub offset: u64,
    pub length: u64,
}

/// Error-message prefix the frontend matches to detect a save conflict (the file
/// changed on disk since it was loaded) so it can prompt before overwriting.
pub const FILE_VIEW_CONFLICT: &str = "FILE_VIEW_CONFLICT";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewWriteRequest {
    pub path: String,
    pub content: String,
    /// The mtime the editor loaded; a mismatch (unless `force`) means the file
    /// changed underneath the editor and the save is refused as a conflict.
    #[serde(default)]
    pub expected_mtime_ms: Option<i64>,
    /// Overwrite even when the on-disk mtime no longer matches.
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewWriteResult {
    pub mtime_ms: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewProbe {
    pub total_size: u64,
    pub mtime_ms: i64,
    /// Heuristic: the sampled prefix contains no NUL byte and decodes as UTF-8.
    pub is_text: bool,
    /// Detected container/image signature (`png`, `jpeg`, `gif`, `webp`, `bmp`,
    /// `pdf`, `zip`, `gzip`, `sqlite`) when one matches, else `None`.
    pub magic: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewText {
    pub text: String,
    pub total_size: u64,
    pub bytes_read: u64,
    /// True when the file is larger than what was returned.
    pub truncated: bool,
    /// True when this is the trailing slice of the file (`from_end`).
    pub from_end: bool,
    pub mtime_ms: i64,
    /// `encoding_rs` label actually used to decode the text (lowercased), so the
    /// viewer can show what Auto resolved to and gate editing to UTF-8.
    pub detected_encoding: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewTextIndex {
    pub total_size: u64,
    pub total_lines: u64,
    pub line_stride: u64,
    /// Byte offset for line 0, line `line_stride`, line `line_stride * 2`, ...
    pub checkpoint_offsets: Vec<u64>,
    pub mtime_ms: i64,
    pub detected_encoding: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewTextPage {
    pub text: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub total_size: u64,
    pub mtime_ms: i64,
    pub detected_encoding: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileViewTextSearchMatch {
    /// Zero-based line and UTF-16 columns, matching the frontend's string
    /// indexing and virtual-row model.
    pub line: u64,
    pub start_column: u64,
    pub end_column: u64,
    pub wrapped: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileViewBytes {
    pub base64: String,
    pub total_size: u64,
    pub offset: u64,
    pub bytes_read: u64,
    pub eof: bool,
    pub mtime_ms: i64,
}

fn metadata_for(path: &Path) -> Result<std::fs::Metadata, String> {
    let metadata = std::fs::metadata(path).map_err(|error| format!("cannot read file: {error}"))?;
    if metadata.is_dir() {
        return Err("path is a directory, not a file".to_string());
    }
    Ok(metadata)
}

fn mtime_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as i64)
        .unwrap_or(0)
}

fn detect_magic(sample: &[u8]) -> Option<String> {
    let starts = |prefix: &[u8]| sample.len() >= prefix.len() && &sample[..prefix.len()] == prefix;
    if starts(b"\x89PNG\r\n\x1a\n") {
        return Some("png".to_string());
    }
    if starts(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpeg".to_string());
    }
    if starts(b"GIF87a") || starts(b"GIF89a") {
        return Some("gif".to_string());
    }
    if starts(b"RIFF") && sample.len() >= 12 && &sample[8..12] == b"WEBP" {
        return Some("webp".to_string());
    }
    if starts(b"BM") {
        return Some("bmp".to_string());
    }
    if starts(b"%PDF-") {
        return Some("pdf".to_string());
    }
    if starts(&[0x50, 0x4B, 0x03, 0x04]) || starts(&[0x50, 0x4B, 0x05, 0x06]) {
        return Some("zip".to_string());
    }
    if starts(&[0x1F, 0x8B]) {
        return Some("gzip".to_string());
    }
    if starts(b"SQLite format 3\0") {
        return Some("sqlite".to_string());
    }
    None
}

/// Cheap text/binary heuristic over a sampled prefix: a NUL byte is a strong
/// binary signal, and the remaining bytes must decode as UTF-8 (allowing a
/// truncated multi-byte sequence at the very end of the sample).
fn looks_like_text(sample: &[u8]) -> bool {
    if sample.contains(&0) {
        return false;
    }
    match std::str::from_utf8(sample) {
        Ok(_) => true,
        Err(error) => {
            // Accept a multi-byte char clipped by the sample boundary, but a
            // genuine decode error earlier in the buffer means binary.
            error.error_len().is_none() && error.valid_up_to() + 4 >= sample.len()
        }
    }
}

pub fn probe(request: FileViewProbeRequest) -> Result<FileViewProbe, String> {
    let path = Path::new(&request.path);
    let metadata = metadata_for(path)?;
    let total_size = metadata.len();

    let mut file = File::open(path).map_err(|error| format!("cannot open file: {error}"))?;
    let mut sample = vec![0u8; PROBE_SAMPLE_BYTES.min(total_size as usize)];
    let read = file
        .read(&mut sample)
        .map_err(|error| format!("cannot read file: {error}"))?;
    sample.truncate(read);

    Ok(FileViewProbe {
        total_size,
        mtime_ms: mtime_ms(&metadata),
        is_text: looks_like_text(&sample),
        magic: detect_magic(&sample),
    })
}

pub fn read_text(request: FileViewTextRequest) -> Result<FileViewText, String> {
    let path = Path::new(&request.path);
    let metadata = metadata_for(path)?;
    let total_size = metadata.len();
    let cap = request.max_bytes.min(READ_HARD_CAP_BYTES);

    let mut file = File::open(path).map_err(|error| format!("cannot open file: {error}"))?;
    let start = if request.from_end {
        total_size.saturating_sub(cap)
    } else {
        0
    };
    if start > 0 {
        file.seek(SeekFrom::Start(start))
            .map_err(|error| format!("cannot seek file: {error}"))?;
    }

    let to_read = cap.min(total_size.saturating_sub(start)) as usize;
    let mut buffer = vec![0u8; to_read];
    let mut filled = 0usize;
    while filled < to_read {
        let read = file
            .read(&mut buffer[filled..])
            .map_err(|error| format!("cannot read file: {error}"))?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    buffer.truncate(filled);

    let (text, detected_encoding) = decode_text(&buffer, request.encoding.as_deref());
    let bytes_read = filled as u64;
    Ok(FileViewText {
        text,
        total_size,
        bytes_read,
        truncated: start > 0 || bytes_read < total_size,
        from_end: request.from_end,
        mtime_ms: mtime_ms(&metadata),
        detected_encoding,
    })
}

#[derive(Clone, Copy)]
enum NewlineEncoding {
    SingleByte,
    Utf16Le,
    Utf16Be,
}

fn newline_encoding(label: &str) -> NewlineEncoding {
    match label.to_ascii_lowercase().as_str() {
        "utf-16le" => NewlineEncoding::Utf16Le,
        "utf-16be" => NewlineEncoding::Utf16Be,
        _ => NewlineEncoding::SingleByte,
    }
}

fn push_large_text_checkpoint(
    newline_count: &mut u64,
    next_line_offset: u64,
    checkpoints: &mut Vec<u64>,
) {
    *newline_count += 1;
    if *newline_count % LARGE_TEXT_LINE_STRIDE == 0 {
        checkpoints.push(next_line_offset);
    }
}

fn scan_large_text_line_unit(
    unit: u16,
    next_offset: u64,
    pending_carriage_return: &mut Option<u64>,
    newline_count: &mut u64,
    checkpoints: &mut Vec<u64>,
) {
    if let Some(carriage_return_end) = pending_carriage_return.take() {
        if unit == b'\n' as u16 {
            push_large_text_checkpoint(newline_count, next_offset, checkpoints);
            return;
        }
        push_large_text_checkpoint(newline_count, carriage_return_end, checkpoints);
    }

    if unit == b'\r' as u16 {
        *pending_carriage_return = Some(next_offset);
    } else if unit == b'\n' as u16 {
        push_large_text_checkpoint(newline_count, next_offset, checkpoints);
    }
}

/// Scan the file once and keep only one byte offset per 256 lines. The scan is
/// performed by the async command's blocking worker, so even multi-gigabyte
/// inputs do not stall the webview or allocate their contents in memory.
pub fn index_text(request: FileViewTextIndexRequest) -> Result<FileViewTextIndex, String> {
    let path = Path::new(&request.path);
    let metadata = metadata_for(path)?;
    let total_size = metadata.len();
    let mut file = File::open(path).map_err(|error| format!("cannot open file: {error}"))?;

    let mut sample = vec![0u8; PROBE_SAMPLE_BYTES.min(total_size as usize)];
    let sample_read = file
        .read(&mut sample)
        .map_err(|error| format!("cannot read file: {error}"))?;
    sample.truncate(sample_read);
    let (_, detected_encoding) = decode_text(&sample, request.encoding.as_deref());
    file.seek(SeekFrom::Start(0))
        .map_err(|error| format!("cannot seek file: {error}"))?;

    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut checkpoints = vec![0];
    let mut newline_count = 0u64;
    let mut absolute_offset = 0u64;
    let mut pending_utf16_byte: Option<(u8, u64)> = None;
    let mut pending_carriage_return: Option<u64> = None;
    let newline_kind = newline_encoding(&detected_encoding);

    loop {
        let buffer = reader
            .fill_buf()
            .map_err(|error| format!("cannot read file: {error}"))?;
        if buffer.is_empty() {
            break;
        }

        match newline_kind {
            NewlineEncoding::SingleByte => {
                for (index, byte) in buffer.iter().enumerate() {
                    scan_large_text_line_unit(
                        *byte as u16,
                        absolute_offset + index as u64 + 1,
                        &mut pending_carriage_return,
                        &mut newline_count,
                        &mut checkpoints,
                    );
                }
            }
            NewlineEncoding::Utf16Le | NewlineEncoding::Utf16Be => {
                for (index, byte) in buffer.iter().enumerate() {
                    let offset = absolute_offset + index as u64;
                    if let Some((first, _first_offset)) = pending_utf16_byte.take() {
                        let unit = match newline_kind {
                            NewlineEncoding::Utf16Le => u16::from_le_bytes([first, *byte]),
                            NewlineEncoding::Utf16Be => u16::from_be_bytes([first, *byte]),
                            NewlineEncoding::SingleByte => unreachable!(),
                        };
                        scan_large_text_line_unit(
                            unit,
                            offset + 1,
                            &mut pending_carriage_return,
                            &mut newline_count,
                            &mut checkpoints,
                        );
                    } else {
                        pending_utf16_byte = Some((*byte, offset));
                    }
                }
            }
        }

        let consumed = buffer.len();
        reader.consume(consumed);
        absolute_offset += consumed as u64;
    }

    if let Some(carriage_return_end) = pending_carriage_return {
        push_large_text_checkpoint(&mut newline_count, carriage_return_end, &mut checkpoints);
    }

    Ok(FileViewTextIndex {
        total_size,
        total_lines: if total_size == 0 {
            0
        } else {
            newline_count.saturating_add(1)
        },
        line_stride: LARGE_TEXT_LINE_STRIDE,
        checkpoint_offsets: checkpoints,
        mtime_ms: mtime_ms(&metadata),
        detected_encoding,
    })
}

/// Read one exact large-text page identified by adjacent sparse-index offsets.
/// The hard cap protects the webview from pathological individual lines while
/// ordinary pages remain a few kilobytes.
pub fn read_text_page(request: FileViewTextPageRequest) -> Result<FileViewTextPage, String> {
    let path = Path::new(&request.path);
    let metadata = metadata_for(path)?;
    let total_size = metadata.len();
    let start_offset = request.start_offset.min(total_size);
    let end_offset = request.end_offset.min(total_size);
    if end_offset < start_offset {
        return Err("large-text page has an invalid byte range".to_string());
    }
    let length = end_offset - start_offset;
    if length > READ_HARD_CAP_BYTES {
        return Err("large-text page exceeds the maximum readable size".to_string());
    }

    let mut file = File::open(path).map_err(|error| format!("cannot open file: {error}"))?;
    if start_offset > 0 {
        file.seek(SeekFrom::Start(start_offset))
            .map_err(|error| format!("cannot seek file: {error}"))?;
    }
    let mut buffer = vec![0u8; length as usize];
    file.read_exact(&mut buffer)
        .map_err(|error| format!("cannot read file: {error}"))?;
    let (text, detected_encoding) = decode_text(&buffer, request.encoding.as_deref());

    Ok(FileViewTextPage {
        text,
        start_offset,
        end_offset,
        total_size,
        mtime_ms: mtime_ms(&metadata),
        detected_encoding,
    })
}

#[derive(Clone, Copy)]
enum SearchRegion {
    BeforeCursor,
    AtOrAfterCursor,
}

fn decoded_line_slices(text: &str, expected_line_count: usize) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut lines = Vec::with_capacity(expected_line_count.min(LARGE_TEXT_LINE_STRIDE as usize));
    let mut start = 0usize;
    let mut cursor = 0usize;
    while cursor < bytes.len() && lines.len() < expected_line_count {
        match bytes[cursor] {
            b'\r' => {
                lines.push(&text[start..cursor]);
                cursor += 1;
                if bytes.get(cursor) == Some(&b'\n') {
                    cursor += 1;
                }
                start = cursor;
            }
            b'\n' => {
                lines.push(&text[start..cursor]);
                cursor += 1;
                start = cursor;
            }
            _ => cursor += 1,
        }
    }
    if lines.len() < expected_line_count {
        lines.push(&text[start..]);
    }
    lines.truncate(expected_line_count);
    lines
}

fn utf16_column(text: &str, byte_offset: usize) -> u64 {
    text[..byte_offset].encode_utf16().count() as u64
}

fn match_is_in_region(
    line: u64,
    column: u64,
    cursor_line: u64,
    cursor_column: u64,
    region: SearchRegion,
) -> bool {
    match region {
        SearchRegion::BeforeCursor => {
            line < cursor_line || (line == cursor_line && column < cursor_column)
        }
        SearchRegion::AtOrAfterCursor => {
            line > cursor_line || (line == cursor_line && column >= cursor_column)
        }
    }
}

fn search_decoded_page(
    regex: &Regex,
    text: &str,
    page_line: u64,
    expected_line_count: usize,
    cursor_line: u64,
    cursor_column: u64,
    region: SearchRegion,
    backwards: bool,
) -> Option<FileViewTextSearchMatch> {
    let lines = decoded_line_slices(text, expected_line_count);
    let make_result =
        |local_line: usize, line: &str, found: regex::Match<'_>| FileViewTextSearchMatch {
            line: page_line + local_line as u64,
            start_column: utf16_column(line, found.start()),
            end_column: utf16_column(line, found.end()),
            wrapped: false,
        };

    if backwards {
        for local_line in (0..lines.len()).rev() {
            let line = lines[local_line];
            let global_line = page_line + local_line as u64;
            let mut last = None;
            for found in regex.find_iter(line) {
                let column = utf16_column(line, found.start());
                if match_is_in_region(global_line, column, cursor_line, cursor_column, region) {
                    last = Some(make_result(local_line, line, found));
                }
            }
            if last.is_some() {
                return last;
            }
        }
        return None;
    }

    for (local_line, line) in lines.into_iter().enumerate() {
        let global_line = page_line + local_line as u64;
        for found in regex.find_iter(line) {
            let column = utf16_column(line, found.start());
            if match_is_in_region(global_line, column, cursor_line, cursor_column, region) {
                return Some(make_result(local_line, line, found));
            }
        }
    }
    None
}

fn search_indexed_page(
    file: &mut File,
    request: &FileViewTextSearchRequest,
    regex: &Regex,
    encoding: &str,
    page_index: usize,
    cursor_line: u64,
    cursor_column: u64,
    region: SearchRegion,
    backwards: bool,
) -> Result<Option<FileViewTextSearchMatch>, String> {
    let start_offset = request.checkpoint_offsets[page_index];
    let end_offset = request
        .checkpoint_offsets
        .get(page_index + 1)
        .copied()
        .unwrap_or(request.total_size);
    let length = end_offset.saturating_sub(start_offset);
    if length > READ_HARD_CAP_BYTES {
        return Err("large-text search page exceeds the maximum readable size".to_string());
    }

    file.seek(SeekFrom::Start(start_offset))
        .map_err(|error| format!("cannot seek file: {error}"))?;
    let mut buffer = vec![0u8; length as usize];
    file.read_exact(&mut buffer)
        .map_err(|error| format!("cannot read file: {error}"))?;
    let (text, _) = decode_text(&buffer, Some(encoding));
    let page_line = page_index as u64 * request.line_stride;
    let expected_line_count = request
        .line_stride
        .min(request.total_lines.saturating_sub(page_line)) as usize;
    Ok(search_decoded_page(
        regex,
        &text,
        page_line,
        expected_line_count,
        cursor_line,
        cursor_column,
        region,
        backwards,
    ))
}

/// Find one literal match in the complete indexed file. The frontend supplies
/// the already-built sparse index, and this helper reads one bounded page at a
/// time in next/previous order. Results therefore cover the whole file without
/// retaining either the document or a potentially huge result list in memory.
pub fn search_text(
    request: FileViewTextSearchRequest,
) -> Result<Option<FileViewTextSearchMatch>, String> {
    if request.query.is_empty() || request.total_lines == 0 {
        return Ok(None);
    }
    if request.query.len() > 16 * 1024 {
        return Err("large-text search query is too long".to_string());
    }
    if request.line_stride == 0 || request.checkpoint_offsets.first() != Some(&0) {
        return Err("large-text search index is invalid".to_string());
    }

    let path = Path::new(&request.path);
    let metadata = metadata_for(path)?;
    if metadata.len() != request.total_size || mtime_ms(&metadata) != request.expected_mtime_ms {
        return Err("large-text search index is stale".to_string());
    }
    let page_count = request.total_lines.div_ceil(request.line_stride) as usize;
    if request.checkpoint_offsets.len() != page_count
        || request
            .checkpoint_offsets
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        || request
            .checkpoint_offsets
            .last()
            .is_some_and(|offset| *offset > request.total_size)
    {
        return Err("large-text search index is invalid".to_string());
    }

    let encoding = request
        .encoding
        .as_deref()
        .filter(|label| !label.eq_ignore_ascii_case("auto"))
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        .map(|value| value.name().to_ascii_lowercase())
        .unwrap_or_else(|| "utf-8".to_string());
    let regex = RegexBuilder::new(&regex::escape(&request.query))
        .case_insensitive(!request.match_case)
        .build()
        .map_err(|error| format!("cannot build large-text search: {error}"))?;
    let cursor_line = request.cursor_line.min(request.total_lines - 1);
    let cursor_page = (cursor_line / request.line_stride) as usize;
    let mut file = File::open(path).map_err(|error| format!("cannot open file: {error}"))?;

    if request.backwards {
        for page_index in (0..=cursor_page).rev() {
            if let Some(found) = search_indexed_page(
                &mut file,
                &request,
                &regex,
                &encoding,
                page_index,
                cursor_line,
                request.cursor_column,
                SearchRegion::BeforeCursor,
                true,
            )? {
                return Ok(Some(found));
            }
        }
        for page_index in (cursor_page..page_count).rev() {
            if let Some(mut found) = search_indexed_page(
                &mut file,
                &request,
                &regex,
                &encoding,
                page_index,
                cursor_line,
                request.cursor_column,
                SearchRegion::AtOrAfterCursor,
                true,
            )? {
                found.wrapped = true;
                return Ok(Some(found));
            }
        }
    } else {
        for page_index in cursor_page..page_count {
            if let Some(found) = search_indexed_page(
                &mut file,
                &request,
                &regex,
                &encoding,
                page_index,
                cursor_line,
                request.cursor_column,
                SearchRegion::AtOrAfterCursor,
                false,
            )? {
                return Ok(Some(found));
            }
        }
        for page_index in 0..=cursor_page {
            if let Some(mut found) = search_indexed_page(
                &mut file,
                &request,
                &regex,
                &encoding,
                page_index,
                cursor_line,
                request.cursor_column,
                SearchRegion::BeforeCursor,
                false,
            )? {
                found.wrapped = true;
                return Ok(Some(found));
            }
        }
    }

    Ok(None)
}

/// Decode a byte buffer to text. With an explicit `encoding_rs` label (other than
/// `auto`) the named charset is used; otherwise `chardetng` guesses one. A BOM in
/// the buffer overrides either choice. Returns the decoded text plus the lowercased
/// label actually used so the UI can show what Auto resolved to.
fn decode_text(buffer: &[u8], label: Option<&str>) -> (String, String) {
    let requested = label
        .filter(|name| !name.eq_ignore_ascii_case("auto"))
        .and_then(|name| encoding_rs::Encoding::for_label(name.as_bytes()));
    let encoding = requested.unwrap_or_else(|| {
        let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Allow);
        detector.feed(buffer, true);
        detector.guess(None, chardetng::Utf8Detection::Allow)
    });
    let (text, used, _had_errors) = encoding.decode(buffer);
    (text.into_owned(), used.name().to_ascii_lowercase())
}

/// Atomically save edited UTF-8 text back to a file. Writes a sibling temp file
/// in the same directory, copies the original's permissions, then renames it
/// over the target — a rename on the same filesystem is atomic, so a crash mid-
/// save cannot leave a truncated file. When `expected_mtime_ms` is provided and
/// the on-disk mtime no longer matches (and `force` is not set), the save is
/// refused with a `FILE_VIEW_CONFLICT` error so the editor can prompt first.
pub fn write_text(request: FileViewWriteRequest) -> Result<FileViewWriteResult, String> {
    let path = Path::new(&request.path);
    if request.content.len() as u64 > READ_HARD_CAP_BYTES {
        return Err("content exceeds the maximum editable size".to_string());
    }
    let existing = std::fs::metadata(path).ok();
    if let Some(meta) = existing.as_ref() {
        if meta.is_dir() {
            return Err("path is a directory, not a file".to_string());
        }
    }

    if !request.force {
        if let (Some(expected), Some(meta)) = (request.expected_mtime_ms, existing.as_ref()) {
            if expected != 0 && mtime_ms(meta) != expected {
                return Err(format!("{FILE_VIEW_CONFLICT}: the file changed on disk"));
            }
        }
    }

    let parent = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let nanos = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|delta| delta.as_nanos())
        .unwrap_or(0);
    let temp_path = parent.join(format!(".kkterm-save-{}-{nanos}.tmp", std::process::id()));

    std::fs::write(&temp_path, request.content.as_bytes())
        .map_err(|error| format!("cannot write file: {error}"))?;
    // Best-effort: preserve the original file's permission bits.
    if let Some(meta) = existing.as_ref() {
        let _ = std::fs::set_permissions(&temp_path, meta.permissions());
    }
    if let Err(error) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("cannot save file: {error}"));
    }

    let metadata = std::fs::metadata(path).map_err(|error| format!("cannot read file: {error}"))?;
    Ok(FileViewWriteResult {
        mtime_ms: mtime_ms(&metadata),
        size: metadata.len(),
    })
}

pub fn read_bytes(request: FileViewBytesRequest) -> Result<FileViewBytes, String> {
    let path = Path::new(&request.path);
    let metadata = metadata_for(path)?;
    let total_size = metadata.len();
    let offset = request.offset.min(total_size);
    let length = request.length.min(READ_HARD_CAP_BYTES);

    let mut file = File::open(path).map_err(|error| format!("cannot open file: {error}"))?;
    if offset > 0 {
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| format!("cannot seek file: {error}"))?;
    }

    let to_read = length.min(total_size.saturating_sub(offset)) as usize;
    let mut buffer = vec![0u8; to_read];
    let mut filled = 0usize;
    while filled < to_read {
        let read = file
            .read(&mut buffer[filled..])
            .map_err(|error| format!("cannot read file: {error}"))?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    buffer.truncate(filled);

    let bytes_read = filled as u64;
    Ok(FileViewBytes {
        base64: base64::engine::general_purpose::STANDARD.encode(&buffer),
        total_size,
        offset,
        bytes_read,
        eof: offset + bytes_read >= total_size,
        mtime_ms: mtime_ms(&metadata),
    })
}

// ── PDF rendering via the optional Poppler dependency ───────────────────────
//
// PDF preview is a Phase 2 "external dependency" file type: rather than bundling
// a PDF engine (large, maintenance-heavy), KKTerm renders pages with Poppler's
// `pdftocairo`/`pdfinfo`, installed on demand through the Install Helper
// (`poppler` catalog id, kind `githubRelease`) or found on PATH. When the tool
// is missing the frontend shows an install gate instead of failing.

/// Install Helper tool id for the PDF dependency. Kept in sync with the
/// frontend `fileViewerDependencies` map and the catalog entry.
pub const PDF_TOOL_ID: &str = "poppler";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfViewStatus {
    /// True when the renderer (`pdftocairo`) can be resolved.
    pub available: bool,
    /// Where the renderer was resolved from: `installer`, `path`, or `null`.
    pub source: Option<String>,
    /// Install Helper tool id to offer for install when unavailable.
    pub tool_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfRenderRequest {
    pub path: String,
    /// 1-based page index.
    pub page: u32,
    /// Zoom factor applied to a 96-DPI baseline (clamped server-side).
    pub scale: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfRender {
    /// Base64 PNG of the rendered page.
    pub base64: String,
    pub page: u32,
    pub page_count: u32,
}

fn exe_name(stem: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{stem}.exe")
    } else {
        stem.to_string()
    }
}

/// Recursively search the Poppler install dir for a tool binary. Poppler-Windows
/// zips nest the binaries under `poppler-<version>/Library/bin/`, so the exact
/// subdir is version-dependent; a bounded walk avoids depending on it.
fn find_in_dir(dir: &Path, target: &str, depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            subdirs.push(path);
        } else if path.file_name().and_then(|name| name.to_str()) == Some(target) {
            return Some(path);
        }
    }
    for subdir in subdirs {
        if let Some(found) = find_in_dir(&subdir, target, depth - 1) {
            return Some(found);
        }
    }
    None
}

/// Resolve a Poppler tool, preferring the Install Helper-managed copy and
/// falling back to PATH. Returns `(program, source)` where `program` is either
/// an absolute path (installer) or the bare tool name (PATH).
fn resolve_poppler_tool(stem: &str) -> Option<(String, &'static str)> {
    let target = exe_name(stem);
    if let Some(path) = find_in_dir(&github_release_install_dir(PDF_TOOL_ID), &target, 4) {
        return Some((path.to_string_lossy().into_owned(), "installer"));
    }
    // PATH fallback: a successful spawn (any exit code) proves the tool resolves.
    if no_window(&mut Command::new(stem))
        .arg("-v")
        .output()
        .is_ok()
    {
        return Some((stem.to_string(), "path"));
    }
    None
}

pub fn pdf_status() -> PdfViewStatus {
    match resolve_poppler_tool("pdftocairo") {
        Some((_, source)) => PdfViewStatus {
            available: true,
            source: Some(source.to_string()),
            tool_id: PDF_TOOL_ID.to_string(),
        },
        None => PdfViewStatus {
            available: false,
            source: None,
            tool_id: PDF_TOOL_ID.to_string(),
        },
    }
}

fn pdf_page_count(path: &str) -> u32 {
    let Some((program, _)) = resolve_poppler_tool("pdfinfo") else {
        return 0;
    };
    let Ok(output) = no_window(&mut Command::new(program)).arg(path).output() else {
        return 0;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("Pages:") {
            if let Ok(count) = rest.trim().parse::<u32>() {
                return count;
            }
        }
    }
    0
}

pub fn render_pdf(request: PdfRenderRequest) -> Result<PdfRender, String> {
    let metadata = metadata_for(Path::new(&request.path))?;
    if metadata.len() == 0 {
        return Err("PDF file is empty".to_string());
    }
    let (program, _) = resolve_poppler_tool("pdftocairo")
        .ok_or_else(|| "PDF renderer (Poppler) is not installed".to_string())?;

    let page_count = pdf_page_count(&request.path);
    let page = request.page.max(1);
    if page_count > 0 && page > page_count {
        return Err(format!("page {page} is out of range (1-{page_count})"));
    }

    let dpi = (96.0 * request.scale).round().clamp(36.0, 600.0) as i32;
    let nanos = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|delta| delta.as_nanos())
        .unwrap_or(0);
    let mut prefix = std::env::temp_dir();
    prefix.push(format!("kkterm-pdf-{}-{nanos}", std::process::id()));
    let output_png = prefix.with_extension("png");

    let dpi_arg = dpi.to_string();
    let page_arg = page.to_string();
    let status = no_window(&mut Command::new(program))
        .args([
            "-png",
            "-singlefile",
            "-r",
            dpi_arg.as_str(),
            "-f",
            page_arg.as_str(),
            "-l",
            page_arg.as_str(),
            request.path.as_str(),
        ])
        .arg(&prefix)
        .output()
        .map_err(|error| format!("failed to run PDF renderer: {error}"))?;
    if !status.status.success() {
        let _ = std::fs::remove_file(&output_png);
        return Err(format!(
            "PDF renderer failed: {}",
            String::from_utf8_lossy(&status.stderr).trim()
        ));
    }

    let bytes = std::fs::read(&output_png)
        .map_err(|error| format!("cannot read rendered page: {error}"))?;
    let _ = std::fs::remove_file(&output_png);

    Ok(PdfRender {
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        page,
        page_count: if page_count == 0 { page } else { page_count },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(name: &str, bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        let mut file = File::create(&path).unwrap();
        file.write_all(bytes).unwrap();
        (dir, path)
    }

    #[test]
    fn probe_detects_text_and_size() {
        let (_dir, path) = temp_file("text.txt", b"hello\nworld\n");
        let probe = probe(FileViewProbeRequest {
            path: path.to_string_lossy().into_owned(),
        })
        .unwrap();
        assert_eq!(probe.total_size, 12);
        assert!(probe.is_text);
        assert_eq!(probe.magic, None);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn probe_detects_png_magic_and_binary() {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&[0, 1, 2, 3]);
        let (_dir, path) = temp_file("img.png", &bytes);
        let probe = probe(FileViewProbeRequest {
            path: path.to_string_lossy().into_owned(),
        })
        .unwrap();
        assert_eq!(probe.magic.as_deref(), Some("png"));
        assert!(!probe.is_text);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn read_text_truncates_and_tails() {
        let (_dir, path) = temp_file("big.log", b"0123456789");
        let head = read_text(FileViewTextRequest {
            path: path.to_string_lossy().into_owned(),
            max_bytes: 4,
            from_end: false,
            encoding: None,
        })
        .unwrap();
        assert_eq!(head.text, "0123");
        assert!(head.truncated);

        let tail = read_text(FileViewTextRequest {
            path: path.to_string_lossy().into_owned(),
            max_bytes: 4,
            from_end: true,
            encoding: None,
        })
        .unwrap();
        assert_eq!(tail.text, "6789");
        assert!(tail.from_end);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn read_text_decodes_named_encoding() {
        // "中文" in GBK is D6 D0 CE C4; as UTF-8 lossy this would be mojibake.
        let (_dir, path) = temp_file("gbk.txt", &[0xD6, 0xD0, 0xCE, 0xC4]);
        let result = read_text(FileViewTextRequest {
            path: path.to_string_lossy().into_owned(),
            max_bytes: 64,
            from_end: false,
            encoding: Some("gbk".to_string()),
        })
        .unwrap();
        assert_eq!(result.text, "中文");
        assert_eq!(result.detected_encoding, "gbk");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn read_text_auto_detects_and_reports_encoding() {
        let (_dir, path) = temp_file("utf8.txt", "héllo".as_bytes());
        let result = read_text(FileViewTextRequest {
            path: path.to_string_lossy().into_owned(),
            max_bytes: 64,
            from_end: false,
            encoding: None,
        })
        .unwrap();
        assert_eq!(result.text, "héllo");
        assert_eq!(result.detected_encoding, "utf-8");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn large_text_index_and_pages_cover_the_complete_file() {
        let source = (0..600)
            .map(|line| format!("line-{line:04}"))
            .collect::<Vec<_>>()
            .join("\n");
        let (_dir, path) = temp_file("large.txt", source.as_bytes());
        let path_string = path.to_string_lossy().into_owned();
        let index = index_text(FileViewTextIndexRequest {
            path: path_string.clone(),
            encoding: Some("utf-8".to_string()),
        })
        .unwrap();

        assert_eq!(index.total_lines, 600);
        assert_eq!(index.line_stride, 256);
        assert_eq!(index.checkpoint_offsets.len(), 3);

        let page = read_text_page(FileViewTextPageRequest {
            path: path_string,
            start_offset: index.checkpoint_offsets[1],
            end_offset: index.checkpoint_offsets[2],
            encoding: Some("utf-8".to_string()),
        })
        .unwrap();
        let lines = page.text.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 256);
        assert_eq!(lines.first().copied(), Some("line-0256"));
        assert_eq!(lines.last().copied(), Some("line-0511"));
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn large_text_index_recognizes_utf16_line_boundaries() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "alpha\nbeta\ngamma".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let (_dir, path) = temp_file("utf16.txt", &bytes);
        let path_string = path.to_string_lossy().into_owned();
        let index = index_text(FileViewTextIndexRequest {
            path: path_string.clone(),
            encoding: Some("utf-16le".to_string()),
        })
        .unwrap();
        assert_eq!(index.total_lines, 3);

        let page = read_text_page(FileViewTextPageRequest {
            path: path_string,
            start_offset: 0,
            end_offset: index.total_size,
            encoding: Some("utf-16le".to_string()),
        })
        .unwrap();
        assert_eq!(page.text, "alpha\nbeta\ngamma");
        std::fs::remove_file(path).ok();
    }

    fn large_text_search_request(
        path: &Path,
        index: &FileViewTextIndex,
        query: &str,
        cursor_line: u64,
        cursor_column: u64,
        backwards: bool,
        match_case: bool,
    ) -> FileViewTextSearchRequest {
        FileViewTextSearchRequest {
            path: path.to_string_lossy().into_owned(),
            query: query.to_string(),
            checkpoint_offsets: index.checkpoint_offsets.clone(),
            total_size: index.total_size,
            total_lines: index.total_lines,
            line_stride: index.line_stride,
            expected_mtime_ms: index.mtime_ms,
            cursor_line,
            cursor_column,
            backwards,
            match_case,
            encoding: Some(index.detected_encoding.clone()),
        }
    }

    #[test]
    fn large_text_search_reaches_matches_outside_the_loaded_page_and_wraps() {
        let source = (0..700)
            .map(|line| match line {
                300 => "Needle Alpha".to_string(),
                600 => "needle Beta".to_string(),
                _ => format!("ordinary line {line}"),
            })
            .collect::<Vec<_>>()
            .join("\n");
        let (_dir, path) = temp_file("search-large.txt", source.as_bytes());
        let index = index_text(FileViewTextIndexRequest {
            path: path.to_string_lossy().into_owned(),
            encoding: Some("utf-8".to_string()),
        })
        .unwrap();

        let first = search_text(large_text_search_request(
            &path, &index, "needle", 0, 0, false, false,
        ))
        .unwrap()
        .unwrap();
        assert_eq!(first.line, 300);
        assert!(!first.wrapped);

        let second = search_text(large_text_search_request(
            &path,
            &index,
            "needle",
            first.line,
            first.end_column,
            false,
            false,
        ))
        .unwrap()
        .unwrap();
        assert_eq!(second.line, 600);

        let previous = search_text(large_text_search_request(
            &path,
            &index,
            "needle",
            second.line,
            second.start_column,
            true,
            false,
        ))
        .unwrap()
        .unwrap();
        assert_eq!(previous.line, 300);

        let wrapped = search_text(large_text_search_request(
            &path,
            &index,
            "needle",
            second.line,
            second.end_column,
            false,
            false,
        ))
        .unwrap()
        .unwrap();
        assert_eq!(wrapped.line, 300);
        assert!(wrapped.wrapped);

        let exact_case = search_text(large_text_search_request(
            &path, &index, "Needle", 0, 0, false, true,
        ))
        .unwrap()
        .unwrap();
        assert_eq!(exact_case.line, 300);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn large_text_search_reports_utf16_columns_for_utf16_files() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "alpha\n😀 beta\ngamma".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let (_dir, path) = temp_file("search-utf16.txt", &bytes);
        let index = index_text(FileViewTextIndexRequest {
            path: path.to_string_lossy().into_owned(),
            encoding: Some("utf-16le".to_string()),
        })
        .unwrap();
        let found = search_text(large_text_search_request(
            &path, &index, "beta", 0, 0, false, false,
        ))
        .unwrap()
        .unwrap();
        assert_eq!(found.line, 1);
        assert_eq!(found.start_column, 3);
        assert_eq!(found.end_column, 7);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn read_bytes_chunks_with_offset() {
        let (_dir, path) = temp_file("bin.dat", b"ABCDEFGH");
        let chunk = read_bytes(FileViewBytesRequest {
            path: path.to_string_lossy().into_owned(),
            offset: 2,
            length: 3,
        })
        .unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(chunk.base64)
            .unwrap();
        assert_eq!(decoded, b"CDE");
        assert_eq!(chunk.offset, 2);
        assert!(!chunk.eof);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn write_text_saves_atomically_and_reports_mtime() {
        let (_dir, path) = temp_file("edit.txt", b"original");
        let path_str = path.to_string_lossy().into_owned();
        let result = write_text(FileViewWriteRequest {
            path: path_str.clone(),
            content: "edited contents".to_string(),
            expected_mtime_ms: None,
            force: false,
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "edited contents");
        assert!(result.size > 0);
        // No leftover temp file in the directory.
        let leftovers = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".kkterm-save-")
            })
            .count();
        assert_eq!(leftovers, 0);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn write_text_detects_and_can_force_conflicts() {
        let (_dir, path) = temp_file("conflict.txt", b"v1");
        let path_str = path.to_string_lossy().into_owned();
        // A stale expected mtime is treated as a conflict.
        let err = write_text(FileViewWriteRequest {
            path: path_str.clone(),
            content: "v2".to_string(),
            expected_mtime_ms: Some(1),
            force: false,
        })
        .unwrap_err();
        assert!(err.starts_with(FILE_VIEW_CONFLICT));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "v1");

        // Forcing overwrites despite the mtime mismatch.
        write_text(FileViewWriteRequest {
            path: path_str,
            content: "v2".to_string(),
            expected_mtime_ms: Some(1),
            force: true,
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "v2");
        std::fs::remove_file(path).ok();
    }
}
