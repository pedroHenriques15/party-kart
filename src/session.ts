// Rooms over WebRTC (PeerJS). Everyone drives their own car in their own browser; the host relays
// where everyone is, keeps the leaderboard and the round's clock.
import Peer, { type DataConnection } from 'peerjs';
import { DRIVERS } from './render/drivers.ts';

const PREFIX = 'partykart-pk26-';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const HOST_ID = 'host';
const MAX_MEMBERS = 8;
const PING_MS = 1000;
const SILENT_MS = 6000;
export const COUNTDOWN_MS = 3500;

export interface Member {
  id: string;
  name: string;
  driver: string;
}

export interface Lobby {
  code: string;
  minutes: number;
  members: Member[];
  racing: boolean;
}

// Where a car is, as sent about 15 times a second.
export interface Snap {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  ux: number;
  uy: number;
  uz: number;
  spd: number;
  st: number;
  b: number; // boosting
  g: number; // grounded
}

export interface Entry {
  id: string;
  name: string;
  driver: string;
  best: number | null;
  laps: number;
}

type ToHost =
  | { t: 'hello'; name: string; driver: string }
  | { t: 'pick'; driver: string }
  | { t: 'pos'; s: Snap }
  | { t: 'lap'; ms: number }
  | { t: 'honk' }
  | { t: 'ping' };

type ToClient =
  | { t: 'lobby'; lobby: Lobby; you: string }
  | { t: 'cars'; list: Snap[] }
  | { t: 'board'; list: Entry[] }
  | { t: 'start'; goIn: number; endIn: number }
  | { t: 'end'; list: Entry[] }
  | { t: 'honk'; id: string }
  | { t: 'bye'; why: string };

export const cleanName = (n: unknown): string =>
  (typeof n === 'string' ? n : '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || 'Driver';

const validDriver = (d: unknown) => (typeof d === 'string' && DRIVERS.some((x) => x.id === d) ? d : DRIVERS[0].id);

function makeCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    const fail = (e: unknown) => {
      peer.destroy();
      reject(e);
    };
    peer.once('open', () => {
      peer.off('error', fail);
      resolve(peer);
    });
    peer.once('error', fail);
  });
}

const errType = (e: unknown) => (e as { type?: string })?.type ?? '';

// What the game needs from a room, host or not.
export interface Room {
  you: string;
  lobby: Lobby;
  board: Entry[];
  cars: Map<string, { at: number; s: Snap }[]>; // the others' recent snapshots
  isHost: boolean;
  onLobby: () => void;
  onStart: (goIn: number, endIn: number) => void;
  onEnd: (list: Entry[]) => void;
  onHonk: (id: string) => void;
  onBoard: () => void;
  onClose: (why: string) => void;
  pick(driver: string): void;
  sendPos(s: Snap): void;
  sendLap(ms: number): void;
  honk(): void;
  leave(): void;
}

function pushSnap(cars: Room['cars'], s: Snap): void {
  const list = cars.get(s.id) ?? [];
  list.push({ at: performance.now(), s });
  if (list.length > 10) list.shift();
  cars.set(s.id, list);
}

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

function cleanSnap(id: string, s: Snap): Snap {
  return {
    id,
    x: num(s.x, -5000, 5000),
    y: num(s.y, -500, 500),
    z: num(s.z, -5000, 5000),
    yaw: num(s.yaw, -1e6, 1e6),
    ux: num(s.ux, -1, 1),
    uy: num(s.uy, -1, 1),
    uz: num(s.uz, -1, 1),
    spd: num(s.spd, -100, 100),
    st: num(s.st, -1, 1),
    b: s.b ? 1 : 0,
    g: s.g ? 1 : 0,
  };
}

interface Remote {
  conn: DataConnection;
  heard: number;
}

