/**
 * Recibe un formulario multipart EN FLUJO (SRV-01): cada archivo va directo a un temporal en disco, con su
 * sha256 calculado al pasar y el tope de tamaño comprobado mientras llega. `req.formData()` cargaba el
 * archivo entero en memoria (un video de 2 GB eran varios GB del servidor) y el tope se miraba al final.
 *
 * La UI sigue mandando un FormData normal: no cambia nada del lado del navegador.
 */
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type ArchivoRecibido = {
  /** Nombre del campo del formulario («archivo», «archivo-12»). */
  campo: string;
  /** Nombre del archivo tal como lo mandó el navegador. */
  nombre: string;
  /** Temporal en disco; quien llama lo renombra o lo borra. */
  ruta: string;
  bytes: number;
  sha256: string;
};

export type FormularioRecibido = { campos: Map<string, string>; archivos: ArchivoRecibido[] };

/**
 * Qué hacer con un archivo según su campo y nombre (se decide antes de escribir un solo byte):
 * `null` lo descarta; si no, el tope en bytes y el mensaje si se pasa. Lanzar aquí rechaza el pedido.
 */
export type ReglaArchivo = (campo: string, nombre: string) => { tope: number; mensaje: string } | null;

export type OpcionesMultipart = {
  /** Carpeta de los temporales (mejor en el mismo disco que el destino final, así renombrar es instantáneo). */
  dir: string;
  archivo: ReglaArchivo;
  /** Tope de cada campo de texto (por defecto 1 MB). */
  maxCampo?: number;
  /** Tope de partes (campos + archivos; por defecto 100). */
  maxPartes?: number;
};

const MAX_CABECERAS = 16 * 1024;

function limite(tipo: string | null): string {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(tipo ?? "");
  const b = m?.[1] ?? m?.[2];
  if (!/^multipart\/form-data/i.test(tipo ?? "") || !b) throw new Error("El pedido no trae un formulario con archivos.");
  return b;
}

function leerCabeceras(texto: string): { campo: string; nombre: string | null } {
  const disp = texto.split("\r\n").find((l) => /^content-disposition:/i.test(l));
  if (!disp) throw new Error("El formulario llegó mal armado (falta el nombre de un campo).");
  const valor = (clave: string) => {
    const m = new RegExp(`(?:^|;)\\s*${clave}="((?:[^"\\\\]|\\\\.)*)"`, "i").exec(disp) ?? new RegExp(`(?:^|;)\\s*${clave}=([^;\\s]+)`, "i").exec(disp);
    return m ? m[1]!.replace(/\\(.)/g, "$1").replace(/%22/g, '"') : null;
  };
  const campo = valor("name");
  if (campo === null) throw new Error("El formulario llegó mal armado (falta el nombre de un campo).");
  return { campo, nombre: valor("filename") };
}

/** Escribe respetando la contrapresión: si el disco va más lento, se espera en vez de llenar la memoria. */
function escribir(s: WriteStream, b: Buffer): Promise<void> {
  if (s.write(b)) return Promise.resolve();
  return new Promise((ok, mal) => {
    const fallo = (e: Error) => mal(e);
    s.once("error", fallo);
    s.once("drain", () => {
      s.off("error", fallo);
      ok();
    });
  });
}

function cerrar(s: WriteStream): Promise<void> {
  return new Promise((ok, mal) => {
    s.once("error", mal);
    s.end(() => ok());
  });
}

type Parte =
  | { tipo: "campo"; campo: string; trozos: Buffer[]; bytes: number }
  | { tipo: "archivo"; a: ArchivoRecibido; s: WriteStream; hash: ReturnType<typeof createHash>; tope: number; mensaje: string }
  | { tipo: "nada" };

