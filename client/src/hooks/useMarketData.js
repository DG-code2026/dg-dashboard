import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = `ws://${window.location.hostname}:3001`;

export function useMarketData() {
  const [data, setData] = useState({});
  const [connected, setConnected] = useState(false);
  const [primaryConnected, setPrimaryConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('WS conectado al backend');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'snapshot') {
          const initial = {};
          msg.data.forEach((item) => {
            initial[item.symbol] = item;
          });
          setData((prev) => ({ ...prev, ...initial }));
        }

        if (msg.type === 'md_update') {
          setData((prev) => ({
            ...prev,
            [msg.symbol]: {
              symbol: msg.symbol,
              marketData: msg.marketData,
              timestamp: msg.timestamp,
            },
          }));
        }

        if (msg.type === 'status') {
          setPrimaryConnected(msg.connected);
        }
      } catch (err) {
        // ignore
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { data, connected, primaryConnected };
}
