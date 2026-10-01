import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@bookmarker/shared';
import { attachRealtime, createIO } from '../src/realtime/hub.ts';
import { APP, db, makeDeps } from './helpers.ts';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export async function startServer() {
  const t = makeDeps();
  const http: HttpServer = createServer(t.app);
  const io = createIO(http, APP);
  const rt = attachRealtime(io, db, t.deps.bus, [APP], t.deps.logger);
  await new Promise<void>((r) => http.listen(0, r));
  const port = (http.address() as AddressInfo).port;
  const sockets: ClientSocket[] = [];
  return {
    ...t,
    url: `http://localhost:${port}`,
    async connect(cookie: string, origin = APP): Promise<ClientSocket> {
      const s: ClientSocket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        extraHeaders: { Cookie: cookie, Origin: origin },
        reconnection: false,
        forceNew: true,
      });
      sockets.push(s);
      await new Promise<void>((resolve, reject) => {
        s.once('connect', () => resolve());
        s.once('connect_error', (e) => reject(e));
      });
      return s;
    },
    async close() {
      for (const s of sockets) s.disconnect();
      rt.close();
      await new Promise<void>((r) => io.close(() => r()));
    },
  };
}

/** Records every event a socket receives, as [name, payload] pairs. */
export function record(s: ClientSocket) {
  const log: Array<[string, unknown]> = [];
  s.onAny((name, payload) => log.push([name, payload]));
  return log;
}

export function join(
  s: ClientSocket,
  roomId: string,
  lastSeq?: number,
): Promise<{ ok: boolean; seq?: number }> {
  return new Promise((resolve) =>
    s.emit('room:join', { roomId, ...(lastSeq !== undefined ? { lastSeq } : {}) }, resolve),
  );
}

/** Wait until `pred` is true (polling), or fail after `ms`. */
export async function until(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
