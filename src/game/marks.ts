// The room's marks (braga-map's task 110): a place on the full map that everyone in the room sees, on
// their maps and minimaps, with the name of who put it. One a player: a new one takes the place of
// theirs, and it goes when they take it away or leave. The host keeps them and trusts nothing in what's
// sent: a place inside the open world, the sender's own, not more than one a second.
export interface RoomMark {
  id: string;
  name: string;
  x: number;
  z: number;
}

// What a player sends: their mark put at `at`, or taken away (null).
export interface MarkMsg {
  at: { x: number; z: number } | null;
}

// The host takes one a second at most from each; the players send one every 1.2 s at most, so the
// network's jitter never makes theirs too soon.
export const MARK_EVERY = 1000;
export const MARK_SEND = 1200;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// The host's marks.
export class MarkBook {
  private marks = new Map<string, RoomMark>();
  private last = new Map<string, number>();
  private inside: (x: number, z: number) => boolean;

  constructor(inside: (x: number, z: number) => boolean) {
    this.inside = inside;
  }

  // What `from` (the connection's own id, never one in the message) sent at `now` (ms): its mark put,
  // moved or taken away. Dropped: what isn't a mark, a place outside the open world, one that names
  // someone else, or one too soon after the last. True if the marks changed.
  take(from: string, name: string, m: unknown, now: number): boolean {
    if (!m || typeof m !== 'object') return false;
    const msg = m as { id?: unknown; at?: unknown };
    if (msg.id !== undefined && msg.id !== from) return false;
    if (now - (this.last.get(from) ?? -Infinity) < MARK_EVERY) return false;
    const at = msg.at as { x?: unknown; z?: unknown } | null | undefined;
    if (at === null) {
      this.last.set(from, now);
      return this.marks.delete(from);
    }
    if (!at || typeof at !== 'object' || !finite(at.x) || !finite(at.z) || !this.inside(at.x, at.z)) return false;
    this.last.set(from, now);
    this.marks.set(from, { id: from, name, x: Math.round(at.x * 10) / 10, z: Math.round(at.z * 10) / 10 });
    return true;
  }

  // Someone gone from the room: their mark with them.
  drop(id: string): boolean {
    this.last.delete(id);
    return this.marks.delete(id);
  }

  // Someone's new name, on their mark.
  rename(id: string, name: string): boolean {
    const m = this.marks.get(id);
    if (!m || m.name === name) return false;
    m.name = name;
    return true;
  }

  list(): RoomMark[] {
    return [...this.marks.values()].map((m) => ({ ...m }));
  }
}

// A player's side: the last mark asked for goes out at once, or as soon as MARK_SEND has passed since
// the one before, so a quick change of mind still gets there.
export class MarkSender {
  private sentAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private next: MarkMsg | null = null;
  private send: (m: MarkMsg) => void;
  private clock: () => number;

  constructor(send: (m: MarkMsg) => void, clock: () => number = () => performance.now()) {
    this.send = send;
    this.clock = clock;
  }

  push(m: MarkMsg): void {
    this.next = m;
    if (this.timer) return;
    const wait = this.sentAt + MARK_SEND - this.clock();
    if (wait <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.next = null;
  }

  private flush(): void {
    this.timer = null;
    if (!this.next) return;
    this.sentAt = this.clock();
    this.send(this.next);
    this.next = null;
  }
}

// Where a friend is (braga-map's task 110), for the GPS to follow: their latest snapshot's, on foot
// their feet's, in their kart its; none once they've left the room, are a bot, or haven't been heard
// of for 5 s.
export function whereIs(
  id: string,
  members: { id: string; bot: boolean }[],
  cars: Map<string, { at: number; s: { x: number; z: number } }[]>,
  now: number,
): { x: number; z: number } | null {
  const m = members.find((x) => x.id === id);
  const last = cars.get(id)?.at(-1);
  if (!m || m.bot || !last || now - last.at > 5000) return null;
  return { x: last.s.x, z: last.s.z };
}
