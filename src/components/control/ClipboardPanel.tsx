import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Clipboard, ClipboardCopy, Eye, EyeOff, RefreshCw } from "lucide-react";

export function ClipboardPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [newText, setNewText] = useState("");
  const [watching, setWatching] = useState(false);

  const getClipboard = useCallback(async () => {
    setBusy(true);
    try {
      const r = await send("clipboard.get");
      setContent(r.result?.text ?? "");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }, [send]);

  useEffect(() => {
    if (connected) getClipboard();
  }, [connected, getClipboard]);

  const setClipboard = async () => {
    if (!newText.trim()) return;
    setBusy(true);
    try {
      await send("clipboard.set", { text: newText });
      toast.success("Clipboard updated on remote device");
      setContent(newText);
      setNewText("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleWatch = async () => {
    try {
      if (watching) {
        await send("clipboard.watch.stop");
        setWatching(false);
        toast.info("Clipboard watching stopped");
      } else {
        await send("clipboard.watch.start");
        setWatching(true);
        toast.info("Watching clipboard changes…");
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Remote Clipboard
          </h3>
          <button
            onClick={getClipboard}
            disabled={!connected || busy}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs transition hover:bg-accent disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button
            onClick={toggleWatch}
            disabled={!connected}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition disabled:opacity-40 ${
              watching
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/60 hover:bg-accent"
            }`}
          >
            {watching ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {watching ? "Stop Watch" : "Watch"}
          </button>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/60 p-4">
          <label className="mb-1 block text-xs text-muted-foreground">Current content</label>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/30 p-3 font-mono text-sm">
            {content || "(empty)"}
          </pre>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/60 p-4">
        <label className="mb-1 block text-xs text-muted-foreground">Set clipboard text</label>
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Paste or type text to send to the remote clipboard…"
          rows={3}
          className="w-full rounded-lg border border-border/60 bg-muted/20 p-3 text-sm outline-none placeholder:text-muted-foreground/60"
        />
        <button
          onClick={setClipboard}
          disabled={!connected || busy || !newText.trim()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition hover:bg-primary/20 disabled:opacity-40"
        >
          <ClipboardCopy className="h-3 w-3" /> Set Clipboard
        </button>
      </div>
    </div>
  );
}
