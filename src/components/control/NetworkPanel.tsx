import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Globe, Network, RefreshCw, Search, Wifi } from "lucide-react";

type NetIface = { name: string; ip: string; mac: string; up: boolean };
type NetConn = {
  proto: string;
  local: string;
  remote: string;
  state: string;
  pid: number;
  process: string;
};
type WifiNet = { ssid: string; signal: number; auth: string; password?: string };

type SubTab = "interfaces" | "connections" | "wifi" | "publicip";

export function NetworkPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [sub, setSub] = useState<SubTab>("interfaces");
  const [ifaces, setIfaces] = useState<NetIface[]>([]);
  const [conns, setConns] = useState<NetConn[]>([]);
  const [wifis, setWifis] = useState<WifiNet[]>([]);
  const [publicIp, setPublicIp] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (sub === "interfaces") {
        const r = await send("net.interfaces");
        setIfaces((r.result?.interfaces as NetIface[]) ?? []);
      } else if (sub === "connections") {
        const r = await send("net.connections");
        setConns((r.result?.connections as NetConn[]) ?? []);
      } else if (sub === "wifi") {
        const r = await send("net.wifi.list");
        setWifis((r.result?.networks as WifiNet[]) ?? []);
      } else if (sub === "publicip") {
        const r = await send("net.publicip");
        setPublicIp(r.result?.ip ?? "");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }, [send, sub]);

  useEffect(() => {
    if (connected) load();
  }, [connected, sub, load]);

  const subtabs: { key: SubTab; label: string; icon: typeof Globe }[] = [
    { key: "interfaces", label: "Interfaces", icon: Network },
    { key: "connections", label: "Connections", icon: Globe },
    { key: "wifi", label: "Wi-Fi", icon: Wifi },
    { key: "publicip", label: "Public IP", icon: Globe },
  ];

  const filteredConns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conns;
    return conns.filter(
      (c) =>
        c.remote.toLowerCase().includes(q) ||
        c.process.toLowerCase().includes(q) ||
        c.state.toLowerCase().includes(q),
    );
  }, [conns, query]);

  return (
    <div className="space-y-4">
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
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs transition hover:bg-accent disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {sub === "interfaces" && (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
                <th className="px-4 py-2.5 font-medium">MAC</th>
                <th className="w-20 px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {ifaces.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    {busy ? "loading…" : "no interfaces"}
                  </td>
                </tr>
              )}
              {ifaces.map((i, idx) => (
                <tr key={idx} className="border-t border-border/40 transition hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{i.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{i.ip}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{i.mac}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${i.up ? "bg-emerald-400" : "bg-muted-foreground"}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === "connections" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter connections…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Proto</th>
                  <th className="px-4 py-2.5 font-medium">Local</th>
                  <th className="px-4 py-2.5 font-medium">Remote</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 font-medium">Process</th>
                </tr>
              </thead>
              <tbody>
                {filteredConns.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      {busy ? "loading…" : "no connections"}
                    </td>
                  </tr>
                )}
                {filteredConns.map((c, idx) => (
                  <tr key={idx} className="border-t border-border/40 transition hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono text-xs">{c.proto}</td>
                    <td className="px-4 py-2 font-mono text-xs">{c.local}</td>
                    <td className="px-4 py-2 font-mono text-xs">{c.remote}</td>
                    <td className="px-4 py-2 text-xs">{c.state}</td>
                    <td className="px-4 py-2 text-xs">
                      {c.process} <span className="text-muted-foreground">({c.pid})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sub === "wifi" && (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">SSID</th>
                <th className="px-4 py-2.5 font-medium">Signal</th>
                <th className="px-4 py-2.5 font-medium">Auth</th>
                <th className="px-4 py-2.5 font-medium">Password</th>
              </tr>
            </thead>
            <tbody>
              {wifis.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    {busy ? "loading…" : "no networks"}
                  </td>
                </tr>
              )}
              {wifis.map((w, idx) => (
                <tr key={idx} className="border-t border-border/40 transition hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{w.ssid}</td>
                  <td className="px-4 py-2 text-xs">{w.signal}%</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{w.auth}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {w.password || <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === "publicip" && (
        <div className="rounded-xl border border-border/60 bg-card/60 p-6 text-center">
          <Globe className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="font-mono text-lg">{publicIp || (busy ? "loading…" : "unknown")}</p>
          <p className="mt-1 text-xs text-muted-foreground">Public IP address of the remote device</p>
        </div>
      )}
    </div>
  );
}
