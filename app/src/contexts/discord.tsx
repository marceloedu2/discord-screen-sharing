'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Onde a página está rodando, e o que isso muda em cada URL que ela monta.
 *
 * O projeto antigo resolvia com duas constantes de módulo (client/src/main.js):
 *
 *     const inDiscord = new URLSearchParams(location.search).has('frame_id');
 *     const P = inDiscord ? '/.proxy' : '';
 *
 * A regra é a mesma; o que muda é o alcance. Constante de módulo é lida na
 * importação, antes de o React montar qualquer coisa, e não sobrevive a render
 * no servidor — aqui o valor nasce da query que o Next entrega e desce pela
 * árvore, que é o único jeito de as duas metades do produto concordarem.
 */
type Discord = {
  /**
   * Estamos dentro do Discord se, e somente se, a query tem `frame_id`
   * (RN-SES-1). O Discord injeta `frame_id` e `instance_id` na URL do iframe;
   * sem eles, é navegador comum.
   */
  inDiscord: boolean;

  /**
   * `/.proxy` dentro da Activity, vazio fora dela (RN-PRO-3). Dentro do iframe
   * todo fetch e todo WebSocket precisa do prefixo, ou o proxy do Discord não
   * repassa.
   */
  prefix: string;

  /** Caminho de uma rota HTTP já com o prefixo do contexto. */
  api: (path: string) => string;

  /**
   * URL absoluta do WebSocket, com o prefixo do contexto.
   *
   * Só para chamar do navegador — depende de `location`, que não existe na
   * renderização do servidor.
   */
  ws: (path: string) => string;
};

const ContextoDiscord = createContext<Discord | null>(null);

export function DiscordProvider({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const inDiscord = params.has('frame_id');

  const value = useMemo<Discord>(() => {
    const prefix = inDiscord ? '/.proxy' : '';
    return {
      inDiscord,
      prefix,
      api: (path) => `${prefix}${path}`,
      ws: (path) => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        return `${proto}://${location.host}${prefix}${path}`;
      },
    };
  }, [inDiscord]);

  return <ContextoDiscord value={value}>{children}</ContextoDiscord>;
}

/**
 * Falha alto quando o provider não está acima.
 *
 * O sintoma alternativo seria uma URL sem prefixo dentro da Activity: o pedido
 * sai, o proxy do Discord recusa, e o erro aparece longe daqui.
 */
export function useDiscord(): Discord {
  const value = useContext(ContextoDiscord);
  if (!value) throw new Error('useDiscord precisa de <DiscordProvider> acima na árvore.');
  return value;
}
