// Rooms over WebRTC (PeerJS). Everyone drives their own car in their own browser, round the city or
// in a race; the host relays where everyone is (always) and what they throw (in a race), drives the
// bots, keeps the leaderboard and the clock.
import Peer, { type DataConnection } from 'peerjs';
import type { ItemEv } from './game/items.ts';
import { driverById, DRIVERS, repeatOf } from './render/drivers.ts';

// Builds see each other's rooms only while this matches: pk33 is the race that jumps over the Rio
// Este into the dead end (braga-map's task 039), its samples changed from there on; pk38 the race round
// the roundabouts' rings as the LiDAR measured them (braga-map's task 014).
const PREFIX = 'partykart-pk38-';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const HOST_ID = 'host';
export const MAX_RACERS = 8;
const PING_MS = 1000;
const SILENT_MS = 15000; // generous: a slow computer can freeze for seconds as a round loads
export const COUNTDOWN_MS = 4000;
const FINISH_GRACE_MS = 30000; // after the winner, how long the rest have to finish
// The most a lap may take before the race is called: main.ts sets it from the track's length.
let lapLimit = 150;
export const setLapLimit = (seconds: number): void => {
  lapLimit = seconds;
};

export interface Settings {
  mode: 'race' | 'time';
  laps: number;
  minutes: number; // time attack
  items: boolean;
  catchUp: boolean;
  bots: number;
}

export interface Member {
  id: string;
  name: string;
  driver: string;
  bot: boolean;
}

export interface Lobby extends Settings {
  code: string;
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
  st: number; // steering
  P: number; // progress, metres counting laps
  fl: number; // status flags (game/arena.ts, FLAG)
  g: number; // grounded
}

export interface Entry {
  id: string;
  name: string;
  driver: string;
  bot: boolean;
  best: number | null; // best lap, ms
  laps: number;
  fin: number | null; // race ms at the finish
  P: number;
}

type ToHost =
  | { t: 'hello'; name: string; driver: string }
  | { t: 'pick'; driver: string }
  | { t: 'name'; name: string }
  | { t: 'pos'; s: Snap }
  | { t: 'lap'; ms: number }
  | { t: 'fin'; ms: number }
  | { t: 'ev'; ev: ItemEv }
  | { t: 'honk' }
  | { t: 'ping' };

type ToClient =
  | { t: 'lobby'; lobby: Lobby; you: string }
  | { t: 'cars'; list: Snap[] }
  | { t: 'board'; list: Entry[] }
  | { t: 'start'; goIn: number; endIn: number; grid: Record<string, number> }
  | { t: 'end'; list: Entry[] }
  | { t: 'ev'; ev: ItemEv }
  | { t: 'honk'; id: string }
  | { t: 'bye'; why: string };

export const cleanName = (n: unknown): string =>
  (typeof n === 'string' ? n : '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || 'Piloto';

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
  onStart: (goIn: number, endIn: number, grid: Record<string, number>) => void;
  onEnd: (list: Entry[]) => void;
  onHonk: (id: string) => void;
  onBoard: () => void;
  onEv: (ev: ItemEv) => void;
  onClose: (why: string) => void;
  pick(driver: string): void;
  rename(name: string): void;
  sendPos(s: Snap): void;
  sendLap(ms: number, id?: string): void;
  sendFin(ms: number, id?: string): void;
  sendEv(ev: ItemEv): void;
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
const str = (v: unknown, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');

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
    P: num(s.P, -1e6, 1e6),
    fl: num(s.fl, 0, 65535) | 0,
    g: s.g ? 1 : 0,
  };
}