export class HostRoom implements Room {
  readonly you = HOST_ID;
  readonly isHost = true;
  lobby: Lobby;
  board: Entry[] = [];
  cars = new Map<string, { at: number; s: Snap }[]>();
  onLobby = () => {};
  onStart: (goIn: number, endIn: number) => void = () => {};
  onEnd: (list: Entry[]) => void = () => {};
  onHonk: (id: string) => void = () => {};
  onBoard = () => {};
  onClose: (why: string) => void = () => {};
  private peer: Peer;
  private remotes = new Map<string, Remote>();
  private latest = new Map<string, Snap>();
  private goAt = 0;
  private endAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];

  private constructor(peer: Peer, code: string, name: string, driver: string) {
    this.peer = peer;
    this.lobby = { code, minutes: 4, members: [{ id: HOST_ID, name, driver: validDriver(driver) }], racing: false };
    peer.on('connection', (c) => this.accept(c));
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    this.timers.push(
      setInterval(() => {
        for (const [id, r] of this.remotes) {
          if (performance.now() - r.heard > SILENT_MS) {
            r.conn.close();
            this.drop(id);
          }
        }
      }, PING_MS),
      // Everyone's positions, 15 times a second.
      setInterval(() => {
        if (!this.lobby.racing || this.remotes.size === 0) return;
        const list = [...this.latest.values()];
        for (const r of this.remotes.values()) this.send(r.conn, { t: 'cars', list });
      }, 1000 / 15),
      setInterval(() => {
        if (this.lobby.racing && performance.now() >= this.endAt) this.finish();
      }, 250),
    );
  }

  static async create(name: string, driver: string): Promise<HostRoom> {
    for (let i = 0; ; i++) {
      try {
        return new HostRoom(await openPeer(PREFIX + makeCode()), '', name, driver).withCode();
      } catch (e) {
        if (errType(e) !== 'unavailable-id' || i >= 3) throw e;
      }
    }
  }

  private withCode(): this {
    this.lobby.code = this.peer.id.slice(PREFIX.length);
    return this;
  }

  private send(c: DataConnection, m: ToClient): void {
    if (c.open) void c.send(m);
  }

  private broadcast(m: ToClient): void {
    for (const r of this.remotes.values()) this.send(r.conn, m);
  }

  private accept(c: DataConnection): void {
    c.on('data', (raw) => this.receive(c, raw as ToHost));
    c.on('close', () => this.drop(c.peer));
    c.on('error', () => this.drop(c.peer));
  }

  private freeDriver(want: string, except: string): string {
    const taken = new Set(this.lobby.members.filter((m) => m.id !== except).map((m) => m.driver));
    if (!taken.has(want)) return want;
    return DRIVERS.find((d) => !taken.has(d.id))?.id ?? want;
  }

  private receive(c: DataConnection, m: ToHost): void {
    if (!m || typeof m !== 'object') return;
    const r = this.remotes.get(c.peer);
    if (r) r.heard = performance.now();
    if (m.t === 'hello' && !r) {
      if (this.lobby.members.length >= MAX_MEMBERS) {
        this.send(c, { t: 'bye', why: 'The room is full.' });
        setTimeout(() => c.close(), 500);
        return;
      }
      this.remotes.set(c.peer, { conn: c, heard: performance.now() });
      this.lobby.members.push({ id: c.peer, name: cleanName(m.name), driver: this.freeDriver(validDriver(m.driver), c.peer) });
      this.entry(c.peer);
      this.changed();
      // Joining mid-round: straight in.
      if (this.lobby.racing) this.send(c, { t: 'start', goIn: this.goAt - performance.now(), endIn: this.endAt - performance.now() });
      this.send(c, { t: 'board', list: this.board });
    } else if (!r) {
      return;
    } else if (m.t === 'pick') {
      this.pickFor(c.peer, m.driver);
    } else if (m.t === 'pos' && m.s && typeof m.s === 'object') {
      const s = cleanSnap(c.peer, m.s);
      this.latest.set(c.peer, s);
      pushSnap(this.cars, s);
    } else if (m.t === 'lap') {
      this.lapFor(c.peer, num(m.ms, 1000, 3_600_000));
    } else if (m.t === 'honk') {
      this.honkFor(c.peer);
    }
  }

  private drop(id: string): void {
    if (!this.remotes.delete(id)) return;
    this.lobby.members = this.lobby.members.filter((m) => m.id !== id);
    this.latest.delete(id);
    this.cars.delete(id);
    this.changed();
  }

  private entry(id: string): Entry {
    const m = this.lobby.members.find((x) => x.id === id)!;
    let e = this.board.find((x) => x.id === id);
    if (!e) {
      e = { id, name: m.name, driver: m.driver, best: null, laps: 0 };
      this.board.push(e);
    }
    e.name = m.name;
    e.driver = m.driver;
    return e;
  }

  private sortBoard(): void {
    this.board.sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity) || b.laps - a.laps);
  }

  private pickFor(id: string, driver: string): void {
    const m = this.lobby.members.find((x) => x.id === id);
    if (!m || this.lobby.racing) return;
    const d = validDriver(driver);
    if (this.lobby.members.some((x) => x.id !== id && x.driver === d)) return;
    m.driver = d;
    this.entry(id);
    this.changed();
  }

  private lapFor(id: string, ms: number): void {
    if (!this.lobby.racing) return;
    const e = this.entry(id);
    e.laps++;
    if (e.best === null || ms < e.best) e.best = ms;
    this.sortBoard();
    this.broadcast({ t: 'board', list: this.board });
    this.onBoard();
  }

  private honkFor(id: string): void {
    this.broadcast({ t: 'honk', id });
    if (id !== HOST_ID) this.onHonk(id);
  }

  private changed(): void {
    for (const [id] of this.remotes) {
      const r = this.remotes.get(id)!;
      this.send(r.conn, { t: 'lobby', lobby: this.lobby, you: id });
    }
    this.onLobby();
  }

  setMinutes(minutes: number): void {
    if (this.lobby.racing) return;
    this.lobby.minutes = minutes;
    this.changed();
  }

  start(): void {
    const now = performance.now();
    this.goAt = now + COUNTDOWN_MS;
    this.endAt = this.goAt + this.lobby.minutes * 60_000;
    this.board = [];
    for (const m of this.lobby.members) this.entry(m.id);
    this.latest.clear();
    this.cars.clear();
    this.lobby.racing = true;
    this.changed();
    this.broadcast({ t: 'board', list: this.board });
    this.broadcast({ t: 'start', goIn: COUNTDOWN_MS, endIn: this.endAt - now });
    this.onStart(COUNTDOWN_MS, this.endAt - now);
  }

  private finish(): void {
    this.lobby.racing = false;
    this.sortBoard();
    this.broadcast({ t: 'end', list: this.board });
    this.changed();
    this.onEnd(this.board);
  }

  // Ends the round now (the host's "End round").
  endNow(): void {
    if (this.lobby.racing) this.finish();
  }

  pick(driver: string): void {
    this.pickFor(HOST_ID, driver);
  }

  sendPos(s: Snap): void {
    this.latest.set(HOST_ID, { ...s, id: HOST_ID });
  }

  sendLap(ms: number): void {
    this.lapFor(HOST_ID, ms);
  }

  honk(): void {
    this.honkFor(HOST_ID);
  }

  leave(): void {
    this.timers.forEach(clearInterval);
    this.peer.destroy();
  }
}

