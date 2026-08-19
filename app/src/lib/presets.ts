/**
 * Os presets de qualidade, nomeados por resolução (RF-TRX-11).
 *
 * O Discord escolhe por resolução e taxa de quadros, com o bitrate como
 * consequência. Aqui era o contrário — escolhia-se Mbps —, e "720p" diz mais do
 * que "1 Mbps" para quem só quer escolher. A troca é de rótulo e de modelo
 * mental, não de capacidade: o modo avançado mantém bitrate e fps separados
 * para quem quiser (RN-TRX-35).
 */
export interface Preset {
  id: 'leve' | 'boa' | 'alta' | 'maxima';
  name: string;
  /** Teto de altura; a redução é proporcional, nunca corta (RN-TRX-36). */
  maxHeight: number;
  fps: number;
  bitrate: number;
  resumo: string;
}

export const PRESETS: readonly Preset[] = [
  { id: 'leve', name: 'Leve', maxHeight: 720, fps: 15, bitrate: 1_000_000, resumo: '720p · 15 fps' },
  { id: 'boa', name: 'Boa', maxHeight: 1080, fps: 30, bitrate: 2_500_000, resumo: '1080p · 30 fps' },
  { id: 'alta', name: 'Alta', maxHeight: 1080, fps: 60, bitrate: 5_000_000, resumo: '1080p · 60 fps' },
  {
    id: 'maxima',
    name: 'Máxima',
    maxHeight: 1080,
    fps: 60,
    bitrate: 8_000_000,
    resumo: '1080p · 60 fps',
  },
];

/** O padrão é "Boa" (RF-TRX-2). */
export const PRESET_PADRAO = PRESETS[1] as Preset;

export const presetDe = (id: string | null): Preset =>
  PRESETS.find((p) => p.id === id) ?? PRESET_PADRAO;
