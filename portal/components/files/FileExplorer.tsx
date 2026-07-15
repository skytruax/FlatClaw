"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  File as FileIcon,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  lastModified: string;
}

/** openclaw runtime files the operator never needs to touch — hidden from the tree. */
const HIDDEN_FILES = new Set(["MEMORY.md", "openclaw-workspace-state.json"]);

/** Extensions we render as an inline image rather than as text. */
const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg",
]);
/** Binary/document extensions whose text preview is garbage — download instead. */
const BINARY_EXTS = new Set([
  "docx", "doc", "xlsx", "xls", "pptx", "ppt", "pdf", "rtf", "odt", "ods", "odp",
  "zip", "gz", "tgz", "tar", "rar", "7z", "bz2", "xz",
  "mp3", "wav", "ogg", "flac", "m4a", "mp4", "mov", "webm", "mkv", "avi",
  "woff", "woff2", "ttf", "otf", "eot",
  "bin", "exe", "dll", "so", "dylib", "wasm", "o", "a",
  "db", "sqlite", "sqlite3", "parquet", "wal",
]);

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
/** How to present a file in the preview popup. */
function previewKind(name: string): "text" | "image" | "binary" {
  const ext = fileExt(name);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (BINARY_EXTS.has(ext)) return "binary";
  return "text";
}

interface FileExplorerProps {
  targetUserId?: string;
  agentId: string;
  className?: string;
}

