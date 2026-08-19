"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Avatar } from "./avatar";
import { Grid } from "./grid";
import { Lobby, PasswordModal, ChangePasswordModal } from "./lobby";
import { ControlBar, RoundButton, Group, Icon } from "./controls";
import { Details } from "./details";
import { ActionItem, CheckItem, Menu, Separator } from "./menu";
import { TileMenu } from "./tile-menu";
import { Modal } from "./modal";
import { BroadcastModal } from "./broadcast-modal";
import { Stage } from "./stage";
import { Profile } from "./profile";
import { Toast } from "./toast";
import { useDiscord } from "@/contexts/discord";
import Link from "next/link";

import { ApiError } from "@/lib/api";
import { normalizeName } from "@/lib/name";
import { RoomConnection } from "@/lib/room";
import {
  callRoom,
  createRoom,
  guildRoom,
  setPassword,
  forgetTokens,
  joinRoom,
  listRooms,
  saveTokens,
  storedTokens,
  writeRoomInUrl,
} from "@/lib/rooms";
import {
  authDiscord,
  authGuest,
  clientIdOf,
  STORED_NAME,
  renewer,
  restoreSession,
  storedName,
  discardBadge,
  takeIdentityFromHash,
} from "@/lib/session";
import { remove, store } from "@/lib/storage";
import { readVolume, readVolumes, saveVolume } from "@/lib/volume";
import { useControlesVisiveis } from "@/lib/controls-visibility";
import { useAtalhos } from "@/lib/shortcuts";
import { popOut, supported as popoutSupported } from "@/lib/popout";
import {
  enterRoom as entrarNativa,
  nativaAtiva,
  ouvir as ouvirTelaCheia,
  sair as sairNativa,
} from "@/lib/fullscreen";
import { PRESET_PADRAO } from "@/lib/presets";
import { iniciarTransmissao } from "@/lib/broadcast";
import type { Broadcaster } from "@/lib/broadcaster";
import { saveBadge } from "@/lib/session";
import type { RoomSummary, RoomTokens, Session, Person } from "@/lib/types";

/** Recarga do lobby (RF-SAL-4): salas abrem, enchem e fecham enquanto se olha. */
const RECARGA_MS = 4000;

/** Sem este vigia, uma espera que não termina fica com cara de "Conectando…" para sempre (RF-SES-8). */
const DEMORA_MS = 8000;

