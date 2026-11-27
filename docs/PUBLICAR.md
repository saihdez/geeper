# Geeper — publicar en redes (cuentas conectadas, VPN y selector de cuenta)

<!-- borrador: 2026-11-18 · M5 propuesto -->

## 1. Qué se agrega

Hasta M4, Geeper entrega un MP4 aprobado por el QC y ahí termina. Con M5 lo **sube a la red y a la
cuenta que la persona elija**:

1. **Cuentas conectadas.** La persona crea sus cuentas a mano, en el navegador, como siempre. Después
   las **conecta** a Geeper con el inicio de sesión oficial de cada red (OAuth). Se pueden conectar
   varias cuentas por red.
2. **Salida por VPN.** Todo el tráfico de Geeper hacia las redes sale por un túnel WireGuard. El
   corte lo hace el propio WireGuard («Block untunneled traffic»): si el VPN se cae, no sale nada
   por la IP de la casa. Geeper vigila la salida y no encola llamadas mientras el VPN esté caído.
3. **Selector de cuenta al publicar.** En la página del proyecto, un panel «Publicar» lista las cuentas
   conectadas que admiten ese formato. La persona marca una o varias, ajusta título, descripción y
   privacidad, y aprieta Publicar. Cada cuenta se vuelve un trabajo de la cola.

**Fuera de alcance:** crear cuentas automáticamente, darle a cada cuenta su propia IP o su propia
huella de navegador, y cualquier automatización del sitio web de una red (sin API oficial). Las
cuentas las crea y las maneja una persona, y Geeper sólo usa las APIs oficiales.

## 2. Principios (los mismos de `PRODUCTO.md`, aplicados aquí)

- **La persona aprueba, la máquina publica.** Nada se sube sin un clic en «Publicar». La privacidad
  por defecto es **privado** (o borrador en TikTok) hasta que la persona elija otra cosa.
- **Sólo se publica un render aprobado** (`Render.estado = "aprobado"`, QC sin errores).
- **Reanudable.** La subida es por partes y guarda la URL de la sesión de subida en el payload. Si
  Windows se reinicia, el trabajo retoma desde el último fragmento confirmado y no vuelve a subir el
  video entero ni lo publica dos veces.
- **US$0 al mes.** YouTube, TikTok e Instagram/Facebook tienen APIs gratuitas. X queda fuera porque
  su API para publicar es de pago.
- **Los secretos nunca entran al repo ni a la base sin cifrar** (§6).

## 3. Redes y lo que pide cada una

| Red | API | Permiso (scope) | Varias cuentas | Límite principal | Trámite |
|---|---|---|---|---|---|
| YouTube | Data API v3, `videos.insert` (subida reanudable) | `youtube.upload` y `youtube.readonly` | Un login de Google puede tener varios **canales** (cuentas de marca). Se elige el canal en la pantalla de Google y cada canal es una `Cuenta` | Cuota diaria del proyecto de Google Cloud: alcanza para pocas subidas al día. Revisar el costo vigente de `videos.insert` en la consola | Sin auditoría de la API, los videos quedan **privados**. Si la app de OAuth está en modo *Testing*, el refresh token vence a los **7 días**: hay que pasarla a *Producción* (sin verificar, hasta 100 usuarios, con pantalla de aviso) |
| TikTok | Content Posting API, con Login Kit para **escritorio** (redirect a `localhost`, PKCE obligatorio) | `video.upload` (borrador) y `video.publish` (publicación directa) | Una cuenta por login. Para agregar otra hay que cerrar la sesión de TikTok en el navegador o usar una ventana privada | Límite de publicaciones por día y por cuenta | Sin auditoría, la publicación directa sólo admite `SELF_ONLY` (privado). Mientras tanto se usa el modo **borrador**: el video llega a la bandeja de la app y se publica desde el teléfono |
| Instagram | Instagram API con **login de Instagram**, Reels por subida reanudable (`upload_type=resumable`) | `instagram_business_basic` e `instagram_business_content_publish` | Cada cuenta **profesional** (Business o Creator) se conecta por separado. No hace falta una página de Facebook | 50 publicaciones cada 24 h por cuenta según la referencia de la API (la guía dice 100). Se usa lo que devuelva `content_publishing_limit` | Revisión de la app por Meta para el acceso avanzado. Mientras no esté aprobada, sólo funciona con las cuentas agregadas como probadoras de la app |
| Facebook (páginas) | Graph API con **login de Facebook**, Reels o videos de página | `pages_show_list` y `pages_manage_posts` | Un login trae todas las páginas que administra la persona y cada página es una `Cuenta` | — | La misma revisión de Meta |

