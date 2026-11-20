# Geeper: instrucciones para agentes

Geeper es el estudio de video local de Dimerso: de un tema o de material largo a un video corto
terminado, editable y con control de calidad (QC). Uso interno, en una sola PC (RTX 5080 de 16 GB,
WSL), US$0 al mes. Escribe código, comentarios, documentos y respuestas en **español** (tuteo).

Antes de un cambio grande, lee `README.md`, `docs/PRODUCTO.md`, `docs/BRECHAS.md` y
`docs/DECISIONES.md` (qué se decidió, por qué y qué se descartó).

## Mapa

| Carpeta | Qué hay |
|---|---|
| `src/lib/` | Toda la lógica: esquema de `geeper.json` (`esquema.ts`), compilador a Hyperframes, QC, cola, ediciones, clips, redes |
| `src/app/`, `src/components/` | Next.js 16 (App Router): páginas y API en `/api/*` |
| `worker/` | El worker de la cola (SQLite con *lease*): un ejecutor por motor |
| `py/` | Scripts de Python (caras, reencuadre, facecam) que corre Geeper como procesos aparte |
| `scripts/` | CLI para la terminal y para agentes (`proponer.ts`, `encolar.ts`, `importar-clip.ts`, `momentos.ts`, `doctor.ts`…); `scripts/ui/` son capturas de la UI con Playwright |
| `tests/` | Vitest; `tests/fixtures.ts` tiene un proyecto de prueba |
| `docs/` | Producto, decisiones, brechas y planes. `docs/esquemas/`: JSON Schema de los contratos |
| `~/geeper-data/` | Datos (fuera del repo): `geeper.db`, un directorio por proyecto con `geeper.json`, `assets/`, `renders/`, `build/` |

## Comandos

```bash
pnpm run dev:up       # web en http://localhost:3300 + worker; Ctrl+C apaga los dos
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # eslint
pnpm test             # vitest (sin GPU ni Docker)
pnpm run doctor       # sólo lectura: qué falta en la PC y cómo arreglarlo
pnpm run esquemas     # regenera docs/esquemas/*.schema.json desde Zod
```

Un cambio está terminado cuando `typecheck`, `lint` y `test` están en verde. Si cambias un esquema Zod
de `src/lib/contratos.ts`, corre `pnpm run esquemas` (una prueba falla si te olvidas).

## Editar un proyecto

`~/geeper-data/<slug>/geeper.json` es la **fuente de verdad**; Hyperframes (`build/`) es sólo un destino
de compilación. **Nunca edites `geeper.json` ni `build/` a mano**: propone el cambio y deja que Geeper lo
valide, muestre las diferencias y lo guarde como versión nueva.

```bash
pnpm tsx scripts/proponer.ts <slug> propuesta.json             # valida y muestra diferencias
pnpm tsx scripts/proponer.ts <slug> propuesta.json --aplicar   # sólo con el visto bueno de la persona
pnpm tsx scripts/encolar.ts <slug> render.entregar
```

- Tipos de edición y el esquema en corto: `.claude/skills/geeper/SKILL.md`.
- Esquema completo: `docs/esquemas/geeper.schema.json` (JSON Schema 2020-12). La referencia exacta es
  Zod (`src/lib/esquema.ts`): las reglas de consistencia (escenas y pistas alineadas, recortes válidos)
  sólo están ahí.
- Otros contratos en `docs/esquemas/`: `propuesta-anuncio` (campañas), `ganchos` y `titulos` (salida
  del modelo local), `director` (storyboard de G1).

## Reglas duras

- **La persona aprueba.** Nada se aplica, renderiza ni publica sin su visto bueno. Publicar en redes es
  sólo desde la UI; nunca toques cuentas ni tokens.
- **Un trabajo de GPU a la vez**, siempre con `~/dev/video-tools/bin/gpu-lock` (en código:
  `tomarGpu` de `src/lib/gpu.ts`). Pide permiso antes de la primera generación con GPU de la sesión y
  avisa que se guarde el trabajo: Windows se ha reiniciado durante generaciones.
- **US$0**: sólo modelos y herramientas locales; nada que obligue a una cuenta o servicio pago.
  Todo servicio nuevo es opcional y apagado por defecto.
- **Licencias**: toda dependencia, modelo o material nuevo va con su licencia en `MODELOS.md` antes de
  usarse. Nada de material de Rockstar (logos, personajes, capturas, música) en ninguna plantilla.
- **Pesos de modelos**: sólo SafeTensors, GGUF, GGML u ONNX; nunca pesos *pickle* (`.pt`, `.pth`,
  `.ckpt`, `.bin` de PyTorch), que ejecutan código al cargarse. Cada descarga fijada a un commit o
  release y con SHA-256 comprobado (como YuNet en `src/lib/caras.ts`). Detalle en `MODELOS.md`.
- **Secretos**: los de redes nunca van a logs ni a errores; pasa todo texto por `tapar()` de
  `src/lib/redes/secretos.ts`. No leas ni muestres `.env*` ni claves.
- **Docker**: no toques contenedores que no sean de MoneyPrinterTurbo (`mpt-*`). Nunca
  `docker system prune`, `docker volume prune` ni `docker compose down -v`. Sin `sudo`.
- **Git**: puede haber otra sesión editando a la vez: `git status` antes de empezar, `test -e` antes de
  crear un archivo y una rama propia por trabajo (o un *worktree* en `.claude/worktrees/`). No toques
  `main`. Commits como `saihdez`, sin *push*.
- Las cifras de blogs o láminas no valen como medición: lo que diga «medir» se mide en esta PC y se
  anota con fecha.
- Cada decisión nueva va a `docs/DECISIONES.md` (qué, por qué, qué se descartó).
