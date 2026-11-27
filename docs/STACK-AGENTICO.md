# El mapa del «stack agéntico abierto» aplicado a Geeper

<!-- 2026-11-20 · plan para que otro agente lo implemente -->

Origen: 8 láminas de un mapa del stack abierto de IA (232 términos en 8 capas: modelos, infraestructura
de inferencia, *harness* de agentes, entorno de ejecución, conectividad, identidad, contrato de
intención, trazas y evidencia). Aquí está **qué sirve a Geeper, para qué y cómo**, y al final el
inventario completo con el veredicto de cada término.

Filtro aplicado (PRODUCTO.md §2): una sola PC con RTX 5080 de 16 GB en WSL, US$0 al mes, uso interno,
un trabajo de GPU a la vez (`gpu-lock`), `geeper.json` como fuente de verdad, la persona aprueba.
Casi todo el mapa es para centros de datos, clústeres o redes de agentes entre empresas: eso no aplica
y queda descartado en el inventario con su razón.

## Resumen: lo que entra

| # | Qué | De la lámina | Para qué en Geeper | Prioridad |
|---|---|---|---|---|
| A1 | `AGENTS.md` + `CLAUDE.md` que lo importa | 07 AGENTS.md | Que cualquier agente (Claude Code, Codex, Goose) trabaje con las mismas reglas | P1 |
| A2 | JSON Schema 2020-12 de `geeper.json` y de las salidas del director, generado desde Zod | 07 JSON Schema | Contrato publicable para agentes, la skill y el modelo local (G1 de BRECHAS) | P1 |
| A3 | Salidas de Ollama restringidas por esquema | 07 JSON Schema + 01 Gemma | Menos respuestas inválidas en ganchos, títulos y anuncios | P1 |
| A4 | Skill `geeper` conforme a la especificación Agent Skills | 07 Agent Skills | Que la skill cargue igual en otros *harness* | P2 |
| B1 | Servidor MCP de Geeper (especificación 2026-07-28, stdio) | 05 MCP | Herramientas tipadas para el director en vez de scripts sueltos | P1 |
| C1 | OpenTelemetry en el worker y en las llamadas al LLM local | 08 OpenTelemetry (+ Phoenix opcional) | Ver dónde se va el tiempo de cada trabajo y de cada llamada al modelo | P2 |
| C2 | SBOM CycloneDX 1.7 (código + modelos + imágenes Docker + apps Craft) | 08 CycloneDX | Cumple la promesa de PRODUCTO.md §9 («SBOM desde F1»), hoy sin hacer | P1 |
| C3 | Evaluación de prompts con Promptfoo | 08 Promptfoo | Comparar modelos y prompts de forma repetible (hoy fue a mano el 2026-11-18) | P2 |
| C4 | Procedencia firmada de cada render (declaración in-toto, firma local con cosign) | 08 in-toto, Sigstore, W3C PROV | Prueba de qué entró en cada video (licencias, modelos, QC) | P3 |
| C5 | Credenciales de contenido C2PA en el MP4 (**no está en las láminas**) | — (equivalente de video de 08) | Declarar contenido hecho con IA como piden las plataformas | P3, evaluar |
| D1 | Playwright MCP para revisar la UI | 04 Playwright MCP | Que el agente vea la app al cambiarla | P2 |
| D2 | Bubblewrap para procesar material externo sin red | 04 Bubblewrap | Aislar ffmpeg/Python cuando el archivo viene de internet (G5) | P3 |
| D3 | Imágenes Docker de MPT fijadas por digest OCI | 04 OCI Image/Distribution | Saber si MPT cambió por debajo (reproducibilidad, Q5) | P2 |
| E1 | Modelo de visión local para el QC visual (Q3) | 01 Gemma / Qwen / MiniCPM | Manos, caras y texto deformes; puntuar momentos | P2, medir |
| E2 | Regla de formatos y descargas fijadas | 01 SafeTensors, GGUF, ONNX, HF Hub | Nada de pesos *pickle*; cada descarga con commit y SHA-256 | P1 |
| E3 | Optimizar prompts con DSPy, luego LoRA con Unsloth/PEFT/TRL | 01 / 03 | Ganchos y títulos que aprenden de la retención real (D2) | P4, con datos |

Lo condicional (sólo si llega el caso) está en la sección F. Todo lo demás, en el inventario.

## Reglas para quien implemente

- Lee primero `README.md`, `docs/PRODUCTO.md`, `docs/BRECHAS.md`, `docs/DECISIONES.md` y
  `.claude/skills/geeper/SKILL.md`. Escribe en español, como el resto del repo.
- **Otra sesión puede estar editando a la vez**: `git status` antes de empezar y `test -e` antes de crear
  un archivo. Rama propia por fase (`feat/stack-<letra>`), sin tocar `main`.
- Cada paso termina con `pnpm run typecheck`, `pnpm run lint` y `pnpm test` en verde y una entrada en
  `docs/DECISIONES.md` cuando se decide algo (formato de las existentes: qué, por qué, qué se descartó).
- US$0: nada que obligue a una cuenta o servicio en la nube. Todo servicio nuevo es opcional y apagado
  por defecto.
- Ninguna dependencia nueva sin anotar su licencia en `MODELOS.md` (tabla «Motores y bibliotecas»).
- Lo que use la GPU toma `gpu-lock` como `src/lib/ganchos.ts` (`tomarGpu`).
- Nunca se publica nada a registros públicos (Rekor de Sigstore, Hugging Face, npm) sin que el dueño
  lo pida: Geeper es interno.
- Las cifras de las láminas o de blogs no valen como medición: lo que diga «medir» se mide en esta PC
  y se anota con fecha.

---

## A. Contrato de intención (lámina 07)

### A1. `AGENTS.md` en la raíz (P1)

**Qué:** el archivo estándar de instrucciones para agentes (lo leen Codex, Goose, OpenHands, Cursor y
otros). Hoy Geeper no tiene `AGENTS.md` ni `CLAUDE.md`.