Instagram y Facebook son **dos redes separadas** en Geeper, cada una con su propio flujo de OAuth y su
propio callback: el login de Instagram no trae páginas de Facebook y el de Facebook sólo trae las
cuentas de Instagram vinculadas a una página.

**Hay que verificar los números contra la documentación vigente al implementar.** Las cuotas y los
nombres de scope de estas APIs cambian seguido. El `doctor` muestra lo que reporte cada API (§10).

## 4. Flujo de la persona

**Conectar una cuenta:**
1. Crea la cuenta a mano en el navegador (con el VPN encendido, si quiere salir por el mismo país).
2. En Geeper, página **Cuentas** → «Conectar YouTube» (o la red que sea).
3. Se abre la pantalla oficial de la red. Elige la cuenta o el canal y acepta los permisos.
4. Vuelve a Geeper. La cuenta aparece con su foto, su @, la red y la fecha en que vence el permiso.
   Se le puede poner un **alias** («GTA VI Shorts», «Farol»).
5. Para agregar otra cuenta de la misma red, repite el proceso. Geeper siempre pide
   `prompt=select_account` (o el equivalente de cada red) para que no reuse la sesión anterior sin
   preguntar.

**Publicar:**
1. Proyecto → render aprobado → panel **Publicar**.
2. Ve sólo las cuentas compatibles con el formato del render: 9:16 → Shorts, TikTok, Reels de
   Instagram y Reels de página de Facebook; 16:9 → YouTube; 1:1 → YouTube e Instagram. (Los videos
   16:9 de página de Facebook quedan para después: la API de Reels sólo admite vertical.)
3. Marca las cuentas. Por cada una ajusta el título (precargado con el nombre del proyecto), la
   descripción y los hashtags (precargados desde la plantilla), la privacidad y, opcionalmente, una
   hora programada. Debajo, cada cuenta muestra «✓ Título y descripción listos» o lo que la red
   recortaría o ignoraría (aviso) y lo que rechazaría (error: no deja publicar), con un botón para
   arreglarlo cuando Geeper puede (`src/lib/redes/revision-texto.ts`). También avisa si el título ya
   se usó en esa cuenta, en cualquier proyecto. «✨ Sugerir título, descripción y hashtags» los escribe
   con el modelo local de MPT a partir de lo que dice el video (`src/lib/texto-publicacion.ts`: largo según
   la duración, sin hashtags de relleno, con el crédito del creador si es un clip); reemplaza lo escrito
   y la persona lo revisa antes de publicar. Usa la GPU un momento: si está ocupada, lo dice.
4. Aprieta «Publicar». Se encola un trabajo `publicar.subir` por cuenta.
5. En **Trabajos** se ve el progreso de la subida. Al terminar, el proyecto muestra el enlace al
   video en cada red.

**Si un permiso vence o se revoca:** la cuenta queda en estado `reconectar`, el trabajo falla con ese
mensaje y el panel ofrece «Reconectar», que repite el flujo de conexión sobre la misma `Cuenta`.

## 5. Modelo de datos (Prisma)

