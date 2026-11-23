import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { queryClient } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Ligação ao vivo (WebSocket /ws). Quando o servidor avisa que uma encomenda mudou,
 * actualizamos os ecrãs que a mostram (os dados vêm sempre da API).
 * Se a ligação cair, volta a ligar sozinha (1 s, 2 s, 4 s… até 30 s) e, enquanto estiver em baixo,
 * os ecrãs continuam a consultar a API com a frequência de antes.
 */
type LiveEvent =
  | { type: "order"; id: number; status: string; at: string; step?: string }
  | { type: "location"; id: number; at: string }
  | { type: "offer"; id: number; offerId: number; status: "new" | "gone"; at: string }
  | { type: "dispatch"; id: number; status: "failed"; at: string }
  | { type: "hello"; channels: number };

const LiveContext = createContext(false);
let liveNow = false;
/**
 * Para refetchInterval do react-query: com ligação ao vivo só consulta de minuto a minuto (segurança);
 * sem ligação, volta à frequência normal. Ex.: refetchInterval: poll(5000)
 */
export const poll = (fallbackMs: number, liveMs = 60_000) => () => (liveNow ? liveMs : fallbackMs);

/** Intervalo de consulta: rápido sem ligação ao vivo, lento (só segurança) com ela. */
export function usePollInterval(fallbackMs: number, liveMs = 60_000) {
  const live = useContext(LiveContext);
  return live ? liveMs : fallbackMs;
}
export const useLive = () => useContext(LiveContext);

const ORDER_KEYS = /^\/api\/(orders|partner\/orders|partner\/stats|driver\/(available|current|history|earnings|offers)|admin\/(orders|dashboard|stats|dispatch))/;

function refreshOrders(id?: number) {
  void queryClient.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey[0] ?? "");
      return ORDER_KEYS.test(k) || (id !== undefined && k.startsWith(`/api/orders/${id}`));
    },
  });
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    if (!user || typeof WebSocket === "undefined") return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry.current = 0;
        liveNow = true;
        setConnected(true);
        refreshOrders(); // apanhar o que mudou enquanto estávamos desligados
      };
      ws.onmessage = (m) => {
        let ev: LiveEvent;
        try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === "order") refreshOrders(ev.id);
        else if (ev.type === "location") void queryClient.invalidateQueries({ queryKey: [`/api/orders/${ev.id}/tracking`] });
        else if (ev.type === "offer") {
          void queryClient.invalidateQueries({ queryKey: ["/api/driver/offers"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/driver/available"] });
        } else if (ev.type === "dispatch") {
          void queryClient.invalidateQueries({ predicate: (q) => /^\/api\/(driver\/available|admin\/(dispatch|orders|dashboard))/.test(String(q.queryKey[0])) });
        }
      };
      ws.onclose = () => {
        liveNow = false;
        setConnected(false);
        if (stopped) return;
        const wait = Math.min(30_000, 1000 * 2 ** retry.current++) + Math.random() * 500;
        timer = setTimeout(connect, wait);
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* já fechada */ } };
    };

    connect();
    // ao voltar à app (telemóvel desbloqueado), religar logo
    const onVisible = () => {
      if (document.visibilityState === "visible" && ws && ws.readyState === WebSocket.CLOSED) {
        clearTimeout(timer);
        retry.current = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
      liveNow = false;
      setConnected(false);
    };
  }, [user?.id]);

  return <LiveContext.Provider value={connected}>{children}</LiveContext.Provider>;
}