**Cómo:**
1. Crear `AGENTS.md` (corto, < 150 líneas) con: qué es Geeper en 3 líneas; mapa de carpetas
   (`src/lib`, `worker`, `py`, `scripts`, `docs`); comandos (`pnpm run dev:up`, `typecheck`, `lint`,
   `test`, `doctor`); reglas duras: no editar `geeper.json` ni `build/` a mano (usar
   `scripts/proponer.ts` o el MCP de B1), un trabajo de GPU a la vez, US$0, nada de material de
   Rockstar, licencias en `MODELOS.md`, secretos de redes nunca en logs (`src/lib/redes/secretos.ts`);
   dónde mirar cada decisión (`docs/DECISIONES.md`).
2. Crear `CLAUDE.md` con una sola línea `@AGENTS.md` (Claude Code importa archivos con `@ruta`), así
   hay una sola fuente.
3. No duplicar la skill: `AGENTS.md` enlaza a `.claude/skills/geeper/SKILL.md` para el esquema.

**Hecho cuando:** un agente sin contexto puede correr las pruebas y proponer un cambio a un proyecto
leyendo sólo `AGENTS.md`.

### A2. JSON Schema 2020-12 generado desde Zod (P1)

**Qué:** Zod 4 (ya en `package.json`) exporta JSON Schema con `z.toJSONSchema(...)`. Hoy el esquema
de `geeper.json` sólo existe como código TypeScript (`src/lib/esquema.ts`).

**Cómo:**
1. `scripts/esquemas.ts` que genera, con `target: "draft-2020-12"`:
   - `docs/esquemas/geeper.schema.json` (proyecto v2),
   - `docs/esquemas/propuesta-anuncio.schema.json` (`src/lib/anuncios/esquema.ts`),
   - `docs/esquemas/ganchos.schema.json` y `titulos.schema.json` (hoy validados a mano en
     `limpiarSugerencias` y `titulos.ts`: pasarlos primero a Zod),
   - `docs/esquemas/director.schema.json`: el contrato del director de G1 (escenas con narración,
     plano pedido, duración estimada, marcas de ritmo). Definirlo ahora en Zod aunque el flujo G1 venga
     después, porque B1 y A3 lo usan.
2. `pnpm run esquemas` en `package.json`. Prueba en `tests/esquemas.test.ts` que regenera en memoria y
   falla si el archivo del repo está desactualizado.
3. Cada esquema con `$id` estable (`https://geeper.local/esquemas/<nombre>.schema.json`, no tiene que
   resolver) y `description` en español en los campos (sale de `.describe()` de Zod).
4. Zod no puede expresar todo (refinamientos): documentar en el encabezado del archivo que la validación
   real sigue siendo Zod y que el JSON Schema es para agentes y modelos.

**Hecho cuando:** los cinco esquemas están en el repo, la prueba los mantiene al día y la skill
`geeper` apunta a `docs/esquemas/geeper.schema.json`.

### A3. Salidas de Ollama restringidas por esquema (P1)

**Qué:** hoy `ganchos.ts`, `titulos.ts` y `anuncios/ideas.ts` llaman `docker exec -i mpt-ollama ollama
run <modelo> --format json` y después limpian. `ollama run --format` sólo acepta `json`; la **API HTTP**
de Ollama acepta un JSON Schema completo en `format` y el modelo queda restringido por gramática.

**Cómo:**
1. Verificar primero (Docker Desktop encendido) cuál de estas vías funciona y anotar la elegida en
   DECISIONES.md:
   - a) `docker exec -i mpt-ollama curl -s http://127.0.0.1:11434/api/chat -d @-` si la imagen trae
     `curl` (no lo pude comprobar: Docker estaba apagado);
   - b) publicar `127.0.0.1:11434` en el compose de MPT (toca MPT: pedir permiso al dueño);
   - c) si ninguna, dejar `--format json` y seguir validando con Zod (no se pierde nada).
2. Un solo módulo `src/lib/llm-local.ts` con `pedirJson<T>(modelo, prompt, esquemaZod, opciones)` que
   arma el JSON Schema con `z.toJSONSchema`, llama por la vía elegida, valida con Zod **siempre** y
   devuelve errores en el mismo tono que hoy («abre Docker Desktop…»). Migrar los tres llamadores.
   Mantener `tomarGpu` y `--keepalive 0s` / `keep_alive: 0`.
3. Ollama convierte el esquema en gramática y no acepta todas las palabras clave de JSON Schema.
   Probar cada esquema de A2 contra el modelo real; si alguna palabra clave falla (`$ref`, `pattern`,
   `oneOf`…), pasarle a Ollama una versión simplificada (sin `$id`, con `$ref` resueltas) y dejar las
   reglas finas en Zod.
4. Pruebas con un ejecutor falso (sin Docker), como las de `tests/` hoy.

**Hecho cuando:** los tres llamadores usan `pedirJson` y las pruebas cubren respuesta válida, inválida
y Docker apagado.

### A4. Skill conforme a Agent Skills (P2)

**Qué:** la especificación abierta de Agent Skills (carpeta con `SKILL.md`, *frontmatter* `name` y
`description`, recursos al lado). La skill ya existe; hay que comprobar los límites.

**Cómo:** comprobar `name` en minúsculas con guiones (≤ 64 car.) y `description` ≤ 1024 car. (la actual
es larga: medirla y acortar si pasa); mover el detalle del esquema a `references/esquema.md` dentro de
la skill y enlazar a `docs/esquemas/geeper.schema.json`. Comprobar la especificación vigente en
agentskills.io antes de cambiar nada.

### A5. OpenAPI 3.2 de la API local (no por ahora)

Sólo serviría si algo externo llamara a `/api/*`. El MCP de B1 llama a `src/lib` directamente, así que
no hace falta. Revisar si aparece una integración (n8n, Zapier) que lo pida.

---

## B. Servidor MCP de Geeper (lámina 05)

