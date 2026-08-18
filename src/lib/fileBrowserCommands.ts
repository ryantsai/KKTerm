// Protocol-agnostic file-browser command adapter.
//
// SftpWorkspace consumes this interface so the same UI/UX can drive both
// the SSH-launched SFTP browser (russh + russh-sftp) and the first-class
// FTP Connection's plain FTP / FTPS browser (suppaftp). The adapter abstracts
// the 12 Tauri command call sites that differ only by command name and
// secret_owner_id handling.
//
// `capabilities` lets the UI gracefully disable features unsupported by a
// given transport (e.g. POSIX permission editing isn't reliable for plain FTP).

import {
  invokeCommand,
  type SftpDirectoryListing,
  type SftpPathProperties,
  type SftpSessionStarted,
  type SftpTransferResult,
} from "./tauri";
import type { Connection, FtpConnectionOptions, SftpSettings } from "../types";
import { connectionPasswordOwnerId, resolveSshCompression, resolveSshOldProtocols, resolveSshSocksProxyRequest } from "../modules/workspace/connections/utils";
import { useWorkspaceStore } from "../store";

export interface FileBrowserCapabilities {
  /** UI may surface a "Properties" dialog editor for owner/group/permissions */
  editPermissions: boolean;
  /** UI may verify a remote SSH host key before connecting */
  verifySshHostKey: boolean;
  /** UI may offer "Open SSH terminal here" from a remote folder */
  openTerminalHere: boolean;
}

export interface FileBrowserCommands {
  /** Display kind shown in tab titles and status bar ("SFTP", "FTP", "FTPS") */
  protocolLabel: string;
  capabilities: FileBrowserCapabilities;
  startSession: (args: {
    sessionId: string;
    path: string;
    password?: string;
  }) => Promise<SftpSessionStarted>;
  listDirectory: (args: {
    sessionId: string;
    path: string;
  }) => Promise<SftpDirectoryListing>;
  closeSession: (sessionId: string) => Promise<void>;
  createFolder: (args: {
    sessionId: string;
    parentPath: string;
    name: string;
  }) => Promise<void>;
  renamePath: (args: {
    sessionId: string;
    path: string;
    newName: string;
  }) => Promise<void>;
  deletePath: (args: { sessionId: string; path: string }) => Promise<void>;
  pathProperties: (args: {
    sessionId: string;
    path: string;
  }) => Promise<SftpPathProperties>;
  updatePathProperties: (args: {
    sessionId: string;
    path: string;
    permissions?: string;
    uid?: number;
    gid?: number;
  }) => Promise<SftpPathProperties>;
  uploadPath: (args: {
    sessionId: string;
    transferId: string;
    localPath: string;
    remoteDirectory: string;
    overwriteBehavior: SftpSettings["overwriteBehavior"];
  }) => Promise<SftpTransferResult>;
  downloadPath: (args: {
    sessionId: string;
    transferId: string;
    remotePath: string;
    localDirectory: string;
    overwriteBehavior: SftpSettings["overwriteBehavior"];
  }) => Promise<SftpTransferResult>;
  cancelTransfer: (args: { transferId: string }) => Promise<void>;
  /** Event name emitted by the backend transport for transfer progress */
  transferProgressEvent: string;
}