// An item event from someone else: only what's expected, with their id as the owner, so nobody
// throws things in someone else's name.
function cleanEv(from: string, ev: ItemEv): ItemEv | null {
  if (!ev || typeof ev !== 'object') return null;
  const id = str(ev.id);
  const n = (v: unknown) => num(v, -1e7, 1e7);
  switch (ev.k) {
    case 'proj':
      if (!['bola', 'pombo', 'foguete'].includes(ev.kind)) return null;
      return { k: 'proj', id, kind: ev.kind, owner: from, t0: n(ev.t0), p0: n(ev.p0), lat: num(ev.lat, -20, 20), v: num(ev.v, -200, 200), target: ev.target === undefined ? undefined : str(ev.target) };
    case 'haz':
      return { k: 'haz', id, kind: 'pudim', owner: from, t0: n(ev.t0), idx: num(ev.idx, 0, 1e5) | 0, lat: num(ev.lat, -20, 20) };
    case 'martelinho':
      return { k: 'martelinho', id, owner: from, t0: n(ev.t0), p0: n(ev.p0) };
    case 'hit':
      return { k: 'hit', id, item: str(ev.item), victim: ev.victim === null ? null : from, blocked: !!ev.blocked, how: str(ev.how, 16), x: n(ev.x), y: n(ev.y), z: n(ev.z) };
    case 'boom':
      return { k: 'boom', id, owner: str(ev.owner), victim: from, x: n(ev.x), y: n(ev.y), z: n(ev.z) };
    default:
      return null;
  }
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
  onStart: Room['onStart'] = () => {};
  onEnd: (list: Entry[]) => void = () => {};
  onHonk: (id: string) => void = () => {};
  onBoard = () => {};
  onEv: (ev: ItemEv) => void = () => {};
  onClose: (why: string) => void = () => {};
  private peer: Peer;
  private remotes = new Map<string, Remote>();
  private latest = new Map<string, Snap>();
  private goAt = 0;
  private endAt = 0;
  private firstFin = 0;
  private grid: Record<string, number> = {};
  private timers: ReturnType<typeof setInterval>[] = [];

  private constructor(peer: Peer, name: string, driver: string) {
    this.peer = peer;
    this.lobby = {
      code: peer.id.slice(PREFIX.length),
      mode: 'race',
      laps: 1,
      minutes: 10,
      items: true,
      catchUp: true,
      bots: 3,
      members: [{ id: HOST_ID, name, driver: validDriver(driver), bot: false }],
      racing: false,
    };
    this.syncBots();
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
      // Everyone's positions, 15 times a second, round the city as in a race.
      setInterval(() => {
        if (this.remotes.size === 0) return;
        const list = [...this.latest.values()];
        for (const r of this.remotes.values()) this.send(r.conn, { t: 'cars', list });
      }, 1000 / 15),
      setInterval(() => this.checkEnd(), 250),
    );
  }

  static async create(name: string, driver: string): Promise<HostRoom> {
    for (let i = 0; ; i++) {
      try {
        return new HostRoom(await openPeer(PREFIX + makeCode()), name, driver);
      } catch (e) {
        if (errType(e) !== 'unavailable-id' || i >= 3) throw e;
      }
    }
  }

  private send(c: DataConnection, m: ToClient): void {
    if (c.open) void c.send(m);
  }

  private broadcast(m: ToClient, except?: string): void {
    for (const [id, r] of this.remotes) if (id !== except) this.send(r.conn, m);
  }

  private accept(c: DataConnection): void {
    c.on('data', (raw) => this.receive(c, raw as ToHost));
    c.on('close', () => this.drop(c.peer));
    c.on('error', () => this.drop(c.peer));
  }

  private humans(): Member[] {
    return this.lobby.members.filter((m) => !m.bot);
  }

  // The bots take the drivers nobody picked, then the same cars again in their second paint, up
  // to the number asked for and the grid's size.
  private syncBots(): void {
    const humans = this.humans();
    const taken = new Set(humans.map((m) => m.driver));
    const free = [...DRIVERS.filter((d) => !taken.has(d.id)).map((d) => d.id), ...DRIVERS.map((d) => repeatOf(d.id))];
    const n = Math.max(0, Math.min(this.lobby.bots, MAX_RACERS - humans.length));
    const bots = free.slice(0, n).map((id, k) => ({ id: `bot-${k + 1}`, name: driverById(id).name, driver: id, bot: true }));
    this.lobby.members = [...humans, ...bots];
  }

  private freeDriver(want: string, except: string): string {
    const taken = new Set(this.humans().filter((m) => m.id !== except).map((m) => m.driver));
    if (!taken.has(want)) return want;
    return DRIVERS.find((d) => !taken.has(d.id))?.id ?? want;
  }

  private receive(c: DataConnection, m: ToHost): void {
    if (!m || typeof m !== 'object') return;
    const r = this.remotes.get(c.peer);
    if (r) r.heard = performance.now();
    if (m.t === 'hello' && !r) {
      if (this.humans().length >= MAX_RACERS) {
        this.send(c, { t: 'bye', why: 'A sala está cheia.' });
        setTimeout(() => c.close(), 500);
        return;
      }
      this.remotes.set(c.peer, { conn: c, heard: performance.now() });
      const humans = this.humans();
      humans.push({ id: c.peer, name: cleanName(m.name), driver: this.freeDriver(validDriver(m.driver), c.peer), bot: false });
      this.lobby.members = [...humans, ...this.lobby.members.filter((x) => x.bot)];
      if (!this.lobby.racing) this.syncBots();
      this.entry(c.peer);
      this.changed();
      // Joining mid-round: straight in, at the back of the grid.
      if (this.lobby.racing) {
        this.grid[c.peer] = Object.keys(this.grid).length;
        this.send(c, { t: 'start', goIn: this.goAt - performance.now(), endIn: this.endAt - performance.now(), grid: this.grid });
      }
      this.send(c, { t: 'board', list: this.board });
    } else if (!r) {
      return;
    } else if (m.t === 'pick') {
      this.pickFor(c.peer, m.driver);
    } else if (m.t === 'name') {
      this.nameFor(c.peer, m.name);
    } else if (m.t === 'pos' && m.s && typeof m.s === 'object') {
      const s = cleanSnap(c.peer, m.s);
      this.latest.set(c.peer, s);
      pushSnap(this.cars, s);
      const e = this.board.find((x) => x.id === c.peer);
      if (e) e.P = s.P;
    } else if (m.t === 'lap') {
      this.lapFor(c.peer, num(m.ms, 1000, 3_600_000));
    } else if (m.t === 'fin') {
      this.finFor(c.peer, num(m.ms, 1000, 3_600_000));
    } else if (m.t === 'ev') {
      const ev = cleanEv(c.peer, m.ev);
      if (!ev || !this.lobby.racing) return;
      this.broadcast({ t: 'ev', ev }, c.peer);
      this.onEv(ev);
    } else if (m.t === 'honk') {
      this.honkFor(c.peer);
    }
  }

  private drop(id: string): void {
    if (!this.remotes.delete(id)) return;
    this.lobby.members = this.lobby.members.filter((m) => m.id !== id);
    if (!this.lobby.racing) this.syncBots();
    this.latest.delete(id);
    this.cars.delete(id);
    this.board = this.board.filter((e) => e.id !== id);
    this.changed();
  }

  private entry(id: string): Entry {
    const m = this.lobby.members.find((x) => x.id === id);
    let e = this.board.find((x) => x.id === id);
    if (!e) {
      e = { id, name: m?.name ?? '?', driver: m?.driver ?? DRIVERS[0].id, bot: !!m?.bot, best: null, laps: 0, fin: null, P: -1e6 };
      this.board.push(e);
    }
    if (m) {
      e.name = m.name;
      e.driver = m.driver;
    }
    return e;
  }

  private sortBoard(): void {
    if (this.lobby.mode === 'race') {
      this.board.sort((a, b) => (a.fin !== null || b.fin !== null ? (a.fin ?? Infinity) - (b.fin ?? Infinity) : b.P - a.P));
    } else {
      this.board.sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity) || b.laps - a.laps);
    }
  }

  private pickFor(id: string, driver: string): void {
    const m = this.lobby.members.find((x) => x.id === id);
    if (!m || this.lobby.racing) return;
    const d = validDriver(driver);
    if (this.humans().some((x) => x.id !== id && x.driver === d)) return;
    m.driver = d;
    this.syncBots();
    this.entry(id);
    this.changed();
  }

  private nameFor(id: string, name: string): void {
    const m = this.lobby.members.find((x) => x.id === id);
    if (!m || m.bot || this.lobby.racing) return;
    m.name = cleanName(name);
    this.entry(id);
    this.changed();
  }

  private lapFor(id: string, ms: number): void {
    if (!this.lobby.racing) return;
    const e = this.entry(id);
    e.laps++;
    if (e.best === null || ms < e.best) e.best = ms;
    this.boardChanged();
  }

  private finFor(id: string, ms: number): void {
    if (!this.lobby.racing || this.lobby.mode !== 'race') return;
    const e = this.entry(id);
    if (e.fin !== null) return;
    e.fin = ms;
    if (!this.firstFin) this.firstFin = performance.now();
    this.boardChanged();
  }

  private boardChanged(): void {
    this.sortBoard();
    this.broadcast({ t: 'board', list: this.board });
    this.onBoard();
  }

  private honkFor(id: string): void {
    this.broadcast({ t: 'honk', id });
    if (id !== HOST_ID) this.onHonk(id);
  }

  private changed(): void {
    for (const [id, r] of this.remotes) this.send(r.conn, { t: 'lobby', lobby: this.lobby, you: id });
    this.onLobby();
  }

  configure(s: Partial<Settings>): void {
    if (this.lobby.racing) return;
    Object.assign(this.lobby, s);
    this.syncBots();
    this.changed();
  }

  start(): void {
    const now = performance.now();
    this.syncBots();
    this.goAt = now + COUNTDOWN_MS;
    const race = this.lobby.mode === 'race';
    this.endAt = this.goAt + (race ? (this.lobby.laps * lapLimit + 60) * 1000 : this.lobby.minutes * 60_000);
    this.firstFin = 0;
    this.board = [];
    for (const m of this.lobby.members) this.entry(m.id);
    // A random grid.
    const order = this.lobby.members.map((m) => m.id).sort(() => Math.random() - 0.5);
    this.grid = Object.fromEntries(order.map((id, k) => [id, k]));
    this.latest.clear();
    this.cars.clear();
    this.lobby.racing = true;
    this.changed();
    this.broadcast({ t: 'board', list: this.board });
    this.broadcast({ t: 'start', goIn: COUNTDOWN_MS, endIn: this.endAt - now, grid: this.grid });
    this.onStart(COUNTDOWN_MS, this.endAt - now, this.grid);
  }

  private checkEnd(): void {
    if (!this.lobby.racing) return;
    const now = performance.now();
    const race = this.lobby.mode === 'race';
    const allIn = race && this.board.length > 0 && this.board.every((e) => e.fin !== null);
    const graceOver = race && this.firstFin > 0 && now - this.firstFin > FINISH_GRACE_MS;
    if (allIn || graceOver || now >= this.endAt) this.finish();
  }

  private finish(): void {
    this.lobby.racing = false;
    // The bots stop with the race: nothing of theirs is relayed round the city.
    for (const m of this.lobby.members) {
      if (!m.bot) continue;
      this.latest.delete(m.id);
      this.cars.delete(m.id);
    }
    this.sortBoard();
    this.broadcast({ t: 'end', list: this.board });
    this.syncBots();
    this.changed();
    this.onEnd(this.board);
  }

  endNow(): void {
    if (this.lobby.racing) this.finish();
  }

  // How long the others have left to finish once someone has, for the screen.
  graceLeft(): number | null {
    return this.firstFin ? Math.max(0, FINISH_GRACE_MS - (performance.now() - this.firstFin)) : null;
  }

  pick(driver: string): void {
    this.pickFor(HOST_ID, driver);
  }

  rename(name: string): void {
    this.nameFor(HOST_ID, name);
  }

  // Ours, or a bot's.
  sendPos(s: Snap): void {
    this.latest.set(s.id, s);
    const e = this.board.find((x) => x.id === s.id);
    if (e) e.P = s.P;
  }

  sendLap(ms: number, id = HOST_ID): void {
    this.lapFor(id, ms);
  }

  sendFin(ms: number, id = HOST_ID): void {
    this.finFor(id, ms);
  }

  sendEv(ev: ItemEv): void {
    if (this.lobby.racing) this.broadcast({ t: 'ev', ev });
  }

  honk(): void {
    this.honkFor(HOST_ID);
  }

  // The bye tells everyone the room closed, rather than their connection failing, and goes out
  // before the peer closes, as a full room's does.
  leave(): void {
    this.timers.forEach(clearInterval);
    this.broadcast({ t: 'bye', why: 'O anfitrião fechou a sala.' });
    this.remotes.clear();
    setTimeout(() => this.peer.destroy(), 500);
  }
}