### B1. `geeper-mcp` por stdio (P1)

**Qué:** hoy el director (Claude Code) usa scripts (`scripts/proponer.ts`, `encolar.ts`,
`importar-clip.ts`, `momentos.ts`) y lee archivos. Un servidor MCP da herramientas tipadas, con
descripción y esquema, a cualquier *harness*. La revisión 2026-07-28 de MCP quitó las sesiones y el
*handshake* (es sin estado), marcó Roots, Sampling y Logging como obsoletos y trata a los servidores
HTTP como servidores de recursos OAuth 2.1. Por stdio no hay autorización: corre como el usuario local.

**Cómo:**
1. `mcp/servidor.ts` con el SDK oficial de TypeScript (`@modelcontextprotocol/sdk`, la versión que
   implemente 2026-07-28: verificarlo en su changelog y fijar la versión exacta). Transporte **stdio**
   únicamente. No usar Sampling, Roots ni Logging (obsoletos).
2. Herramientas (cada una llama a las funciones de `src/lib`, nunca reimplementa lógica):

   | Herramienta | Hace | Anotación |
   |---|---|---|
   | `proyectos_listar` | Proyectos con estado y último render | sólo lectura |
   | `proyecto_leer` | `geeper.json` + último QC + versiones | sólo lectura |
   | `esquema` | Devuelve `geeper.schema.json` (A2) | sólo lectura |
   | `proponer_cambio` | Valida un `geeper.json` nuevo o un parche y devuelve las diferencias, **sin guardar** | sólo lectura |
   | `aplicar_cambio` | Guarda la propuesta como versión nueva (la misma ruta que la UI) | destructiva |
   | `encolar` | `render`, `regenerar-voz`, `qc`… con el `input_hash` normal | destructiva |
   | `trabajo_estado` | Estado, avance y final del log de un trabajo | sólo lectura |
   | `fotograma` | PNG de un instante del último render (para que el agente lo mire) | sólo lectura |
   | `momentos_buscar` | Lo que hoy hace `scripts/momentos.ts` | sólo lectura |

   `aplicar_cambio` y `encolar` con `destructiveHint: true`, así el *harness* pide permiso. Nunca
   exponer las cuentas de redes ni publicar: publicar sigue siendo sólo desde la UI.
3. `.mcp.json` del proyecto registrando `geeper` (`npx tsx mcp/servidor.ts`).
4. Actualizar la skill `geeper` y `AGENTS.md`: preferir el MCP; los scripts quedan para la terminal.
5. Pruebas: cliente MCP en memoria contra el servidor, una por herramienta, con un `~/geeper-data` de
   prueba como hacen las pruebas actuales (`tests/fixtures.ts`).

**Hecho cuando:** desde Claude Code, «quita la escena 3 del proyecto X y renderiza» se resuelve con
`proponer_cambio` → aprobación → `aplicar_cambio` → `encolar`, sin leer archivos a mano.

---

## C. Trazas y evidencia (lámina 08)

### C1. OpenTelemetry en el worker (P2)

**Qué:** hoy cada trabajo tiene log y telemetría de GPU (`con-telemetria`), pero no hay forma de ver un
trabajo como árbol de pasos con tiempos (espera de `gpu-lock`, MPT, whisper, compilar, render, QC).

**Cómo:**
1. `@opentelemetry/api` + `@opentelemetry/sdk-trace-node` (Apache 2.0). Un *span* por trabajo y uno por
   paso (`src/lib/pasos.ts`), con atributos `geeper.trabajo.id`, `geeper.motor`, `geeper.input_hash`,
   `geeper.gpu.espera_ms`, resultado y error. Las llamadas al LLM local (A3) con las convenciones
   semánticas GenAI de OTel (`gen_ai.request.model`, tokens si Ollama los da).
2. Exportador por defecto: archivo JSONL en `~/geeper-data/trazas/AAAA-MM-DD.jsonl`, rotado a 14 días.
   Sin servicios.
3. Opcional: si existe `GEEPER_OTLP_URL`, exportar también por OTLP/HTTP. Documentar cómo levantar
   **Phoenix** en local (`docker run -p 6006:6006 arizephoenix/phoenix`, licencia Elastic 2.0: uso
   interno sí) para mirarlas. No se instala por defecto.
4. Pasar todo texto de atributos por `tapar()` de `src/lib/redes/secretos.ts`.
5. En `/trabajos/<id>`, una tabla «Pasos» con duración de cada *span* leída del JSONL.

**Descartado:** Langfuse (pide Postgres + ClickHouse + Redis para hospedarlo: demasiado para una PC).

### C2. SBOM CycloneDX 1.7 (P1)

**Qué:** PRODUCTO.md §9 promete un SBOM «desde F1» y no existe. CycloneDX (OWASP, ECMA-424) describe
también modelos de ML (`type: machine-learning-model`), que es lo que más importa aquí. Se elige sobre
SPDX 3.0.1 por eso y porque basta con un formato.

**Cómo:**
1. `@cyclonedx/cyclonedx-npm` (Apache 2.0) para las dependencias de npm.
2. `scripts/sbom.ts` que agrega al mismo documento:
   - los modelos de `src/lib/modelos.ts` (`PESOS`) con su sha256 y licencia de `MODELOS.md`;
   - los modelos dentro de MPT por nombre (no se ven sus pesos, como dice `modelos.ts`);
   - las apps Craft de `src/lib/craft-web.ts` (release fijada y SHA-256);
   - las imágenes Docker de MPT con su digest (D3);
   - ffmpeg y Hyperframes con su versión.
3. `pnpm run sbom` → `docs/sbom/geeper.cdx.json`. El doctor avisa si es más viejo que `pnpm-lock.yaml`.
4. Validar el resultado contra el esquema oficial de CycloneDX 1.7 en una prueba.
5. Lo barato que va antes del inventario: `pnpm audit --prod` en el doctor (aviso con las
   vulnerabilidades altas y críticas). Un SBOM sólo describe; esto avisa de lo que hay que parchar.

