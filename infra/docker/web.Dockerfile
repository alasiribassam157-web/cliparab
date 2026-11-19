# Next.js frontend. NEXT_PUBLIC_API_URL is inlined at build time (the browser calls this origin).
#   docker build -f infra/docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:8000 -t cliparab-web .
FROM node:22-alpine AS build
WORKDIR /web
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
COPY apps/web/package.json ./
RUN npm install --no-audit --no-fund
COPY apps/web ./
RUN npm run build

FROM node:22-alpine
WORKDIR /web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /web/.next/standalone ./
COPY --from=build /web/.next/static ./.next/static
COPY --from=build /web/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
