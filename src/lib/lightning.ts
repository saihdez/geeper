/**
 * Ajustes de Wan2GP sin dependencias de servidor: los usan actuar.ts (el avatar que hace algo) y los
 * estilos de «Nuevo» (estilos-generacion.ts, que también carga el navegador).
 */
import type { AjustesWan2gp } from "./wan2gp";

/** Lightning 4 pasos para Wan 2.2 I2V A14B (perfil «Lightning i2v v2025-10-14 2 Phases» de Wan2GP). */
export const LIGHTNING_I2V: AjustesWan2gp = {
  num_inference_steps: 4,
  guidance_scale: 1,
  guidance2_scale: 1,
  switch_threshold: 876,
  model_switch_phase: 1,
  guidance_phases: 2,
  flow_shift: 5,
  sample_solver: "euler",
  loras_multipliers: "1;0 0;1",
  activated_loras: [
    "https://huggingface.co/DeepBeepMeep/Wan2.2/resolve/main/loras_accelerators/Wan2.2_I2V_A14B_HIGH_lightx2v_MoE_distill_lora_rank_64_bf16.safetensors",
    "https://huggingface.co/DeepBeepMeep/Wan2.2/resolve/main/loras_accelerators/Wan2.2_I2V_A14B_LOW_4steps_lora_rank64_Seko_V1_forKJ.safetensors",
  ],
};

/** Interpolación RIFE ×2 de Wan2GP: el I2V A14B sale a 16 cuadros por segundo; así queda a 32, sin saltos. */
export const FLUIDO_X2: AjustesWan2gp = { temporal_upsampling: "rife*2" };
