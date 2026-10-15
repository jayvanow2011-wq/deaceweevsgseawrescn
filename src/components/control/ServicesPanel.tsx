import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Play, Square, RefreshCw, Search, Cog } from "lucide-react";

type Svc = { name: string; display: string; status: string; start_type: string };

export function ServicesPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [svcs, setSvcs] = useState<Svc[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await send("svc.list");
      setSvcs((r.result?.services as Svc[]) ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }, [send]);

  useEffect(() => {
    if (connected) load();
  }, [connected, load]);

  const svcAction = async (name: string, action: "svc.start" | "svc.stop") => {
    try {
      await send(action, { name });
      toast.success(`${action === "svc.start" ? "Started" : "Stopped"} ${name}`);
      setTimeout(load, 1000);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return svcs;
    return svcs.filter(
      (s) => s.name.toLowerCase().includes(q) || s.display.toLowerCase().includes(q),
    );
  }, [svcs, query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter services…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Service</th>
              <th className="px-4 py-2.5 font-medium">Display Name</th>
              <th className="w-28 px-4 py-2.5 font-medium">Status</th>
              <th className="w-28 px-4 py-2.5 font-medium">Start Type</th>
              <th className="w-24 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  {busy ? "loading…" : "no services"}
                </td>
              </tr>
            )}
            {filtered.map((s) => (
              <tr key={s.name} className="border-t border-border/40 transition hover:bg-muted/20">
                <td className="px-4 py-2 font-mono text-xs">{s.name}</td>
                <td className="px-4 py-2 font-medium">{s.display}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center gap-1 text-xs ${
                      s.status === "Running"
                        ? "text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        s.status === "Running" ? "bg-emerald-400" : "bg-muted-foreground"
                      }`}
                    />
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{s.start_type}</td>
                <td className="px-4 py-2 text-right">
                  {s.status === "Running" ? (
                    <button
                      onClick={() => svcAction(s.name, "svc.stop")}
                      className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/20"
                    >
                      <Square className="h-3 w-3" /> Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => svcAction(s.name, "svc.start")}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-400/20"
                    >
                      <Play className="h-3 w-3" /> Start
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