```prisma
/// Una cuenta o un canal conectado por OAuth. Los tokens se guardan cifrados (§6).
model Cuenta {
  id            String        @id @default(cuid())
  /// youtube | tiktok | instagram | facebook
  red           String
  /// id de la cuenta en la red (channelId, open_id, ig user id, page id)
  externoId     String
  usuario       String        // @handle o nombre del canal
  alias         String?       // nombre interno: «GTA VI Shorts»
  avatarUrl     String?
  /// conectada | reconectar | desconectada
  estado        String        @default("conectada")
  scopes        String        // separados por espacio, como los devuelve la red
  accesoCifrado String?       // access token o token de página, AES-256-GCM (null al desconectar)
  refrescoCifrado String?     // refresh token
  expira        DateTime?
  error         String?       // último motivo de «reconectar», sin tokens
  /// Plantilla de Geeper que se sugiere publicar aquí (opcional).
  plantilla     String?
  creado        DateTime      @default(now())
  actualizado   DateTime      @updatedAt
  publicaciones Publicacion[]

  @@unique([red, externoId])
}

// Cambios a modelos existentes (M5.0):
// Render  suma  hash      String?   // sha256 del MP4, se calcula al aprobar
// Trabajo suma  noAntesDe DateTime? // reclamar() no lo toma antes de esta hora (esperas por VPN o cuota)

/// Un render subido (o por subir) a una cuenta.
model Publicacion {
  id          String    @id @default(cuid())
  proyectoId  String
  renderId    String
  cuentaId    String
  /// pendiente | subiendo | procesando | publicada | borrador | fallida | cancelada
  estado      String    @default("pendiente")
  titulo      String
  descripcion String
  /// publico | no_listado | privado | borrador
  privacidad  String    @default("privado")
  programada  DateTime?
  idExterno   String?   // videoId, publish_id, media id
  urlExterna  String?
  error       String?
  trabajoId   String?
  creado      DateTime  @default(now())
  actualizado DateTime  @updatedAt
  cuenta      Cuenta    @relation(fields: [cuentaId], references: [id])
  proyecto    Proyecto  @relation(fields: [proyectoId], references: [id], onDelete: Cascade)

  /// Evita subir el mismo render dos veces a la misma cuenta por un doble clic.
  @@unique([renderId, cuentaId])
}
```

`Proyecto` suma `publicaciones Publicacion[]`. Si se quiere volver a subir el mismo render a la misma
cuenta, la persona tiene que borrar o marcar `cancelada` la publicación anterior. Es intencional.

## 6. Secretos y tokens

- **Credenciales de cada app de OAuth** (client id y client secret de Google, TikTok y Meta): van en
  `~/.config/geeper/redes.json`, fuera del repo, con permisos `600`. Se cargan desde `src/lib/redes/config.ts`.
  `doctor` avisa si falta alguna, sin mostrar su contenido.
- **Clave de cifrado de tokens**: está en `~/.config/geeper/clave` (32 bytes aleatorios, se crea en el
  primer `pnpm run setup`; ojo: `pnpm setup` a secas corre el comando propio de pnpm, no el script). Los tokens se cifran con AES-256-GCM y un nonce por campo. Sin la clave, la
  base no sirve para tomar las cuentas.
- **El estado de OAuth** (`state` y el `code_verifier` de PKCE) se guarda en una cookie firmada y
  `httpOnly` que dura 10 minutos, y se valida al volver.
- **Ningún token sale por la API de Geeper ni aparece en los logs.** Se agrega en M5.0 (hoy no existe)
  un filtro (`src/lib/redes/secretos.ts`) por el que pasan el log de cada trabajo, los errores que se
  guardan en la base y los mensajes de la API, y que tapa `access_token`,
  `refresh_token`, `code`, `Authorization` y las URLs de sesión de subida.
- **Desconectar** revoca el token en la red (cuando la red ofrece ese endpoint), borra los tokens
  cifrados y deja la `Cuenta` en `desconectada` para no perder el historial de publicaciones.

## 7. Redirect URIs y dominio

| Red | Redirect | Nota |
|---|---|---|
| Google | `http://localhost:3300/api/cuentas/callback/youtube` | Google acepta `localhost` en clientes de tipo web |
| TikTok | `http://localhost:3300/api/cuentas/callback/tiktok` | Login Kit para escritorio: sólo `localhost` o `127.0.0.1`, con puerto, sin parámetros en la URI y con PKCE |
| Instagram | `http://localhost:3300/api/cuentas/callback/instagram` en modo desarrollo | Para la revisión de Meta puede pedir HTTPS (verificar al iniciarla) |
| Facebook | `http://localhost:3300/api/cuentas/callback/facebook` en modo desarrollo | Ídem |

No hace falta ningún reenviador ni dominio propio para los callbacks. El dominio de Dimerso sólo se
necesita para la política de privacidad que pide la revisión de Meta.

## 8. VPN integrado

### Cómo funciona

- **WireGuard en Windows** con el cliente oficial y un único túnel (`geeper.conf`), de cualquier
  proveedor que entregue configuraciones WireGuard o de un VPS propio. Como WSL sale a internet por
  Windows, Geeper, el worker y el navegador quedan todos detrás del mismo túnel. Así, crear cuentas a
  mano y publicar salen por la misma IP.
