#!/usr/bin/env bash
# Hook PostToolUse: roda depois de cada Edit/Write num arquivo de código.
# Segura tipos e lint antes que o erro chegue no navegador.
# Sai com 2 quando falha — o stderr volta para o agente corrigir.
#
# Ciente de workspace: cada pacote tem o próprio tsconfig e o próprio eslint,
# e rodar o do app contra um arquivo do server (ou vice-versa) só produz erro
# que não existe. Arquivo fora dos dois workspaces — scripts/, infra/ — não tem
# projeto TypeScript nenhum, então a checagem que cabe ali é a de sintaxe.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INPUT="$(cat)"

FILE="$(printf '%s' "$INPUT" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { process.stdout.write(JSON.parse(s).tool_input?.file_path ?? ""); }
  catch { process.stdout.write(""); }
})')"

[ -n "$FILE" ] || exit 0
[ -d "$ROOT/node_modules" ] || exit 0

# Só arquivos deste projeto — o agente pode editar coisas fora dele.
case "$FILE" in
  "$ROOT"/*) ;;
  *) exit 0 ;;
esac
case "$FILE" in
  "$ROOT"/node_modules/*|"$ROOT"/*/node_modules/*) exit 0 ;;
  "$ROOT"/app/.next/*|"$ROOT"/server/dist/*|"$ROOT"/.agent-browser/*) exit 0 ;;
esac

RELATIVE="${FILE#"$ROOT"/}"

# Em qual workspace o arquivo caiu?
case "$RELATIVE" in
  app/*)    PKG="$ROOT/app" ;;
  server/*) PKG="$ROOT/server" ;;
  *)        PKG="" ;;
esac

# Fora dos workspaces: sem tsconfig e sem eslint, o que dá para garantir é que
# o arquivo ao menos parseia.
if [ -z "$PKG" ]; then
  case "$FILE" in
    *.js|*.mjs|*.cjs)
      if ! OUT="$(node --check "$FILE" 2>&1)"; then
        printf 'Sintaxe inválida em %s:\n%s\n' "$RELATIVE" "$OUT" >&2
        exit 2
      fi
      ;;
  esac
  exit 0
fi

NEEDS_TYPES=0
NEEDS_LINT=0
case "$FILE" in
  *.ts|*.tsx) NEEDS_TYPES=1; NEEDS_LINT=1 ;;
  *.js|*.jsx|*.mjs) NEEDS_LINT=1 ;;
  *.css) ;;
  *) exit 0 ;;
esac

cd "$PKG" || exit 0
PROBLEMS=""

if [ "$NEEDS_TYPES" = 1 ]; then
  if ! TYPES="$(npx --no-install tsc --noEmit -p tsconfig.json 2>&1)"; then
    PROBLEMS="${PROBLEMS}
=== TypeScript ===
${TYPES}"
  fi
fi

if [ "$NEEDS_LINT" = 1 ]; then
  if ! LINT="$(npx --no-install eslint "$FILE" 2>&1)"; then
    PROBLEMS="${PROBLEMS}
=== ESLint ===
${LINT}"
  fi
fi

if [ -n "$PROBLEMS" ]; then
  printf 'Verificação automática falhou em %s. Corrija antes de seguir:\n%s\n' \
    "$RELATIVE" "$PROBLEMS" >&2
  exit 2
fi

exit 0