### C3. Evaluación de prompts con Promptfoo (P2)

**Qué:** la comparativa gemma4:26b vs 12b del 2026-11-18 se hizo a mano. Promptfoo (MIT, Node)
corre casos fijos contra varios modelos y prompts con aserciones. DeepEval y Ragas hacen lo mismo en
Python; Ragas es para RAG, que Geeper no tiene.

**Cómo:**
1. `evals/promptfooconfig.yaml` con proveedor `exec:` que llama a `pedirJson` (A3), así usa la misma
   vía y el `gpu-lock`. Si A3 consigue la API HTTP, el proveedor nativo `ollama:` también sirve.
2. Suites: ganchos (20 momentos de prueba sacados de `tests/fixtures.ts` o creados a mano, **sin**
   datos de canales reales con personas identificables), títulos, propuestas de anuncios, guion.
3. Aserciones deterministas primero: JSON válido con el esquema de A2, largo máximo, idioma, sin
   nombres que no estén en el texto de entrada (contra inventos como el «faro de la isla de Somme»).
   Juez con modelo sólo local (`llm-rubric` con gemma4), nunca una API paga.
4. `pnpm run evals` manual (usa GPU, no va en CI). Guardar resultados en
   `~/dev/video-tools/pruebas/evals/<fecha>/` y anotar conclusiones en `MODELOS.md`.

**Hecho cuando:** cambiar de modelo o de prompt se decide con una tabla de Promptfoo, no a ojo.

### C4. Procedencia firmada de cada render (P3)

**Qué:** Geeper ya guarda por asset `source`, prompt, semilla, modelo, sha256 de pesos y licencia, y el
informe de QC. Falta juntarlo en un documento estándar y verificable por render.

**Cómo:**
1. Al terminar el QC, escribir `renders/<id>/procedencia.intoto.json`: una *Statement* in-toto v1 con
   `subject` = nombre y sha256 del MP4 (y del `.srt` y del máster) y un `predicate` propio
   (`https://geeper.local/procedencia/v1`) con: versión de Geeper (commit), hash de la versión de
   `geeper.json`, assets (hash, `source`, licencia, modelo, pesos), versiones de ffmpeg y Hyperframes,
   y el informe de QC.
2. Firma opcional y **local**: `cosign sign-blob --key` con una clave en `~/geeper-data/claves/`
   (generada con `cosign generate-key-pair`), **sin** subir a Rekor (`--tlog-upload=false`): el log de
   transparencia de Sigstore es público y Geeper es interno.
3. Botón «Descargar procedencia» junto al render.

W3C PROV queda como vocabulario de referencia para el `predicate`, no como formato aparte. SLSA no
aplica (no se publican paquetes).

### C5. Credenciales de contenido C2PA (P3, evaluar) — no está en las láminas

**Por qué se agrega:** es el equivalente de la lámina 08 para video y es el que las plataformas leen:
YouTube, TikTok y Meta usan metadatos C2PA para la etiqueta de contenido hecho con IA. Las láminas no
lo incluyen.

**Cómo (evaluar primero):** verificar el estado actual en cada plataforma; probar `c2patool` (Apache 2.0
/ MIT) para incrustar en el MP4 un manifiesto con la acción `c2pa.created` y
`digitalSourceType: trainedAlgorithmicMedia` cuando haya planos generativos, firmado con un
certificado propio. Medir si ffmpeg o la subida lo borran. Anotar resultado en DECISIONES.md antes de
implementarlo en la entrega.

---

## D. Entorno de ejecución (lámina 04)

### D1. Playwright MCP para la UI (P2)

Ya hay `playwright-core` y scripts en `scripts/ui/`. Agregar `@playwright/mcp` (Apache 2.0) en
`.mcp.json` para que el agente abra `http://localhost:3300`, navegue y mire. Sólo desarrollo; no
es dependencia de la app. Anotar en `AGENTS.md` cuándo usarlo (cambios en `src/components`).

### D2. Bubblewrap para material de internet (P3)

**Qué:** con G5, Geeper procesa VODs y videos bajados. Los demuxers de ffmpeg y las librerías de
imagen tienen CVE cada año. `bwrap` (LGPL) corre un proceso sin red, con el sistema de archivos en
sólo lectura salvo la carpeta de salida.

**Cómo:** comprobar `bwrap` en WSL (`apt install bubblewrap`, puede requerir permisos del dueño);
`correrAislado()` en `src/lib/proceso.ts` con `--unshare-net --ro-bind / / --bind <salida> <salida>
--dev /dev --proc /proc`; usarlo sólo para el primer `ffprobe`/transcodificación de archivos que
vienen de fuera (`importador-clip.ts`). Si `bwrap` no está, seguir como hoy y avisar en el doctor.
Medir que no cambia el tiempo de forma notable.

### D3. Imágenes Docker fijadas por digest (P2)

El doctor lee `docker image inspect` de los contenedores de MPT, guarda el digest en
`~/geeper-data/imagenes.json` y avisa si cambió desde la última vez. El digest entra al SBOM (C2) y al
`input_hash` de los trabajos de MPT (Q5).

### Descartado en esta lámina

Temporal, LangGraph, Obelisk y Dora (ejecución durable): la cola en SQLite con `input_hash`, *lease* y
manifiestos ya cubre lo mismo y sobrevive a reinicios (PRODUCTO.md §8). E2B, Firecracker, gVisor, Kata
y containerd: aislamiento para multiusuario o nube. WASI, Wasmtime y Pyodide: no hay código ajeno que
correr. browser-use, BrowserGym y UI-TARS Desktop: publicar ya usa las API oficiales; manejar las webs
de las plataformas con un agente rompe sus términos.

---

## E. Modelos (lámina 01)

Todo modelo nuevo: medido en esta PC, con licencia en `MODELOS.md`, sha256 en `modelos.ts` y `gpu-lock`.