- **Una IP fija y un mismo país.** Se elige un servidor fijo y no se rota. Si las redes ven logins y
  subidas desde IPs que cambian a cada rato, piden verificaciones extra y aumentan las suspensiones.
- **Geeper no levanta el túnel; lo vigila.** Levantar WireGuard requiere permisos de administrador en
  Windows y no corresponde al worker.
- **El corte real es de WireGuard.** El túnel lleva `AllowedIPs = 0.0.0.0/0, ::/0` y la casilla «Block
  untunneled traffic (kill-switch)» marcada. Si el túnel cae a mitad de una subida, la conexión se corta
  en vez de seguir por la IP de la casa. Un chequeo desde la app no alcanza: la IP puede cambiar entre
  el chequeo y la llamada.

### Lo que Geeper agrega

1. **Ajuste `red.vpn`** en la barra de VPN de la página Cuentas: `apagado` | `requerido`, más el país
   o la IP esperada (se guardan en `Sistema`: `red.vpn`, `red.ipEsperada`, `red.paisEsperado`).
2. **Chequeo de salida** (`src/lib/redes/salida.ts`): consulta la IP pública y el país, guarda el
   resultado en `Sistema` (clave `red.salida`) por **60 s** y lo muestra en la barra de Cuentas como «VPN:
   activo · AR · 203.0.113.7» o «VPN: caído». Si el servicio de IP no responde, el resultado es «sin
   dato», no «caído», y se prueba un segundo servicio antes de frenar nada.
3. **Espera por VPN.** Con `red.vpn = requerido`, el ejecutor de `publicar.subir` revisa la salida al
   empezar y antes de cada etapa (no antes de cada fragmento). Si no es la esperada, el trabajo **no
   falla: vuelve a `pendiente`** con la etapa «Esperando VPN» y `noAntesDe = ahora + 60 s`, sin gastar
   intentos (§9). El botón «Conectar cuenta» se deshabilita con el mismo motivo.
4. **Sin proxy.** Geeper no maneja proxies: todo sale por el túnel del sistema. Un proxy por app
   obligaría a que todas las llamadas usen el mismo agente HTTP (las librerías de Google no lo harían)
   y duplicaría lo que ya hace WireGuard.
5. **`doctor`** reporta el estado del VPN y la IP de salida.

## 9. Cola y ejecutor

Se agrega un motor `red` en `src/lib/cola.ts`, sin GPU, así no compite con el render:

```ts
"publicar.subir": { motor: "red", usaGpu: false, nombre: "Publicar en red" },
```

`MOTORES` suma `"red"` y `worker/ejecutores.ts` suma el ejecutor. Pasos del trabajo, cada uno
idempotente:

| Etapa | Qué hace | Lo que guarda en el payload |
|---|---|---|
| Verificar | Render aprobado, archivo con `Render.hash` esperado, cuenta `conectada`, VPN ok | — |
| Token | Refresca el access token si vence en menos de 5 min | (el token nuevo se guarda cifrado en `Cuenta`) |
| Iniciar subida | Abre la sesión reanudable en la red | `sesionSubida` (URL o `publish_id`), `bytesConfirmados: 0` |
| Subir | Envía fragmentos de 8 MB y actualiza `progreso`. Al reanudar, pregunta a la red cuántos bytes tiene y sigue desde ahí | `bytesConfirmados`, `tamFragmento` |
| Procesar | Consulta el estado del procesamiento hasta que la red lo da por listo (TikTok, Instagram) | `idExterno` |
| Publicar | Instagram: `media_publish` del contenedor. YouTube: ya queda publicado al terminar la subida. TikTok: borrador o publicación directa según la auditoría | `urlExterna` |

Detalles por red:
- **YouTube:** los fragmentos tienen que ser múltiplos de 256 KiB (8 MiB lo es). Para reanudar se manda
  un `PUT` vacío con `Content-Range: bytes */<total>`: devuelve `308` con los bytes recibidos, o `200/201`
  con el video si la subida ya había terminado.
- **TikTok:** `FILE_UPLOAD` fija `chunk_size` y `total_chunk_count` al iniciar (fragmentos de 5 a 64 MB,
  el último hasta 128 MB, enviados en orden), así que el tamaño de fragmento se guarda en el payload y no
  cambia al reanudar. La documentación no describe cómo reanudar; el estado del post informa
  `uploaded_bytes`. **Verificar en M5.2** si se puede seguir desde ahí. Si no se puede, reanudar = iniciar
  una sesión nueva, lo que es seguro porque la sesión anterior nunca llegó a publicarse.
