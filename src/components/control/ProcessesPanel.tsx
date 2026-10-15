import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { RefreshCw, Search, Skull } from "lucide-react";

type Proc = { pid: number; name: string; mem_kb: number };

export function ProcessesPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [busy, setBusy] = useState(false);
  const [killing, setKilling] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await send("proc.list");
      const list = (r.result.processes as Proc[]).sort((a, b) => b.mem_kb - a.mem_kb);
      setProcs(list);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }, [send]);

  useEffect(() => {
    if (connected) load();
  }, [connected, load]);

  const kill = async (p: Proc) => {
    if (!confirm(`Kill ${p.name} (PID ${p.pid})?`)) return;
    setKilling(p.pid);
    try {
      await send("proc.kill", { pid: p.pid });
      toast.success(`Killed ${p.name}`);
      setProcs((prev) => prev.filter((x) => x.pid !== p.pid));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setKilling(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return procs;
    return procs.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q));
  }, [procs, query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter processes…"
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
              <th className="px-4 py-2.5 font-medium">process</th>
              <th className="w-24 px-4 py-2.5 font-medium">pid</th>
              <th className="w-28 px-4 py-2.5 text-right font-medium">memory</th>
              <th className="w-20 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  {busy ? "loading…" : connected ? "no processes" : "waiting for device…"}
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr key={p.pid} className="border-t border-border/40 transition hover:bg-muted/20">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p.pid}</td>
                <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                  {(p.mem_kb / 1024).toFixed(1)} MB
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => kill(p)}
                    disabled={killing === p.pid}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-40"
                  >
                    <Skull className="h-3 w-3" /> kill
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
