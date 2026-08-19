import { read, remove, store } from './storage';

/**
 * Os dois volumes, como no Discord (RF-AUD-1).
 *
 * O geral vale para tudo que chega e sobrevive a trocar de sala (RN-AUD-13) —
 * é preferência de quem assiste, não estado de uma transmissão. O por pessoa
 * vale para uma transmissão e é guardado **por pessoa, não por sessão**
 * (RN-AUD-10): quem sempre chega alto demais continua ajustado amanhã.
 */

const OVERALL = 'volume';
// A chave guardada é herdada: renomeá-la orfanaria o ajuste de quem já usou.
const PER_PERSON = 'volumePessoa';

export function readVolume(): number {
  const raw = Number(read(OVERALL));
  return Number.isFinite(raw) && read(OVERALL) !== null ? Math.min(1, Math.max(0, raw)) : 1;
}

export const saveVolume = (value: number) => store(OVERALL, String(value));

export function readVolumes(): Map<string, number> {
  try {
    return new Map(Object.entries(JSON.parse(read(PER_PERSON) ?? '{}') as Record<string, number>));
  } catch {
    return new Map();
  }
}

/**
 * 100% é o padrão e **não é guardado** (RN-AUD-11). Não ter registro significa
 * "nunca foi mexido", e é o que mantém o armazenamento pequeno depois de muita
 * gente passar pela sala.
 */
export function saveVolumeDe(userId: string, value: number): Map<string, number> {
  const all = readVolumes();
  if (value === 1) all.delete(userId);
  else all.set(userId, value);

  if (all.size === 0) remove(PER_PERSON);
  else store(PER_PERSON, JSON.stringify(Object.fromEntries(all)));

  return all;
}