export function sftpBrowserCommands(connection: Connection): FileBrowserCommands {
  return {
    protocolLabel: "SFTP",
    capabilities: {
      editPermissions: true,
      verifySshHostKey: true,
      openTerminalHere: true,
    },
    startSession: ({ sessionId, path, password }) =>
      invokeCommand("start_sftp_session", {
        request: {
          sessionId,
          title: connection.name,
          host: connection.host,
          user: connection.user,
          port: connection.port,
          keyPath: connection.keyPath,
          proxyJump: connection.proxyJump,
          ...resolveSshSocksProxyRequest(connection),
          sshCompression: resolveSshCompression(connection, useWorkspaceStore.getState().sshSettings),
          sshOldProtocols: resolveSshOldProtocols(connection, useWorkspaceStore.getState().sshSettings),
          authMethod: connection.authMethod,
          secretOwnerId: connectionPasswordOwnerId(connection),
          password,
          passphraseOwnerId: connection.id,
          path,
        },
      }),
    listDirectory: (args) =>
      invokeCommand("list_sftp_directory", { request: args }),
    closeSession: (sessionId) =>
      invokeCommand("close_sftp_session", { sessionId }).then(() => undefined),
    createFolder: (args) =>
      invokeCommand("create_sftp_folder", { request: args }).then(() => undefined),
    renamePath: (args) =>
      invokeCommand("rename_sftp_path", { request: args }).then(() => undefined),
    deletePath: (args) =>
      invokeCommand("delete_sftp_path", { request: args }).then(() => undefined),
    pathProperties: (args) =>
      invokeCommand("sftp_path_properties", { request: args }),
    updatePathProperties: (args) =>
      invokeCommand("update_sftp_path_properties", { request: args }),
    uploadPath: (args) =>
      invokeCommand("upload_sftp_path", { request: args }),
    downloadPath: (args) =>
      invokeCommand("download_sftp_path", { request: args }),
    cancelTransfer: (args) =>
      invokeCommand("cancel_sftp_transfer", { request: args }).then(() => undefined),
    transferProgressEvent: "sftp-transfer-progress",
  };
}

export function ftpBrowserCommands(
  connection: Connection,
  options: FtpConnectionOptions,
): FileBrowserCommands {
  const protocolLabel =
    options.protocol === "ftps"
      ? options.tlsMode === "implicit"
        ? "FTPS (implicit)"
        : "FTPS"
      : "FTP";

  return {
    protocolLabel,
    capabilities: {
      // FTP servers vary wildly in chmod / SITE CHMOD support; surfacing the
      // POSIX permissions editor would be misleading. Disable until we
      // probe FEAT and conditionally enable.
      editPermissions: false,
      verifySshHostKey: false,
      openTerminalHere: false,
    },
    startSession: ({ sessionId, path, password }) =>
      invokeCommand("start_ftp_session", {
        request: {
          sessionId,
          title: connection.name,
          host: connection.host,
          user: connection.user,
          port: connection.port,
          secretOwnerId: connectionPasswordOwnerId(connection),
          password,
          path,
          options,
        },
      }),
    listDirectory: (args) =>
      invokeCommand("list_ftp_directory", { request: args }),
    closeSession: (sessionId) =>
      invokeCommand("close_ftp_session", { sessionId }).then(() => undefined),
    createFolder: (args) =>
      invokeCommand("create_ftp_folder", { request: args }).then(() => undefined),
    renamePath: (args) =>
      invokeCommand("rename_ftp_path", { request: args }).then(() => undefined),
    deletePath: (args) =>
      invokeCommand("delete_ftp_path", { request: args }).then(() => undefined),
    pathProperties: (args) =>
      invokeCommand("ftp_path_properties", { request: args }),
    updatePathProperties: () => {
      throw new Error("FTP does not support editing POSIX properties");
    },
    uploadPath: (args) => invokeCommand("upload_ftp_path", { request: args }),
    downloadPath: (args) => invokeCommand("download_ftp_path", { request: args }),
    cancelTransfer: (args) =>
      invokeCommand("cancel_ftp_transfer", { request: args }).then(() => undefined),
    transferProgressEvent: "ftp-transfer-progress",
  };
}

/**
 * Local File Explorer adapter. Drives the same file-browser surface over the
 * local filesystem with no network session: listing reuses `list_local_directory`
 * and item details use `local_path_properties`. The File Explorer UI presents
 * this as a single-pane local browser rather than a transfer surface.
 */
let localBrowserCommandsSingleton: FileBrowserCommands | null = null;

function localPathName(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() ?? "";
}