export default function FileExplorer({
  targetUserId,
  agentId,
  className,
}: FileExplorerProps) {
  const [root, setRoot] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Map<string, FileEntry[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const buildQuery = useCallback(
    (extra?: Record<string, string>) => {
      const p = new URLSearchParams();
      if (targetUserId) p.set("userId", targetUserId);
      for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
      return p.toString();
    },
    [targetUserId],
  );

  const loadDir = useCallback(
    async (path: string): Promise<FileEntry[]> => {
      const r = await fetch(`/api/portal/workspace/list?${buildQuery({ path })}`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "list failed");
      // openclaw scaffolds these into the workspace root; they're runtime
      // bookkeeping, not user files — keep them out of the operator's view.
      return ((json.entries ?? []) as FileEntry[]).filter(
        (e) => !HIDDEN_FILES.has(e.name),
      );
    },
    [buildQuery],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      setRoot(await loadDir(""));
      // refresh open dirs in place
      const reopened = new Map<string, FileEntry[]>();
      for (const dir of expanded.keys()) {
        try {
          reopened.set(dir, await loadDir(dir));
        } catch {
          /* skip */
        }
      }
      setExpanded(reopened);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("missing") || msg.includes("no agent")) setMissing(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDir]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, targetUserId]);

  // Quiet variant of `refresh` for background auto-reload: re-fetches root and
  // any open dirs WITHOUT toggling `loading`, so the tree doesn't flicker a
  // spinner every few seconds. Errors stay silent — the visible `refresh`
  // (mount / user actions) is what surfaces them.
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  const backgroundRefresh = useCallback(async () => {
    try {
      setRoot(await loadDir(""));
      const reopened = new Map<string, FileEntry[]>();
      for (const dir of expandedRef.current.keys()) {
        try {
          reopened.set(dir, await loadDir(dir));
        } catch {
          /* skip a dir that vanished */
        }
      }
      setExpanded(reopened);
    } catch {
      /* silent — background poll, don't clobber the visible error state */
    }
  }, [loadDir]);

  // Auto-reload the workspace: the agent writes files mid-turn (reports,
  // exports, downloads). Primary trigger is the `flatclaw:files-refresh`
  // event the chat panel fires when a turn finishes; a gentle poll and a
  // focus/visibility refresh back it up.
  useEffect(() => {
    const t = setInterval(() => void backgroundRefresh(), 8_000);
    const onSignal = () => void backgroundRefresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void backgroundRefresh();
    };
    window.addEventListener("flatclaw:files-refresh", onSignal);
    window.addEventListener("focus", onSignal);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      window.removeEventListener("flatclaw:files-refresh", onSignal);
      window.removeEventListener("focus", onSignal);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [backgroundRefresh]);

  const toggle = useCallback(
    async (entry: FileEntry) => {
      if (entry.kind === "file") {
        setSelected(entry);
        setFileContent(null);
        // Binary/document/image files have no readable text preview — skip the
        // read entirely (it would just stream garbage) and let the popup show a
        // download prompt or render the image from the download URL.
        if (previewKind(entry.name) !== "text") {
          setFileLoading(false);
          return;
        }
        setFileLoading(true);
        try {
          const r = await fetch(
            `/api/portal/workspace/read?${buildQuery({ path: entry.path })}`,
          );
          const json = await r.json();
          if (!r.ok) throw new Error(json.error ?? "read failed");
          setFileContent(json.content ?? "");
        } catch (err) {
          setFileContent(`[error: ${err instanceof Error ? err.message : String(err)}]`);
        } finally {
          setFileLoading(false);
        }
        return;
      }
      // toggle directory
      if (expanded.has(entry.path)) {
        setExpanded((prev) => {
          const next = new Map(prev);
          next.delete(entry.path);
          return next;
        });
        return;
      }
      try {
        const children = await loadDir(entry.path);
        setExpanded((prev) => {
          const next = new Map(prev);
          next.set(entry.path, children);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [buildQuery, expanded, loadDir],
  );

  const upload = useCallback(
    async (files: FileList | File[]) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      try {
        const fd = new FormData();
        for (const f of Array.from(files)) fd.append("file", f);
        const r = await fetch(`/api/portal/workspace/upload?${buildQuery()}`, {
          method: "POST",
          body: fd,
        });
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "upload failed");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    },
    [buildQuery, refresh],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) upload(e.dataTransfer.files);
    },
    [upload],
  );

  const newFolder = useCallback(async () => {
    const name = window.prompt("Folder name");
    if (!name || !name.trim()) return;
    try {
      const r = await fetch(`/api/portal/workspace/mkdir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: targetUserId,
          path: name.trim(),
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "mkdir failed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh, targetUserId]);

  const deleteEntry = useCallback(
    async (entry: FileEntry) => {
      const label = entry.kind === "directory" ? "folder" : "file";
      if (!window.confirm(`Delete ${label} "${entry.path}"? This cannot be undone.`)) {
        return;
      }
      const post = async (recursive: boolean) => {
        const r = await fetch(`/api/portal/workspace/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: targetUserId,
            path: entry.path,
            recursive,
          }),
        });
        return { res: r, json: await r.json() };
      };
      try {
        let { res, json } = await post(false);
        if (!res.ok && typeof json?.error === "string" && json.error.startsWith("directory not empty")) {
          if (
            !window.confirm(
              `"${entry.path}" is not empty (${json.error}). Delete recursively?`,
            )
          ) {
            return;
          }
          ({ res, json } = await post(true));
        }
        if (!res.ok) throw new Error(json?.error ?? "delete failed");
        if (selected && (selected.path === entry.path || selected.path.startsWith(entry.path + "/"))) {
          setSelected(null);
          setFileContent(null);
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh, selected, targetUserId],
  );

  return (
    <div
      className={
        "flex flex-col rounded-xl bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] overflow-hidden shadow-sm relative " +
        (className ?? "")
      }
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="absolute inset-2 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-[hsl(var(--brand-accent))/0.18] backdrop-blur-md ring-2 ring-dashed ring-[hsl(var(--brand-accent))] pointer-events-none animate-in fade-in duration-150">
          <div className="rounded-full bg-[hsl(var(--brand-accent))/0.25] p-3">
            <Upload className="w-8 h-8 text-[hsl(var(--brand-primary))]" />
          </div>
          <p className="text-sm font-semibold text-[hsl(var(--brand-primary))]">
            Drop to upload
          </p>
          <p className="text-[11px] text-[hsl(var(--brand-primary))/0.7]">
            files will be added to the workspace
          </p>
        </div>
      )}
      {uploading && !dragOver && (
        <div className="absolute top-12 right-3 z-20 px-2 py-1 rounded text-[10px] font-medium bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] flex items-center gap-1.5 animate-pulse">
          <Upload className="w-3 h-3" />
          uploading…
        </div>
      )}

      <header className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))]">
        <div className="flex items-center gap-2">
          <Folder className="w-3.5 h-3.5 text-[hsl(var(--brand-primary))]" />
          <span className="text-xs font-semibold tracking-tight">Workspace</span>
        </div>
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => {
              if (e.target.files) upload(e.target.files);
              e.target.value = "";
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={newFolder}
            title="New folder"
            className="p-1.5 rounded hover:bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] hover:text-[hsl(var(--fc-fg-primary))]"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload files"
            className="p-1.5 rounded hover:bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] hover:text-[hsl(var(--fc-fg-primary))] disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={refresh}
            title="Refresh"
            className="p-1.5 rounded hover:bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] hover:text-[hsl(var(--fc-fg-primary))]"
          >
            <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
          </button>
        </div>
      </header>

      {/* Single-pane tree (preview opens in a popup) */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <p className="p-3 text-xs text-[hsl(var(--fc-fg-muted))]">loading…</p>
        ) : missing ? (
          <p className="p-3 text-xs text-[hsl(var(--fc-fg-muted))]">
            workspace will be created on first agent run
          </p>
        ) : error ? (
          <p className="p-3 text-xs text-red-700">{error}</p>
        ) : root.length === 0 ? (
          <div className="p-6 text-center text-xs text-[hsl(var(--fc-fg-muted))]">
            <Folder className="w-7 h-7 mx-auto mb-2 opacity-40" />
            empty workspace
            <div className="mt-1 text-[10px]">drag files here to upload</div>
          </div>
        ) : (
          <Tree
            entries={root}
            expanded={expanded}
            onToggle={toggle}
            onDelete={deleteEntry}
            selectedPath={selected?.path}
            depth={0}
          />
        )}
      </div>

      {selected && (
        <FilePopup
          file={selected}
          content={fileContent}
          loading={fileLoading}
          downloadUrl={`/api/portal/workspace/download?${buildQuery({ path: selected.path })}`}
          onClose={() => {
            setSelected(null);
            setFileContent(null);
          }}
          onDelete={() => deleteEntry(selected)}
        />
      )}
    </div>
  );
}