export class ClientRoom implements Room {
  readonly isHost = false;
  you = '';
  lobby: Lobby = { code: '', minutes: 4, members: [], racing: false };
  board: Entry[] = [];
  cars = new Map<string, { at: number; s: Snap }[]>();
  onLobby = () => {};
  onStart: (goIn: number, endIn: number) => void = () => {};
  onEnd: (list: Entry[]) => void = () => {};
  onHonk: (id: string) => void = () => {};
  onBoard = () => {};
  onClose: (why: string) => void = () => {};
  private peer: Peer;
  private conn: DataConnection;
  private pinger: ReturnType<typeof setInterval>;
  private closed = false;
  private lastPos = 0;

  private constructor(peer: Peer, conn: DataConnection) {
    this.peer = peer;
    this.conn = conn;
    conn.on('data', (raw) => this.receive(raw as ToClient));
    conn.on('close', () => this.close('The host closed the room.'));
    conn.on('error', () => this.close('Lost the connection to the host.'));
    peer.on('error', (e) => {
      if (errType(e) !== 'peer-unavailable') this.close('Lost the connection to the host.');
    });
    this.pinger = setInterval(() => this.send({ t: 'ping' }), PING_MS);
  }

  static async join(code: string, name: string, driver: string): Promise<ClientRoom> {
    const peer = await openPeer();
    return new Promise((resolve, reject) => {
      const conn = peer.connect(PREFIX + code.toLowerCase(), { reliable: true });
      const fail = (why: string) => {
        peer.destroy();
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail("Couldn't reach that room. Check the code, and that the host still has it open."), 15000);
      peer.once('error', (e) => {
        clearTimeout(timer);
        fail(errType(e) === 'peer-unavailable' ? 'No room with that code.' : `Couldn't connect (${errType(e) || 'error'}).`);
      });
      conn.once('open', () => {
        clearTimeout(timer);
        const room = new ClientRoom(peer, conn);
        room.send({ t: 'hello', name, driver });
        resolve(room);
      });
    });
  }

  private send(m: ToHost): void {
    if (this.conn.open) void this.conn.send(m);
  }

  private receive(m: ToClient): void {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'lobby':
        this.lobby = m.lobby;
        this.you = m.you;
        this.onLobby();
        break;
      case 'cars':
        for (const s of m.list) if (s.id !== this.you) pushSnap(this.cars, s);
        break;
      case 'board':
        this.board = m.list;
        this.onBoard();
        break;
      case 'start':
        this.cars.clear();
        this.onStart(m.goIn, m.endIn);
        break;
      case 'end':
        this.board = m.list;
        this.onEnd(m.list);
        break;
      case 'honk':
        if (m.id !== this.you) this.onHonk(m.id);
        break;
      case 'bye':
        this.close(m.why);
        break;
    }
  }

  pick(driver: string): void {
    this.send({ t: 'pick', driver });
  }

  sendPos(s: Snap): void {
    const now = performance.now();
    if (now - this.lastPos < 1000 / 15) return;
    this.lastPos = now;
    this.send({ t: 'pos', s });
  }

  sendLap(ms: number): void {
    this.send({ t: 'lap', ms });
  }

  honk(): void {
    this.send({ t: 'honk' });
  }

  leave(): void {
    this.close('');
  }

  close(why: string): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    this.peer.destroy();
    this.onClose(why);
  }
}