- **Instagram:** el id del contenedor se guarda en el payload **apenas se crea**. Antes de `media_publish`
  se consulta el `status_code` del contenedor: si ya es `PUBLISHED`, se busca el media publicado y se
  cierra sin volver a publicar. Así un corte entre `media_publish` y el guardado no duplica el Reel.
| Cerrar | `Publicacion.estado` = `publicada` o `borrador` | — |

Reglas:
- Si el payload ya tiene `idExterno`, **nunca** se vuelve a iniciar una subida (evita duplicados tras
  un reinicio).
- Un 401 refresca el token una vez. Si falla de nuevo, la cuenta pasa a `reconectar`.
- Los 429 y la cuota agotada dejan el trabajo `pendiente` con `noAntesDe` en la hora de reinicio de la
  cuota, sin gastar intentos.

**Cambios a la cola (M5.0).** Hoy `reclamar()` toma cualquier trabajo `pendiente` del motor y suma
`intentos` en cada reclamo, y `encolar()` fija `maxIntentos: 1`. Para que las esperas funcionen:
- `reclamar()` sólo toma trabajos con `noAntesDe` nulo o ya pasado.
- Una función `esperar(id, hasta, etapa)` devuelve el trabajo a `pendiente`, fija `noAntesDe` y **resta**
  el intento que sumó el reclamo, en la misma actualización. Los ejecutores existentes no cambian.
- El resto de los errores de la red se guardan tal cual en `Publicacion.error`, sin tokens.

### Adaptadores

```
src/lib/redes/
  config.ts       credenciales de las apps (desde ~/.config/geeper/redes.json)
  cifrado.ts      AES-256-GCM de tokens
  salida.ts       chequeo de IP y VPN
  secretos.ts     filtro que tapa tokens en logs y errores
  oauth.ts        PKCE, state y canje de código (común)
  tipos.ts        interfaz Red
  youtube.ts
  tiktok.ts
  instagram.ts    login de Instagram, Reels
  facebook.ts     login de Facebook, páginas
  cuentas.ts      guardar, descifrar, refrescar y desconectar cuentas
  publicar.ts     ejecutor de publicar.subir (independiente de la red)
  http.ts         errores clasificados (auth | cuota | red) y lectura del archivo por tramos
src/app/api/cuentas/route.ts                      GET lista, sin tokens, con el estado del VPN
src/app/api/cuentas/conectar/[red]/route.ts       arma la URL de OAuth y redirige (?cuenta= para reconectar)
src/app/api/cuentas/callback/[red]/route.ts       canjea el código y crea o actualiza las Cuentas
src/app/api/cuentas/[id]/route.ts                 PATCH alias o plantilla, DELETE desconectar
src/app/api/red/route.ts                          GET mide la salida ahora, PATCH ajustes del VPN
src/app/api/proyectos/[id]/publicar/route.ts      POST { renderId, destinos: [{ cuentaId, titulo, ... }] }
src/app/api/publicaciones/[id]/route.ts           POST { accion: reintentar | cancelar }
src/app/cuentas/page.tsx
src/components/cuentas.tsx
src/components/panel-publicar.tsx
```

```ts
// src/lib/redes/tipos.ts
export interface Red {
  id: "youtube" | "tiktok" | "instagram" | "facebook";
  formatos: Array<"shorts-9x16" | "youtube-16x9" | "cuadrado-1x1">;
  urlConexion(state: string, codeChallenge: string): string;
  canjear(code: string, codeVerifier: string): Promise<CuentaNueva[]>; // un login puede traer varias
  refrescar(cuenta: CuentaDescifrada): Promise<Tokens>;
  iniciarSubida(c: CuentaDescifrada, archivo: ArchivoVideo, meta: MetaPublicacion): Promise<Sesion>;
  subirFragmento(s: Sesion, desde: number, datos: Buffer): Promise<number>; // bytes confirmados
  consultar(s: Sesion): Promise<{ listo: boolean; idExterno?: string; url?: string; error?: string }>;
  publicar?(c: CuentaDescifrada, s: Sesion): Promise<{ idExterno: string; url: string }>;
  revocar?(c: CuentaDescifrada): Promise<void>;
}
```

