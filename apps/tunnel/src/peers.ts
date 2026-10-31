/** A router allowed on the tunnel. */
export interface Peer {
  publicKey: string;
  address: string;
}

/** What must change on the interface: only the difference, so live tunnels are left alone. */
export function peerChanges(current: readonly string[], wanted: readonly Peer[]) {
  const have = new Set(current);
  const keys = new Set(wanted.map((peer) => peer.publicKey));
  return {
    add: wanted.filter((peer) => !have.has(peer.publicKey)),
    remove: current.filter((key) => !keys.has(key)),
  };
}

const KEY = /^[A-Za-z0-9+/]{43}=$/;
const ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The API's answer, checked: these values reach a command line. */
export function parsePeers(body: unknown): Peer[] {
  const list = (body as { peers?: unknown } | null)?.peers;
  if (!Array.isArray(list)) throw new Error("Unexpected peer list");
  return list.map((item: unknown) => {
    const { publicKey, address } = item as Partial<Peer>;
    if (typeof publicKey !== "string" || !KEY.test(publicKey)) throw new Error("Bad peer key");
    if (typeof address !== "string" || !ADDRESS.test(address)) throw new Error("Bad peer address");
    return { publicKey, address };
  });
}

/** Routers fetch their pages here during setup, and nothing else is passed on. */
export function relayPath(path: string): boolean {
  return /^\/portal\/hotspot-files\/[0-9a-f-]{36}\/[a-z]+\.html$/.test(path);
}
