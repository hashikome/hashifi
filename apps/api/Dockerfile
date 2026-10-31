FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

FROM oven/bun:1.4.4
WORKDIR /app
# The same image runs the release migration, so Prisma's CLI stays in it.
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/packages ./packages
COPY --from=build --chown=bun:bun /app/apps/api ./apps/api
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock /app/tsconfig.json ./
WORKDIR /app/apps/api
ENV NODE_ENV=production PORT=8080
USER bun
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:8080/api/health');process.exit(r.ok?0:1)"]
CMD ["bun", "src/entrypoint.ts"]
