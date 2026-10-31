FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
# Fixed at build: staff and guests reach the API on the page's own origin, through the proxy.
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL= API_INTERNAL_URL=http://api:8080
RUN bun run --filter @hashifi/web build

FROM oven/bun:1.4.4
WORKDIR /app
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/packages ./packages
COPY --from=build --chown=bun:bun /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build --chown=bun:bun /app/apps/web/.next ./apps/web/.next
COPY --from=build --chown=bun:bun /app/apps/web/public ./apps/web/public
COPY --from=build --chown=bun:bun /app/apps/web/next.config.mjs /app/apps/web/package.json ./apps/web/
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock ./
WORKDIR /app/apps/web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=4s --start-period=30s --retries=3 CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:3000/portal/login');process.exit(r.ok?0:1)"]
CMD ["bun", "--bun", "next", "start", "-p", "3000"]
