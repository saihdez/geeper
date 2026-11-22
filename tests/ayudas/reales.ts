/**
 * Pruebas que hacen trabajo de verdad (whisper, PhotoCraft, VectorCraft, la paridad con el estudio):
 * tardan y dependen de lo instalado en esta PC. `pnpm test` las salta; se corren antes de integrar con
 *   GEEPER_PRUEBAS_REALES=1 pnpm exec vitest run
 */
export const pruebasReales = process.env.GEEPER_PRUEBAS_REALES === "1";
