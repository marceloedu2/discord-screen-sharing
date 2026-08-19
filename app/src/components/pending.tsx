/**
 * Marcador do que ainda não foi portado.
 *
 * Existe para o esqueleto subir e ser navegável antes da interface: uma rota
 * que devolve 404 não distingue "ainda não escrevi" de "quebrou", e essa
 * diferença é a única coisa que importa no meio de uma migração.
 */
export function Pending({
  title,
  source,
  phase,
  items = [],
}: {
  title: string;
  source: string;
  phase: string;
  items?: readonly string[];
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <p className="text-sm text-suave">{phase}</p>
      <h1 className="mt-1 text-3xl font-semibold">{title}</h1>

      <p className="mt-4 text-suave">
        A rota existe e o esqueleto sobe. A interface ainda vive em{" "}
        <code className="rounded bg-tile px-1.5 py-0.5 text-texto">{source}</code>, no
        projeto antigo.
      </p>

      <h2 className="mt-8 text-sm font-semibold tracking-wider text-suave uppercase">
        Falta portar
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-suave">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-linha" />
            {item}
          </li>
        ))}
      </ul>
    </main>
  );
}
