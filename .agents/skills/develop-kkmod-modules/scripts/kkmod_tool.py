#!/usr/bin/env python3
"""Validate and reproducibly package KKTerm Custom Module host API v2 archives."""

from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import posixpath
import re
import stat
import sys
import tempfile
from typing import Any, Iterable
from urllib.parse import unquote, urlparse, urlsplit
import zipfile


MANIFEST = "kkterm-extension.json"
HOST_API_VERSION = 2
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
MAX_ENTRIES = 10_000
MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_RATIO = 1_000

BOOLEAN_PERMISSIONS = {
    "storage", "documentStorage", "blobStorage", "browserStorage",
    "openExternal", "clipboard", "secretReferences", "hostUi",
}
PERMISSION_KEYS = BOOLEAN_PERMISSIONS | {"files", "networkFetch"}
ALLOWED_DIST_EXTENSIONS = {
    "html", "css", "js", "mjs", "json", "map", "wasm", "svg", "png",
    "jpg", "jpeg", "gif", "webp", "avif", "ico", "woff", "woff2", "ttf",
    "otf", "txt", "md", "xml", "webmanifest", "gz", "bcmap", "pfb",
    "ftl", "icc", "whl", "zip",
}
ALLOWED_LICENSE_EXTENSIONS = {None, "txt", "md", "html"}
FORBIDDEN_EXTENSIONS = {
    "exe", "dll", "so", "dylib", "bat", "cmd", "com", "ps1", "sh",
    "app", "msi", "jar",
}
PORTABLE_PATH = re.compile(r"^[A-Za-z0-9/._@-]+$")
IDENTIFIER = re.compile(r"^[a-z][a-z0-9.-]{0,127}$")
SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


class ContractError(Exception):
    pass


