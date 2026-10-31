FROM oven/bun:1.4.4
RUN apt-get update \
  && apt-get install -y --no-install-recommends wireguard-tools iproute2 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY apps/tunnel/src ./src
# Root, for NET_ADMIN on the host's network: nothing else runs here, and it has no shell exposed.
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 CMD ["wg", "show", "wg0", "public-key"]
CMD ["bun", "src/main.ts"]
