/**
 * 뷰어 서버(scripts/fsApi.ts)로 연 게임 폴더. 실제 경로(root)를 알므로 실행·백업도 같은 경로를 쓴다.
 * 서버가 다시 시작돼 세션을 잊으면(410) 같은 경로로 한 번 다시 열고 재시도한다.
 */
import type { FileStat, WritableGameFolder } from "@/core/fs/folder";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchFn = (input, init) => fetch(input, init);

export interface ServerSession {
  id: string;
  /** 게임 루트의 실제 경로 */
  root: string;
  title: string;
  engine: string;
  /** 루트 폴더 이름 */
  name: string;
}

export type ServerOpenResult =
  | { ok: true; session: ServerSession }
  | { ok: true; cancelled: true }
  | { ok: false; error: string; pickerFailed?: boolean };

const NETWORK_ERROR = "뷰어 서버에 연결하지 못했어요";

function toSession(j: Record<string, unknown>): ServerSession | null {
  if (typeof j.id !== "string" || typeof j.root !== "string") return null;
  return {
    id: j.id,
    root: j.root,
    title: typeof j.title === "string" ? j.title : "",
    engine: typeof j.engine === "string" ? j.engine : "",
    name: typeof j.name === "string" ? j.name : j.root,
  };
}

async function postJson(fetchFn: FetchFn, route: string, body: unknown): Promise<Response> {
  return fetchFn(`/api/fs/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function openResult(fetchFn: FetchFn, route: "pick" | "open", body: unknown): Promise<ServerOpenResult> {
  try {
    const r = await postJson(fetchFn, route, body);
    const j = (await r.json()) as Record<string, unknown>;
    if (j?.ok === true) {
      if (j.cancelled === true) return { ok: true, cancelled: true };
      const session = toSession(j);
      if (session) return { ok: true, session };
    } else if (j?.ok === false && typeof j.error === "string") {
      return { ok: false, error: j.error, ...(j.pickerFailed === true ? { pickerFailed: true } : {}) };
    }
    return { ok: false, error: NETWORK_ERROR };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

/** 서버에 기본 폴더 선택 창을 띄운다. 게임 폴더·www·.exe가 든 폴더 모두 받는다. */
export const pickFolderOnServer = (fetchFn: FetchFn = defaultFetch) => openResult(fetchFn, "pick", {});

/** 알고 있는 경로(최근 게임)로 연다. */
export const openFolderOnServer = (path: string, fetchFn: FetchFn = defaultFetch) => openResult(fetchFn, "open", { path });

export interface FsApiInfo { available: boolean; pick: boolean }

let pingPromise: Promise<FsApiInfo> | null = null;

/** 서버 폴더 API가 있는지, 기본 폴더 선택 창을 띄울 수 있는지(한 번만 확인). */
export function fsApiInfo(fetchFn: FetchFn = defaultFetch): Promise<FsApiInfo> {
  pingPromise ??= fetchFn("/api/fs/ping", { cache: "no-store" })
    .then(async (r) => {
      if (!r.ok) return { available: false, pick: false };
      const j = (await r.json()) as { ok?: unknown; pick?: unknown };
      return { available: j.ok === true, pick: j.ok === true && j.pick === true };
    })
    .catch(() => ({ available: false, pick: false }));
  return pingPromise;
}

export class ServerFolder implements WritableGameFolder {
  readonly session: ServerSession;
  private id: string;
  private fetchFn: FetchFn;
  private reopening: Promise<boolean> | null = null;
  /** 휴대폰 보기: 읽기만 한다(쓰기는 시도하지 않고, 서버도 막는다). 세션을 다시 열지도 않는다. */
  readonly readOnly: boolean;

  constructor(session: ServerSession, fetchFn: FetchFn = defaultFetch, opts: { readOnly?: boolean } = {}) {
    this.session = session;
    this.id = session.id;
    this.fetchFn = fetchFn;
    this.readOnly = opts.readOnly === true;
  }

  get root(): string { return this.session.root; }

  private reopen(staleId: string): Promise<boolean> {
    if (this.readOnly) return Promise.resolve(false);
    if (this.id !== staleId) return Promise.resolve(true);
    this.reopening ??= openFolderOnServer(this.session.root, this.fetchFn).then((r) => {
      this.reopening = null;
      if (r.ok && "session" in r) { this.id = r.session.id; return true; }
      return false;
    });
    return this.reopening;
  }

  /** 요청. 네트워크 오류면 null. 세션이 사라졌으면 다시 열고 한 번 재시도. */
  private async call(route: string, body: Record<string, unknown>): Promise<Response | null> {
    try {
      const id = this.id;
      let r = await postJson(this.fetchFn, route, { ...body, id });
      if (r.status === 410 && (await this.reopen(id))) r = await postJson(this.fetchFn, route, { ...body, id: this.id });
      return r;
    } catch {
      return null;
    }
  }

  private async bytes(route: string, body: Record<string, unknown>): Promise<ArrayBuffer | null> {
    const r = await this.call(route, body);
    if (!r || r.status !== 200) return null;
    try { return await r.arrayBuffer(); } catch { return null; }
  }

  private async json(route: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const r = await this.call(route, body);
    if (!r || r.status !== 200) return null;
    try {
      const j = (await r.json()) as unknown;
      return typeof j === "object" && j !== null ? (j as Record<string, unknown>) : null;
    } catch { return null; }
  }

  async readText(path: string): Promise<string | null> {
    const b = await this.bytes("read", { path });
    return b === null ? null : new TextDecoder().decode(b);
  }

  readBinary(path: string): Promise<ArrayBuffer | null> {
    return this.bytes("read", { path });
  }

  /** 없으면(404·잘못된 경로 400) null. 네트워크 오류·그 밖의 상태(500 등)는 throw. */
  async readBinaryStrict(path: string): Promise<ArrayBuffer | null> {
    const r = await this.call("read", { path });
    if (!r) throw new Error(NETWORK_ERROR);
    if (r.status === 404 || r.status === 400) return null;
    if (r.status !== 200) throw new Error(`read failed: ${r.status}`);
    return await r.arrayBuffer();
  }

  readRange(path: string, start: number, end: number): Promise<ArrayBuffer | null> {
    return this.bytes("range", { path, start, end });
  }

  async list(dir: string): Promise<string[]> {
    const j = await this.json("list", { path: dir });
    return Array.isArray(j?.names) ? (j.names as unknown[]).filter((n): n is string => typeof n === "string") : [];
  }

  async stat(path: string): Promise<FileStat | null> {
    const j = await this.json("stat", { path });
    const s = j?.stat as { size?: unknown; lastModified?: unknown } | null | undefined;
    if (!s || typeof s.size !== "number" || typeof s.lastModified !== "number") return null;
    return { size: s.size, lastModified: s.lastModified };
  }

  async writeText(path: string, text: string): Promise<boolean> {
    if (this.readOnly) throw new Error(READ_ONLY);
    return (await this.json("write", { path, text }))?.ok === true;
  }

  async remove(path: string): Promise<boolean> {
    if (this.readOnly) throw new Error(READ_ONLY);
    return (await this.json("remove", { path }))?.ok === true;
  }

  async canWrite(): Promise<boolean> { return !this.readOnly; }
  async requestWrite(): Promise<boolean> { return !this.readOnly; }
}

const READ_ONLY = "휴대폰 보기에서는 쓸 수 없어요";

/** 읽기 전용 폴더(휴대폰 보기)인지 */
export function isReadOnlyFolder(f: unknown): boolean {
  return f instanceof ServerFolder && f.readOnly;
}
