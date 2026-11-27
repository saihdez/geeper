"use client";
import { useEffect, useState } from "react";
import { AvisoPrivados } from "./aviso-privados";
import { AppsRedes } from "./apps-redes";
import { Aviso, Estado, fecha, pedir, useSondeo } from "./comun";

export interface RedInfo {
  id: string;
  nombre: string;
  configurada: boolean;
  formatos: string[];
  privacidades: string[];
  programar: boolean;
  callback: string;
}
export interface CuentaInfo {
  id: string;
  red: string;
  usuario: string;
  alias: string | null;
  avatarUrl: string | null;
  estado: string;
  expira: string | null;
  error: string | null;
  publicaciones: { id: string; estado: string; titulo: string; urlExterna: string | null; creado: string }[];
}
export interface Ajustes { vpn: "apagado" | "requerido"; ipEsperada: string; paisEsperado: string }
export interface Vpn {
  ok: boolean;
  estado: "activo" | "caido" | "sin_dato" | "apagado" | "sin_configurar";
  detalle: string;
  salida: { ip: string | null; pais: string | null; fuente: string | null; medido: string } | null;
}
export interface DatosCuentas { cuentas: CuentaInfo[]; redes: RedInfo[]; ajustes: Ajustes; vpn: Vpn; privadosBloquean?: boolean }

const ESTADO_VPN: Record<Vpn["estado"], { texto: string; color: string }> = {
  activo: { texto: "activo", color: "text-emerald-300" },
  caido: { texto: "caído", color: "text-red-300" },
  sin_dato: { texto: "sin dato", color: "text-amber-300" },
  apagado: { texto: "apagado (no requerido)", color: "text-tenue" },
  sin_configurar: { texto: "sin configurar", color: "text-amber-300" },
};


/**
 * El aviso del VPN con la hora de la medida: la lista de cuentas ya no mide en cada refresco (WEB-09),
 * así que la medida puede ser de hace un rato.
 */
export function textoVpn(vpn: Pick<Vpn, "detalle" | "salida">): string {
  return `${vpn.detalle}${vpn.salida?.medido ? ` · medido ${fecha(vpn.salida.medido)}` : ""}`;
}

function FormAjustes({ inicial, alGuardar }: { inicial: Ajustes; alGuardar: (v: { ajustes: Ajustes; vpn: Vpn }) => void }) {
  const [a, setA] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; t: string } | null>(null);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setMsg(null);
    try {
      const r = await pedir<{ ajustes: Ajustes; vpn: Vpn }>("/api/red", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(a) });
      setMsg({ tipo: "ok", t: "Ajustes guardados y salida medida de nuevo." });
      alGuardar(r);
    } catch (err) {
      setMsg({ tipo: "error", t: err instanceof Error ? err.message : String(err) });
    } finally {
      setGuardando(false);
    }
  }
  return (
    <form onSubmit={(e) => void guardar(e)} className="space-y-2 border-t border-borde pt-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="etiqueta" htmlFor="vpn-modo">VPN</label>
          <select id="vpn-modo" className="campo" value={a.vpn} onChange={(e) => setA({ ...a, vpn: e.target.value as Ajustes["vpn"] })}>
            <option value="apagado">Apagado: no se exige</option>
            <option value="requerido">Requerido: sin VPN no se publica ni se conecta</option>
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="vpn-ip">IP de salida esperada</label>
          <input id="vpn-ip" className="campo font-mono" value={a.ipEsperada} placeholder="203.0.113.7" inputMode="decimal" autoComplete="off"
            onChange={(e) => setA({ ...a, ipEsperada: e.target.value })} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="vpn-pais">País esperado (2 letras)</label>
          <input id="vpn-pais" className="campo font-mono uppercase" value={a.paisEsperado} placeholder="AR" maxLength={2} autoComplete="off"
            onChange={(e) => setA({ ...a, paisEsperado: e.target.value.toUpperCase() })} />
        </div>
      </div>
      <p className="text-xs text-tenue">Con «requerido» hace falta al menos la IP o el país. Geeper no levanta el túnel: lo vigila. El corte real lo hace WireGuard con «Block untunneled traffic».</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="boton boton-primario" disabled={guardando}>Guardar ajustes</button>
        {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
      </div>
    </form>
  );
}