/** Lee el cuerpo multipart de `req` en flujo. Si algo falla, borra los temporales que ya escribió. */
export async function recibirMultipart(req: Request, o: OpcionesMultipart): Promise<FormularioRecibido> {
  const b = limite(req.headers.get("content-type"));
  if (!req.body) throw new Error("No llegó el archivo");
  const maxCampo = o.maxCampo ?? 1024 ** 2;
  const maxPartes = o.maxPartes ?? 100;
  const delim = Buffer.from(`\r\n--${b}`);
  const campos = new Map<string, string>();
  const archivos: ArchivoRecibido[] = [];
  await fs.mkdir(o.dir, { recursive: true });

  // El primer «--límite» no lleva \r\n delante: se agrega para buscar siempre el mismo separador.
  let buf: Buffer = Buffer.from("\r\n");
  // En un objeto: TypeScript no sigue los cambios que hacen las funciones de abajo a variables sueltas.
  const m: { estado: "inicio" | "tras-limite" | "cabeceras" | "cuerpo" | "fin"; parte: Parte } = { estado: "inicio", parte: { tipo: "nada" } };
  let partes = 0;

  const volcar = async (datos: Buffer) => {
    if (!datos.length) return;
    if (m.parte.tipo === "campo") {
      m.parte.bytes += datos.length;
      if (m.parte.bytes > maxCampo) throw new Error(`El campo «${m.parte.campo}» es demasiado largo.`);
      m.parte.trozos.push(Buffer.from(datos));
    } else if (m.parte.tipo === "archivo") {
      m.parte.a.bytes += datos.length;
      if (m.parte.a.bytes > m.parte.tope) throw new Error(m.parte.mensaje);
      m.parte.hash.update(datos);
      await escribir(m.parte.s, datos);
    }
  };

  const terminarParte = async () => {
    if (m.parte.tipo === "campo") campos.set(m.parte.campo, Buffer.concat(m.parte.trozos).toString("utf8"));
    else if (m.parte.tipo === "archivo") {
      const p = m.parte;
      m.parte = { tipo: "nada" };
      await cerrar(p.s);
      p.a.sha256 = p.hash.digest("hex");
    }
    m.parte = { tipo: "nada" };
  };

  const empezarParte = async (cab: string) => {
    if (++partes > maxPartes) throw new Error("El formulario trae demasiadas partes.");
    const { campo, nombre } = leerCabeceras(cab);
    if (nombre === null) {
      m.parte = { tipo: "campo", campo, trozos: [], bytes: 0 };
      return;
    }
    const regla = o.archivo(campo, nombre);
    if (!regla) {
      m.parte = { tipo: "nada" };
      return;
    }
    const ruta = path.join(o.dir, `.subiendo-${randomBytes(6).toString("hex")}`);
    const a: ArchivoRecibido = { campo, nombre, ruta, bytes: 0, sha256: "" };
    archivos.push(a);
    m.parte = { tipo: "archivo", a, s: createWriteStream(ruta, { flags: "wx" }), hash: createHash("sha256"), tope: regla.tope, mensaje: regla.mensaje };
  };

  /** Avanza con lo que hay en `buf`; devuelve cuando hace falta leer más. */
  const avanzar = async () => {
    for (;;) {
      if (m.estado === "inicio" || m.estado === "cuerpo") {
        const i = buf.indexOf(delim);
        if (i < 0) {
          // Lo que seguro no es parte de un separador se vuelca ya; el resto espera al próximo trozo.
          const seguro = Math.max(0, buf.length - delim.length + 1);
          if (m.estado === "cuerpo") await volcar(buf.subarray(0, seguro));
          buf = buf.subarray(seguro);
          return;
        }
        if (m.estado === "cuerpo") {
          await volcar(buf.subarray(0, i));
          await terminarParte();
        }
        buf = buf.subarray(i + delim.length);
        m.estado = "tras-limite";
      }
      if (m.estado === "tras-limite") {
        if (buf.length < 2) return;
        if (buf[0] === 0x2d && buf[1] === 0x2d) {
          m.estado = "fin";
          return;
        }
        if (buf[0] !== 0x0d || buf[1] !== 0x0a) throw new Error("El formulario llegó mal armado.");
        buf = buf.subarray(2);
        m.estado = "cabeceras";
      }
      if (m.estado === "cabeceras") {
        const i = buf.indexOf("\r\n\r\n");
        if (i < 0) {
          if (buf.length > MAX_CABECERAS) throw new Error("El formulario llegó mal armado.");
          return;
        }
        await empezarParte(buf.subarray(0, i).toString("utf8"));
        buf = buf.subarray(i + 4);
        m.estado = "cuerpo";
      }
      if (m.estado === "fin") return;
    }
  };

  try {
    for await (const trozo of req.body as unknown as AsyncIterable<Uint8Array>) {
      buf = buf.length ? Buffer.concat([buf, trozo]) : Buffer.from(trozo);
      await avanzar();
      if (m.estado === "fin") break;
    }
    if (m.estado !== "fin") throw new Error("La subida se cortó antes de terminar. Prueba otra vez.");
    return { campos, archivos };
  } catch (e) {
    if (m.parte.tipo === "archivo") {
      const s = m.parte.s;
      // Se espera a que suelte el archivo (en Windows no se puede borrar uno abierto).
      if (!s.closed) await new Promise<void>((ok) => s.once("close", () => ok()).destroy());
    }
    await borrarRecibidos(archivos);
    throw e;
  }
}

/** Borra los temporales (cuando el pedido falla después de recibirlos). */
export async function borrarRecibidos(archivos: ArchivoRecibido[]): Promise<void> {
  await Promise.all(archivos.map((a) => fs.rm(a.ruta, { force: true }).catch(() => {})));
}
