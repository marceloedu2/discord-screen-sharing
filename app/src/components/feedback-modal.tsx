"use client";

import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import { Button } from "./button";
import { Modal } from "./modal";
import {
  FEEDBACK_LIMITS,
  FeedbackError,
  IMAGE_ACCEPT,
  addImages,
  checkDraft,
  megabytes,
  sendFeedback,
  type FeedbackKind,
} from "@/lib/feedback";

const FIELD =
  "w-full rounded-md border border-linha bg-[#111214] px-2.5 py-2 text-texto disabled:opacity-60" +
  " focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento";
const LABEL = "mb-1.5 block text-[13.5px] text-suave";
const HINT = "mt-1 text-[12.5px] text-suave";

/**
 * O formulário de bug e feedback (spec 12).
 *
 * Vai para o canal do Discord da equipe, pelo servidor — o token do bot nunca
 * passa por aqui. O que a pessoa digita é só o que ela sabe dizer; o resto
 * (onde estava, tamanho da janela, quem é) vai junto sozinho, e o texto do
 * modal diz isso, porque mandar dado sem avisar não é aceitável.
 *
 * Anexo entra de três jeitos — botão, arrastar e colar —, porque um print
 * recém-tirado já está na área de transferência e é o caminho mais curto.
 */
export function FeedbackModal({
  url,
  identity,
  name,
  roomId,
  where,
  onClose,
}: {
  /** O endereço da rota, já com o prefixo da Activity quando há. */
  url: string;
  identity: string | null;
  /** O nome que a pessoa vê aqui (o apelido), e não o que o crachá guardou ao ser emitido. */
  name: string;
  /** A sala atual, quando há: o servidor resolve o nome dela e o põe no relato. */
  roomId: string | null;
  /** Onde a pessoa estava: caminho e sala, nunca o fragmento com o crachá. */
  where: string;
  onClose: () => void;
}) {
  const ids = { title: useId(), description: useId(), steps: useId(), contact: useId(), images: useId() };

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<{ field: "title" | "description"; message: string } | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);

  // Fechar com o envio em andamento cancela o pedido: sem isso o relato podia
  // chegar à equipe depois de a pessoa ter desistido dele.
  useEffect(() => () => request.current?.abort(), []);

  // As miniaturas são URLs de objeto: cada uma segura o arquivo na memória até
  // ser liberada, então a lista inteira é refeita e revogada a cada mudança.
  const previews = useMemo(() => images.map((file) => URL.createObjectURL(file)), [images]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p)), [previews]);

  const sending = state === "sending";
  const isBug = kind === "bug";

  function attach(incoming: File[]) {
    if (incoming.length === 0) return;
    const result = addImages(images, incoming);
    setImages(result.files);
    setProblems(result.problems);
  }

  function onPaste(e: ClipboardEvent) {
    const pasted = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (pasted.length === 0) return; // texto colado segue o caminho normal
    e.preventDefault();
    attach(pasted);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!sending) attach([...e.dataTransfer.files]);
  }

  async function submit() {
    const draft = { kind, title, description, steps, contact, images };
    const problem = checkDraft(draft);
    setInvalid(problem);
    setFailure(null);
    if (problem) {
      (problem.field === "title" ? titleRef : descriptionRef).current?.focus();
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setState("sending");
    try {
      await sendFeedback(
        url,
        draft,
        {
          identity,
          name,
          room: roomId,
          where,
          viewport: `${window.innerWidth}×${window.innerHeight}`,
          website,
        },
        controller.signal
      );
      setState("done");
    } catch (err) {
      if (controller.signal.aborted) return;
      setState("idle");
      setFailure(err instanceof FeedbackError ? err.message : "Não consegui enviar agora. Tente de novo.");
    }
  }

  function another() {
    setTitle("");
    setDescription("");
    setSteps("");
    setImages([]);
    setProblems([]);
    setInvalid(null);
    setFailure(null);
    setState("idle");
  }

  if (state === "done") {
    return (
      <Modal title="Relato enviado" onClose={onClose} wide>
        <p role="status" className="mb-5 text-[14px]/[1.5] text-texto">
          Valeu! Seu relato já está com a equipe, no Discord. Se você deixou um contato, a gente pode
          responder por lá.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={another}>Enviar outro</Button>
          <Button variant="primary" wide onClick={onClose}>
            Fechar
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Enviar feedback"
      sub="Conte um problema ou uma ideia. A mensagem vai direto para a equipe, no Discord."
      onClose={onClose}
      wide
    >
      {/* Colar uma imagem funciona em qualquer ponto do formulário. */}
      <form
        noValidate
        onPaste={onPaste}
        onSubmit={(e) => {
          e.preventDefault();
          if (!sending) void submit();
        }}
      >
        <fieldset className="mb-4" disabled={sending}>
          <legend className="mb-1.5 text-[13.5px] text-suave">O que você quer enviar?</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["bug", "Relatar um bug"],
                ["feedback", "Dar um feedback"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[14px] transition-colors" +
                  (kind === value ? " border-acento bg-acento/10 text-texto" : " border-linha text-suave hover:bg-tile")
                }
              >
                <input
                  type="radio"
                  name="feedback-kind"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="accent-acento"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mb-4">
          <label className={LABEL} htmlFor={ids.title}>
            Resumo
          </label>
          <input
            ref={titleRef}
            id={ids.title}
            value={title}
            maxLength={FEEDBACK_LIMITS.title.max}
            disabled={sending}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isBug ? "Ex.: o vídeo trava depois de um minuto" : "Ex.: seria bom poder fixar duas telas"}
            aria-invalid={invalid?.field === "title"}
            aria-describedby={invalid?.field === "title" ? `${ids.title}-erro` : undefined}
            className={FIELD}
          />
          {invalid?.field === "title" ? (
            <p id={`${ids.title}-erro`} role="alert" className="mt-1 text-[13px] text-[#ffb3b6]">
              {invalid.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4">
          <label className={LABEL} htmlFor={ids.description}>
            {isBug ? "O que aconteceu?" : "Seu feedback"}
          </label>
          <textarea
            ref={descriptionRef}
            id={ids.description}
            value={description}
            rows={4}
            maxLength={FEEDBACK_LIMITS.description.max}
            disabled={sending}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={invalid?.field === "description"}
            aria-describedby={`${ids.description}-ajuda`}
            className={`${FIELD} resize-y`}
          />
          <p id={`${ids.description}-ajuda`} className={HINT}>
            {invalid?.field === "description" ? (
              <span role="alert" className="text-[#ffb3b6]">
                {invalid.message}
              </span>
            ) : (
              <>
                {description.length} / {FEEDBACK_LIMITS.description.max}
              </>
            )}
          </p>
        </div>

        {isBug ? (
          <div className="mb-4">
            <label className={LABEL} htmlFor={ids.steps}>
              Como reproduzir (opcional)
            </label>
            <textarea
              id={ids.steps}
              value={steps}
              rows={3}
              maxLength={FEEDBACK_LIMITS.steps.max}
              disabled={sending}
              onChange={(e) => setSteps(e.target.value)}
              placeholder={"1. Entrei na sala\n2. Cliquei em Assistir\n3. …"}
              className={`${FIELD} resize-y`}
            />
          </div>
        ) : null}

        <div className="mb-4">
          <label className={LABEL} htmlFor={ids.contact}>
            Como falar com você (opcional)
          </label>
          <input
            id={ids.contact}
            value={contact}
            maxLength={FEEDBACK_LIMITS.contact.max}
            disabled={sending}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Seu usuário do Discord ou e-mail"
            autoComplete="off"
            className={FIELD}
          />
        </div>

        <div className="mb-4">
          <span className={LABEL}>Imagens (opcional)</span>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!sending) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={
              "flex flex-col items-start gap-2 rounded-lg border border-dashed px-3 py-3 transition-colors" +
              (dragging ? " border-acento bg-acento/10" : " border-linha")
            }
          >
            <input
              ref={picker}
              id={ids.images}
              type="file"
              multiple
              accept={IMAGE_ACCEPT}
              hidden
              onChange={(e) => {
                attach([...(e.target.files ?? [])]);
                e.target.value = ""; // permite escolher o mesmo arquivo de novo depois de removê-lo
              }}
            />
            <Button
              aria-describedby={`${ids.images}-ajuda`}
              disabled={sending || images.length >= FEEDBACK_LIMITS.images.max}
              onClick={() => picker.current?.click()}
              className="h-9!"
            >
              Anexar imagens
            </Button>
            <p id={`${ids.images}-ajuda`} className={HINT.replace("mt-1 ", "")}>
              Até {FEEDBACK_LIMITS.images.max} imagens de {megabytes(FEEDBACK_LIMITS.images.maxBytes)} MB — PNG, JPG, GIF
              ou WebP. Dá para arrastar para cá ou colar um print (Ctrl+V).
            </p>

            {images.length > 0 ? (
              <ul aria-label="Imagens anexadas" className="flex flex-wrap gap-2">
                {images.map((file, i) => (
                  <li key={`${file.name}-${file.size}-${file.lastModified}`} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- miniatura de arquivo local (blob:), não há o que otimizar */}
                    <img
                      src={previews[i]}
                      alt={`Pré-visualização de ${file.name}`}
                      className="size-16 rounded-md border border-linha bg-fundo object-cover"
                    />
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => {
                        setImages(images.filter((_, j) => j !== i));
                        setProblems([]);
                      }}
                      aria-label={`Remover imagem ${i + 1}: ${file.name}`}
                      className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-perigo-solido text-[13px]/none text-white hover:bg-perigo-solido-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto disabled:opacity-60"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {problems.length > 0 ? (
            // O alert vai no div: `role="alert"` num <ul> anula a semântica de lista
            // e deixa os <li> órfãos (o axe reprova).
            <div role="alert" className="mt-1.5 text-[13px] text-[#ffb3b6]">
              <ul className="list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Armadilha para robô: fora da tela e fora da ordem de foco. Pessoa de
            verdade nunca preenche; o servidor finge sucesso e descarta. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Não preencha este campo
            <input
              tabIndex={-1}
              autoComplete="off"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        <p className="mb-4 text-[12.5px]/[1.5] text-suave">
          Junto vão o nome que você usa aqui, a tela em que está, o tamanho da janela e o navegador — só para ajudar a
          reproduzir o problema.
        </p>

        {failure ? (
          <p role="alert" className="mb-4 rounded-lg border border-perigo bg-perigo/10 px-3 py-2 text-[13.5px] text-texto">
            {failure}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" wide type="submit" disabled={sending}>
            {sending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