### E1. Visión local para el QC visual (Q3) y momentos (P2, medir)

Candidatos, en este orden:
1. **Gemma 4** (ya descargado para guiones): comprobar con `ollama show gemma4:12b` si el *tag* trae
   visión. Si sí, no hay descarga ni VRAM nueva.
2. **Qwen3-VL** (Apache 2.0) en el tamaño que quepa con los 16 GB.
3. **MiniCPM-V** (entiende video, liviano): su licencia propia pide registro para uso comercial;
   revisarla antes.

Uso: sobre la **hoja de contacto** (no cada fotograma), respuesta con esquema (A3):
`{ problemas: [{ fotograma, tipo: mano|cara|texto|marca, gravedad }] }`. Primero como aviso del QC,
nunca bloqueante hasta medir falsos positivos en 30 renders. Mismo modelo para puntuar momentos en
G5 si mejora a `buscar-momentos.ts` (medirlo con C3).

### E2. Formatos y descargas (P1)

Regla en `AGENTS.md` y `MODELOS.md`: pesos nuevos sólo en **SafeTensors, GGUF u ONNX**; nunca `.pt`,
`.pth` o `.bin` *pickle* (ejecutan código al cargarse). Descargas de Hugging Face fijadas a un commit
(`revision`) y con SHA-256 comprobado, como ya hace `src/lib/caras.ts` con YuNet. ModelScope sólo
como espejo si Hugging Face falla, con el mismo SHA-256.

### E3. Que los ganchos aprendan (P4, sólo con datos de D2)

Cuando el bucle de aprendizaje D2 tenga métricas reales de ≥ 200 videos:
1. Primero **DSPy** (MIT): optimizar los prompts de ganchos y títulos con los datos reales y la suite
   de C3 como métrica. Barato y reversible.
2. Si no basta, LoRA de Gemma con **Unsloth** + PEFT/TRL (Apache 2.0) en QLoRA de 4 bits, exportado a
   GGUF e importado en Ollama. Medir que cabe en 16 GB y que gana en C3. No reemplaza el modelo base:
   es un *tag* aparte.

### Descartado en esta lámina

DeepSeek, Kimi, GLM, MiniMax, Llama 4, Mistral grandes: no caben bien en 16 GB o no ganan a Gemma 4 en
guiones en español (se pueden sumar como candidatos en C3 si un tamaño cabe). OLMo: totalmente abierto,
pero sin ventaja para esta tarea. openPangu y MindSpore: para Ascend de Huawei. Laguna XS.2 (Poolside,
Apache 2.0, 33B MoE): modelo de programación, no de guiones. Nemotron: se sigue usando por MCP en
desarrollo y Parakeet ya está en `MODELOS.md`. verl, DeepSpeed, Megatron-LM, torchtune, Axolotl,
LLaMA-Factory, TransferQueue, DataFlow y DataFlex: entrenamiento a escala de clúster.

---

## F. Condicional (no hacer hasta que se cumpla la condición)

| Pieza | Condición | Para qué |
|---|---|---|
| AG-UI (+ A2UI) | El director G1 se vuelve un chat dentro de la app con *streaming* | AG-UI transporta los eventos agente ↔ UI; A2UI describe formularios generados (aprobar storyboard) con componentes que la app registra antes |
| Mastra o Pydantic AI | Hace falta un bucle de agente **dentro** de la app (no en Claude Code) | Mastra es TypeScript y encaja con Next.js; preferir antes una función con A3 sin framework |
| CloudEvents 1.0 | Geeper emite eventos a otra herramienta (webhooks, n8n) | Sobre estándar para «render terminado», «QC falló» |
| OpenAPI 3.2 | Algo externo llama a `/api/*` | Contrato de la API (A5) |
| OpenBao | Más de una PC o más de una persona | Hoy `src/lib/redes/cifrado.ts` alcanza |
| Mem0, Letta, Graphiti, Cognee | El director necesita memoria entre sesiones que SQLite no resuelva | D2 se guarda en SQLite primero |

---

## Orden de trabajo sugerido

| Paso | Rama | Contenido | Depende de |
|---|---|---|---|
| 1 ✅ | `feat/stack-contrato` | A1, A2, E2 — **hecho 2026-11-20** (commit `9c168ec`, DECISIONES §23) | — |
| 2 ✅ | `feat/stack-llm-local` | A3 — **hecho y medido** (`8d8cbfe`, §24; `d2bc173` pide `think: false`, tabla en §34) | A2 |
| 3 ✅ | `feat/stack-mcp` | B1, D1, A4 — **hecho** (`465fc14`, §25): SDK v2 con la revisión 2026-07-28 | A2 |
| 4 ✅ | `feat/stack-evidencia` | C2, D3 — **hecho** (`4e89baf`, §26); digests de las 5 imágenes de MPT registrados y en el SBOM (`d2bc173`) | — |
| 5 ✅ | `feat/stack-trazas` | C1 — **hecho** (`d84c8dc`, §27) | A3 |
| 6 ✅ | `feat/stack-evals` | C3 — **hecho y corrido con gemma4:12b** (`29d95b7`, §28; `9ac7a8e`, §34). Falta comparar con el 26b | A3 |
| 7 ✅ | `feat/stack-qc-vision` | E1 — **hecho, medido con gemma4:12b** (`1a0cc50`, §29; §34): 0 marcas en 14 hojas; sigue como aviso hasta revisar a mano | A3, C3 |
| 8 ✅ | `feat/stack-procedencia` | C4 — **hecho** (`23be719`, §30; firma real probada). C5 evaluado en `feat/stack-c2pa` (`aaf37f7`, §33): no se incrusta todavía | C2 |
| 9 ✅ | `feat/stack-aislado` | D2 — **código hecho** (`06b894e`, §31; revisión §32); falta `sudo apt install bubblewrap` y medir | G5 en uso real |
| 10 ⏸ | — | E3 — **no se puede todavía**: pide métricas reales de ≥ 200 videos (D2 de BRECHAS, sin datos aún). C1 y C3 ya están | D2 de BRECHAS con datos, y C1 + C3 funcionando (sin trazas ni evals no se sabe qué optimizar) |

