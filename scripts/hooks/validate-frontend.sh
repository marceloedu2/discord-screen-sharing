#!/usr/bin/env bash
# Hook Stop: antes de encerrar o turno, passa o navegador de verdade pelo
# front. Só roda se a porta de entrada estiver no ar; caso contrário sai quieto.
# Sai com 2 quando acha erro — o agente continua e conserta.
#
# A porta de entrada, e não a do Next: é ela que roteia entre o app e o
# servidor, e uma tela que funciona direto no :3100 mas quebra pelo :3000 é
# exatamente o tipo de falha que este hook existe para pegar.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${BASE_URL:-http://localhost:3000}"
INPUT="$(cat)"

# Guarda contra laço: se já estamos rodando por causa deste hook, não bloqueia
# de novo.
ALREADY="$(printf '%s' "$INPUT" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { process.stdout.write(String(JSON.parse(s).stop_hook_active === true)); }
  catch { process.stdout.write("false"); }
})')"
[ "$ALREADY" = "true" ] && exit 0

[ -d "$ROOT/node_modules" ] || exit 0
command -v agent-browser >/dev/null 2>&1 || exit 0

# No ar? Sem isso não há o que validar.
if ! node -e "
fetch('$BASE', { signal: AbortSignal.timeout(3000) })
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
" 2>/dev/null; then
  exit 0
fi

cd "$ROOT" || exit 0

if OUT="$(BASE_URL="$BASE" node scripts/test-frontend.mjs --fast 2>&1)"; then
  printf '%s\n' "$OUT"
  exit 0
fi

printf 'A validação de front-end falhou. Conserte os erros abaixo antes de encerrar:\n%s\n' "$OUT" >&2
exit 2