function localDestinationPath(sourcePath: string, destinationDirectory: string) {
  const name = localPathName(sourcePath);
  if (!name) {
    throw new Error("source path must name a file or folder");
  }
  const directory = destinationDirectory.trim();
  if (!directory) {
    throw new Error("destination directory is required");
  }
  if (directory.endsWith("\\") || directory.endsWith("/")) {
    return `${directory}${name}`;
  }
  // Drive-letter roots ("C:"), UNC shares, and any backslash-separated path join
  // with a backslash; everything else — including relative POSIX paths — joins
  // with a forward slash.
  const separator = /^[A-Za-z]:$/.test(directory) || directory.includes("\\") ? "\\" : "/";
  return `${directory}${separator}${name}`;
}

async function copyLocalBrowserPath(
  sourcePath: string,
  destinationDirectory: string,
  overwriteBehavior: SftpSettings["overwriteBehavior"],
) {
  if (overwriteBehavior !== "overwrite") {
    const destinationPath = localDestinationPath(sourcePath, destinationDirectory);
    const existing = await invokeCommand("local_path_properties", {
      request: { path: destinationPath },
    }).catch(() => null);
    if (existing) {
      throw new Error(`destination already exists: ${destinationPath}`);
    }
  }
  // `copy_local_path` resolves the destination directory and refuses to copy a
  // folder into itself or one of its own subfolders. `copy_local_path_to` skips
  // that guard whenever the target does not exist yet, which would let a copy
  // recurse into the tree it is still reading.
  return invokeCommand("copy_local_path", {
    request: { sourcePath, destinationDirectory },
  });
}

export function localBrowserCommands(): FileBrowserCommands {
  if (localBrowserCommandsSingleton) {
    return localBrowserCommandsSingleton;
  }
  async function listLocal(path: string, sessionId: string): Promise<SftpDirectoryListing> {
    const listing = await invokeCommand("list_local_directory", {
      request: { path: path?.trim() ? path : undefined },
    });
    return { sessionId, path: listing.path, entries: listing.entries };
  }
  localBrowserCommandsSingleton = {
    protocolLabel: "Files",
    capabilities: {
      editPermissions: false,
      verifySshHostKey: false,
      openTerminalHere: false,
    },
    startSession: ({ sessionId, path }) => listLocal(path, sessionId),
    listDirectory: ({ sessionId, path }) => listLocal(path, sessionId),
    closeSession: () => Promise.resolve(),
    createFolder: ({ parentPath, name }) =>
      invokeCommand("create_local_folder", {
        request: { parentPath, name },
      }).then(() => undefined),
    renamePath: ({ path, newName }) =>
      invokeCommand("rename_local_path", {
        request: { path, newName },
      }).then(() => undefined),
    deletePath: ({ path }) =>
      invokeCommand("delete_local_path", { request: { path } }).then(() => undefined),
    pathProperties: ({ path }) =>
      invokeCommand("local_path_properties", { request: { path } }),
    updatePathProperties: () => {
      throw new Error("Local File Explorer does not support editing POSIX properties");
    },
    uploadPath: ({ localPath, remoteDirectory, overwriteBehavior }) =>
      copyLocalBrowserPath(localPath, remoteDirectory, overwriteBehavior),
    downloadPath: ({ remotePath, localDirectory, overwriteBehavior }) =>
      copyLocalBrowserPath(remotePath, localDirectory, overwriteBehavior),
    cancelTransfer: () => Promise.resolve(),
    transferProgressEvent: "local-files-transfer-progress",
  };
  return localBrowserCommandsSingleton;
}

/** Resolve the right adapter from a Connection. */
export function fileBrowserCommandsFor(connection: Connection): FileBrowserCommands {
  if (connection.type === "localFiles") {
    return localBrowserCommands();
  }
  if (connection.type === "ftp") {
    const options: FtpConnectionOptions = connection.ftpOptions ?? {
      protocol: "ftp",
      mode: "passive",
      transferType: "binary",
      utf8: true,
      showHidden: false,
      ignoreCertErrors: false,
    };
    return ftpBrowserCommands(connection, options);
  }
  return sftpBrowserCommands(connection);
}