Al terminar cada paso: actualizar el estado en `docs/BRECHAS.md` (tabla de arriba) y en este archivo.

---

## Inventario completo

Veredicto: **Sí** (entra, ver sección), **Ya** (Geeper ya lo usa), **Cond.** (sección F), **No**
(con razón). «No verificado»: no encontré fuente fiable; no cambia el plan porque ninguno de esos
aplicaría a una sola PC.

### 01 Modelos abiertos (32)

| Término | Qué es | Veredicto |
|---|---|---|
| Hugging Face Hub | Repositorio de modelos y datos | Ya (Kokoro, Parakeet, Wan); E2 fija commit y hash |
| ModelScope | Repositorio de modelos de Alibaba | No (espejo de reserva, E2) |
| Unsloth | Afinado LoRA/QLoRA rápido con poca VRAM | Sí, E3 (P4) |
| verl | Entrenamiento por refuerzo (RL) de LLM, ByteDance | No: escala de clúster |
| GGUF | Formato de pesos cuantizados de llama.cpp/Ollama | Ya (Ollama); E2 |
| SafeTensors | Formato de pesos seguro (sin código) | Sí, E2 |
| ONNX | Formato portable de modelos | Ya (Kokoro, Parakeet, YuNet); E2 |
| MindSpore | Framework de aprendizaje profundo de Huawei | No: Ascend |
| PEFT | Biblioteca de afinado eficiente (LoRA) de Hugging Face | Sí, E3 |
| torchtune | Afinado con PyTorch de Meta | No: Unsloth cubre lo mismo con menos VRAM |
| TransferQueue | Sistema de datos en *streaming* para el *post-training* en verl | No: clúster |
| TRL | Entrenamiento con refuerzo y SFT de Hugging Face | Sí, E3 |
| DataFlex | Herramienta de datos para entrenamiento (no verificado) | No |
| DataFlow | Preparación de datos para entrenar LLM (OpenDCAI) | No |
| DeepSpeed | Entrenamiento distribuido de Microsoft | No: clúster |
| Llama-Factory | Afinado de LLM con interfaz | No: Unsloth basta; revisar si E3 crece |
| Megatron-LM | Entrenamiento de modelos enormes de NVIDIA | No: clúster |
| Nemotron | Familia de modelos de NVIDIA | Ya (MCP en desarrollo, Parakeet) |
| OLMo | LLM totalmente abierto (datos y código) de Ai2 | No: sin ventaja para guiones |
| openPangu | Modelos de Huawei para Ascend | No |
| Qwen | Familia de Alibaba (texto, visión, TTS) | Sí: Qwen3-VL en E1; Qwen3-TTS ya candidato en G2 |
| Axolotl | Afinado por configuración YAML | No: Unsloth basta |
| Llama | Familia de Meta | No: licencia propia y sin ventaja |
| MiniCPM | Modelos pequeños con visión y video (OpenBMB) | Sí, candidato en E1 (revisar licencia) |
| MiniMax | Modelos MoE grandes | No: no caben |
| Mistral | Familia de Mistral AI | No por ahora (candidato en C3 si cabe) |
| Muse | No verificado (¿modelo de mundo de Microsoft?) | No |
| DeepSeek | Modelos MoE grandes | No: no caben en 16 GB |
| Gemma | Familia de Google | Ya (guiones, ganchos); E1 si trae visión |
| GLM | Modelos de Zhipu | No: sin ventaja medida (candidato en C3) |
| Kimi | Modelos MoE enormes de Moonshot | No: no caben |
| Laguna XS.2 | Modelo de programación de Poolside, 33B MoE, Apache 2.0 | No: programación, no guiones |

### 02 Infraestructura de inferencia (61)

| Término | Qué es | Veredicto |
|---|---|---|
| SUE-T, SUE 1.0 | Scale-Up Ethernet (Broadcom) entre GPU | No: hardware de centro de datos |
| NVMe-MI 2.2, NVMe Base 2.4, NVMe/RDMA 1.3, NVMe/TCP 1.3, SPDK | Gestión y acceso a discos NVMe en red | No |
| OCP SAI, OpenConfig, YANG, gNMI 0.10, Redfish 1.25.0 | Gestión de switches y servidores | No |
| P802.3dj, IEEE 802.3, 802.1Qaz ETS, 802.1Qbb PFC, ECN, BGP, EVPN/VXLAN | Ethernet y redes de centro de datos | No |
| InfiniBand EDR/HDR/NDR, RoCEv2, Ultra Ethernet/UET 1.0.3, rdma-core | Redes RDMA entre servidores | No |
| DMTF MCTP, DMTF PLDM, DMTF SPDM 1.4.1 | Gestión y autenticación de componentes de hardware | No |
| ISO/IEC 25706:2026 | Norma ISO citada en la lámina (no verificado) | No |
| Volcano, Kubernetes, Kueue, Slurm, NVIDIA GPU Operator | Orquestación de clústeres y colas de GPU | No: una PC; `gpu-lock` basta |
| PCIe 7.0, CXL 4.0, UCIe 3.0, UALink 128G DL/PL 1.0, UALink Manageability 1.0, UnifiedBus 2.0, OCP ESUN 1.0 | Interconexión de chips y GPU | No |
| UCM, UCX, Mooncake TE, NIXL, AIBrix, FlexKV, LMCache, Mooncake | Caché KV y movimiento de datos para servir LLM a escala | No |
| SGLang, vLLM | Servidores de LLM de alto rendimiento | No: un usuario; reservan VRAM y chocan con `gpu-lock`. Ollama queda |
| Dynamo, llm-d, MindIE-LLM | Servir LLM distribuido (NVIDIA, Red Hat, Huawei) | No |
| KTransformers | Correr MoE grandes repartidos entre CPU y GPU | No por ahora (sólo si un modelo grande ganara en C3) |
| llama.cpp | Motor de inferencia en CPU/GPU | Ya (debajo de Ollama; whisper.cpp es su hermano) |
| MLC-LLM | Compilar LLM para muchos dispositivos | No |
| CANN, FlagOS | Pila de software para Ascend / multi-chip | No |
| PyTorch | Framework de aprendizaje profundo | Ya (Wan, MPT); sin cambios |
| ROCm | Pila de GPU de AMD | No: GPU NVIDIA |
| TileLang, Triton | Lenguajes para escribir kernels de GPU | No |

