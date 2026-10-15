import { useState } from "react";
import { toast } from "sonner";
import { useDeviceCommands } from "@/hooks/use-device-commands";
import { Mic, MicOff, Volume2, VolumeX, RefreshCw, Speaker } from "lucide-react";

type AudioDevice = { id: string; name: string; kind: "input" | "output"; default: boolean };

export function AudioPanel({ deviceId }: { deviceId: string }) {
  const { send, connected } = useDeviceCommands(deviceId);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState<number | null>(null);
  const [micListening, setMicListening] = useState(false);

  const loadDevices = async () => {
    setBusy(true);
    try {
      const r = await send("audio.devices");
      setDevices((r.result?.devices as AudioDevice[]) ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const getVolume = async () => {
    try {
      const r = await send("audio.volume.get");
      setVolume(r.result?.volume ?? null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const setVolumeRemote = async (v: number) => {
    try {
      await send("audio.volume.set", { volume: v });
      setVolume(v);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const toggleMic = async () => {
    try {
      if (micListening) {
        await send("audio.mic.stop");
        setMicListening(false);
        toast.info("Mic stream stopped");
      } else {
        await send("audio.mic.start");
        setMicListening(true);
        toast.info("Mic stream started — audio playback coming soon");
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
            Audio Devices
          </h3>
          <button
            onClick={loadDevices}
            disabled={!connected || busy}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs transition hover:bg-accent disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Detect
          </button>
        </div>
        {devices.length > 0 ? (
          <div className="grid gap-2">
            {devices.map((d, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-4 py-2.5 text-sm"
              >
                {d.kind === "input" ? (
                  <Mic className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Speaker className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="flex-1 font-medium">{d.name}</span>
                <span className="text-xs text-muted-foreground">{d.kind}</span>
                {d.default && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                    Default
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click Detect to find audio devices.</p>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card/60 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Volume
        </h3>
        <div className="flex items-center gap-3">
          <VolumeX className="h-4 w-4 text-muted-foreground" />
          <input
            type="range"
            min={0}
            max={100}
            value={volume ?? 50}
            onChange={(e) => setVolumeRemote(Number(e.target.value))}
            className="flex-1"
            disabled={!connected}
          />
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <span className="w-10 text-right font-mono text-sm">{volume ?? "—"}%</span>
          <button
            onClick={getVolume}
            disabled={!connected}
            className="rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
          >
            Get
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/60 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Microphone Listen
        </h3>
        <button
          onClick={toggleMic}
          disabled={!connected}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-40 ${
            micListening
              ? "bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20"
              : "bg-primary/10 text-primary border border-primary/40 hover:bg-primary/20"
          }`}
        >
          {micListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {micListening ? "Stop Listening" : "Start Listening"}
        </button>
        {micListening && (
          <p className="mt-2 text-xs text-muted-foreground animate-pulse">
            🎙 Mic stream active — audio will play through your speakers when the playback module is ready.
          </p>
        )}
      </div>
    </div>
  );
}
