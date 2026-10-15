import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { FolderOpen, Download, Trash2, Eye, Loader2, Monitor, X } from "lucide-react";

export const Route = createFileRoute("/dashboard/files")({
  component: FilesPage,
  head: () => ({
    meta: [
      { title: "Files · Dashboard" },
      { name: "description", content: "Browse screenshots and webcam photos captured from your clients." },
    ],
  }),
});

type Device = { id: string; pc_name: string; tag: string | null };
type StoredFile = { name: string; id: string | null; created_at: string | null; size: number };

export default function FilesPage() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [active, setActive] = useState<Device | null>(null);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("devices")
      .select("id,pc_name,tag")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setDevices((data as Device[]) ?? []));
  }, [user]);

  const openFolder = async (d: Device) => {
    setActive(d);
    setLoading(true);
    const { data, error } = await supabase.storage.from("client-files").list(d.id, {
      limit: 500,
      sortBy: { column: "created_at", order: "desc" },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setFiles(
      (data ?? [])
        .filter((f) => f.name !== ".emptyFolderPlaceholder")
        .map((f) => ({
          name: f.name,
          id: f.id ?? null,
          created_at: f.created_at ?? null,
          size: (f.metadata as any)?.size ?? 0,
        })),
    );
  };

  const view = async (f: StoredFile) => {
    if (!active) return;
    const { data, error } = await supabase.storage
      .from("client-files")
      .createSignedUrl(`${active.id}/${f.name}`, 300);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPreview(data.signedUrl);
  };

  const download = async (f: StoredFile) => {
    if (!active) return;
    const { data, error } = await supabase.storage
      .from("client-files")
      .download(`${active.id}/${f.name}`);
    if (error) {
      toast.error(error.message);
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(data);
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const remove = async (f: StoredFile) => {
    if (!active || !confirm(`Delete ${f.name}?`)) return;
    const { error } = await supabase.storage
      .from("client-files")
      .remove([`${active.id}/${f.name}`]);
    if (error) {
      toast.error(error.message);
      return;
    }
    setFiles((prev) => prev.filter((x) => x.name !== f.name));
    toast.success("Deleted");
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">files</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Screenshots and webcam photos captured from your clients.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="space-y-1 rounded-xl border border-border/60 bg-card/60 p-2 backdrop-blur-xl">
          {devices.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">no clients yet</div>
          )}
          {devices.map((d) => (
            <button
              key={d.id}
              onClick={() => openFolder(d)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                active?.id === d.id
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Monitor className="h-4 w-4 shrink-0" />
              <span className="truncate">{d.pc_name}</span>
              {d.tag && (
                <span className="ml-auto rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                  {d.tag}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-xl">
          {!active ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <FolderOpen className="h-6 w-6" />
              pick a client folder
            </div>
          ) : loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> loading…
            </div>
          ) : files.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              nothing captured yet — use Screenshot or Webcam photo on the control page
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {files.map((f) => (
                  <tr key={f.name} className="border-t border-border/40 transition hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{f.name}</td>
                    <td className="w-40 px-4 py-2.5 text-xs text-muted-foreground">
                      {f.created_at ? new Date(f.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="w-36 px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => view(f)}
                          className="rounded p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          title="View"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => download(f)}
                          className="rounded p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => remove(f)}
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
          )}
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <button className="absolute right-4 top-4 rounded-md border border-border p-2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
          <img
            src={preview}
            alt="capture"
            className="max-h-full max-w-full rounded-lg border border-border object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