function BarraVpn({ ajustes, vpn, alCambiar }: { ajustes: Ajustes; vpn: Vpn; alCambiar: () => void }) {
  const [medido, setMedido] = useState<{ ajustes: Ajustes; vpn: Vpn } | null>(null);
  const [midiendo, setMidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  // La medición forzada gana hasta que el sondeo traiga una más nueva.
  const actual = medido && (medido.vpn.salida?.medido ?? "") > (vpn.salida?.medido ?? "") ? medido.vpn : vpn;
  const e = ESTADO_VPN[actual.estado];
  async function medir() {
    setMidiendo(true);
    setError(null);
    try {
      setMedido(await pedir<{ ajustes: Ajustes; vpn: Vpn }>("/api/red"));
      alCambiar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMidiendo(false);
    }
  }
  return (
    <section className="tarjeta space-y-3 p-4" aria-labelledby="vpn-titulo">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="vpn-titulo" className="font-medium">VPN: <span className={e.color}>{e.texto}</span></h2>
        {actual.salida?.ip && <span className="font-mono text-sm text-tenue">{actual.salida.pais ?? "??"} · {actual.salida.ip}</span>}
        <div className="ml-auto flex gap-2">
          <button type="button" className="boton" disabled={midiendo} onClick={() => void medir()}>{midiendo ? "Midiendo…" : "Medir ahora"}</button>
          <button type="button" className="boton" aria-expanded={abierto} aria-controls="vpn-ajustes" onClick={() => setAbierto(!abierto)}>Ajustes</button>
        </div>
      </div>
      <p className="text-sm text-tenue">{textoVpn(actual)}</p>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {abierto && (
        <div id="vpn-ajustes">
          <FormAjustes inicial={medido?.ajustes ?? ajustes} alGuardar={(r) => { setMedido(r); alCambiar(); }} />
        </div>
      )}
    </section>
  );
}

function TarjetaCuenta({ c, red, puedeConectar, alCambiar, avisar }: {
  c: CuentaInfo; red: RedInfo; puedeConectar: boolean; alCambiar: () => void;
  avisar: (m: { tipo: "ok" | "error"; t: string }) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [alias, setAlias] = useState(c.alias ?? "");
  const [ocupado, setOcupado] = useState(false);
  const nombre = c.alias ?? c.usuario;

  async function hacer(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      avisar({ tipo: "ok", t: ok });
      alCambiar();
      return true;
    } catch (e) {
      avisar({ tipo: "error", t: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setOcupado(false);
    }
  }
  const renombrar = async () => {
    const hecho = await hacer(() => pedir(`/api/cuentas/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias }) }),
      alias.trim() ? `Ahora se llama «${alias.trim()}».` : "Alias quitado.");
    if (hecho) setEditando(false);
  };
  const desconectarla = () => {
    if (!confirm(`¿Desconectar ${nombre} de ${red.nombre}? Se revoca el permiso (si la red lo permite) y se borran los tokens. El historial de publicaciones se conserva.`)) return;
    void hacer(() => pedir(`/api/cuentas/${c.id}`, { method: "DELETE" }), `${nombre} quedó desconectada.`);
  };

  return (
    <li className="tarjeta flex gap-3 p-3">
      {c.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.avatarUrl} alt={`Foto de ${c.usuario}`} referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-full bg-slate-800 object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-800 text-lg" aria-hidden>{c.usuario.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{nombre}</span>
          {c.alias && <span className="text-sm text-tenue">{c.usuario}</span>}
          <Estado valor={c.estado} />
        </div>
        {editando && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void renombrar(); }}>
            <label className="sr-only" htmlFor={`alias-${c.id}`}>Alias de {c.usuario}</label>
            <input id={`alias-${c.id}`} className="campo min-w-0 flex-1 py-1" value={alias} maxLength={80} placeholder="GTA VI Shorts" onChange={(e) => setAlias(e.target.value)} />
            <button type="submit" className="boton boton-primario py-1" disabled={ocupado}>Guardar</button>
            <button type="button" className="boton py-1" onClick={() => { setAlias(c.alias ?? ""); setEditando(false); }}>Cancelar</button>
          </form>
        )}
        <p className="text-xs text-tenue">
          {c.estado === "desconectada" ? "Sin permiso: reconéctala para volver a publicar." : c.expira ? `El permiso actual vence ${fecha(c.expira)} (se renueva solo si la red lo permite).` : "El permiso no vence."}
        </p>
        {c.error && <p className="text-xs text-red-300">{c.error}</p>}
        {c.publicaciones.length > 0 && (
          <ul className="space-y-0.5 text-xs">
            {c.publicaciones.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <Estado valor={p.estado} />
                {p.urlExterna ? <a className="text-acento hover:underline" href={p.urlExterna} target="_blank" rel="noreferrer">{p.titulo}</a> : <span>{p.titulo}</span>}
                <span className="text-tenue">{fecha(p.creado)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {!editando && <button type="button" className="boton py-1" disabled={ocupado} onClick={() => setEditando(true)}>Renombrar</button>}
          {puedeConectar
            ? <a className={`boton py-1 ${c.estado !== "conectada" ? "boton-primario" : ""}`} href={`/api/cuentas/conectar/${red.id}?cuenta=${encodeURIComponent(c.id)}`}>Reconectar</a>
            : <button type="button" className="boton py-1" disabled>Reconectar</button>}
          {c.estado !== "desconectada" && <button type="button" className="boton boton-peligro py-1" disabled={ocupado} onClick={desconectarla}>Desconectar</button>}
        </div>
      </div>
    </li>
  );
}

function SeccionRed({ red, cuentas, vpn, bloqueada, alCambiar, avisar }: {
  red: RedInfo; cuentas: CuentaInfo[]; vpn: Vpn; bloqueada: boolean; alCambiar: () => void;
  avisar: (m: { tipo: "ok" | "error"; t: string }) => void;
}) {
  const puedeConectar = red.configurada && vpn.ok;
  return (
    <section className="space-y-3" aria-labelledby={`red-${red.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`red-${red.id}`} className="text-lg font-medium">{red.nombre}</h2>
        <span className="text-xs text-tenue">{red.formatos.join(" · ")}</span>
        {red.configurada && (
          puedeConectar
            ? <a className="boton boton-primario ml-auto" href={`/api/cuentas/conectar/${red.id}`}>Conectar {red.nombre}</a>
            : <button type="button" className="boton boton-primario ml-auto" disabled title={vpn.detalle}>Conectar {red.nombre}</button>
        )}
      </div>
      {!red.configurada && bloqueada && (
        <p className="text-sm text-amber-300">No disponible hasta que protejas tus datos de acceso (aviso de arriba).</p>
      )}
      {!red.configurada && !bloqueada && (
        <Aviso tipo="info">
          Falta la app de {red.nombre}: cárgala arriba, en «Apps de las redes» (o importa el archivo del equipo).
        </Aviso>
      )}
      {red.id === "youtube" && (
        // Exigido por las políticas para desarrolladores de los Servicios de API de YouTube.
        <p className="text-xs text-tenue">
          Geeper usa los Servicios de API de YouTube. Al conectar un canal aceptas los{" "}
          <a className="text-acento underline" href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">Términos del Servicio de YouTube</a>
          {" "}y la{" "}
          <a className="text-acento underline" href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Política de Privacidad de Google</a>.
          {" "}Puedes revocar el acceso cuando quieras con «Desconectar» o desde la{" "}
          <a className="text-acento underline" href="https://security.google.com/settings/security/permissions" target="_blank" rel="noreferrer">configuración de seguridad de Google</a>.
        </p>
      )}
      {red.configurada && !vpn.ok && <p className="text-xs text-amber-300">No se puede conectar ahora: {vpn.detalle}</p>}
      {cuentas.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {cuentas.map((c) => <TarjetaCuenta key={c.id} c={c} red={red} puedeConectar={puedeConectar} alCambiar={alCambiar} avisar={avisar} />)}
        </ul>
      ) : red.configurada && <p className="text-sm text-tenue">Sin cuentas conectadas.</p>}
    </section>
  );
}

export function Cuentas({ ok, error, aviso }: { ok: string | null; error: string | null; aviso: string | null }) {
  const { datos, error: errorCarga, recargar } = useSondeo<DatosCuentas>("/api/cuentas", 30_000);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; t: string } | null>(null);
  const [vuelta] = useState(() => ({ ok, error, aviso }));

  // El resultado del OAuth llega en la URL: se muestra una vez y se limpia para que no quede al recargar.
  useEffect(() => {
    if (ok || error || aviso) window.history.replaceState(null, "", "/cuentas");
  }, [ok, error, aviso]);

  const n = Number(vuelta.ok);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Cuentas conectadas</h1>
        <p className="text-sm text-tenue">
          Las cuentas se crean a mano en el navegador; aquí se conectan con el inicio de sesión oficial de cada red. Geeper nunca muestra ni guarda los tokens sin cifrar.
        </p>
      </header>
      {vuelta.ok && <Aviso tipo="ok">{n === 1 ? "Se conectó 1 cuenta." : `Se conectaron ${n} cuentas.`}</Aviso>}
      {vuelta.aviso && <Aviso tipo="alerta">{vuelta.aviso}</Aviso>}
      {vuelta.error && <Aviso tipo="error">No se pudo conectar: {vuelta.error}</Aviso>}
      {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
      {errorCarga && !datos && <Aviso tipo="error">{errorCarga}</Aviso>}
      {!datos && !errorCarga && <p className="text-tenue">Cargando…</p>}
      {datos && (
        <>
          <AvisoPrivados alCambiar={() => void recargar()} />
          <BarraVpn ajustes={datos.ajustes} vpn={datos.vpn} alCambiar={() => void recargar()} />
          <AppsRedes alCambiar={() => void recargar()} />
          {datos.redes.map((r) => (
            <SeccionRed key={r.id} red={r} cuentas={datos.cuentas.filter((c) => c.red === r.id)} vpn={datos.vpn} bloqueada={!!datos.privadosBloquean} alCambiar={() => void recargar()} avisar={setMsg} />
          ))}
        </>
      )}
    </div>
  );
}
