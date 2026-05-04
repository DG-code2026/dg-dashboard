import { useState, useEffect, useRef, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const WS_URL = API_URL.replace(/^http/, 'ws');

export function useMarketData() {
  const [data, setData] = useState({});
  const [connected, setConnected] = useState(false);
  const [primaryConnected, setPrimaryConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'snapshot' && Array.isArray(msg.data)) {
          const snap = {};
          msg.data.forEach((d) => { snap[d.symbol] = d; });
          setData(snap);
        } else if (msg.type === 'md_update') {
          // Merge en lugar de reemplazar (matchea el comportamiento del server):
          // un md_update suele traer sólo los entries que cambiaron. Si
          // reemplazáramos, un tick con sólo CL borraría BI/OF/LA y las
          // tarjetas mostrarían "SIN DATOS". Mergeando, lo último conocido
          // de cada entry persiste hasta que llegue otro update explícito.
          setData((prev) => {
            const old = prev[msg.symbol]?.marketData || {};
            return {
              ...prev,
              [msg.symbol]: {
                symbol: msg.symbol,
                marketData: { ...old, ...msg.marketData },
                timestamp: msg.timestamp,
              },
            };
          });
        } else if (msg.type === 'status') {
          setPrimaryConnected(msg.connected);
        }
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return { data, connected, primaryConnected };
}
