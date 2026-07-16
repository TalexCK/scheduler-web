import net from "node:net";

const MAX_PACKET = 1024 * 1024;

function varInt(value: number) {
  const bytes: number[] = [];
  let current = value >>> 0;
  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current) byte |= 0x80;
    bytes.push(byte);
  } while (current);
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset = 0): [number, number] | null {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    if (offset + index >= buffer.length) return null;
    const byte = buffer[offset + index];
    value |= (byte & 0x7f) << (7 * index);
    if ((byte & 0x80) === 0) return [value, index + 1];
  }
  throw new Error("无效 VarInt");
}

function packet(payload: Buffer) {
  return Buffer.concat([varInt(payload.length), payload]);
}

function target(address: string) {
  const ipv6 = /^\[([^\]]+)]:(\d+)$/.exec(address);
  const split = ipv6 ? [ipv6[1], ipv6[2]] : address.match(/^(.+):(\d+)$/)?.slice(1);
  if (!split) throw new Error("无效 Minecraft 地址");
  const port = Number(split[1]);
  if (!split[0] || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("无效 Minecraft 地址");
  return { host: split[0], port };
}

function motdText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(motdText).filter(Boolean).join("") || null;
  if (value && typeof value === "object") {
    const item = value as { text?: unknown; extra?: unknown[] };
    return `${typeof item.text === "string" ? item.text : ""}${Array.isArray(item.extra) ? item.extra.map(motdText).filter(Boolean).join("") : ""}`.trim() || null;
  }
  return null;
}

export async function queryMinecraftStatus(address: string) {
  const { host, port } = target(address);
  const started = Date.now();
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let pending = Buffer.alloc(0);
    let receivedStatus = false;
    const ping = BigInt(Date.now());
    const timer = setTimeout(() => socket.destroy(new Error("状态探测超时")), 3000);
    const finish = (result: Record<string, unknown>) => { clearTimeout(timer); socket.destroy(); resolve(result); };
    socket.setNoDelay(true);
    socket.once("error", reject);
    socket.once("connect", () => {
      const hostBytes = Buffer.from(host);
      const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(port);
      socket.write(packet(Buffer.concat([varInt(0), varInt(-1), varInt(hostBytes.length), hostBytes, portBytes, varInt(1)])));
      socket.write(packet(Buffer.from([0])));
    });
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > MAX_PACKET + 16) return socket.destroy(new Error("状态响应过大"));
      while (true) {
        const length = readVarInt(pending); if (!length) return;
        if (length[0] > MAX_PACKET || pending.length < length[1] + length[0]) return;
        const body = pending.subarray(length[1], length[1] + length[0]);
        pending = pending.subarray(length[1] + length[0]);
        if (!receivedStatus) {
          const id = readVarInt(body); if (!id || id[0] !== 0) return socket.destroy(new Error("状态包无效"));
          const jsonLength = readVarInt(body, id[1]); if (!jsonLength) return socket.destroy(new Error("状态包无效"));
          const json = body.subarray(id[1] + jsonLength[1]);
          if (json.length !== jsonLength[0]) return socket.destroy(new Error("状态包长度无效"));
          const payload = JSON.parse(json.toString("utf8"));
          receivedStatus = true;
          const pingPayload = Buffer.alloc(9); pingPayload[0] = 1; pingPayload.writeBigInt64BE(ping, 1);
          socket.write(packet(pingPayload));
          (socket as net.Socket & { statusPayload?: unknown }).statusPayload = payload;
        } else {
          if (body.length !== 9 || body[0] !== 1 || body.readBigInt64BE(1) !== ping) return socket.destroy(new Error("Pong 无效"));
          const payload = (socket as net.Socket & { statusPayload?: { players?: { online?: number; max?: number }; version?: { name?: string }; description?: unknown } }).statusPayload ?? {};
          finish({ online: true, host, port, latency_ms: Date.now() - started, online_players: payload.players?.online ?? null, max_players: payload.players?.max ?? null, version: payload.version?.name ?? null, motd: motdText(payload.description), checked_at: new Date().toISOString() });
        }
      }
    });
  });
}

export function offlineMinecraftStatus(address: string) {
  let parsed = { host: address, port: 0 };
  try { parsed = target(address); } catch { /* 保留安全的离线响应 */ }
  return { online: false, ...parsed, latency_ms: null, online_players: null, max_players: null, version: null, motd: null, checked_at: new Date().toISOString() };
}
