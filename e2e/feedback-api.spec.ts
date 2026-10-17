import { test, expect } from '@playwright/test';
import { BASE, guest, post, healthy, assinar } from './ws';

/**
 * A rota /api/feedback contra um Discord falso (e2e/discord-mock.mjs): o que o
 * relay manda para o canal, o que ele recusa antes de mandar, e como reage
 * quando o Discord responde mal. Nada aqui toca o Discord de verdade.
 */
const MOCK = 'http://127.0.0.1:4999';
const CANAL = '1561141729648840754';

interface Gravado {
  channel: string;
  authorization: string | null;
  payload: { embeds: any[]; allowed_mentions: { parse: string[] }; attachments: { id: number; filename: string }[] } | null;
  files: { field: string; name: string; type: string; size: number; head: string }[];
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46494600010100', 'hex');
const GIF = Buffer.from('474946383961010001000000002c', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const preenchido = (cabeca: Buffer, tamanho: number) => Buffer.concat([cabeca, Buffer.alloc(Math.max(0, tamanho - cabeca.length), 7)]);

let ip = 0;
/** Cada teste é "uma pessoa" com seu endereço: o limite por pessoa não vaza de um para o outro. */
const novoEndereco = () => `10.9.${Math.floor(++ip / 250)}.${(ip % 250) + 1}-${Date.now()}`;

interface Envio {
  kind?: string;
  title?: string;
  description?: string;
  steps?: string;
  contact?: string;
  where?: string;
  viewport?: string;
  website?: string;
  identity?: string;
  room?: string;
  images?: { bytes: Buffer; name?: string; type?: string }[];
  ip?: string;
  rota?: string;
}

async function enviar(e: Envio = {}) {
  const form = new FormData();
  const campos = { kind: 'bug', title: 'O vídeo trava', description: 'Ao assistir a tela, o vídeo congela depois de um minuto.', ...e };
  for (const k of ['kind', 'title', 'description', 'steps', 'contact', 'where', 'viewport', 'website', 'identity', 'room'] as const) {
    if (campos[k] !== undefined) form.append(k, campos[k]!);
  }
  for (const [i, img] of (e.images ?? []).entries()) {
    form.append('images', new Blob([img.bytes], { type: img.type ?? 'image/png' }), img.name ?? `foto-${i}.png`);
  }
  const r = await fetch(`${BASE}${e.rota ?? '/api/feedback'}`, {
    method: 'POST',
    body: form,
    headers: { 'x-forwarded-for': e.ip ?? novoEndereco() },
  });
  return { status: r.status, headers: r.headers, data: (await r.json().catch(() => null)) as any };
}

const gravados = async (): Promise<Gravado[]> => (await fetch(`${MOCK}/__requests`)).json();
const modo = (m: object) => fetch(`${MOCK}/__mode`, { method: 'POST', body: JSON.stringify(m) });

test.describe('POST /api/feedback', () => {
  test.beforeEach(async () => {
    await fetch(`${MOCK}/__reset`, { method: 'POST' });
  });
  test.afterEach(async () => {
    expect(await healthy(), 'servidor de pé').toBe(true);
  });

  test('bug com várias imagens: vai para o canal certo, como bot, com embed e anexos', async () => {
    const identity = await guest('Ana Teste');
    const r = await enviar({
      identity,
      steps: '1. Abrir a sala\n2. Assistir',
      contact: 'ana@exemplo.com',
      where: 'sala · /?room=abc',
      viewport: '1280×720',
      images: [
        { bytes: preenchido(PNG, 5000), name: 'print final.png' },
        { bytes: preenchido(JPG, 3000), name: 'x.jpeg', type: 'image/jpeg' },
        { bytes: preenchido(GIF, 2000), name: 'a.gif', type: 'image/gif' },
        { bytes: preenchido(WEBP, 2000), name: 'b.webp', type: 'image/webp' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
    expect(r.data.link).toMatch(new RegExp(`^https://discord.com/channels/576022672983457802/${CANAL}/`));

    const [msg] = await gravados();
    expect(await gravados()).toHaveLength(1);
    expect(msg!.channel).toBe(CANAL);
    expect(msg!.authorization).toBe('Bot token-de-teste');

    const embed = msg!.payload!.embeds[0];
    expect(embed.title).toBe('🐞 Bug: O vídeo trava');
    expect(embed.description).toContain('o vídeo congela');
    const campo = (nome: string) => embed.fields.find((f: any) => f.name === nome)?.value;
    expect(campo('Passos para reproduzir')).toContain('2. Assistir');
    expect(campo('Contato')).toBe('ana@exemplo.com');
    expect(campo('Enviado por')).toMatch(/^Ana Teste \(`guest-/);
    expect(campo('Onde')).toBe('sala · /?room=abc');
    expect(campo('Tela')).toBe('1280×720');
    expect(campo('Imagens')).toBe('4');
    expect(embed.image.url).toBe('attachment://imagem-1.png');

    // Nomes são nossos, o tipo vem dos bytes, e a ordem se mantém.
    expect(msg!.files.map((f) => [f.field, f.name, f.type])).toEqual([
      ['files[0]', 'imagem-1.png', 'image/png'],
      ['files[1]', 'imagem-2.jpg', 'image/jpeg'],
      ['files[2]', 'imagem-3.gif', 'image/gif'],
      ['files[3]', 'imagem-4.webp', 'image/webp'],
    ]);
    expect(msg!.files[0]!.size).toBe(5000);
    expect(msg!.payload!.attachments.map((a) => a.filename)).toEqual(msg!.files.map((f) => f.name));
  });

  test('feedback sem imagens: sem passos, cor própria, sem campos vazios', async () => {
    const r = await enviar({ kind: 'feedback', title: 'Adorei', description: 'Muito bom poder ver a tela sem sair do Discord.', steps: 'ignorado em feedback' });
    expect(r.status).toBe(200);
    const [msg] = await gravados();
    const embed = msg!.payload!.embeds[0];
    expect(embed.title).toBe('💬 Feedback: Adorei');
    expect(embed.color).toBe(0x5865f2);
    expect(embed.image).toBeUndefined();
    expect(msg!.files).toEqual([]);
    const nomes = embed.fields.map((f: any) => f.name);
    expect(nomes).not.toContain('Passos para reproduzir');
    expect(nomes).not.toContain('Contato');
    expect(nomes).not.toContain('Imagens');
    expect(embed.fields.find((f: any) => f.name === 'Enviado por').value).toBe('Convidado sem identidade');
  });

  test('o relato funciona também pelo prefixo /.proxy da Activity', async () => {
    const r = await enviar({ rota: '/.proxy/api/feedback' });
    expect(r.status).toBe(200);
    expect(await gravados()).toHaveLength(1);
  });

  test('validação: nada chega ao Discord quando o formulário está errado', async () => {
    const casos: [string, Envio, number, string][] = [
      ['sem tipo', { kind: 'outro' }, 400, 'kind'],
      ['título curto', { title: 'ab' }, 400, 'title'],
      ['título só de espaços', { title: '     ' }, 400, 'title'],
      ['descrição vazia (só espaços)', { description: '     ' }, 400, 'description'],
      ['seis imagens', { images: Array.from({ length: 6 }, () => ({ bytes: preenchido(PNG, 100) })) }, 400, 'images-count'],
      ['arquivo que não é imagem, com nome .png', { images: [{ bytes: Buffer.from('MZ\x90\x00 executavel disfarçado') , name: 'foto.png', type: 'image/png' }] }, 400, 'image-type'],
      ['html disfarçado de imagem', { images: [{ bytes: Buffer.from('<html><script>alert(1)</script>'), name: 'a.png' }] }, 400, 'image-type'],
      ['svg (pode carregar script)', { images: [{ bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), name: 'a.svg', type: 'image/svg+xml' }] }, 400, 'image-type'],
      ['imagem de 8 MB + 1 byte', { images: [{ bytes: preenchido(PNG, 8 * 1024 * 1024 + 1) }] }, 400, 'image-size'],
    ];
    for (const [nome, envio, status, code] of casos) {
      const r = await enviar(envio);
      expect(r.status, nome).toBe(status);
      expect(r.data.code, nome).toBe(code);
      expect(typeof r.data.error, nome).toBe('string');
    }
    expect(await gravados(), 'algo escapou da validação').toEqual([]);
  });

  test('imagem de exatamente 8 MB passa; o teto do corpo inteiro responde 413 sem derrubar nada', async () => {
    const limite = await enviar({ images: [{ bytes: preenchido(PNG, 8 * 1024 * 1024) }] });
    expect(limite.status).toBe(200);

    const grande = await enviar({ images: Array.from({ length: 6 }, () => ({ bytes: preenchido(PNG, 7 * 1024 * 1024) })) });
    expect(grande.status).toBe(413);
    expect(grande.data.code).toBe('too-large');
    expect(await gravados()).toHaveLength(1);
  });

  test('texto: limites, controle e menções em massa não passam', async () => {
    await enviar({
      title: `T${'x'.repeat(300)}`,
      description: `@everyone @here <@123456> ${'y'.repeat(5000)}\u0000‮ fim`,
      contact: 'c'.repeat(500),
      where: 'w'.repeat(900),
      viewport: 'v'.repeat(80),
      steps: 's'.repeat(4000),
    });
    const [msg] = await gravados();
    const embed = msg!.payload!.embeds[0];
    expect(embed.title.length).toBeLessThanOrEqual(256);
    // 1500 do texto + 1 espaço de largura zero por menção neutralizada (3 aqui); o limite do Discord é 4096.
    expect(Array.from(embed.description as string).length).toBeLessThanOrEqual(1503);
    expect(embed.description).not.toMatch(/@everyone|@here|<@1/);
    expect(embed.description).toContain('@​everyone');
    expect(embed.description).not.toMatch(/[\u0000‮]/);
    const campo = (n: string) => embed.fields.find((f: any) => f.name === n).value as string;
    expect(Array.from(campo('Contato')).length).toBeLessThanOrEqual(100);
    expect(Array.from(campo('Onde')).length).toBeLessThanOrEqual(200);
    expect(Array.from(campo('Tela')).length).toBeLessThanOrEqual(20);
    expect(Array.from(campo('Passos para reproduzir')).length).toBeLessThanOrEqual(1000);
    // O ping nunca é permitido, com ou sem "@everyone" no texto.
    expect(msg!.payload!.allowed_mentions).toEqual({ parse: [] });
  });

  test('emoji e acentos sobrevivem inteiros, e o corte não parte um emoji ao meio', async () => {
    await enviar({ title: 'Ação não funciona 😀', description: `${'😀'.repeat(1499)}ab` });
    const [msg] = await gravados();
    const embed = msg!.payload!.embeds[0];
    expect(embed.title).toBe('🐞 Bug: Ação não funciona 😀');
    expect(Array.from(embed.description as string)).toHaveLength(1500);
    expect(embed.description).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  test('campo-armadilha: robô recebe sucesso e nada é enviado', async () => {
    const r = await enviar({ website: 'http://spam.example' });
    expect(r.status).toBe(200);
    expect(await gravados()).toEqual([]);
  });

  test('identidade inválida ou de sala não vira autoria: aparece como convidado sem identidade', async () => {
    for (const identity of ['lixo', 'a.b', (await post('/api/rooms/create', { identity: await guest(), name: 'x' })).data.viewerToken]) {
      expect((await enviar({ identity })).status).toBe(200);
    }
    for (const m of await gravados()) {
      expect(m.payload!.embeds[0].fields.find((f: any) => f.name === 'Enviado por').value).toBe('Convidado sem identidade');
    }
  });

  test('limite por endereço: o 4º relato em 10 min leva 429 com Retry-After; outro endereço não é afetado', async () => {
    const ip = novoEndereco();
    for (let i = 0; i < 3; i++) expect((await enviar({ ip })).status).toBe(200);
    const bloqueado = await enviar({ ip });
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.data.code).toBe('rate');
    expect(bloqueado.data.retryAfter).toBeGreaterThan(0);
    expect(Number(bloqueado.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await enviar()).status).toBe(200);
    expect(await gravados()).toHaveLength(4);
  });

  test('mudar de identidade não burla o limite (convidados são de graça)', async () => {
    const ip = novoEndereco();
    for (let i = 0; i < 3; i++) expect((await enviar({ ip, identity: await guest(`G${i}`) })).status).toBe(200);
    expect((await enviar({ ip, identity: await guest('G4') })).status).toBe(429);
  });

  test('falha do Discord não gasta a cota de quem tentou', async () => {
    const ip = novoEndereco();
    await modo({ status: 500 });
    for (let i = 0; i < 4; i++) expect((await enviar({ ip })).status).toBe(502);
    await modo({ status: 200 });
    expect((await enviar({ ip })).status).toBe(200);
  });

  test('o Discord recusa (401, 403, 404): 502 genérico, sem vazar token nem detalhe', async () => {
    for (const status of [401, 403, 404]) {
      await modo({ status });
      const r = await enviar();
      expect(r.status, `Discord ${status}`).toBe(502);
      expect(r.data.code).toBe('discord-refused');
      const texto = JSON.stringify(r.data);
      expect(texto).not.toContain('token-de-teste');
      expect(texto).not.toMatch(/erro simulado|Bot /);
    }
  });

  test('o Discord pede para esperar (429): 503 com tempo de espera', async () => {
    await modo({ status: 429, retryAfter: 7 });
    const r = await enviar();
    expect(r.status).toBe(503);
    expect(r.data.code).toBe('discord-busy');
    expect(r.data.retryAfter).toBe(7);
  });

  test('corpos que não são o formulário: 4xx, nunca 5xx, servidor de pé', async () => {
    const h = { 'x-forwarded-for': novoEndereco() };
    const casos: [string, RequestInit][] = [
      ['JSON', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{"kind":"bug"}' }],
      ['sem corpo', { method: 'POST', headers: h }],
      ['multipart sem boundary', { method: 'POST', headers: { ...h, 'content-type': 'multipart/form-data' }, body: 'x' }],
      ['multipart truncado', { method: 'POST', headers: { ...h, 'content-type': 'multipart/form-data; boundary=zz' }, body: '--zz\r\nContent-Disposition: form-data; name="kind"\r\n\r\nbug' }],
      ['multipart lixo', { method: 'POST', headers: { ...h, 'content-type': 'multipart/form-data; boundary=zz' }, body: Buffer.alloc(2000, 1) }],
      ['GET', { method: 'GET' }],
      ['PUT', { method: 'PUT', headers: h, body: 'x' }],
    ];
    for (const [nome, init] of casos) {
      const r = await fetch(`${BASE}/api/feedback`, init);
      expect(r.status, nome).toBeGreaterThanOrEqual(400);
      expect(r.status, nome).toBeLessThan(500);
    }
    expect(await gravados()).toEqual([]);
  });

  test('o mesmo campo repetido e campos extras desconhecidos são tolerados', async () => {
    const form = new FormData();
    form.append('kind', 'bug');
    form.append('kind', 'feedback');
    form.append('title', 'Título válido');
    form.append('description', 'Descrição bem comprida o bastante.');
    form.append('__proto__', 'x');
    form.append('constructor', 'y');
    const r = await fetch(`${BASE}/api/feedback`, { method: 'POST', body: form, headers: { 'x-forwarded-for': novoEndereco() } });
    expect(r.status).toBeLessThan(500);
  });

  // ------------------------------------------------------ sala e conta do Discord

  const ID_DISCORD = '123456789012345678';
  const AVATAR = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const crachaDiscord = (extra: Record<string, unknown> = {}) =>
    assinar({ instance: 'web', uid: ID_DISCORD, name: 'Ana do Discord', av: AVATAR, scope: 'identity', ...extra });
  const primeiro = async () => (await gravados())[0]!.payload!.embeds[0];
  const campoDe = (embed: any, nome: string) => embed.fields.find((f: any) => f.name === nome)?.value as string | undefined;

  test('traz o nome da sala em que a pessoa estava, lido do servidor', async () => {
    const dono = await guest('Dono');
    const sala = await post('/api/rooms/create', { identity: dono, name: 'Sala dos Testes' });
    await enviar({ room: sala.data.roomId });
    expect(campoDe(await primeiro(), 'Sala')).toBe('Sala dos Testes');
    await post('/api/rooms/password', { identity: dono, roomId: sala.data.roomId });
  });

  test('sem sala, ou com id que não existe, o relato diz que veio do lobby (e o nome nunca é do cliente)', async () => {
    await enviar({});
    await enviar({ room: 'nao-existe-123' });
    await enviar({ room: '<script>alert(1)</script>' });
    for (const m of await gravados()) expect(campoDe(m.payload!.embeds[0], 'Sala')).toBe('Fora de uma sala (lobby)');
  });

  test('nome de sala com menção em massa chega neutralizado', async () => {
    const dono = await guest('Dono');
    const sala = await post('/api/rooms/create', { identity: dono, name: '@everyone @here sala' });
    await enviar({ room: sala.data.roomId });
    const embed = await primeiro();
    expect(campoDe(embed, 'Sala')).not.toMatch(/@everyone|@here/);
    expect((await gravados())[0]!.payload!.allowed_mentions).toEqual({ parse: [] });
  });

  test('conta do Discord: menção, link do perfil, nome e foto no cartão', async () => {
    await enviar({ identity: crachaDiscord() });
    const embed = await primeiro();
    expect(campoDe(embed, 'Discord')).toBe(`<@${ID_DISCORD}>\n[Abrir perfil](https://discord.com/users/${ID_DISCORD})`);
    expect(embed.author).toEqual({
      name: 'Ana do Discord',
      url: `https://discord.com/users/${ID_DISCORD}`,
      icon_url: `https://cdn.discordapp.com/avatars/${ID_DISCORD}/${AVATAR}.png?size=64`,
    });
    // A menção aparece como nome, mas nunca pinga ninguém.
    expect((await gravados())[0]!.payload!.allowed_mentions).toEqual({ parse: [] });
  });

  test('o apelido que a pessoa vê aparece no cartão, sem trocar quem ela é', async () => {
    const form = new FormData();
    form.append('kind', 'bug');
    form.append('title', 'Com apelido');
    form.append('description', 'x');
    form.append('identity', crachaDiscord());
    form.append('name', 'Apelido Novo');
    await fetch(`${BASE}/api/feedback`, { method: 'POST', body: form, headers: { 'x-forwarded-for': novoEndereco() } });
    const embed = await primeiro();
    expect(embed.author.name).toBe('Apelido Novo');
    expect(campoDe(embed, 'Discord')).toContain(`<@${ID_DISCORD}>`); // o id continua o do crachá
  });

  test('convidado: sem link de Discord, sem foto, e o cartão diz isso', async () => {
    await enviar({ identity: await guest('Visitante') });
    const embed = await primeiro();
    expect(campoDe(embed, 'Discord')).toBe('Convidado, sem conta do Discord');
    expect(embed.author.name).toBe('Visitante');
    expect(embed.author.url).toBeUndefined();
    expect(embed.author.icon_url).toBeUndefined();
  });

  test('crachá forjado ou de outro tipo não vira conta do Discord', async () => {
    const casos: [string, string][] = [
      ['assinatura de outro segredo', assinar({ instance: 'web', uid: ID_DISCORD, name: 'Falso', av: null, scope: 'identity' }, 'outro-segredo')],
      ['sem assinatura', Buffer.from(JSON.stringify({ uid: ID_DISCORD, name: 'Falso', scope: 'identity' })).toString('base64url') + '.'],
      ['token de sala com id de Discord', assinar({ room: 'x', uid: ID_DISCORD, name: 'Falso', av: null, role: 'viewer' })],
      ['crachá expirado', assinar({ instance: 'web', uid: ID_DISCORD, name: 'Falso', av: null, scope: 'identity', exp: 1 })],
    ];
    for (const [nome, identity] of casos) {
      await fetch(`${MOCK}/__reset`, { method: 'POST' });
      expect((await enviar({ identity })).status, nome).toBe(200);
      const embed = await primeiro();
      expect(campoDe(embed, 'Discord'), nome).toBe('Convidado, sem conta do Discord');
      expect(embed.author, nome).toBeUndefined();
    }
  });

  test('id que não é de Discord (convidado, teste) e foto fora do formato não geram link nem imagem', async () => {
    await enviar({ identity: assinar({ instance: 'web', uid: 'dev-Ana', name: 'Dev Ana', av: AVATAR, scope: 'identity' }) });
    expect(campoDe(await primeiro(), 'Discord')).toBe('Convidado, sem conta do Discord');

    await fetch(`${MOCK}/__reset`, { method: 'POST' });
    await enviar({ identity: crachaDiscord({ av: 'x".png?size=9999#<script>' }) });
    const embed = await primeiro();
    expect(embed.author.icon_url).toBeUndefined();
    expect(embed.author.url).toBe(`https://discord.com/users/${ID_DISCORD}`);

    await fetch(`${MOCK}/__reset`, { method: 'POST' });
    await enviar({ identity: crachaDiscord({ uid: '123456789012345678/../../x' }) });
    expect(campoDe(await primeiro(), 'Discord')).toBe('Convidado, sem conta do Discord');
  });

  test('nome com menção falsa no apelido não vira menção de verdade', async () => {
    const form = new FormData();
    form.append('kind', 'bug');
    form.append('title', 'Apelido malicioso');
    form.append('description', 'x');
    form.append('identity', crachaDiscord());
    form.append('name', '<@999999999999999999> @everyone');
    await fetch(`${BASE}/api/feedback`, { method: 'POST', body: form, headers: { 'x-forwarded-for': novoEndereco() } });
    const embed = await primeiro();
    expect(embed.author.name).not.toMatch(/<@9|@everyone/);
    expect((await gravados())[0]!.payload!.allowed_mentions).toEqual({ parse: [] });
  });
});
