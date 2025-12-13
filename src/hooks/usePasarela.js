import { useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

const PASARELA_URL = import.meta.env.VITE_PASARELA_URL || 'http://localhost:5000';

export function usePasarela(userId) {
  const [connected, setConnected] = useState(false);
  const [identified, setIdentified] = useState(false);
  const socketRef = useRef(null);
  const listenersRef = useRef(new Map());

  useEffect(() => {
    const socket = io(`${PASARELA_URL}/pasarela`, {
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Pasarela] Conectado:', socket.id);
      setConnected(true);
      
      if (userId) {
        socket.emit('identificar', userId, (ok) => {
          console.log('[Pasarela] Identificado:', userId);
          setIdentified(ok);
        });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[Pasarela] Desconectado:', reason);
      setConnected(false);
      setIdentified(false);
    });

    socket.on('connect_error', (error) => {
      console.error('[Pasarela] Error:', error.message);
    });

    socket.on('pasarela', (data) => {
      listenersRef.current.forEach((callback) => callback(data));
    });

    socket.on('notificar', (data) => {
      listenersRef.current.forEach((callback, key) => {
        if (key.startsWith('notificar:')) callback(data);
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [userId]);

  const enviar = useCallback((data, destino = 'nosotros') => {
    if (socketRef.current) {
      socketRef.current.emit('pasarela', { ...data, destino });
    }
  }, []);

  const enviarATodos = useCallback((data) => enviar(data, 'nosotros'), [enviar]);
  const enviarAOtros = useCallback((data) => enviar(data, 'ustedes'), [enviar]);
  const enviarAMi = useCallback((data) => enviar(data, 'yo'), [enviar]);

  const onMensaje = useCallback((callback) => {
    const key = `mensaje:${Date.now()}:${Math.random()}`;
    listenersRef.current.set(key, callback);
    return () => listenersRef.current.delete(key);
  }, []);

  return {
    connected,
    identified,
    enviar,
    enviarATodos,
    enviarAOtros,
    enviarAMi,
    onMensaje,
    socket: socketRef.current
  };
}

export default usePasarela;

