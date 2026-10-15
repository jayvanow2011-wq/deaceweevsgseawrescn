import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Bell, RefreshCw } from "lucide-react";

type AgentEvent = {
  id: string;
  kind: string;
  payload: Record<string, any>;
  created_at: string;
};

export function EventsPanel({ deviceId }: { deviceId: string }) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_events")
        .select("*")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      setEvents((data as AgentEvent[]) ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    load();
    // realtime subscription for new events
    const ch = supabase
      .channel(`agent-events-${deviceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_events",
          filter: `device_id=eq.${deviceId}`,
        },
        (p: any) => {
          setEvents((prev) => [p.new as AgentEvent, ...prev].slice(0, 200));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [deviceId, load]);

  const kindColor = (kind: string) => {
    if (kind.includes("login")) return "text-emerald-400";
    if (kind.includes("usb")) return "text-amber-400";
    if (kind.includes("process")) return "text-blue-400";
    if (kind.includes("network")) return "text-purple-400";
    if (kind.includes("geoip")) return "text-pink-400";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Event Stream
        </h3>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs transition hover:bg-accent disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
        <span className="ml-auto text-xs text-muted-foreground">{events.length} events</span>
      </div>

      <div className="max-h-[600px] overflow-auto rounded-xl border border-border/60 bg-card/60">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Bell className="mb-2 h-8 w-8" />
            <p className="text-sm">{loading ? "Loading events…" : "No events recorded yet"}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {events.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-3 transition hover:bg-muted/20">
                <span className={`mt-0.5 inline-block h-2 w-2 rounded-full ${kindColor(e.kind)} bg-current`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${kindColor(e.kind)}`}>{e.kind}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                  {Object.keys(e.payload).length > 0 && (
                    <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
