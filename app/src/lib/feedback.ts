/**
 * Relato de bug e feedback: validação e envio (spec 12).
 *
 * Os limites espelham os de server/src/feedback.ts. Aqui eles só poupam a
 * pessoa de esperar um upload para ouvir "grande demais"; quem vale é o
 * servidor, que confere o formato pelos bytes e não pelo nome do arquivo.
 */

export type FeedbackKind = 'bug' | 'feedback';

export const FEEDBACK_LIMITS = {
  title: { min: 3, max: 100 },
  description: { min: 10, max: 1500 },
  steps: { max: 1000 },
  contact: { max: 100 },
  images: { max: 5, maxBytes: 8 * 1024 * 1024 },
} as const;

/** Formatos que o servidor aceita; SVG fica de fora porque pode carregar script. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const IMAGE_TYPES = new Set(IMAGE_ACCEPT.split(','));
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** Envio de imagens é o pedido lento; o prazo padrão de 15 s do resto não serve. */
const SEND_TIMEOUT_MS = 90_000;

export const megabytes = (bytes: number) => (bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

const isImage = (file: File) => IMAGE_TYPES.has(file.type) || (!file.type && IMAGE_EXT.test(file.name));
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Soma arquivos novos aos já anexados, na ordem, respeitando o teto.
 *
 * @returns a lista nova e os motivos de cada recusa — a pessoa precisa saber por
 * que uma imagem não entrou, e "nada aconteceu" é o pior jeito de dizer.
 */
export function addImages(current: File[], incoming: File[]): { files: File[]; problems: string[] } {
  const files = [...current];
  const problems: string[] = [];

  for (const file of incoming) {
    if (files.some((f) => sameFile(f, file))) continue;
    if (!isImage(file)) {
      problems.push(`“${file.name}” não é PNG, JPG, GIF ou WebP.`);
    } else if (file.size > FEEDBACK_LIMITS.images.maxBytes) {
      problems.push(`“${file.name}” tem ${megabytes(file.size)} MB; o limite é ${megabytes(FEEDBACK_LIMITS.images.maxBytes)} MB.`);
    } else if (files.length >= FEEDBACK_LIMITS.images.max) {
      problems.push(`Só cabem ${FEEDBACK_LIMITS.images.max} imagens; “${file.name}” ficou de fora.`);
    } else {
      files.push(file);
    }
  }
  return { files, problems };
}

export interface FeedbackDraft {
  kind: FeedbackKind;
  title: string;
  description: string;
  steps: string;
  contact: string;
  images: File[];
}

export type FieldName = 'title' | 'description';

/** O primeiro campo inválido e a mensagem, ou null se pode enviar. */
export function checkDraft(draft: FeedbackDraft): { field: FieldName; message: string } | null {
  if (draft.title.trim().length < FEEDBACK_LIMITS.title.min) {
    return { field: 'title', message: `Dê um resumo com ao menos ${FEEDBACK_LIMITS.title.min} caracteres.` };
  }
  if (draft.description.trim().length < FEEDBACK_LIMITS.description.min) {
    return {
      field: 'description',
      message: `Conte um pouco mais: a descrição precisa de ao menos ${FEEDBACK_LIMITS.description.min} caracteres.`,
    };
  }
  return null;
}

export class FeedbackError extends Error {
  /** Em quanto tempo vale tentar de novo, quando o servidor diz. */
  readonly retryAfter: number | null;
  constructor(message: string, retryAfter: number | null = null) {
    super(message);
    this.name = 'FeedbackError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Manda o relato.
 *
 * `where` e `viewport` são contexto que ajuda a reproduzir e que a pessoa
 * jamais escreveria: onde estava e o tamanho da janela. Só caminho e `?room=` —
 * nunca o fragmento (`#identity=`), que carrega o crachá.
 */
export async function sendFeedback(
  url: string,
  draft: FeedbackDraft,
  context: { identity: string | null; name: string; where: string; viewport: string; website: string },
  signal?: AbortSignal
): Promise<void> {
  const form = new FormData();
  form.append('kind', draft.kind);
  form.append('title', draft.title.trim());
  form.append('description', draft.description.trim());
  if (draft.kind === 'bug' && draft.steps.trim()) form.append('steps', draft.steps.trim());
  if (draft.contact.trim()) form.append('contact', draft.contact.trim());
  form.append('where', context.where);
  form.append('viewport', context.viewport);
  form.append('website', context.website);
  if (context.identity) form.append('identity', context.identity);
  form.append('name', context.name);
  draft.images.forEach((image) => form.append('images', image, image.name));

  const timeout = AbortSignal.timeout(SEND_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new FeedbackError(
      timedOut
        ? 'O envio demorou demais. Se tiver imagens grandes, tente com menos ou menores.'
        : 'Não consegui falar com o servidor. Confira sua conexão e tente de novo.'
    );
  }

  if (response.ok) return;

  const data = (await response.json().catch(() => null)) as { error?: string; retryAfter?: number } | null;
  throw new FeedbackError(
    data?.error ?? 'Não consegui enviar agora. Tente de novo em instantes.',
    typeof data?.retryAfter === 'number' ? data.retryAfter : null
  );
}
