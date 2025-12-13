import { useState, useEffect, useMemo, useRef } from 'react';
import { usePasarela } from './hooks/usePasarela';
import './App.css';

const SESSION_ID = localStorage.getItem('colaSession') || (() => {
  const id = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('colaSession', id);
  return id;
})();

const TIPOS_TURNO = {
  CAJERO: 'cajero',
  EJECUTIVO: 'ejecutivo'
};

const ESTADOS_TURNO = {
  ESPERANDO: 'esperando',
  LLAMANDO: 'llamando',
  EN_ATENCION: 'en_atencion',
  ATENDIDO: 'atendido',
  CANCELADO: 'cancelado'
};

function App() {
  const { connected, enviarATodos, onMensaje } = usePasarela(SESSION_ID);
  
  const [vista, setVista] = useState('usuario'); // usuario, admin, operador
  const [tipoOperador, setTipoOperador] = useState(null); // cajero, ejecutivo
  const [miTurno, setMiTurno] = useState(null);
  const [cola, setCola] = useState([]);
  const [turnosAtendiendo, setTurnosAtendiendo] = useState(new Map());
  const [logs, setLogs] = useState([]);
  const [notificacion, setNotificacion] = useState(null);
  
  // Referencias para evitar dependencias en useEffect
  const miTurnoRef = useRef(miTurno);
  const vistaRef = useRef(vista);
  
  useEffect(() => {
    miTurnoRef.current = miTurno;
  }, [miTurno]);
  
  useEffect(() => {
    vistaRef.current = vista;
  }, [vista]);

  // Escuchar mensajes
  useEffect(() => {
    const unsubscribe = onMensaje((data) => {
      switch (data.tipo) {
        case 'nuevo_turno':
          setCola(prev => {
            const nuevaCola = [...prev, data.turno].sort((a, b) => a.numero - b.numero);
            return nuevaCola;
          });
          if (vistaRef.current === 'admin' || vistaRef.current === 'operador') {
            addLog(`🎫 Nuevo turno: ${data.turno.numero} - ${data.turno.tipo}`);
          }
          break;

        case 'turno_llamando':
          setCola(prev => prev.map(t => 
            t.id === data.turnoId 
              ? { ...t, estado: ESTADOS_TURNO.LLAMANDO, operador: data.operador }
              : t
          ));
          if (data.turnoId === miTurnoRef.current?.id) {
            setMiTurno(prev => prev ? { ...prev, estado: ESTADOS_TURNO.LLAMANDO, operador: data.operador } : null);
            setNotificacion({
              tipo: 'llamando',
              mensaje: `¡Tu turno ${data.numero} está siendo llamado!`,
              operador: data.operador
            });
            // Sonido de notificación (simulado con vibración si está disponible)
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          }
          break;

        case 'turno_en_atencion':
          setCola(prev => prev.map(t => 
            t.id === data.turnoId 
              ? { ...t, estado: ESTADOS_TURNO.EN_ATENCION }
              : t
          ));
          setTurnosAtendiendo(prev => {
            const nuevo = new Map(prev);
            nuevo.set(data.turnoId, data.turno);
            return nuevo;
          });
          if (data.turnoId === miTurnoRef.current?.id) {
            setMiTurno(prev => prev ? { ...prev, estado: ESTADOS_TURNO.EN_ATENCION } : null);
          }
          break;

        case 'turno_atendido':
          setCola(prev => prev.filter(t => t.id !== data.turnoId));
          setTurnosAtendiendo(prev => {
            const nuevo = new Map(prev);
            nuevo.delete(data.turnoId);
            return nuevo;
          });
          if (data.turnoId === miTurnoRef.current?.id) {
            setMiTurno(null);
            setNotificacion({
              tipo: 'atendido',
              mensaje: 'Tu turno ha sido atendido'
            });
          }
          addLog(`✅ Turno ${data.numero} atendido`);
          break;

        case 'turno_cancelado':
          setCola(prev => prev.filter(t => t.id !== data.turnoId));
          if (data.turnoId === miTurnoRef.current?.id) {
            setMiTurno(null);
          }
          break;

        case 'sync_cola':
          if (data.cola) {
            setCola(data.cola.sort((a, b) => a.numero - b.numero));
          }
          break;
      }
    });

    return unsubscribe;
  }, [onMensaje]);

  // Solicitar sincronización al conectar
  useEffect(() => {
    if (connected) {
      enviarATodos({ tipo: 'sync_request', sessionId: SESSION_ID });
      addLog('🟢 Conectado al sistema');
    }
  }, [connected, enviarATodos]);

  const addLog = (msg) => {
    setLogs(prev => [{
      time: new Date().toLocaleTimeString('es'),
      msg
    }, ...prev].slice(0, 20));
  };

  const pedirTurno = (tipo) => {
    const turno = {
      id: 'turno_' + Date.now(),
      numero: cola.length > 0 ? Math.max(...cola.map(t => t.numero)) + 1 : 1,
      tipo,
      estado: ESTADOS_TURNO.ESPERANDO,
      timestamp: Date.now(),
      sessionId: SESSION_ID
    };

    setMiTurno(turno);
    setCola(prev => [...prev, turno].sort((a, b) => a.numero - b.numero));
    
    enviarATodos({
      tipo: 'nuevo_turno',
      turno
    });

    addLog(`🎫 Turno ${turno.numero} solicitado (${tipo})`);
  };

  const llamarTurno = (turno) => {
    enviarATodos({
      tipo: 'turno_llamando',
      turnoId: turno.id,
      numero: turno.numero,
      operador: tipoOperador,
      tipoTurno: turno.tipo
    });

    addLog(`📢 Llamando turno ${turno.numero}`);
  };

  const iniciarAtencion = (turno) => {
    enviarATodos({
      tipo: 'turno_en_atencion',
      turnoId: turno.id,
      turno: { ...turno, estado: ESTADOS_TURNO.EN_ATENCION },
      operador: tipoOperador
    });

    setTurnosAtendiendo(prev => {
      const nuevo = new Map(prev);
      nuevo.set(turno.id, { ...turno, estado: ESTADOS_TURNO.EN_ATENCION });
      return nuevo;
    });

    addLog(`👤 Atendiendo turno ${turno.numero}`);
  };

  const finalizarAtencion = (turnoId) => {
    const turno = turnosAtendiendo.get(turnoId);
    if (!turno) return;

    enviarATodos({
      tipo: 'turno_atendido',
      turnoId,
      numero: turno.numero
    });

    setTurnosAtendiendo(prev => {
      const nuevo = new Map(prev);
      nuevo.delete(turnoId);
      return nuevo;
    });
  };

  const cancelarTurno = (turnoId) => {
    enviarATodos({
      tipo: 'turno_cancelado',
      turnoId
    });
  };

  const colaEsperando = useMemo(() => 
    cola.filter(t => t.estado === ESTADOS_TURNO.ESPERANDO),
    [cola]
  );

  const colaLlamando = useMemo(() => 
    cola.filter(t => t.estado === ESTADOS_TURNO.LLAMANDO),
    [cola]
  );

  const miPosicion = useMemo(() => {
    if (!miTurno) return null;
    return colaEsperando.findIndex(t => t.id === miTurno.id) + 1;
  }, [miTurno, colaEsperando]);

  // Cerrar notificación después de 5 segundos
  useEffect(() => {
    if (notificacion) {
      const timer = setTimeout(() => setNotificacion(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notificacion]);

  return (
    <div className="app">
      <header>
        <h1>🏦 Sistema de Cola de Turnos</h1>
        <p>Gestión de turnos en tiempo real</p>
        <div className={`status ${connected ? 'online' : ''}`}>
          <span className="dot"></span>
          {connected ? 'Conectado' : 'Desconectado'}
        </div>
      </header>

      <div className="tabs">
        <button 
          className={`tab ${vista === 'usuario' ? 'active' : ''}`}
          onClick={() => setVista('usuario')}
        >
          👤 Usuario
        </button>
        <button 
          className={`tab ${vista === 'admin' ? 'active' : ''}`}
          onClick={() => setVista('admin')}
        >
          📊 Administración
        </button>
        <button 
          className={`tab ${vista === 'operador' ? 'active' : ''}`}
          onClick={() => {
            if (!tipoOperador) {
              const tipo = prompt('Selecciona tipo de operador:\n1. Cajero\n2. Ejecutivo', '1');
              if (tipo === '1') setTipoOperador(TIPOS_TURNO.CAJERO);
              else if (tipo === '2') setTipoOperador(TIPOS_TURNO.EJECUTIVO);
              else return;
            }
            setVista('operador');
          }}
        >
          👨‍💼 Operador
        </button>
      </div>

      {/* Notificación flotante */}
      {notificacion && (
        <div className={`notificacion ${notificacion.tipo}`}>
          <div className="notif-icon">
            {notificacion.tipo === 'llamando' ? '🔔' : '✅'}
          </div>
          <div className="notif-content">
            <strong>{notificacion.mensaje}</strong>
            {notificacion.operador && (
              <span>Operador: {notificacion.operador}</span>
            )}
          </div>
          <button onClick={() => setNotificacion(null)}>✕</button>
        </div>
      )}

      {/* VISTA USUARIO */}
      {vista === 'usuario' && (
        <div className="vista-usuario">
          {!miTurno ? (
            <div className="panel">
              <h2>🎫 Solicitar Turno</h2>
              <p className="subtitle">Selecciona el tipo de atención que necesitas</p>
              
              <div className="tipos-turno">
                <button 
                  className="tipo-btn cajero"
                  onClick={() => pedirTurno(TIPOS_TURNO.CAJERO)}
                >
                  <div className="icon">💰</div>
                  <h3>Cajero</h3>
                  <p>Operaciones bancarias, depósitos, retiros</p>
                  <div className="tiempo-estimado">⏱️ ~5 min</div>
                </button>
                
                <button 
                  className="tipo-btn ejecutivo"
                  onClick={() => pedirTurno(TIPOS_TURNO.EJECUTIVO)}
                >
                  <div className="icon">👔</div>
                  <h3>Ejecutivo</h3>
                  <p>Atención personalizada, consultas, productos</p>
                  <div className="tiempo-estimado">⏱️ ~15 min</div>
                </button>
              </div>
            </div>
          ) : (
            <div className="panel">
              <h2>🎫 Tu Turno</h2>
              
              <div className="turno-card">
                <div className="turno-numero">{miTurno.numero}</div>
                <div className="turno-info">
                  <span className="turno-tipo">{miTurno.tipo === TIPOS_TURNO.CAJERO ? '💰 Cajero' : '👔 Ejecutivo'}</span>
                  <span className={`turno-estado ${miTurno.estado}`}>
                    {miTurno.estado === ESTADOS_TURNO.ESPERANDO && `⏳ Esperando (Posición ${miPosicion || '?'})`}
                    {miTurno.estado === ESTADOS_TURNO.LLAMANDO && '🔔 Siendo llamado'}
                    {miTurno.estado === ESTADOS_TURNO.EN_ATENCION && '👤 En atención'}
                  </span>
                </div>
              </div>

              {miTurno.estado === ESTADOS_TURNO.ESPERANDO && (
                <div className="tiempo-espera">
                  <p>Personas delante de ti: <strong>{miPosicion - 1 || 0}</strong></p>
                  <p>Tiempo estimado: <strong>~{(miPosicion - 1) * (miTurno.tipo === TIPOS_TURNO.CAJERO ? 5 : 15)} min</strong></p>
                </div>
              )}

              <button 
                className="btn-cancelar"
                onClick={() => {
                  cancelarTurno(miTurno.id);
                  setMiTurno(null);
                }}
              >
                Cancelar Turno
              </button>
            </div>
          )}

          <div className="panel">
            <h3>📋 Cola Actual</h3>
            <div className="cola-preview">
              {colaEsperando.length === 0 ? (
                <p className="empty">Sin turnos en espera</p>
              ) : (
                <div className="turnos-mini">
                  {colaEsperando.slice(0, 5).map(t => (
                    <span key={t.id} className={`mini-turno ${t.id === miTurno?.id ? 'mio' : ''}`}>
                      {t.numero}
                    </span>
                  ))}
                  {colaEsperando.length > 5 && (
                    <span className="mini-turno mas">+{colaEsperando.length - 5}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VISTA ADMIN */}
      {vista === 'admin' && (
        <div className="vista-admin">
          <div className="panel">
            <h2>📊 Panel de Administración</h2>
            
            <div className="stats">
              <div className="stat-card">
                <div className="stat-numero">{colaEsperando.length}</div>
                <div className="stat-label">En Espera</div>
              </div>
              <div className="stat-card llamando">
                <div className="stat-numero">{colaLlamando.length}</div>
                <div className="stat-label">Llamando</div>
              </div>
              <div className="stat-card atendiendo">
                <div className="stat-numero">{turnosAtendiendo.size}</div>
                <div className="stat-label">En Atención</div>
              </div>
            </div>

            <h3>🎫 Cola Completa</h3>
            <div className="cola-completa">
              {cola.length === 0 ? (
                <p className="empty">Sin turnos en el sistema</p>
              ) : (
                <div className="turnos-lista">
                  {cola.map(turno => (
                    <div key={turno.id} className={`turno-item ${turno.estado}`}>
                      <div className="turno-num">{turno.numero}</div>
                      <div className="turno-detalles">
                        <span className="turno-tipo-badge">
                          {turno.tipo === TIPOS_TURNO.CAJERO ? '💰' : '👔'} {turno.tipo}
                        </span>
                        <span className="turno-estado-badge">
                          {turno.estado === ESTADOS_TURNO.ESPERANDO && '⏳ Esperando'}
                          {turno.estado === ESTADOS_TURNO.LLAMANDO && `🔔 Llamando (${turno.operador})`}
                          {turno.estado === ESTADOS_TURNO.EN_ATENCION && `👤 En atención (${turno.operador})`}
                        </span>
                      </div>
                      <div className="turno-tiempo">
                        {new Date(turno.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VISTA OPERADOR */}
      {vista === 'operador' && tipoOperador && (
        <div className="vista-operador">
          <div className="panel">
            <h2>👨‍💼 Operador: {tipoOperador === TIPOS_TURNO.CAJERO ? '💰 Cajero' : '👔 Ejecutivo'}</h2>
            
            <div className="operador-acciones">
              <h3>🎫 Turnos Disponibles</h3>
              <div className="turnos-disponibles">
                {colaEsperando
                  .filter(t => t.tipo === tipoOperador)
                  .length === 0 ? (
                  <p className="empty">No hay turnos disponibles</p>
                ) : (
                  colaEsperando
                    .filter(t => t.tipo === tipoOperador)
                    .slice(0, 3)
                    .map(turno => (
                      <div key={turno.id} className="turno-disponible">
                        <div className="turno-num-grande">{turno.numero}</div>
                        <div className="turno-acciones">
                          <button 
                            className="btn-llamar"
                            onClick={() => llamarTurno(turno)}
                          >
                            📢 Llamar
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

            <div className="operador-acciones">
              <h3>🔔 Turnos Llamando</h3>
              <div className="turnos-llamando">
                {colaLlamando
                  .filter(t => t.tipo === tipoOperador && t.operador === tipoOperador)
                  .length === 0 ? (
                  <p className="empty">No hay turnos llamando</p>
                ) : (
                  colaLlamando
                    .filter(t => t.tipo === tipoOperador && t.operador === tipoOperador)
                    .map(turno => (
                      <div key={turno.id} className="turno-llamando-card">
                        <div className="turno-num-grande">{turno.numero}</div>
                        <button 
                          className="btn-atender"
                          onClick={() => iniciarAtencion(turno)}
                        >
                          ✅ Iniciar Atención
                        </button>
                      </div>
                    ))
                )}
              </div>
            </div>

            <div className="operador-acciones">
              <h3>👤 En Atención</h3>
              <div className="turnos-atendiendo">
                {Array.from(turnosAtendiendo.values())
                  .filter(t => t.tipo === tipoOperador)
                  .length === 0 ? (
                  <p className="empty">No hay turnos en atención</p>
                ) : (
                  Array.from(turnosAtendiendo.values())
                    .filter(t => t.tipo === tipoOperador)
                    .map(turno => (
                      <div key={turno.id} className="turno-atendiendo-card">
                        <div className="turno-info-atencion">
                          <div className="turno-num-grande">{turno.numero}</div>
                          <span className="tiempo-atencion">
                            {Math.floor((Date.now() - turno.timestamp) / 1000 / 60)} min
                          </span>
                        </div>
                        <button 
                          className="btn-finalizar"
                          onClick={() => finalizarAtencion(turno.id)}
                        >
                          ✅ Finalizar
                        </button>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logs */}
      <div className="panel logs-panel">
        <h3>📋 Actividad</h3>
        <div className="log-list">
          {logs.map((log, i) => (
            <div key={i} className="log-entry">
              <span className="time">{log.time}</span>
              <span>{log.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