export function Room({ guild }: { guild?: string } = {}) {
  const { inDiscord, api, ws } = useDiscord();

  // useState com inicializador preguiçoso, e não useRef: a conexão é lida
  // durante a renderização (o useSyncExternalStore precisa dela ali), e ler
  // ref nesse momento é justamente o que o compilador do React proíbe.
  const [connection] = useState(() => new RoomConnection());
  const room = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
    connection.getServerSnapshot
  );

  const [session, setSession] = useState<Session | null>(null);
  const [bootFailure, setBootFailure] = useState<string | null>(null);
  // Em `/<id do servidor>` não há caminho de convidado: sem conta do Discord
  // não há voz para consultar. Aqui a tela é de login, não de erro.
  const [needsLogin, setNeedsLogin] = useState(false);
  /**
   * O link aponta para uma call, e a pessoa está noutra.
   *
   * Não é erro dela nem falta de permissão — é só o link errado para o momento.
   * Então em vez de "não deu para entrar", a saída oferecida é a call em que
   * ela **está**, que é o link padrão do servidor.
   */
  const [wrongCall, setWrongCall] = useState(false);
  /**
   * Saiu da conta estando num link de servidor.
   *
   * Ali não há lobby nem sala para criar: quem cria é a call. Então a tela diz
   * que saiu e oferece o caminho de volta, que refaz a validação inteira.
   */
  const [loggedOut, setLoggedOut] = useState(false);
  /**
   * A sala da call, resolvida e guardada — mas fora dela.
   *
   * Abrir `/<id>` **entra direto**: quem chega pelo link quer a sala, e uma
   * tela de confirmação no meio só custaria um clique.
   *
   * Ela aparece depois de sair, e é isso que impede o laço: você continua na
   * call, então sem esse estado o arranque colocaria você de volta no mesmo
   * instante. Os tokens ficam guardados aqui para reentrar sem consultar o
   * Discord de novo.
   */
  const [entrada, setEntrada] = useState<RoomTokens | null>(null);
  const [slow, setSlow] = useState(false);

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [listed, setListed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [askingPassword, setAskingPassword] = useState<RoomSummary | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    error: boolean;
    action?: { label: string; onClick: () => void };
  } | null>(null);
  const [inRoom, setInRoom] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Recolher as pessoas é preferência de quem assiste, então fica guardada
  // (RF-AST-14). Vive no snapshot da conexão pelo mesmo motivo do volume: ler
  // localStorage na renderização quebraria a hidratação.
  const showPeople = room.showPeople;
  // Qual tela está no palco quando o modo é foco. Fica aqui, e não na conexão,
  // porque se refere a uma transmissão específica — que não existe na próxima
  // visita (RN-AST-34).
  const [focused, setFocused] = useState<number | null>(null);
  // A fixação é da sessão, não guardada: ela se refere a uma transmissão
  // específica, que não existe na próxima visita (RN-AST-34).
  const [pinned, setPinned] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const controlsVisible = useControlesVisiveis(fullscreen);
  const [helpOpen, setHelpOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [poppedOut, setPoppedOut] = useState<number | null>(null);
  const popoutWindow = useRef<Window | null>(null);
  const [tileMenu, setTileMenu] = useState<{
    slot: number;
    userId: string;
    x: number;
    y: number;
  } | null>(null);
  const [tokens, setTokens] = useState<RoomTokens | null>(null);
  /**
   * Os mesmos tokens, numa ref.
   *
   * `leaveRoom` precisa deles, e lê-los do estado o fazia mudar de identidade a
   * cada entrada e saída. Isso subia a cadeia — `connect`, `enterGuildRoom` — e
   * chegava ao efeito de arranque, que rodava de novo e **reentrava na sala que
   * a pessoa acabara de deixar**.
   */
  const tokensRef = useRef<RoomTokens | null>(null);
  const [broadcastModal, setBroadcastModal] = useState(false);
  // Transmissão nascida aqui dentro, quando o Discord permite capturar no
  // iframe. A que roda na aba externa tem conexão própria e não aparece aqui.
  //
  // A instância fica na ref e o "estou no ar" num estado à parte: ler a ref
  // durante a renderização é o que o compilador do React proíbe, e o botão
  // precisa do valor justamente ali.
  const mine = useRef<Broadcaster | null>(null);
  const [onAirLocal, setOnAirLocal] = useState(false);
  // Para onde o botão de silenciar volta: sem isto, desmutar cairia sempre em
  // 100%, ignorando o ajuste que a pessoa tinha feito (RN-AUD-12).
  const volumeBeforeMute = useRef(1);

  const toast = useCallback((text: string, error = false) => setNotice({ text, error }), []);

  // Só alimenta a conexão com o que estava guardado; quem publica o valor para
  // a interface é ela, pelo snapshot.
  useEffect(() => {
    connection.carregarVolumes(readVolume(), readVolumes());
  }, [connection]);

  /**
   * Entra e sai de tela cheia (RF-AST-4).
   *
   * Tenta a API nativa primeiro — fora do Discord é o que a pessoa espera, o
   * mesmo que o F11 faz. Dentro da Activity ela é negada por Permissions Policy
   * (RN-UI-8), e aí vale o layout (RN-AST-13).
   */
  const toggleFullscreen = useCallback(() => {
    void (async () => {
      if (fullscreen || nativaAtiva()) {
        if (!(await sairNativa())) setFullscreen(false);
        return;
      }
      if (!(await entrarNativa())) setFullscreen(true);
    })();
  }, [fullscreen]);

  // O navegador também entra e sai por conta própria — o Esc, o F11, o botão da
  // barra dele. Assinar o evento mantém o nosso estado honesto.
  useEffect(() => ouvirTelaCheia(() => setFullscreen(nativaAtiva())), []);

  /**
   * `Esc` sai da tela cheia por layout (RF-AST-4).
   *
   * O modal também escuta `Esc`, e por isso ele para a propagação: o de cima
   * fecha primeiro, e só quando não há modal a tecla chega aqui.
   */
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // ------------------------------------------------------------- entrar

  const renew = useCallback(() => {
    const params = new URLSearchParams(location.search);
    return renewer(inDiscord, clientIdOf(params), api, setSession)();
  }, [inDiscord, api]);

  /**
   * Parar a transmissão vem primeiro (RN-SAL-22).
   *
   * A captura da aba externa só para se o servidor avisar, e depois do close()
   * não sobra por onde avisar. Deixar a captura viva depois de sair é vazamento
   * de tela, não detalhe de interface.
   */
  const stopMyBroadcast = useCallback(() => {
    mine.current?.stop();
    mine.current = null;
    setOnAirLocal(false);
    // A aba externa tem conexão própria: só o servidor consegue mandá-la parar
    // (RN-TRX-31), e ele encerra a de quem pediu, resolvida por uid (RN-PRO-16).
    connection.pedirParada();
  }, [connection]);

  /**
   * Sai da sala e volta para a raiz certa.
   *
   * Num link de servidor, a raiz é a dele — a tela de entrada, que diz em qual
   * call você está e oferece abrir de novo. Fora dele, é a lista de salas de
   * convidado. Antes isto só limpava o estado e ficava na mesma URL, o que
   * deixava a pessoa numa tela que não era nem sala nem entrada.
   */
  const leaveRoom = useCallback(() => {
    stopMyBroadcast();
    connection.disconnect();
    writeRoomInUrl(null);
    setTokens(null);
    setInRoom(false);
    // O valor é lido **agora**, e não dentro do atualizador: o atualizador roda
    // depois, e a essa altura a ref já teria sido zerada — a tela de "você
    // saiu" ficava sem os tokens e caía no painel de "abrindo a sala".
    const ultimos = tokensRef.current;
    tokensRef.current = null;
    // Guarda o que já foi resolvido: voltar não precisa consultar o Discord de
    // novo para saber qual é a call.
    if (guild && ultimos) setEntrada((atual) => atual ?? ultimos);
  }, [connection, stopMyBroadcast, guild]);

  /**
   * O ciclo entre entrar na call e conectar, quebrado.
   *
   * `conectar` precisa reentrar na call quando a sala some, e `entrarNaCall`
   * precisa de `conectar` para terminar. Declarar um dentro do outro é
   * impossível nos dois sentidos; a ref segura a versão mais recente e é lida
   * só dentro de um callback, nunca durante a renderização.
   */
  const rejoinCall = useRef<(() => void) | null>(null);

  const connect = useCallback(
    (tokens: RoomTokens) => {
      saveTokens(tokens);
      writeRoomInUrl(tokens.roomId);
      tokensRef.current = tokens;
      setTokens(tokens);
      setInRoom(true);

      connection.connect(ws, tokens, storedName(), {
        onError: (m) => toast(m, true),
        onStreamStart: (slot, userId) => {
          // Sem som de notificação (RN-AST-33): um aviso sonoro numa página que
          // já toca o áudio de outra pessoa é ruído em cima de ruído.
          const quem = connection.getSnapshot().participants.find((p) => p.id === userId);
          setNotice({
            text: `${quem?.name ?? "Alguém"} começou a compartilhar a tela`,
            error: false,
            action: { label: "Assistir", onClick: () => connection.watch(slot) },
          });
        },
        onRoomGone: () => {
          forgetTokens(tokens.roomId);
          // Onde a sala é a da call — Activity ou link de servidor — ela é
          // recriada e a pessoa volta para ela (RF-SAL-7). Só no lobby é que
          // "a sala sumiu" significa mesmo perder o lugar.
          if (inDiscord || guild) {
            rejoinCall.current?.();
          } else {
            toast("A sala foi fechada.", true);
            leaveRoom();
          }
        },
        onRejected: () => {
          forgetTokens(tokens.roomId);
          toast("Sua sessão expirou. Entrando de novo…");
          if (inDiscord || guild) rejoinCall.current?.();
          else leaveRoom();
        },
      });
    },
    [connection, ws, inDiscord, guild, toast, leaveRoom]
  );

  /**
   * A identidade vem por argumento, e não do estado.
   *
   * Quem chama primeiro é o arranque, que ainda não terminou de guardar a
   * sessão no estado quando precisa entrar na sala da call — ler dali daria o
   * valor da renderização anterior, que é null.
   */
  const joinCallRoom = useCallback(
    async (identity: string) => {
      try {
        connect(await callRoom(api, identity, renew));
      } catch (err) {
        toast(err instanceof Error ? err.message : "Não consegui abrir a sala da call.", true);
      }
    },
    [api, renew, connect, toast]
  );

  /**
   * Entra na sala daquela call do servidor (`/<id>`).
   *
   * Quem responde em qual call a pessoa está é o Discord. Os três desfechos
   * têm textos diferentes de propósito: "entre numa call" é ação dela, "o bot
   * precisa estar no servidor" é ação de quem administra, e 401 é falta de
   * login — tratá-los igual manda a pessoa resolver o problema errado.
   */
  /** A call que o link pede, quando ele diz. */
  const requestedRoom = () => new URLSearchParams(location.search).get("room");

  const enterGuildRoom = useCallback(
    async (identity: string) => {
      if (!guild) return;
      try {
        const pedida = requestedRoom();
        const tokens = await guildRoom(api, identity, guild, pedida, renew);
        // O servidor pode ter resolvido o apelido desta pessoa naquele servidor
        // do Discord; é por ele que a galera dali a reconhece.
        if (tokens.user) {
          setSession((atual) => (atual ? { ...atual, user: tokens.user as Person } : atual));
        }
        connect(tokens);
      } catch (err) {
        if (err instanceof ApiError && err.code === "outra-call") {
          setWrongCall(true);
          return;
        }
        setBootFailure(
          err instanceof Error ? err.message : "Não consegui abrir a sala deste servidor."
        );
      }
    },
    [guild, api, renew, connect]
  );

  useEffect(() => {
    rejoinCall.current = session
      ? () => void (guild ? enterGuildRoom(session.identity) : joinCallRoom(session.identity))
      : null;
  }, [joinCallRoom, enterGuildRoom, guild, session]);

  // ------------------------------------------------------------- arranque

  /**
   * O arranque.
   *
   * As dependências abaixo são todas estáveis de propósito: se qualquer uma
   * mudar de identidade, este efeito roda de novo — e rodar de novo significa
   * **entrar na sala outra vez**, inclusive numa que a pessoa acabou de
   * deixar. Foi esse o caminho do laço que os tokens em `useState` abriam.
   *
   * Uma trava de "já arranquei" não serve aqui: em desenvolvimento o React
   * monta o efeito duas vezes, e a trava barraria a segunda passagem — a
   * primeira já foi cancelada pelo `alive`, e a sessão nunca chegaria.
   */
  useEffect(() => {
    let alive = true;
    const watchdog = setTimeout(() => alive && setSlow(true), DEMORA_MS);

    (async () => {
      try {
        // O crachá do callback do OAuth chega no fragmento e é apagado da barra
        // de endereço na leitura (RN-SES-9).
        takeIdentityFromHash();

        const params = new URLSearchParams(location.search);
        const clientId = clientIdOf(params);

        /*
         * Dentro da Activity a identidade é **sempre** refeita pelo Discord.
         *
         * Restaurar do armazenamento ali seria reusar um crachá emitido para
         * outra instância — a de uma sessão web, ou a de um lançamento anterior
         * da atividade —, e o `instance` dele decide em que sala da call a
         * pessoa entra (RN-SAL-3). O sintoma seria entrar na sala errada, ou em
         * nenhuma, sem nada acusando.
         *
         * Fora do Discord vale o contrário: o crachá guardado evita uma ida à
         * rede no arranque e mantém a mesma identidade entre recargas.
         */
        let fresh: Session;
        if (inDiscord) {
          if (!clientId) {
            throw new Error(
              "O servidor está sem as credenciais do Discord. Preencha DISCORD_CLIENT_ID no .env."
            );
          }
          fresh = await authDiscord(clientId, api);
        } else {
          fresh = restoreSession() ?? (await authGuest(api));
        }

        if (!alive) return;
        saveBadge(fresh.identity);
        setSession(fresh);

        // Dentro do Discord não há lobby: a atividade entra direto na sala
        // daquela call (RN-SAL-1). Fica aqui, e não num efeito que observa a
        // sessão, porque entrar é parte do arranque — um efeito reativo faria
        // a entrada depender de uma renderização a mais e devolveria uma
        // cascata de re-render a cada mudança de sessão.
        if (inDiscord) await joinCallRoom(fresh.identity);
        else if (guild) {
          if (fresh.user.id.startsWith("guest-")) setNeedsLogin(true);
          else await enterGuildRoom(fresh.identity);
        }
      } catch (err) {
        if (!alive) return;
        setBootFailure(
          err instanceof Error ? err.message : "Não foi possível iniciar a sessão."
        );
      } finally {
        clearTimeout(watchdog);
        if (alive) setSlow(false);
      }
    })();

    return () => {
      alive = false;
      clearTimeout(watchdog);
    };
  }, [inDiscord, api, joinCallRoom, enterGuildRoom, guild]);

  // ------------------------------------------------------------- o lobby

  useEffect(() => {
    if (inDiscord || guild || inRoom) return;

    let alive = true;
    const buscar = async () => {
      // A recarga pausa enquanto houver modal aberto: recarregar sob o cursor
      // tiraria o card do lugar no meio de um clique (RN-SAL-13).
      if (modalOpen || askingPassword) return;
      try {
        const { rooms } = await listRooms(api, session?.identity ?? null);
        if (alive) {
          setRooms(rooms);
          setListed(true);
        }
      } catch {
        // Lista que falha não tira ninguém da tela; a próxima volta em 4 s.
      }
    };

    void buscar();
    const t = setInterval(buscar, RECARGA_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [inDiscord, guild, inRoom, modalOpen, askingPassword, api, session]);

  async function handleEnter(target: RoomSummary, password?: string) {
    if (!session) return;

    // Token guardado primeiro: numa visita seguinte entra sem pedir a senha de
    // novo (RF-SAL-9). Se ele falhar, o fluxo normal assume.
    const stored = storedTokens(target.id, session.user.id);
    if (stored && password === undefined) {
      connect(stored);
      return;
    }

    try {
      const tokens = await joinRoom(
        api,
        password === undefined
          ? { identity: session.identity, roomId: target.id }
          : { identity: session.identity, roomId: target.id, password: password },
        renew
      );
      setAskingPassword(null);
      setPasswordError(null);
      connect(tokens);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const text = err instanceof Error ? err.message : "Não consegui entrar.";

      // 403 senha, 429 bloqueio: os dois abrem o modal de senha, mas com textos
      // diferentes — a recusa por bloqueio diz quantos segundos faltam.
      if (status === 403 || status === 429) {
        setAskingPassword(target);
        setPasswordError(password === undefined ? null : text);
        return;
      }
      // 404: a sala fechou. Limpa o token guardado e recarrega a lista.
      if (status === 404) forgetTokens(target.id);
      toast(text, true);
    }
  }

  async function handleCreate(name: string, password: string) {
    if (!session) return;
    setModalOpen(false);
    try {
      connect(
        await createRoom(
          api,
          password
            ? { identity: session.identity, name: name, password: password }
            : { identity: session.identity, name: name },
          renew
        )
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Não consegui criar a sala.", true);
    }
  }

  /**
   * Estou transmitindo?
   *
   * A transmissão local entra no OU porque o `state` leva um instante para
   * chegar, e sem isso o botão pisca de volta para "Compartilhar" logo depois
   * de começar.
   */
  // Quem está no palco agora — é o nome que o cabeçalho anuncia.
  const onStage = room.streams[0]
    ? (room.participants.find((p) => p.id === room.streams[0]?.userId) ?? null)
    : null;

  const iAmOnAir =
    onAirLocal || room.participants.some((p) => p.broadcasting && p.id === session?.user.id);

  async function share(preset: typeof PRESET_PADRAO, sound: boolean) {
    setBroadcastModal(false);
    if (!tokens) return;

    const r = await iniciarTransmissao(tokens, preset, sound, ws, {
      onEnd: (reason) => {
        mine.current = null;
        setOnAirLocal(false);
        if (reason) toast(reason);
      },
      onAviso: (m) => toast(m),
    });

    if (r.kind === "iframe") {
      mine.current = r.broadcaster;
      setOnAirLocal(true);
    }
    else if (r.kind === "aba") toast("Abri a aba de captura. Deixe-a aberta enquanto transmite.");
    else if (r.kind === "recusado") toast(r.message, true);
  }

  /**
   * Sai da conta do Discord e volta a ser convidado (RF-SES-9).
   *
   * Descarta o crachá e o apelido escolhido, e emite uma identidade nova de
   * convidado. Os tokens de sala guardados morrem junto: eles carregam o `uid`
   * de quem os pediu, e reusá-los com outra identidade colocaria a pessoa na
   * sala com o nome antigo.
   */
  const logout = useCallback(async () => {
    discardBadge();
    remove(STORED_NAME);
    leaveRoom();
    setProfileOpen(false);

    // No link de servidor não existe caminho de convidado: a tela vira o aviso
    // de que saiu, com o botão que refaz a validação do zero.
    if (guild) {
      writeRoomInUrl(null);
      setSession(null);
      setLoggedOut(true);
      return;
    }

    try {
      const guest = await authGuest(api);
      saveBadge(guest.identity);
      setSession(guest);
    } catch {
      setBootFailure("Saí da conta, mas não consegui abrir uma sessão de convidado.");
    }
  }, [api, guild, leaveRoom]);

  function renameSelf(name: string) {
    const clean = normalizeName(name);
    if (!clean) return;
    store(STORED_NAME, clean);
    connection.rename(clean);
    setSession((atual) => (atual ? { ...atual, user: { ...atual.user, name: clean } } : atual));
  }

  const toggleMute = useCallback(() => {
    const v = room.volume === 0 ? volumeBeforeMute.current || 1 : 0;
    if (room.volume > 0) volumeBeforeMute.current = room.volume;
    saveVolume(v);
    connection.setVolume(v);
  }, [connection, room.volume]);

  useAtalhos(inRoom, {
    fullscreen: toggleFullscreen,
    mudo: toggleMute,
    modo: () => connection.setModo(room.modo === "grade" ? "foco" : "grade"),
    people: () => connection.mostrarPessoas(!showPeople),
    aoPalco: (i) => {
      const target = room.streams[i];
      if (!target) return;
      setFocused(target.slot);
      connection.setModo("foco");
    },
    ajuda: () => setHelpOpen(true),
  });

  /**
   * Destaca a tela numa janela sempre-no-topo, ou traz de volta.
   *
   * O canvas é um nó só (RN-AST-17): destacar o move para lá, e fechar a janela
   * o devolve ao tile na renderização seguinte.
   */
  const togglePopout = useCallback(
    (slot: number) => {
      if (poppedOut !== null) {
        popoutWindow.current?.close();
        popoutWindow.current = null;
        setPoppedOut(null);
        return;
      }
      const canvas = connection.canvasDe(slot);
      if (!canvas) return;
      void popOut(canvas, () => {
        popoutWindow.current = null;
        setPoppedOut(null);
      }).then((j) => {
        popoutWindow.current = j;
        if (j) setPoppedOut(slot);
      });
    },
    [connection, poppedOut]
  );

  // ------------------------------------------------------------- desenho

  if (entrada && !inRoom) {
    return (
      <main className="grid h-dvh place-items-center p-respiro text-center">
        <div className="max-w-md">
          <p className="text-[13px] text-suave">Você saiu da sala</p>
          <h1 className="mt-1 text-xl font-semibold text-texto">
            {entrada.roomName ?? "Sala da call"}
          </h1>
          <p className="mt-2 text-suave">
            Você continua na call do Discord. Pode voltar quando quiser.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/"
              className="inline-block rounded-full bg-tile px-5 py-2.5 text-[14px]/none font-medium text-texto hover:bg-tile-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
            >
              Salas de convidados
            </Link>
            <button
              type="button"
              onClick={() => {
                // Tokens novos, e não os guardados: se você era o último a
                // sair, a sala foi dissolvida na hora (RN-SAL-20a) e o token
                // antigo aponta para algo que não existe mais. Reentrar é o
                // mesmo caminho de entrar — perguntar ao Discord onde você
                // está.
                setEntrada(null);
                if (session) void enterGuildRoom(session.identity);
              }}
              className="rounded-full bg-acento px-5 py-2.5 text-[14px]/none font-medium text-white hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
            >
              Voltar para a sala
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (loggedOut) {
    return (
      <main className="grid h-dvh place-items-center p-respiro text-center">
        <div className="max-w-md">
          <h1 className="text-lg font-semibold text-texto">Você saiu da conta</h1>
          <p className="mt-1 text-suave">
            A sala deste servidor é a da call em que você está, então ela precisa saber quem você é
            no Discord.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {/* A saída para quem não quer voltar ao servidor: a raiz aceita
                convidado, e é lá que dá para criar sala à mão. */}
            <Link
              href="/"
              className="inline-block rounded-full bg-tile px-5 py-2.5 text-[14px]/none font-medium text-texto hover:bg-tile-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
            >
              Salas de convidados
            </Link>
            <a
              href={`/auth/login?goBack=${encodeURIComponent(`/${guild ?? ""}`)}`}
              className="inline-block rounded-full bg-acento px-5 py-2.5 text-[14px]/none font-medium text-white hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
            >
              Voltar para a sala
            </a>
          </div>
        </div>
      </main>
    );
  }

  if (wrongCall) {
    return (
      <main className="grid h-dvh place-items-center p-respiro text-center">
        <div className="max-w-md">
          <h1 className="text-lg font-semibold text-texto">Esse link é de outra call</h1>
          <p className="mt-1 text-suave">
            Você está numa call diferente da que esse convite aponta. Quer abrir a sala da call em
            que você está?
          </p>
          <a
            href={`/${guild ?? ""}`}
            className="mt-4 inline-block rounded-full bg-acento px-5 py-2.5 text-[14px]/none font-medium text-white hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
          >
            Abrir a sala da minha call
          </a>
          <p className="mt-3 text-[13px] text-suave">
            Se você queria mesmo a call do convite, entre no canal de voz dela e abra o link de
            novo.
          </p>
        </div>
      </main>
    );
  }

  if (needsLogin) {
    return (
      <main className="grid h-dvh place-items-center p-respiro text-center">
        <div>
          <h1 className="text-lg font-semibold text-texto">Entre com o Discord</h1>
          <p className="mt-1 text-suave">
            Para abrir a sala deste servidor eu preciso saber em qual call você está.
          </p>
          <a
            href={`/auth/login?goBack=${encodeURIComponent(`/${guild ?? ""}`)}`}
            className="mt-4 inline-block rounded-full bg-acento px-5 py-2.5 text-[14px]/none font-medium text-white hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
          >
            Entrar com Discord
          </a>
        </div>
      </main>
    );
  }

  if (bootFailure) {
    return (
      <main className="grid h-dvh place-items-center p-respiro text-center">
        <div>
          <p className="text-lg font-semibold text-texto">Não deu para entrar</p>
          <p className="mt-1 text-suave">{bootFailure}</p>
          {/* Entrar na call é ação de quem está lendo isto, então o caminho de
              volta fica aqui — sem recarregar a página (RN-SES-3). E a saída
              para a raiz também: sem ela esta tela é um beco, e a única forma
              de sair seria editar o endereço. */}
          {guild && session ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href="/"
                className="inline-block rounded-full bg-tile px-5 py-2.5 text-[14px]/none font-medium text-texto hover:bg-tile-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
              >
                Salas de convidados
              </Link>
              <button
                type="button"
                onClick={() => {
                  setBootFailure(null);
                  void enterGuildRoom(session.identity);
                }}
                className="rounded-full bg-acento px-5 py-2.5 text-[14px]/none font-medium text-white hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
              >
                Tentar de novo
              </button>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="grid h-dvh place-items-center p-respiro text-center">
        {slow ? (
          <Panel title="Está demorando…" text="Sem resposta do servidor. Ele está no ar?" />
        ) : (
          <Panel title="Conectando…" text="Preparando a sua sessão." />
        )}
      </main>
    );
  }

  const eu = session.user;
  const source = eu.id.startsWith("guest-") ? "modo local" : `Discord · ${eu.id}`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/*
        A barra de cima carrega só metadado, como a do Discord: onde estamos,
        de quem é a tela no palco, e em que qualidade ela está indo. Os
        controles ficam embaixo, flutuando — ver componentes/controles.tsx.
      */}
      <header
        className={
          "flex shrink-0 items-center gap-3 px-respiro transition-all duration-200 " +
          (fullscreen && !controlsVisible ? "h-0 overflow-hidden opacity-0" : "h-[52px]")
        }
      >
        {inRoom && room.room ? (
          <span className="flex min-w-0 items-center gap-2 text-[14px] font-medium text-texto">
            <span className="truncate">
              {room.room.locked ? "🔒 " : ""}
              {room.room.name}
            </span>
            {onStage ? (
              <>
                <span aria-hidden="true" className="text-suave">
                  ·
                </span>
                <Avatar
                  id={onStage.id}
                  name={onStage.name}
                  avatar={onStage.avatar}
                  className="w-5! text-[9px]!"
                />
                <span className="truncate text-suave">Screen de {onStage.name}</span>
              </>
            ) : null}
          </span>
        ) : null}

        <span className="flex-1" />

        {/* O chip de qualidade e o selo de no ar, como no Discord. */}
        {iAmOnAir ? (
          <>
            <span className="rounded bg-tile px-2 py-1 text-[11px] font-semibold tracking-wide text-texto">
              {PRESET_PADRAO.resumo.replace(" · ", " ").toUpperCase()}
            </span>
            <span className="rounded bg-perigo px-2 py-1 text-[11px] font-semibold tracking-wide text-white">
              AO VIVO
            </span>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          aria-label={`Seu perfil: ${eu.name}`}
          className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-tile focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto"
        >
          <Avatar id={eu.id} name={eu.name} avatar={eu.avatar} className="w-7! text-[11px]!" />
          <span className="max-w-[20ch] truncate text-[13px] text-suave">{eu.name}</span>
        </button>
      </header>

      {/* A faixa de baixo é reservada para a barra flutuante: sem ela, os
          controles cobrem o rodapé dos tiles e o name de quem está neles. */}
      <main className={`relative min-h-0 flex-1 ${inRoom ? "pb-[76px]" : ""}`}>
        {inRoom ? (
          room.modo === "foco" && room.streams.length > 0 ? (
            <Stage
              room={room}
              connection={connection}
              myId={eu.id}
              fullscreen={fullscreen}
              showWithoutVideo={showPeople}
              focused={focused}
              pinned={pinned}
              onFocus={setFocused}
              onUnpin={() => setPinned(null)}
              onMenu={(slot, userId, x, y) => setTileMenu({ slot, userId, x, y })}
              poppedOut={poppedOut}
            />
          ) : room.streams.length > 0 || room.participants.length > 0 ? (
            <Grid
              room={room}
              connection={connection}
              myId={eu.id}
              showWithoutVideo={showPeople}
              onFocus={(slot) => {
                setFocused(slot);
                connection.setModo("foco");
              }}
              onMenu={(slot, userId, x, y) => setTileMenu({ slot, userId, x, y })}
              poppedOut={poppedOut}
            />
          ) : (
            <Panel
              title={room.phase === "caiu" ? "Reconectando…" : "Ninguém na sala"}
              text={
                room.phase === "caiu"
                  ? "A conexão com a sala caiu."
                  : "Aguardando participantes."
              }
            />
          )
        ) : guild ? (
          // No link de servidor nunca há lobby: a sala é a da call, criada
          // sozinha por quem entra nela. Oferecer "criar sala" aqui daria uma
          // sala que ninguém daquele canal encontraria.
          <Panel
            title="Abrindo a sala da sua call…"
            text="Estou perguntando ao Discord em qual canal de voz você está."
          />
        ) : (
          <Lobby
            rooms={rooms}
            loading={!listed}
            onEnter={(s) => void handleEnter(s)}
            onCreate={(n, s) => void handleCreate(n, s)}
            onModalOpen={setModalOpen}
          />
        )}

        {askingPassword ? (
          <PasswordModal
            room={askingPassword}
            error={passwordError}
            onClose={() => {
              setAskingPassword(null);
              setPasswordError(null);
            }}
            onSubmit={(password) => void handleEnter(askingPassword, password)}
          />
        ) : null}

        {broadcastModal ? (
          <BroadcastModal
            onClose={() => setBroadcastModal(false)}
            onConfirm={(preset, sound) => void share(preset, sound)}
          />
        ) : null}

        {helpOpen ? (
          <Modal
            title="Atalhos"
            sub="Nenhum deles é o único caminho: tudo aqui também tem botão."
            onClose={() => setHelpOpen(false)}
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
              {[
                ["Esc", "fecha o modal ou sai da tela cheia"],
                ["F", "alterna tela cheia"],
                ["M", "silencia e devolve o som"],
                ["G", "alterna grade e foco"],
                ["P", "recolhe ou mostra as pessoas"],
                ["1–4", "põe aquela tela no palco"],
                ["?", "abre esta lista"],
              ].map(([key, what]) => (
                <Fragment key={key}>
                  <dt className="rounded border border-linha bg-tile px-1.5 py-0.5 text-center font-mono text-[12px] text-texto">
                    {key}
                  </dt>
                  <dd className="text-suave">{what}</dd>
                </Fragment>
              ))}
            </dl>
          </Modal>
        ) : null}

        {passwordOpen && room.room ? (
          <ChangePasswordModal
            hasPassword={room.room.locked}
            onClose={() => setPasswordOpen(false)}
            onSave={(password) => {
              setPasswordOpen(false);
              void setPassword(api, { identity: session.identity, roomId: room.room!.id, password: password }, renew)
                .then((r) => toast(r.locked ? "Senha definida." : "Senha removida."))
                .catch((err: unknown) =>
                  toast(err instanceof Error ? err.message : "Não consegui salvar.", true)
                );
            }}
          />
        ) : null}

        {profileOpen ? (
          <Profile
            user={eu}
            source={source}
            onSave={renameSelf}
            {...(eu.id.startsWith("guest-") ? {} : { onLogout: () => void logout() })}
            onClose={() => setProfileOpen(false)}
          />
        ) : null}
        {/* Os controles pairam sobre a tela, ao centro de baixo, e o alternar
            de tela cheia fica no canto — a geometria do Discord. */}
        {inRoom ? (
          <div
            data-controles
            className={
              "pointer-events-none absolute inset-x-0 bottom-4 flex justify-center transition-opacity duration-200 " +
              (controlsVisible ? "opacity-100" : "pointer-events-none opacity-0")
            }
          >
            <ControlBar>
              <Group>
                <RoundButton
                  label={iAmOnAir ? "Parar de transmitir" : "Compartilhar tela"}
                  state={iAmOnAir ? "ativo" : "neutro"}
                  onClick={() => (iAmOnAir ? stopMyBroadcast() : setBroadcastModal(true))}
                >
                  {iAmOnAir ? <Icon.Parar /> : <Icon.Screen />}
                </RoundButton>

                {/* Só existe quando há som para controlar (RN-AUD-14). */}
                {room.comSom.length > 0 ? (
                  <label className="flex items-center gap-2 pr-2 pl-1">
                    <span className="sr-only">Volume geral</span>
                    <RoundButton
                      label={room.volume === 0 ? "Tirar do mudo" : "Silenciar"}
                      // O mudo é zero no volume geral — um número só, em vez de
                      // dois estados que precisam concordar (RN-AUD-12).
                      onClick={toggleMute}
                    >
                      {room.volume === 0 ? <Icon.Mudo /> : <Icon.Som />}
                    </RoundButton>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={room.volume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        saveVolume(v);
                        connection.setVolume(v);
                      }}
                      className="w-24 accent-acento"
                    />
                  </label>
                ) : null}
                <span className="relative">
                  <RoundButton label="Mais opções" onClick={() => setMenuOpen((v) => !v)}>
                    <Icon.Mais />
                  </RoundButton>

                  {menuOpen ? (
                    <Menu onClose={() => setMenuOpen(false)}>
                      {/* Sem transmissão a grade é o único layout possível, e
                          a box marcaria uma escolha que não vale — pior que
                          não oferecer a escolha. */}
                      {room.streams.length > 0 ? (
                        <CheckItem
                          label="Exibição em grade"
                          checked={room.modo === "grade"}
                          onToggle={() =>
                            connection.setModo(room.modo === "grade" ? "foco" : "grade")
                          }
                        />
                      ) : null}
                      <CheckItem
                        label="Participantes sem vídeo"
                        checked={showPeople}
                        onToggle={() => connection.mostrarPessoas(!showPeople)}
                      />
                      <Separator />
                      {/* Só o dono troca a senha. O servidor confere de novo
                          (RN-SAL-15); esconder aqui é conveniência. */}
                      {room.room?.ownerId === eu.id ? (
                        <ActionItem
                          label="Senha da sala"
                          onClick={() => {
                            setMenuOpen(false);
                            setPasswordOpen(true);
                          }}
                        />
                      ) : null}
                      <ActionItem
                        label="Details da conexão"
                        onClick={() => {
                          setMenuOpen(false);
                          setDetails(true);
                        }}
                      />
                      <ActionItem
                        label="Seu perfil"
                        onClick={() => {
                          setMenuOpen(false);
                          setProfileOpen(true);
                        }}
                      />
                    </Menu>
                  ) : null}
                </span>
              </Group>

              {/* Dentro do Discord não há botão de sair: quem fecha a atividade
                  é o próprio Discord (RN-SAL-23). */}
              {inDiscord ? null : (
                <RoundButton label="Sair da sala" state="encerrar" wide onClick={leaveRoom}>
                  <Icon.Sair />
                </RoundButton>
              )}
            </ControlBar>
          </div>
        ) : null}

        {details ? (
          <Details
            room={room}
            connection={connection}
            // O do palco, ou o primeiro que se está assistindo (RN-AST-23).
            slot={
              room.watching.includes(focused ?? -1)
                ? focused
                : (room.watching[0] ?? null)
            }
            onClose={() => setDetails(false)}
          />
        ) : null}

        {inRoom && room.streams.length > 0 ? (
          <div
            data-controles
            className={
              "absolute right-4 bottom-4 transition-opacity duration-200 " +
              (controlsVisible ? "opacity-100" : "pointer-events-none opacity-0")
            }
          >
            <span className="flex items-center gap-2">
              {/* Sem suporte, o botão não aparece (RN-AST-37): uma janela sem
                  sempre-no-topo não resolve o problema que a pessoa tinha. */}
              {popoutSupported() && room.watching.length > 0 ? (
                <RoundButton
                  label={poppedOut !== null ? "Trazer de volta" : "Destacar em outra janela"}
                  onClick={() => togglePopout(poppedOut ?? (room.watching[0] as number))}
                >
                  <Icon.Destacar />
                </RoundButton>
              ) : null}

              <RoundButton
                // O rótulo muda com o estado: anunciar sempre a mesma coisa
                // mentiria para quem usa leitor de tela (RN-AST-15).
                label={fullscreen ? "Sair da tela cheia" : "Screen cheia"}
                onClick={toggleFullscreen}
              >
                {fullscreen ? <Icon.SairTelaCheia /> : <Icon.TelaCheia />}
              </RoundButton>
            </span>
          </div>
        ) : null}
      </main>

      {tileMenu ? (
        <TileMenu
          name={room.participants.find((p) => p.id === tileMenu.userId)?.name ?? "essa pessoa"}
          userId={tileMenu.userId}
          connection={connection}
          hasSound={room.comSom.includes(tileMenu.slot)}
          pinned={pinned === tileMenu.slot}
          onPin={() => {
            setPinned(pinned === tileMenu.slot ? null : tileMenu.slot);
            setTileMenu(null);
          }}
          x={tileMenu.x}
          y={tileMenu.y}
          onClose={() => setTileMenu(null)}
          onStop={() => {
            connection.unwatch(tileMenu.slot);
            setTileMenu(null);
          }}
        />
      ) : null}

      {notice ? (
        <Toast
          message={notice.text}
          error={notice.error}
          {...(notice.action ? { action: notice.action } : {})}
          onDismiss={() => setNotice(null)}
        />
      ) : null}
    </div>
  );
}

function Panel({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid h-full place-items-center p-respiro text-center">
      <div>
        <p className="text-lg font-semibold text-texto">{title}</p>
        <p className="mt-1 text-suave">{text}</p>
      </div>
    </div>
  );
}