`canjear` devuelve una lista porque un login de Facebook trae todas las páginas que administra la
persona, y uno de Google puede traer varios canales. Se elige en la pantalla oficial de cada red
(Facebook deja marcar las páginas; Google, el canal), y Geeper agrega todo lo que la red devuelve; lo
que sobre se desconecta en Cuentas. Instagram y TikTok devuelven siempre una sola cuenta.

## 10. Pantallas

- **Cuentas** (nueva, en el menú junto a Plantillas): tarjetas agrupadas por red con avatar, @, alias,
  estado, vencimiento y las últimas 3 publicaciones. Botones «Conectar», «Reconectar», «Renombrar» y
  «Desconectar». Arriba, la barra de VPN con la IP y el país de salida.
- **Panel Publicar** (en la página del proyecto, debajo del render aprobado): casillas con las cuentas
  compatibles, campos por cuenta, «Publicar en N cuentas» y la lista de publicaciones del proyecto con
  su estado y enlace.
- **Sistema** (`doctor`): credenciales presentes por red, permisos del `redes.json`, clave de cifrado,
  estado del VPN y cuentas por reconectar. Además, las credenciales
  presentes por red y la cuota usada hoy en YouTube.

## 11. Pruebas

- **Unitarias (vitest):** cifrado ida y vuelta y que falle con otra clave; PKCE y state, que rechace un
  state ajeno o vencido; filtro de secretos en logs; reanudación del ejecutor con un adaptador falso
  (corte a mitad de la subida → retoma desde `bytesConfirmados` y no duplica); corte por VPN (IP
  distinta → «Esperando VPN» sin gastar intentos); `reclamar()` no toma trabajos con `noAntesDe`
  futuro; Instagram con el contenedor ya `PUBLISHED` cierra sin volver a publicar; compatibilidad de
  formatos por red.
- **Manual por red:** conectar dos cuentas de la misma red; subir un render en **privado** a cada una;
  revocar el permiso desde la red y comprobar que la cuenta pasa a `reconectar`; reiniciar el worker a
  mitad de una subida.
- **Nunca se prueba contra cuentas reales en público.** Todas las pruebas son en privado o borrador.

## 12. Fases

| Fase | Contenido | Esfuerzo | Calendario |
|---|---|---|---|
| M5.0 | Esquema (`Cuenta`, `Publicacion`, `Render.hash`, `Trabajo.noAntesDe`), `reclamar()` con `noAntesDe` y `esperar()`, cifrado, filtro de secretos, chequeo de VPN, motor `red`, página Cuentas vacía | 3–4 días | — |
| M5.1 | YouTube de punta a punta (conexión, varios canales, subida reanudable, panel Publicar) | 3–4 días | Pasar la app de OAuth a Producción ya. Pedir la auditoría de la API para poder publicar en público (semanas) |
| M5.2 | TikTok en modo borrador (Login Kit para escritorio, redirect a `localhost`) | 3 días | Pedir la auditoría de Content Posting ya (semanas) |
| M5.3 | Instagram (Reels, login de Instagram) y páginas de Facebook (login de Facebook) | 4–5 días | Revisión de la app por Meta (semanas): pide política de privacidad, video del flujo y dominio |
| Después | Programación nativa, miniaturas personalizadas en YouTube, métricas | — | — |

Los trámites con Google, TikTok y Meta son lo que más tarda en calendario y no dependen del código.
Conviene iniciarlos en paralelo con M5.0.

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| La auditoría tarda o la rechazan | Mientras tanto se publica en privado o borrador y se hace público a mano desde la app. El producto sigue siendo útil |
| Suspensión de cuentas por actividad inusual | IP fija (§8), volumen moderado, nada de automatizar fuera de la API oficial y contenido que cumple las normas de cada red |
| Música con licencia desconocida (DECISIONES §2) dispara Content ID o silenciamientos | El panel Publicar muestra el aviso de licencia del QC antes de publicar en público |
| Cuota de YouTube agotada | El trabajo espera al reinicio de la cuota (§9) y `doctor` muestra lo usado hoy |
| Instagram no acepta la subida reanudable con el login de Instagram (la guía la menciona sólo con el login de Facebook) | Es lo primero que se prueba en M5.3 con una cuenta de prueba. Si falla, se cambia Instagram al login de Facebook (cuenta de Instagram vinculada a una página), que sí la documenta |
| Robo de la base | Los tokens están cifrados con una clave que vive fuera de la base y del repo |