function FilePopup({
  file,
  content,
  loading,
  downloadUrl,
  onClose,
  onDelete,
}: {
  file: FileEntry;
  content: string | null;
  loading: boolean;
  downloadUrl: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[hsl(var(--fc-bg-surface))] ring-1 ring-[hsl(var(--fc-bg-tertiary))] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--fc-bg-tertiary))] bg-[hsl(var(--fc-bg-soft))]">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-mono truncate text-[hsl(var(--fc-fg-primary))]">
              {file.path}
            </div>
            <div className="text-[10px] text-[hsl(var(--fc-fg-muted))]">
              {formatBytes(file.size)} · {new Date(file.lastModified).toLocaleString()}
            </div>
          </div>
          <div className="flex items-center gap-1 ml-3 shrink-0">
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium hover:bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] hover:text-[hsl(var(--fc-fg-primary))]"
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium hover:bg-red-50 text-[hsl(var(--fc-fg-secondary))] hover:text-red-600"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-[hsl(var(--fc-bg-tertiary))] text-[hsl(var(--fc-fg-secondary))] hover:text-[hsl(var(--fc-fg-primary))]"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>
        {(() => {
          const kind = previewKind(file.name);
          if (kind === "image") {
            return (
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[hsl(var(--fc-bg-primary))]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={downloadUrl}
                  alt={file.name}
                  className="max-w-full max-h-full object-contain rounded"
                />
              </div>
            );
          }
          if (kind === "binary") {
            return (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10 text-center bg-[hsl(var(--fc-bg-primary))]">
                <FileText className="w-10 h-10 text-[hsl(var(--fc-fg-muted))]" />
                <div className="text-sm text-[hsl(var(--fc-fg-secondary))]">
                  No preview for{" "}
                  <span className="font-mono">.{fileExt(file.name)}</span> files.
                </div>
                <a
                  href={downloadUrl}
                  download
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent-fg))] hover:bg-[hsl(var(--brand-primary))]"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download to view
                </a>
              </div>
            );
          }
          return (
            <div className="flex-1 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap text-[hsl(var(--fc-fg-primary))] bg-[hsl(var(--fc-bg-primary))]">
              {loading ? (
                <span className="text-[hsl(var(--fc-fg-muted))]">loading…</span>
              ) : (
                content
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function Tree({
  entries,
  expanded,
  onToggle,
  onDelete,
  selectedPath,
  depth,
}: {
  entries: FileEntry[];
  expanded: Map<string, FileEntry[]>;
  onToggle: (e: FileEntry) => void;
  onDelete: (e: FileEntry) => void;
  selectedPath?: string;
  depth: number;
}) {
  return (
    <ul className="text-xs py-1">
      {entries.map((e) => {
        const isOpen = expanded.has(e.path);
        const children = expanded.get(e.path) ?? [];
        const isSelected = selectedPath === e.path;
        return (
          <li key={e.path}>
            <div
              className={
                "group relative flex items-center hover:bg-[hsl(var(--fc-bg-soft))] " +
                (isSelected
                  ? "bg-[hsl(var(--brand-accent))/0.14] text-[hsl(var(--brand-primary))]"
                  : "")
              }
            >
              <button
                type="button"
                onClick={() => onToggle(e)}
                className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 text-left"
                style={{ paddingLeft: 8 + depth * 14 }}
              >
                {e.kind === "directory" ? (
                  <ChevronRight
                    className={
                      "w-3 h-3 text-[hsl(var(--fc-fg-muted))] transition-transform " +
                      (isOpen ? "rotate-90" : "")
                    }
                  />
                ) : (
                  <span className="w-3" />
                )}
                {e.kind === "directory" ? (
                  isOpen ? (
                    <FolderOpen className="w-3.5 h-3.5 text-[hsl(var(--brand-primary))]" />
                  ) : (
                    <Folder className="w-3.5 h-3.5 text-[hsl(var(--brand-primary))]" />
                  )
                ) : (
                  <FileIconFor name={e.name} />
                )}
                <span className="truncate flex-1">{e.name}</span>
                {e.kind === "file" && (
                  <span className="text-[10px] text-[hsl(var(--fc-fg-muted))] opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatBytes(e.size)}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onDelete(e);
                }}
                title={`Delete ${e.kind}`}
                className="shrink-0 mr-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-[hsl(var(--fc-fg-muted))] hover:text-red-600 hover:bg-[hsl(var(--fc-bg-tertiary))]"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {e.kind === "directory" && isOpen && children.length > 0 && (
              <Tree
                entries={children}
                expanded={expanded}
                onToggle={onToggle}
                onDelete={onDelete}
                selectedPath={selectedPath}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FileIconFor({ name }: { name: string }) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"].includes(ext))
    return <ImageIcon className="w-3.5 h-3.5 text-[hsl(var(--fc-fg-secondary))]" />;
  if (
    [
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "go",
      "rs",
      "rb",
      "java",
      "c",
      "cpp",
      "h",
      "json",
      "yml",
      "yaml",
      "sh",
      "css",
      "html",
    ].includes(ext)
  )
    return <FileCode2 className="w-3.5 h-3.5 text-[hsl(var(--fc-fg-secondary))]" />;
  if (["md", "txt", "log"].includes(ext))
    return <FileText className="w-3.5 h-3.5 text-[hsl(var(--fc-fg-secondary))]" />;
  return <FileIcon className="w-3.5 h-3.5 text-[hsl(var(--fc-fg-secondary))]" />;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
