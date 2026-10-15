import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Database, ChevronRight, FolderOpen, Trash2, Plus, RefreshCw } from "lucide-react";

type RegValue = { name: string; type: string; data: string };

export function RegistryPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [path, setPath] = useState("HKLM\\SOFTWARE");
  const [subkeys, setSubkeys] = useState<string[]>([]);
  const [values, setValues] = useState<RegValue[]>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("REG_SZ");
  const [newData, setNewData] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await send("reg.list", { path });
      setSubkeys((r.result?.subkeys as string[]) ?? []);
      setValues((r.result?.values as RegValue[]) ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }, [send, path]);

  const navigate = (sub: string) => {
    setPath((prev) => prev + "\\" + sub);
  };

  const goUp = () => {
    const i = path.lastIndexOf("\\");
    if (i > 0) setPath(path.slice(0, i));
  };

  const setValue = async () => {
    if (!newName.trim()) return;
    try {
      await send("reg.set", { path, name: newName, type: newType, data: newData });
      toast.success(`Set ${newName}`);
      setNewName("");
      setNewData("");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const deleteValue = async (name: string) => {
    if (!confirm(`Delete registry value "${name}"?`)) return;
    try {
      await send("reg.delete", { path, name });
      toast.success(`Deleted ${name}`);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            className="w-full bg-transparent font-mono text-sm outline-none"
          />
        </div>
        <button
          onClick={goUp}
          className="rounded-md border border-border/60 px-2.5 py-2 text-xs hover:bg-accent"
        >
          ↑ Up
        </button>
        <button
          onClick={load}
          disabled={!connected || busy}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-2 text-xs hover:bg-accent disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Load
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card/60 p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Subkeys
          </h4>
          <div className="max-h-60 space-y-0.5 overflow-auto">
            {subkeys.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {busy ? "loading…" : "no subkeys"}
              </p>
            )}
            {subkeys.map((s) => (
              <button
                key={s}
                onClick={() => navigate(s)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-accent"
              >
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 text-left font-mono text-xs">{s}</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/60 p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Values
          </h4>
          <div className="max-h-60 space-y-1 overflow-auto">
            {values.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {busy ? "loading…" : "no values"}
              </p>
            )}
            {values.map((v) => (
              <div
                key={v.name}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/20"
              >
                <span className="flex-1 font-mono font-medium">{v.name || "(Default)"}</span>
                <span className="text-muted-foreground">{v.type}</span>
                <span className="max-w-32 truncate font-mono text-muted-foreground">{v.data}</span>
                <button
                  onClick={() => deleteValue(v.name)}
                  className="rounded p-1 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/60 p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Set Value
        </h4>
        <div className="flex flex-wrap gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-sm outline-none"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-sm outline-none"
          >
            <option>REG_SZ</option>
            <option>REG_DWORD</option>
            <option>REG_QWORD</option>
            <option>REG_BINARY</option>
            <option>REG_EXPAND_SZ</option>
            <option>REG_MULTI_SZ</option>
          </select>
          <input
            value={newData}
            onChange={(e) => setNewData(e.target.value)}
            placeholder="Data"
            className="flex-1 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-sm outline-none"
          />
          <button
            onClick={setValue}
            disabled={!connected || !newName.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Set
          </button>
        </div>
      </div>
    </div>
  );
}