### 03 *Harness* de agentes (46)

| Término | Qué es | Veredicto |
|---|---|---|
| Makepad | Framework de UI en Rust | No |
| Octop | Plataforma de asistente autoalojado de Tencent Cloud | No: Claude Code es el *harness* |
| Open WebUI, LibreChat | Interfaces de chat para LLM | No |
| TuyaOpen | SDK de agentes para dispositivos IoT | No |
| A2UI | Especificación de Google para UI generada por agentes (JSON declarativo) | Cond. (F) |
| AG-UI | Protocolo de eventos agente ↔ interfaz (CopilotKit) | Cond. (F) |
| Agent TARS | Agente multimodal de ByteDance | No |
| Coze Studio, Dify | Constructores visuales de agentes | No: rompe «una fuente de verdad» |
| DSPy | Programar y optimizar prompts con métricas | Sí, E3 |
| JIT-Agent | Investigación: modelo que genera el *harness* a medida | No |
| PenguinHarness | *Harness* en TypeScript (autor de LLaMA-Factory) | No |
| PhyAgentOS | Runtime de agentes para robots | No |
| RAGEN, SkyRL, Agent Lightning, ART | Entrenar agentes con refuerzo | No |
| AHE | Investigación: evolución automática del *harness* por observabilidad | No (la idea de C1 + C3 es la misma, a mano) |
| Mem0, MemoryOS, MemOS, Cognee, Graphiti, JiuwenMemory, Letta | Memoria para agentes | Cond. (F) |
| Rig | Framework de LLM en Rust | No |
| ZeroClaw, OpenClaw, Octos, Hermes Agent | Agentes personales autoalojados | No |
| OpenHands, Goose, Codex SDK, Pi-Mono, AtomCode (no verificado), DeepSeek Harness (no verificado) | Agentes de programación | No: Claude Code; A1 les sirve si se usan |
| openJiuwen | Plataforma de agentes de Huawei | No |
| Pydantic AI, Mastra | Frameworks para escribir agentes (Python / TypeScript) | Cond. (F) |
| DeerFlow | Agente de investigación profunda de ByteDance | No |
| Google ADK, LangChain, Microsoft Agent Framework, CrewAI, Dapr Agents | Frameworks de agentes | No |

### 04 Entorno de ejecución (29)

| Término | Qué es | Veredicto |
|---|---|---|
| BrowserGym, browser-use, UI-TARS Desktop | Agentes que manejan navegador o escritorio | No |
| Playwright | Automatización de navegador | Ya (`scripts/ui`) |
| Playwright MCP | Playwright como servidor MCP | Sí, D1 |
| OCI Image 1.1, OCI Runtime 1.3, OCI Distribution | Estándares de contenedores | Sí, D3 (digest) |
| POSIX | Interfaz estándar de sistemas Unix | Ya (WSL) |
| WASI, Wasmtime, Pyodide | Ejecutar WebAssembly / Python en WASM | No |
| Kata Containers, gVisor, Firecracker, E2B, containerd | Aislamiento fuerte de cargas | No |
| Moby | Base de Docker | Ya (Docker Desktop para MPT) |
| Bubblewrap | Aislamiento liviano sin root | Sí, D2 |
| AX | No verificado | No |
| Dora, LangGraph, Temporal | Flujos de datos y ejecución durable | No: la cola SQLite ya lo hace |
| Agent Substrate | No verificado como proyecto | No |
| Linux | — | Ya (WSL) |
| Omarchy, openEuler, OpenHarmony, OpenVela | Distribuciones y sistemas para escritorio, servidor o IoT | No |

### 05 Conectividad y estado (30)

| Término | Qué es | Veredicto |
|---|---|---|
| draft-wang-lisp-ai-agent, Agent Internet Architecture, IEEE ComSoc ACN TWG, Network Trust, Routing, Trust/Auth | Borradores y grupos de trabajo sobre redes de agentes | No |
| AID | Descubrir el agente de un dominio con un registro DNS `_agent` (borrador IETF) | No: Geeper no expone agentes |
| AIPF | Marco de interoperabilidad de agentes (borrador IETF, jul. 2026) | No |
| CATALIST | Coordinación de esfuerzos A2A en el IETF (BoF del IETF 125) | No |
| TLS 1.3, HTTP/2, HTTP/3, QUIC | Transporte web | Ya, por debajo (APIs de publicación) |
| IPv6, SRv6, DNS, DNSSEC, DNS-SD, SVCB/HTTPS | Red y nombres | No |
| Zenoh, NATS | Mensajería entre sistemas | No: un proceso web y un worker con SQLite |
| Matrix, Robrix | Chat federado y su cliente en Makepad | No |
| MCP 2026-07-28 | Protocolo de herramientas para agentes, revisión sin estado | Sí, B1 |
| OpenAgents, A2A 1.0, AgentConnect, ANP | Comunicación entre agentes de distintos dueños | No: no hay agentes ajenos |
| CloudEvents 1.0 | Sobre estándar de eventos | Cond. (F) |
| DHTTP | No verificado | No |

### 06 Identidad y acceso (14)

