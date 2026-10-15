import { useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Lock, LogOut, Power, PowerOff, Moon, Monitor, RefreshCw } from "lucide-react";

type DisplayInfo = { index: number; name: string; width: number; height: number; primary: boolean };

export function SessionPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [busy, setBusy] = useState<string | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [loadingDisplays, setLoadingDisplays] = useState(false);

  const sessionCmd = async (action: string, label: string) => {
    if (!confirm(`Are you sure you want to ${label} this device?`)) return;
    setBusy(action);
    try {
      await send(action);
      toast.success(`${label} command sent`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const loadDisplays = async () => {
    setLoadingDisplays(true);
    try {
      const r = await send("display.list");
      setDisplays((r.result?.displays as DisplayInfo[]) ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingDisplays(false);
    }
  };

  const actions = [
    { action: "session.lock", label: "Lock", icon: Lock, variant: "" },
    { action: "session.logoff", label: "Log Off", icon: LogOut, variant: "" },
    { action: "session.reboot", label: "Reboot", icon: RefreshCw, variant: "destructive" },
    { action: "session.shutdown", label: "Shutdown", icon: PowerOff, variant: "destructive" },
    { action: "session.sleep", label: "Sleep", icon: Moon, variant: "" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Session Control
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {actions.map((a) => {
            const Icon = a.icon;
            const isDanger = a.variant === "destructive";
            return (
              <button
                key={a.action}
                onClick={() => sessionCmd(a.action, a.label)}
                disabled={!connected || busy !== null}
                className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium transition disabled:opacity-40 ${
                  isDanger
                    ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : "border-border/60 bg-card/60 hover:bg-accent"
                }`}
              >
                <Icon className="h-4 w-4" />
                {busy === a.action ? "Sending…" : a.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Displays
          </h3>
          <button
            onClick={loadDisplays}
            disabled={!connected || loadingDisplays}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs transition hover:bg-accent disabled:opacity-40"
          >
            <Monitor className="h-3 w-3" />
            {loadingDisplays ? "Loading…" : "Detect"}
          </button>
        </div>
        {displays.length > 0 ? (
          <div className="grid gap-2">
            {displays.map((d) => (
              <div
                key={d.index}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-4 py-2.5 text-sm"
              >
                <Monitor className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{d.name || `Display ${d.index + 1}`}</span>
                <span className="text-xs text-muted-foreground">
                  {d.width}×{d.height}
                </span>
                {d.primary && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                    Primary
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Click Detect to enumerate connected monitors.
          </p>
        )}
      </div>
    </div>
  );
}