export class ClientRoom implements Room {
  readonly isHost = false;
  you = '';
  lobby: Lobby = { code: '', mode: 'race', laps: 1, minutes: 10, items: true, catchUp: true, bots: 0, members: [], racing: false };
  board: Entry[] = [];
  cars = new Map<string, { at: number; s: Snap }[]>();
  onLobby = () => {};
  onStart: Room['onStart'] = () => {};
  onEnd: (list: Entry[]) => void = () => {};
  onHonk: (id: string) => void = () => {};
  onBoard = () => {};
  onEv: (ev: ItemEv) => void = () => {};
  onClose: (why: string) => void = () => {};
  private peer: Peer;
  private conn: DataConnection;
  private pinger: ReturnType<typeof setInterval>;
  private closed = false;
  private lastPos = 0;

  private constructor(peer: Peer, conn: DataConnection) {
    this.peer = peer;
    this.conn = conn;
    // Only the connection to the host ends the room. PeerJS's server just introduced us, so the
    // peer's own errors, such as its socket to that server dropping mid-race, leave the race be.
    // A host that leaves says so first, with a bye.
    conn.on('data', (raw) => this.receive(raw as ToClient));
    conn.on('close', () => this.close('Perdeu-se a ligação ao anfitrião.'));
    conn.on('error', () => this.close('Perdeu-se a ligação ao anfitrião.'));
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
      const timer = setTimeout(() => fail('Não foi possível chegar a essa sala. Confirma o código, e se o anfitrião ainda a tem aberta.'), 15000);
      const failed = (e: unknown) => {
        clearTimeout(timer);
        fail(errType(e) === 'peer-unavailable' ? 'Não há nenhuma sala com esse código.' : `Não foi possível ligar (${errType(e) || 'erro'}).`);
      };
      peer.once('error', failed);
      conn.once('open', () => {
        clearTimeout(timer);
        peer.off('error', failed);
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
        this.onStart(m.goIn, m.endIn, m.grid);
        break;
      case 'end':
        this.board = m.list;
        for (const x of this.lobby.members) if (x.bot) this.cars.delete(x.id);
        this.onEnd(m.list);
        break;
      case 'ev':
        this.onEv(m.ev);
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

  rename(name: string): void {
    this.send({ t: 'name', name });
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

  sendFin(ms: number): void {
    this.send({ t: 'fin', ms });
  }

  sendEv(ev: ItemEv): void {
    this.send({ t: 'ev', ev });
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