class HtmlReferenceParser(HTMLParser):
    """Collect URL-bearing attributes without trying to interpret the document."""

    URL_ATTRIBUTES = {"data", "href", "poster", "src"}
    ASSET_HREF_TAGS = {"base", "image", "link", "use"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[tuple[str, str, str]] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self._collect(tag, attrs)

    def handle_startendtag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self._collect(tag, attrs)

    def _collect(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized_tag = tag.lower()
        for name, value in attrs:
            normalized_name = name.lower()
            if (
                normalized_name in self.URL_ATTRIBUTES
                and value is not None
                and (
                    normalized_name != "href"
                    or normalized_tag in self.ASSET_HREF_TAGS
                )
            ):
                self.references.append((normalized_tag, normalized_name, value))


def byte_len(value: str) -> int:
    return len(value.encode("utf-8"))


def require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError(f"{label} must be an object")
    return value


def strict_keys(
    value: dict[str, Any], *, required: set[str], optional: set[str], label: str
) -> None:
    missing = sorted(required - value.keys())
    unknown = sorted(value.keys() - required - optional)
    if missing:
        raise ContractError(f"{label} is missing required field(s): {', '.join(missing)}")
    if unknown:
        raise ContractError(f"{label} contains unknown field(s): {', '.join(unknown)}")


def require_string(
    value: Any, label: str, *, max_bytes: int | None, allow_blank: bool = False
) -> str:
    if not isinstance(value, str):
        raise ContractError(f"{label} must be a string")
    if not allow_blank and not value.strip():
        raise ContractError(f"{label} must not be blank")
    if max_bytes is not None and byte_len(value) > max_bytes:
        raise ContractError(f"{label} exceeds {max_bytes} bytes")
    return value


def validate_identifier(value: Any, label: str) -> str:
    value = require_string(value, label, max_bytes=128)
    if not IDENTIFIER.fullmatch(value):
        raise ContractError(
            f"{label} must start with a lowercase letter and contain only "
            "lowercase letters, digits, dots, and hyphens"
        )
    return value


def extension(path: str) -> str | None:
    name = path.rsplit("/", 1)[-1]
    if "." not in name or (name.startswith(".") and name.count(".") == 1):
        return None
    return name.rsplit(".", 1)[-1].lower()


def validate_portable_path(value: Any, label: str) -> str:
    value = require_string(value, label, max_bytes=240)
    if not PORTABLE_PATH.fullmatch(value) or "\\" in value:
        raise ContractError(f"{label} must be a portable ASCII relative path")
    if value.startswith("/") or value.endswith("/") or "//" in value:
        raise ContractError(f"{label} contains an unsafe path segment")
    parts = value.split("/")
    for part in parts:
        if part in {"", ".", ".."} or part.endswith("."):
            raise ContractError(f"{label} contains an unsafe path segment")
        stem = part.rstrip(" .").split(".", 1)[0].upper()
        if stem in {"CON", "PRN", "AUX", "NUL"}:
            raise ContractError(f"{label} contains reserved Windows name {stem}")
        if re.fullmatch(r"(?:COM|LPT)[1-9]", stem):
            raise ContractError(f"{label} contains reserved Windows name {stem}")
    return value


def below(path: str, root: str) -> bool:
    return path.startswith(root + "/")


def validate_html_document(package_path: str, raw: bytes) -> None:
    try:
        source = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ContractError(f"HTML must be UTF-8: {package_path}: {error}") from error

    parser = HtmlReferenceParser()
    try:
        parser.feed(source)
        parser.close()
    except Exception as error:
        raise ContractError(f"invalid HTML in {package_path}: {error}") from error

    document_directory = posixpath.dirname(package_path)
    for _tag, _attribute, reference in parser.references:
        candidate = reference.strip()
        if not candidate or candidate.startswith(("#", "?")):
            continue
        if candidate.startswith("//"):
            continue
        try:
            parsed = urlsplit(candidate)
        except ValueError as error:
            raise ContractError(
                f"invalid HTML reference in {package_path}: {reference!r}"
            ) from error
        if parsed.scheme:
            continue
        local_path = unquote(parsed.path).replace("\\", "/")
        if not local_path:
            continue
        if local_path.startswith("/"):
            resolved = posixpath.normpath(local_path.lstrip("/"))
        else:
            resolved = posixpath.normpath(
                posixpath.join(document_directory, local_path)
            )
        if resolved != "dist" and not below(resolved, "dist"):
            raise ContractError(
                f"HTML reference escapes dist/: {package_path}: {reference}"
            )


def validate_payload_path(path: str) -> None:
    if path == MANIFEST:
        return
    suffix = extension(path)
    if suffix in FORBIDDEN_EXTENSIONS:
        raise ContractError(f"forbidden executable payload: {path}")
    if below(path, "licenses"):
        if suffix not in ALLOWED_LICENSE_EXTENSIONS:
            raise ContractError(f"unsupported license payload type: {path}")
        return
    if below(path, "dist") and suffix in ALLOWED_DIST_EXTENSIONS:
        return
    raise ContractError(f"unsupported payload path or type: {path}")


def validate_manifest(data: Any) -> dict[str, Any]:
    manifest = require_object(data, "manifest")
    strict_keys(
        manifest,
        required={"id", "name", "version", "publisher", "apiVersion", "license", "modules"},
        optional={"summary", "homepage", "permissions"},
        label="manifest",
    )
    validate_identifier(manifest["id"], "manifest.id")
    require_string(manifest["name"], "manifest.name", max_bytes=128)
    version = require_string(manifest["version"], "manifest.version", max_bytes=64)
    if not SEMVER.fullmatch(version):
        raise ContractError("manifest.version must be valid SemVer")
    require_string(manifest["publisher"], "manifest.publisher", max_bytes=256)
    require_string(manifest.get("summary", ""), "manifest.summary", max_bytes=2_048, allow_blank=True)
    api_version = manifest["apiVersion"]
    if not isinstance(api_version, int) or isinstance(api_version, bool) or api_version != HOST_API_VERSION:
        raise ContractError(f"manifest.apiVersion must equal {HOST_API_VERSION}")

    homepage = manifest.get("homepage")
    if homepage is not None:
        homepage = require_string(homepage, "manifest.homepage", max_bytes=None)
        parsed = urlparse(homepage)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ContractError("manifest.homepage must be an absolute HTTP(S) URL")

    license_data = require_object(manifest["license"], "manifest.license")
    strict_keys(
        license_data,
        required={"name", "file"},
        optional={"noticesFile"},
        label="manifest.license",
    )
    require_string(license_data["name"], "manifest.license.name", max_bytes=128)
    validate_portable_path(license_data["file"], "manifest.license.file")
    if "noticesFile" in license_data and license_data["noticesFile"] is not None:
        validate_portable_path(license_data["noticesFile"], "manifest.license.noticesFile")

    permissions = require_object(manifest.get("permissions", {}), "manifest.permissions")
    strict_keys(
        permissions,
        required=set(),
        optional=PERMISSION_KEYS,
        label="manifest.permissions",
    )
    for permission in BOOLEAN_PERMISSIONS:
        if permission in permissions and not isinstance(permissions[permission], bool):
            raise ContractError(f"manifest.permissions.{permission} must be a boolean")
    if "files" in permissions and permissions["files"] is not None:
        files = require_object(permissions["files"], "manifest.permissions.files")
        strict_keys(files, required=set(), optional={"open", "save", "extensions"}, label="manifest.permissions.files")
        for operation in ("open", "save"):
            if operation in files and not isinstance(files[operation], bool):
                raise ContractError(f"manifest.permissions.files.{operation} must be a boolean")
        if not files.get("open", False) and not files.get("save", False):
            raise ContractError("manifest.permissions.files must enable open, save, or both")
        extensions = files.get("extensions", [])
        if not isinstance(extensions, list) or len(extensions) > 128:
            raise ContractError("manifest.permissions.files.extensions must be an array of at most 128 items")
        if len(set(extensions)) != len(extensions):
            raise ContractError("manifest.permissions.files.extensions contains a duplicate")
        for item in extensions:
            if not isinstance(item, str) or not re.fullmatch(r"[a-z0-9]{1,32}", item):
                raise ContractError(f"invalid file extension: {item!r}")
    if "networkFetch" in permissions and permissions["networkFetch"] is not None:
        network = require_object(permissions["networkFetch"], "manifest.permissions.networkFetch")
        strict_keys(
            network,
            required={"origins"},
            optional={"methods", "allowPrivateNetwork", "maxResponseBytes"},
            label="manifest.permissions.networkFetch",
        )
        origins = network["origins"]
        allow_private = network.get("allowPrivateNetwork", False)
        if not isinstance(allow_private, bool):
            raise ContractError("manifest.permissions.networkFetch.allowPrivateNetwork must be a boolean")
        if not isinstance(origins, list) or not 1 <= len(origins) <= 64 or len(set(origins)) != len(origins):
            raise ContractError("manifest.permissions.networkFetch.origins must contain 1 to 64 unique origins")
        for origin in origins:
            origin = require_string(origin, "networkFetch origin", max_bytes=2048)
            parsed = urlparse(origin)
            if (
                parsed.scheme not in ({"https", "http"} if allow_private else {"https"})
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.params
                or parsed.query
                or parsed.fragment
                or origin != f"{parsed.scheme}://{parsed.netloc}"
            ):
                raise ContractError(f"networkFetch origin must be canonical and path-free: {origin}")
        methods = network.get("methods", ["GET"])
        allowed_methods = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}
        if not isinstance(methods, list) or not 1 <= len(methods) <= 8 or len(set(methods)) != len(methods):
            raise ContractError("manifest.permissions.networkFetch.methods must contain 1 to 8 unique methods")
        if any(method not in allowed_methods for method in methods):
            raise ContractError("manifest.permissions.networkFetch.methods contains an unsupported method")
        maximum = network.get("maxResponseBytes", 16 * 1024 * 1024)
        if not isinstance(maximum, int) or isinstance(maximum, bool) or not 1 <= maximum <= 64 * 1024 * 1024:
            raise ContractError("manifest.permissions.networkFetch.maxResponseBytes must be 1 to 67108864")

    modules = manifest["modules"]
    if not isinstance(modules, list) or not 1 <= len(modules) <= 64:
        raise ContractError("manifest.modules must contain between 1 and 64 contributions")
    contribution_ids: set[str] = set()
    for index, raw in enumerate(modules):
        label = f"manifest.modules[{index}]"
        contribution = require_object(raw, label)
        strict_keys(
            contribution,
            required={"id", "title", "entrypoint"},
            optional={"icon", "railVisible", "routing"},
            label=label,
        )
        contribution_id = validate_identifier(contribution["id"], f"{label}.id")
        if contribution_id in contribution_ids:
            raise ContractError(f"duplicate contribution id: {contribution_id}")
        contribution_ids.add(contribution_id)
        require_string(contribution["title"], f"{label}.title", max_bytes=128)
        entrypoint = validate_portable_path(contribution["entrypoint"], f"{label}.entrypoint")
        if not below(entrypoint, "dist") or not entrypoint.endswith(".html"):
            raise ContractError(f"{label}.entrypoint must be a lowercase .html file below dist/")
        if "icon" in contribution and contribution["icon"] is not None:
            icon = validate_portable_path(contribution["icon"], f"{label}.icon")
            if not below(icon, "dist"):
                raise ContractError(f"{label}.icon must be below dist/")
        if "railVisible" in contribution and not isinstance(contribution["railVisible"], bool):
            raise ContractError(f"{label}.railVisible must be a boolean")
        if contribution.get("routing", "static") not in {"static", "spa"}:
            raise ContractError(f"{label}.routing must be static or spa")
    return manifest


def required_paths(manifest: dict[str, Any]) -> set[str]:
    required = {MANIFEST, manifest["license"]["file"]}
    notices = manifest["license"].get("noticesFile")
    if notices:
        required.add(notices)
    for contribution in manifest["modules"]:
        required.add(contribution["entrypoint"])
        if contribution.get("icon"):
            required.add(contribution["icon"])
    return required


def load_manifest(raw: bytes) -> dict[str, Any]:
    if not raw or len(raw) > MAX_MANIFEST_BYTES:
        raise ContractError("manifest is empty or exceeds 1 MiB")
    try:
        return validate_manifest(json.loads(raw.decode("utf-8")))
    except UnicodeDecodeError as error:
        raise ContractError(f"manifest must be UTF-8: {error}") from error
    except json.JSONDecodeError as error:
        raise ContractError(f"manifest contains invalid JSON: {error}") from error


def verify_required(seen: set[str], manifest: dict[str, Any]) -> None:
    missing = sorted(required_paths(manifest) - seen)
    if missing:
        raise ContractError(f"missing required packaged file(s): {', '.join(missing)}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def directory_files(root: Path) -> list[tuple[str, Path]]:
    if not root.is_dir():
        raise ContractError(f"module root is not a directory: {root}")
    manifest_path = root / MANIFEST
    if not manifest_path.is_file():
        raise ContractError(f"module root is missing {MANIFEST}")
    if manifest_path.is_symlink():
        raise ContractError(f"package source contains symbolic link: {manifest_path}")
    files: list[tuple[str, Path]] = [(MANIFEST, manifest_path)]
    for package_root in ("dist", "licenses"):
        directory = root / package_root
        if not directory.is_dir():
            continue
        if directory.is_symlink():
            raise ContractError(f"package source contains symbolic link: {directory}")
        for current, directories, filenames in os.walk(directory, followlinks=False):
            current_path = Path(current)
            for name in list(directories):
                path = current_path / name
                if path.is_symlink():
                    raise ContractError(f"package source contains symbolic link: {path}")
            for name in filenames:
                path = current_path / name
                if path.is_symlink():
                    raise ContractError(f"package source contains symbolic link: {path}")
                relative = path.relative_to(root).as_posix()
                files.append((relative, path))
    return sorted(files)


def inspect_directory(root: Path) -> tuple[dict[str, Any], list[tuple[str, Path]]]:
    files = directory_files(root)
    if not 1 <= len(files) <= MAX_ENTRIES:
        raise ContractError("package has an invalid number of files")
    seen: set[str] = set()
    seen_folded: set[str] = set()
    expanded = 0
    manifest_raw: bytes | None = None
    for relative, path in files:
        validate_portable_path(relative, "package path")
        validate_payload_path(relative)
        folded = relative.lower()
        if folded in seen_folded:
            raise ContractError(f"duplicate or case-colliding package path: {relative}")
        seen.add(relative)
        seen_folded.add(folded)
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise ContractError(f"package file exceeds 128 MiB: {relative}")
        expanded += size
        if expanded > MAX_EXPANDED_BYTES:
            raise ContractError("package expands beyond 1 GiB")
        if relative == MANIFEST:
            manifest_raw = path.read_bytes()
        elif extension(relative) == "html":
            validate_html_document(relative, path.read_bytes())
    assert manifest_raw is not None
    manifest = load_manifest(manifest_raw)
    verify_required(seen, manifest)
    return {
        "kind": "directory",
        "moduleId": manifest["id"],
        "version": manifest["version"],
        "fileCount": len(files),
        "expandedBytes": expanded,
        "permissions": manifest.get("permissions", {}),
        "contributions": [item["id"] for item in manifest["modules"]],
    }, files


def zip_is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return stat.S_ISLNK(mode)


def inspect_archive(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ContractError(f"archive does not exist: {path}")
    archive_bytes = path.stat().st_size
    if not 0 < archive_bytes <= MAX_ARCHIVE_BYTES:
        raise ContractError("archive is empty or exceeds 1 GiB")
    try:
        with zipfile.ZipFile(path, "r") as archive:
            entries = archive.infolist()
            if not 1 <= len(entries) <= MAX_ENTRIES:
                raise ContractError("archive has an invalid number of ZIP entries")
            seen: set[str] = set()
            seen_folded: set[str] = set()
            expanded = 0
            file_count = 0
            manifest_raw: bytes | None = None
            for info in entries:
                raw_name = info.filename
                name = raw_name[:-1] if info.is_dir() and raw_name.endswith("/") else raw_name
                validate_portable_path(name, "ZIP entry")
                folded = raw_name.lower()
                if folded in seen_folded:
                    raise ContractError(f"duplicate or case-colliding ZIP entry: {raw_name}")
                seen_folded.add(folded)
                if zip_is_symlink(info):
                    raise ContractError(f"ZIP contains symbolic link: {raw_name}")
                if info.is_dir():
                    if name not in {"dist", "licenses"} and not below(name, "dist") and not below(name, "licenses"):
                        raise ContractError(f"unsupported ZIP directory: {raw_name}")
                    continue
                seen.add(raw_name)
                file_count += 1
                validate_payload_path(raw_name)
                if info.file_size > MAX_FILE_BYTES:
                    raise ContractError(f"ZIP entry exceeds 128 MiB: {raw_name}")
                if info.compress_size > 0 and info.file_size // max(info.compress_size, 1) > MAX_RATIO:
                    raise ContractError(f"unsafe ZIP compression ratio: {raw_name}")
                expanded += info.file_size
                if expanded > MAX_EXPANDED_BYTES:
                    raise ContractError("archive expands beyond 1 GiB")
                if raw_name == MANIFEST:
                    manifest_raw = archive.read(info)
                elif extension(raw_name) == "html":
                    validate_html_document(raw_name, archive.read(info))
            if manifest_raw is None:
                raise ContractError(f"archive is missing root {MANIFEST}")
            manifest = load_manifest(manifest_raw)
            verify_required(seen, manifest)
    except zipfile.BadZipFile as error:
        raise ContractError(f"not a valid ZIP archive: {error}") from error
    return {
        "kind": "archive",
        "moduleId": manifest["id"],
        "version": manifest["version"],
        "archiveBytes": archive_bytes,
        "expandedBytes": expanded,
        "fileCount": file_count,
        "sha256": sha256(path),
        "permissions": manifest.get("permissions", {}),
        "contributions": [item["id"] for item in manifest["modules"]],
    }


def check(path: Path) -> dict[str, Any]:
    if path.is_dir():
        summary, _ = inspect_directory(path)
        return summary
    return inspect_archive(path)


def reproducible_info(relative: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    return info


def pack(root: Path, output: Path, force: bool) -> dict[str, Any]:
    _, files = inspect_directory(root)
    if output.exists() and not force:
        raise ContractError(f"output already exists (pass --force to replace): {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        handle, temporary_name = tempfile.mkstemp(prefix=output.name + ".", suffix=".tmp", dir=output.parent)
        os.close(handle)
        temporary = Path(temporary_name)
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for relative, source in files:
                archive.writestr(reproducible_info(relative), source.read_bytes())
        summary = inspect_archive(temporary)
        os.replace(temporary, output)
        temporary = None
        summary["path"] = str(output.resolve())
        return summary
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def print_json(value: dict[str, Any]) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    check_parser = commands.add_parser("check", help="validate a module directory or .kkmod archive")
    check_parser.add_argument("path", type=Path)
    pack_parser = commands.add_parser("pack", help="validate and reproducibly create a .kkmod archive")
    pack_parser.add_argument("module_root", type=Path)
    pack_parser.add_argument("output", type=Path)
    pack_parser.add_argument("--force", action="store_true", help="replace an existing output archive")
    hash_parser = commands.add_parser("hash", help="print archive byte size and SHA-256")
    hash_parser.add_argument("archive", type=Path)
    return result


def main(argv: Iterable[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "check":
            print_json(check(args.path.resolve()))
        elif args.command == "pack":
            print_json(pack(args.module_root.resolve(), args.output.resolve(), args.force))
        elif args.command == "hash":
            archive = args.archive.resolve()
            if not archive.is_file():
                raise ContractError(f"archive does not exist: {archive}")
            print_json({"path": str(archive), "archiveBytes": archive.stat().st_size, "sha256": sha256(archive)})
        return 0
    except (ContractError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
