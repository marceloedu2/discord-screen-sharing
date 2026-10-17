# 12 — Feedback e relato de bugs

Um botão no cabeçalho (e "Enviar feedback" no menu "Mais opções") abre um
formulário que publica o relato num canal do Discord da equipe.

## O que a pessoa faz

`RF-FBK-1` · novo · P1 — O botão fica no cabeçalho, no lobby e na sala, e abre
o modal. Fecha com `Esc`, clique fora e **Cancelar**, e o foco volta ao botão.

`RF-FBK-2` · novo · P1 — Campos:

| Campo | Regra |
|---|---|
| Tipo | **Relatar um bug** (padrão) ou **Dar um feedback** |
| Resumo | obrigatório, 3–100 caracteres |
| Descrição | obrigatória (não pode ficar em branco), **sem mínimo de caracteres**, até 1500, com contador |
| Como reproduzir | só em bug, opcional, até 1000 |
| Contato | opcional, até 100 (usuário do Discord ou e-mail) |
| Imagens | opcional, até **5**, **8 MB** cada, PNG · JPG · GIF · WebP |

`RF-FBK-3` · novo · P1 — Imagens entram por **botão, arrastar e colar** (Ctrl+V
num print recém-tirado). Cada uma ganha miniatura e botão de remover; arquivo
repetido não duplica. Recusa (tipo, tamanho, passou de 5) **diz o motivo** — nada
de "não aconteceu nada".

`RN-FBK-1` · novo · P1 — Erro de validação foca o primeiro campo inválido e
nada é enviado. Erro de envio **mantém o formulário preenchido** (texto e
imagens) e deixa tentar de novo. Fechar durante o envio cancela o pedido e não
mostra sucesso.

`RN-FBK-2` · novo · P1 — O modal diz o que vai junto sem a pessoa digitar: nome
exibido, tela e sala, tamanho da janela, navegador. A política de privacidade
também (`/privacidade`, 2.2). Nunca vai o fragmento da URL (`#identity=`).

## O que o servidor faz

`RF-FBK-4` · novo · P0 — `POST /api/feedback`, `multipart/form-data`. Rota
**crua**: não passa pelo leitor de JSON de 64 KB; o teto do corpo
(5 × 8 MB + 256 KB) é imposto em fluxo, e passar dele responde **413** sem
bufferizar o resto. Entra em `infra/server-paths.mjs` e no `Caddyfile`.

`RF-FBK-5` · novo · P0 — O envio ao Discord é `POST /channels/{id}/messages`
**como bot**, com `payload_json` (um embed) e as imagens em `files[n]`. A
primeira imagem aparece **dentro do embed**; as demais, como anexos logo abaixo
(verificado no Discord real). Canal e servidor vêm de `FEEDBACK_CHANNEL_ID` e
`FEEDBACK_GUILD_ID` (padrão: o canal dos Sapekadores). Precisa do
`DISCORD_BOT_TOKEN` e, no canal, de Ver canal, Enviar mensagens, Anexar arquivos
e Inserir links. O token **nunca** chega ao navegador.

`RN-FBK-3` · novo · P0 — **O formato da imagem sai dos bytes**, não do nome nem
do `Content-Type`: PNG, JPEG, GIF e WebP por assinatura. SVG, HTML e executável
com nome `.png` são recusados (400). O nome do anexo é sempre nosso
(`imagem-N.ext`).

`RN-FBK-4` · novo · P0 — Nada no relato pode pingar ninguém: `allowed_mentions`
vazio, e `@everyone`, `@here` e `<@` ganham um espaço de largura zero para não
parecerem ativos. Caracteres de controle e de inversão de texto saem, e o corte
é por ponto de código (não parte emoji).

`RN-FBK-5` · novo · P0 — **Limite por endereço**: 3 relatos a cada 10 min
(`FEEDBACK_RATE_MAX`) e teto global de 30 (`FEEDBACK_RATE_GLOBAL`). É por
endereço, e não por identidade, porque qualquer um cria convidados à vontade. O
endereço é o primeiro `X-Forwarded-For` (o Caddy sobrescreve o de quem chega de
fora). **Só entrega conta**: falha do Discord não gasta a cota. Excedeu: 429 com
`Retry-After`.

`RN-FBK-6` · novo · P1 — Campo-armadilha `website`, fora da tela e fora da ordem
de foco: preenchido, a resposta é 200 e **nada** é enviado.

`RN-FBK-7` · novo · P1 — Falhas do Discord: 401/403/404 (token, permissão ou
canal errados) viram **502 genérico** — o detalhe fica no log do servidor, nunca
na resposta; 429 vira 503 com `retryAfter`; Discord fora do ar, 502.

`RF-FBK-6` · novo · P1 — **O cartão diz de onde veio e de quem é.** Campos
**Sala** (o nome, lido do registro do servidor pelo id que o cliente manda —
nunca o nome vindo do cliente; "(call do Discord)" nas salas de call; "Fora de
uma sala (lobby)" sem sala ou com id desconhecido) e **Discord**.

`RN-FBK-8` · novo · P1 — **Discord só para conta de verdade.** Quem entrou pelo
Discord (crachá assinado, `uid` numérico de 15 a 21 dígitos) ganha: menção
`<@id>` (aparece como o nome, e **não pinga** — `allowed_mentions` vazio), link
do perfil, e o autor do cartão com nome, link e foto (hash validado). Convidado,
id de teste, crachá forjado, expirado ou de outro tipo: "Convidado, sem conta do
Discord", sem link nem foto. O nome mostrado é o apelido atual (o crachá guarda o
de quando foi emitido), mas o **id é sempre o do crachá** — o apelido é só rótulo
e passa pelo mesmo desarme de menções.

## Testes

`e2e/feedback-api.spec.ts` (servidor, contra `e2e/discord-mock.mjs`) e
`e2e/feedback-ui.spec.ts` (navegador). A suíte sobe um **Discord falso** e
sobrescreve `PUBLIC_ORIGIN`, as credenciais do Discord e o bot do `.env`: o teste
nunca posta no canal de verdade. A entrega real foi conferida à mão, uma vez,
com a mensagem apagada em seguida.
