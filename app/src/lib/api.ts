/**
 * O cliente HTTP do produto: um POST com prazo, e a renovação do crachá.
 *
 * Duas regras herdadas moram aqui, e as duas existem por sintoma:
 *
 * - Prazo de 15 s em todo POST (RN-SES-15). Um pedido pendurado é pior que um
 *   que falha: o que falha diz alguma coisa, o pendurado só deixa a tela parada.
 * - Um 401 numa chamada que levava `identity` significa crachá morto, não falta
 *   de permissão (RF-SES-5). O segredo que assina muda em reinstalação, troca
 *   de máquina ou rotação — e aí todo crachá guardado vira inválido de uma vez.
 *   Sem a renovação, a pessoa ficava presa em "sessão inválida" sem nada na
 *   interface que resolvesse.
 */

export const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  /** 0 quando o pedido nem chegou a ter resposta. */
  readonly status: number;
  /**
   * Um rótulo da recusa, quando o servidor manda um.
   *
   * O status sozinho não basta: dois 403 diferentes — "você não está em call
   * nenhuma" e "você está, mas noutra" — pedem caminhos de saída diferentes, e
   * decidir por texto de mensagem quebraria na primeira vez que ele mudasse.
   */
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type Corpo = Record<string, unknown>;

/**
 * `renew` emite uma identidade nova quando o servidor recusa a atual. Quem a
 * fornece é a camada de sessão, que sabe se estamos dentro do Discord ou não.
 *
 * `retry: false` existe para a própria chamada de renovação não cair nela
 * mesma: um 401 ali significa que renovar não resolve, e insistir viraria laço.
 */
export async function post<T>(
  url: string,
  body: Corpo,
  options: { retry?: boolean; renew?: () => Promise<string | null> } = {}
): Promise<T> {
  const { retry = true, renew } = options;

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError';
    throw new ApiError(
      timeout ? 'O guild não respondeu a tempo.' : 'Não foi possível falar com o guild.',
      0
    );
  }

  const data: { error?: string } & Record<string, unknown> = await resposta
    .json()
    .catch(() => ({}));

  if (!resposta.ok) {
    if (resposta.status === 401 && retry && renew && body.identity) {
      const fresh = await renew();
      if (fresh) return post<T>(url, { ...body, identity: fresh }, { retry: false });
    }

    // O status carrega significado — 403 senha, 429 bloqueio, 404 sala fechou —
    // então vai junto do erro em vez de virar texto.
    throw new ApiError(data.error ?? `Servidor respondeu ${resposta.status}.`, resposta.status);
  }

  return data as T;
}