| Término | Qué es | Veredicto |
|---|---|---|
| OAuth 2.0, OIDC, JWT/JWS | Autorización y tokens | Ya (YouTube, TikTok, Meta con PKCE en `src/lib/redes/oauth.ts`) |
| SPIFFE/SPIRE | Identidad de cargas de trabajo | No |
| OpenFGA, Cedar, OPA/Rego | Motores de permisos | No: una persona; las aprobaciones ya están en la app |
| Vault, OpenBao | Gestores de secretos | Cond. (F) |
| Keycloak | Proveedor de identidad | No |
| SCIM 2.0 | Alta y baja de usuarios entre sistemas | No |
| W3C DID Core, W3C VC 2.0 | Identificadores y credenciales descentralizados | No |
| GNAP | Sucesor propuesto de OAuth | No |

### 07 Contrato de intención (4)

| Término | Qué es | Veredicto |
|---|---|---|
| Agent Skills | Especificación de skills para agentes | Ya (skill `geeper`); A4 |
| AGENTS.md | Instrucciones estándar para agentes en un repo | Sí, A1 |
| JSON Schema 2020-12 | Esquema de documentos JSON | Sí, A2 y A3 |
| OpenAPI 3.2.1 | Descripción de APIs HTTP | Cond. (A5) |

### 08 Trazas y evidencia (16)

| Término | Qué es | Veredicto |
|---|---|---|
| Sigstore | Firma de artefactos (cosign) | Sí, C4 (sólo clave local, sin Rekor) |
| SLSA | Niveles de seguridad de la cadena de construcción | No: no se publican paquetes |
| SPDX 3.0.1 | Formato de SBOM de la Linux Foundation | No: se usa CycloneDX |
| W3C PROV | Modelo de procedencia | Referencia del `predicate` de C4 |
| Promptfoo | Evaluación de prompts y modelos | Sí, C3 |
| Ragas | Evaluación de RAG | No: no hay RAG |
| RATS Architecture, EAT | Atestación remota de hardware (RFC 9334, RFC 9711) | No |
| SCITT Architecture | Registros de transparencia de la cadena de suministro | No |
| Langfuse | Observabilidad de LLM | No: su autoalojado es pesado (C1) |
| Obelisk | Motor de flujos durable en WASM (AGPL) | No |
| OpenTelemetry | Trazas, métricas y logs estándar | Sí, C1 |
| Phoenix | Observabilidad de LLM sobre OTel (Arize) | Opcional, C1 |
| CycloneDX 1.7 | Formato de SBOM con modelos de ML | Sí, C2 |
| DeepEval | Evaluación de LLM en Python | No: Promptfoo en Node |
| In-toto | Atestaciones de la cadena de suministro | Sí, C4 |

## Anexo: segunda opinión (Nemotron Ultra, 2026-11-20)

**Aceptado:** comprobar qué partes de JSON Schema acepta Ollama en `format` (A3); `pnpm audit --prod`
antes que el SBOM (C2); DSPy y LoRA sólo después de tener trazas y evals (orden, paso 10).

**Discutido, se mantiene:**
- *«El servidor MCP sobra: basta un CLI con `--json`»*: los scripts ya existen y siguen. El MCP agrega
  herramientas tipadas con permiso por herramienta (`destructiveHint`) y sirve a cualquier *harness*
  (A1). Si se quiere ir más corto, el primer paso de B1 puede ser sólo las herramientas de lectura.
- *«in-toto y C2PA sobran; basta sha256 + firma con `age`»*: `age` cifra, no firma. C4 sigue en P3 y
  C5 sólo se evalúa.
- *«`ffprobe` es de sólo lectura y seguro»*: leer un archivo hostil es justo donde están los CVE de los
  demuxers. D2 sigue en P3 y sólo para archivos de fuera.

**Descartado (falso o ya resuelto):** que `ollama run --format json` no existe (Geeper lo usa en
`ganchos.ts`); que Next.js 16 no existe (está en `package.json`); que Gemma 4 no tiene visión (su
información llega a 2025; Gemma 4 está en `MODELOS.md` y E1 ya pide comprobarlo antes de usarlo); que `flock` falla en WSL (DECISIONES y PRODUCTO §8,
corre sobre el sistema de archivos de Linux); fijar Hyperframes (ya fijado en 0.9.27); `input_hash`
antes de encolar y retención de archivos intermedios (fuera del mapa; si hace falta, va a BRECHAS).

## Fuentes de lo menos conocido (consultadas el 2026-11-20)

- MCP 2026-07-28: [blog de MCP](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/), [WorkOS](https://workos.com/blog/mcp-stateless-spec-2026-07-28).
- A2UI y AG-UI: [Google](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/), [CopilotKit](https://copilotkit.ai/blog/ag-ui-and-a2ui-explained-how-the-emerging-agentic-stack-fits-together).
- AID: [borrador IETF](https://datatracker.ietf.org/doc/html/draft-nemethi-aid-agent-identity-discovery-00). AIPF: [borrador IETF](https://datatracker.ietf.org/doc/html/draft-zahed-agent-comm-framework-01). CATALIST: [borrador IETF](https://www.ietf.org/archive/id/draft-yao-catalist-problem-space-analysis-01.html).
- Laguna XS.2: [Poolside](https://poolside.ai/blog/introducing-laguna-xs2-m1). TransferQueue: [docs de verl](https://verl.readthedocs.io/en/latest/data/transfer_queue.html).
- AHE: [arXiv 2604.25850](https://arxiv.org/html/2604.25850v2). JIT-Agent: [arXiv 2608.25593](https://huggingface.co/papers/2608.25593). PenguinHarness, PhyAgentOS, Octos, Octop: [everydev](https://www.everydev.ai/tools/penguinharness), [PhyAgentOS](https://www.sourcepulse.org/projects/30710154), [Octos](https://www.everydev.ai/tools/octos), [Octop](https://landscape.jimmysong.io/projects/octop/).
- Obelisk: [obeli.sk](https://obeli.sk/docs/v0.41.0/concepts/workflows/). OpenClaw / Hermes / ZeroClaw: [comparativa](https://parallel.ai/articles/openclaw-vs-nousresearch-hermes.md).
