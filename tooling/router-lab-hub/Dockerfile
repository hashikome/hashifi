# The router lab's stand-in for the platform side of the management tunnel: WireGuard in the
# container's own network namespace, and Bun to run tooling/router-lab.ts against the router
# through the tunnel only. Development tooling; production's endpoint is the platform's.
FROM oven/bun:1.4.4
RUN apt-get update \
  && apt-get install -y --no-install-recommends wireguard-tools iproute2 iputils-ping \
  && rm -rf /var/lib/apt/lists/*
