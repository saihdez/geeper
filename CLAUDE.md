# Geeper: guía corta para agentes

Estudio de video local de Dimerso: de la idea al video terminado y editable. Corre en esta PC (WSL +
RTX 5080) y como app de escritorio (Windows y macOS). Responde en español, con tuteo en el código y en la
interfaz («crea», «puedes», nunca «creá»). Los textos de pantalla son para alguien que no sabe de
video: palabras simples, un paso a la vez, sin rutas ni nombres técnicos a la vista.

Este archivo es el índice. **No leas todos los documentos al empezar**: lee la sección que tu tarea
necesita (mapa más abajo).

## Reglas que no se rompen

- **US$0 al mes.** Ningún servicio de nube ni API paga. Si algo parece necesitarlo, propónlo con su
  costo mensual y no lo implementes. Sin dependencias nuevas salvo que la tarea lo pida.
- **Un trabajo de GPU a la vez**, siempre por `~/dev/video-tools/bin/gpu-lock`. Pide permiso antes de
  la primera generación con GPU de la sesión (Windows se reinicia sin aviso).
- **Nunca reintentes solo un trabajo de GPU** que corría durante un reinicio: queda «interrumpido» y lo
  relanza la persona desde la UI.
- **Contenedores de Farol:** no toques `supabase_*_farol` ni `farol-dev-redis`. Nunca
  `docker system prune`, `docker volume prune` ni `docker compose down -v`.
- **Sin `sudo`.** Si hace falta, dale al dueño el comando exacto.
- **Datos fuera del repo:** `~/geeper-data/` (base `geeper.db` y un directorio por proyecto). No borres
  ni modifiques nada ahí ni en las cachés de modelos. Para probar, usa otra carpeta (ver «Probar»).
- **Puerto 3300** es el de Geeper en uso; el 3000 es de Farol y de Remotion.
- **Secretos nunca en git** (`.env*`, claves de las redes, `redes.json`).
- **`geeper.json` es la fuente de verdad** de cada proyecto (esquema Zod en `src/lib/esquema.ts`).
  Hyperframes (0.9.27 fijado) es un destino de compilación, no el formato guardado.
- **Sesiones en paralelo:** otra sesión suele editar el repo a la vez. Antes de crear un archivo,
  comprueba que no exista; commitea sólo lo tuyo; no uses `git stash` sin etiqueta ni `git reset --hard`.
- Commits: Conventional Commits en español. Sin push hasta que el dueño lo pida.

## Comandos de calidad

```bash
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint .
pnpm test               # vitest run (las pruebas de trabajo real se saltan; ver abajo)
pnpm test:escritorio    # las que corren también en Windows y macOS (CI)
pnpm run doctor         # qué falta en el equipo y cómo arreglarlo (sólo lectura)
```

- Pruebas que hacen trabajo real (whisper, PhotoCraft, VectorCraft, paridad de subtítulos): sólo con
  `GEEPER_PRUEBAS_REALES=1 pnpm exec vitest run`. Córrelas antes de integrar si tocaste esas partes.
- Una prueba que toque la GPU usa un candado falso: `GPU_LOCK=/tmp/gpu-prueba-$$.lock`.
- Código muerto: `pnpm dlx knip` con el `knip.json` del repo (knip no es dependencia). Quita un
  `export` sobrante sólo cuando ya estés tocando ese archivo.

## Probar sin tocar los datos reales

```bash
export GEEPER_DATA=/tmp/geeper-prueba GEEPER_DB=/tmp/geeper-prueba/geeper.db
pnpm exec prisma db push && pnpm tsx prisma/seed.ts
pnpm exec next dev --port 3310 & GPU_LOCK=/tmp/gpu-falso.lock pnpm run worker
```

Para que la prueba no use la tarjeta, deja tomado ese candado: `flock -x /tmp/gpu-falso.lock sleep 86400 &`
(el render cae a CPU y lo que espera la GPU se queda en fila).

UI: `pnpm tsx scripts/ui/capturas.ts /tmp/capturas [proyectoId]` (1440 px y teléfono, sin errores).

## Cómo está hecho (mapa del código)

| Parte | Dónde |
|---|---|
| Web (Next.js 16, App Router) | `src/app/` (páginas y `api/`), `src/components/` |
| Lógica compartida | `src/lib/` (una pieza por archivo: `cola.ts`, `compilador.ts`, `render.ts`, `qc.ts`…) |
| Base (Prisma 7 sobre SQLite) | `prisma/schema.prisma`, `src/lib/db.ts`; cliente en `src/generated/` |
| Cola y worker | `src/lib/cola.ts` (lease, `input_hash`), `worker/index.ts`, `worker/ejecutores.ts` |
| Redes (publicar) | `src/lib/redes/` |
| Python del estudio | `py/` (caras, alineación, reencuadre, voz) |
| App de escritorio | `escritorio/` (Electron), `scripts/escritorio/empaquetar.ts`, `.github/workflows/escritorio.yml` |
| Scripts de terminal | `scripts/` (`dev-up.ts`, `doctor.ts`, `ui/`, `novedades.ts`) |
| Pruebas | `tests/` (vitest), ayudas en `tests/ayudas/` |
| Skill de Claude | `.claude/skills/geeper/SKILL.md` (proponer cambios a `geeper.json`) |

`pnpm run dev:up` arranca web (:3300) y worker juntos; el worker no recarga código en caliente: tras
cambiar código, reinícialo (lo que corría queda «interrumpido»).

## Para esto, lee esto

| Si vas a… | Lee |
|---|---|
| Entender qué es Geeper, sus principios y la arquitectura | `docs/PRODUCTO.md` §1, §2 y §5 |
| Tocar calidad (sonoridad, color, subtítulos) | `docs/PRODUCTO.md` §7 y `docs/DECISIONES.md` §10–13 |
| Cambiar una decisión ya tomada (voz, música, NVENC, vista previa…) | `docs/DECISIONES.md`, la sección del tema |
| Trabajar en la cola, reinicios o reanudar | `docs/PRODUCTO.md` §8 y `docs/DECISIONES.md` §7, §12 y §20 |
| Clips de material largo | `docs/DECISIONES.md` §21–22 |
| Elegir qué construir después | `docs/BRECHAS.md` §2–3 |
| Usar un modelo o revisar su licencia | `MODELOS.md` y `docs/PRODUCTO.md` §9 |
| Traer algo de otro repo (storytold, ComfyUI, Wan2GP…) | `docs/HEREDADO.md`, sólo la sección de ese repo; `docs/fuentes.json` |
| La app de escritorio o los instaladores | `docs/ESCRITORIO.md` |
| Publicar en redes | `docs/PUBLICAR.md` y `docs/TRAMITES.md` |
| Anuncios | `docs/ANUNCIOS.md` |
| PhotoCraft / EffectCraft | `docs/PHOTOCRAFT.md`, `docs/EFFECTCRAFT.md` |
| VPN para el equipo | `docs/VPN.md` |
| Instalar y usar (lo que ve la persona) | `README.md` «Instalación» y «Uso» |
| El alcance original del MVP | `docs/ENCARGO-MVP.md` |

## Al terminar una tarea

1. `pnpm typecheck && pnpm lint` y las pruebas que toquen lo cambiado, en verde.
2. Si cambiaste algo que la persona ve, revísalo en la UI (capturas a 1440 px y en teléfono).
3. Si tomaste una decisión que cuesta revertir, anótala en `docs/DECISIONES.md`.
