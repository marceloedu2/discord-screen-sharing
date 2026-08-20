# Sala de Tela numa imagem só.
#
# Os três processos — porta de entrada, app e servidor de tempo real — continuam
# sendo três, como em desenvolvimento: quem os sobe é o mesmo scripts/up.mjs, e
# o Ctrl+C do contêiner derruba os três juntos. Separá-los em contêineres
# diferentes exigiria uma rede entre eles para ganhar nada: o relay guarda as
# salas em memória e não escala para duas réplicas de qualquer jeito.

# ---------------------------------------------------------------- construção
FROM node:22-alpine AS build
WORKDIR /app

# Só os manifestos primeiro: enquanto eles não mudam, o cache do Docker reusa a
# instalação inteira, que é o passo caro.
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY server/package.json server/
RUN npm ci

COPY . .

# NEXT_TELEMETRY_DISABLED: uma imagem que só constrói não tem por que telefonar.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Sem `npm prune --omit=dev` de propósito. Ele deixaria a imagem bem menor, mas
# tiraria o `typescript` — e o `next.config.ts` é TypeScript, lido de novo pelo
# `next start`. Trocar a configuração para .js resolveria; enquanto ela for .ts,
# podar aqui é apostar que o carregador interno do Next nunca vai precisar do
# pacote.

# ------------------------------------------------------------------- imagem
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# As três portas. Só a primeira sai do contêiner: as outras duas existem porque
# app e servidor são processos separados, e quem fala com elas é a porta de
# entrada, aqui dentro.
ENV PORT=3000
ENV APP_PORT=3100
ENV RELAY_PORT=3101

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/infra ./infra
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/app/package.json ./app/package.json
COPY --from=build /app/app/.next ./app/.next
COPY --from=build /app/app/next.config.ts ./app/next.config.ts
COPY --from=build /app/app/public ./app/public

# Não roda como root: se algo aqui for comprometido, que seja com as permissões
# de quem não pode reescrever a própria imagem.
USER node

EXPOSE 3000

# Responde 200 só quando o servidor **e** o relay estão de pé, não quando a
# porta abriu (RN-PRO-8).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/up.mjs"]
