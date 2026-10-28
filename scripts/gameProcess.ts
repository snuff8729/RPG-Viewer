/**
 * 실행 중인 게임 프로세스 찾기·강제 종료.
 *
 * 복원 직전에 게임을 강제로 끈다: 정상 종료하면 게임이 메모리의 공용 데이터를 다시 써 버릴 수 있다.
 * 실제 동작(ProcessOps)은 바꿔 끼울 수 있어 테스트에서 진짜 프로세스를 건드리지 않는다.
 */
import { execFile } from "node:child_process";

export interface ProcessOps {
  /** 이 실행 파일로 돈 프로세스 pid들. 알 수 없으면 null. */
  findByExe(exe: string): Promise<number[] | null>;
  /** 프로세스와 그 자식들까지 강제 종료. */
  killTree(pid: number): Promise<void>;
  /** pid가 아직 살아 있는지(조회가 안 될 때 대신 쓴다). */
  isAlive(pid: number): boolean;
  sleep(ms: number): Promise<void>;
}

export const ERR_STILL_RUNNING = "게임이 꺼지지 않아 복원하지 않았어요";

/** 실행 파일 경로가 같은 프로세스. 경로는 환경 변수로 넘겨 명령 문자열에 넣지 않는다. */
const FIND_SCRIPT =
  "$p = $env:RPGV_GAME_EXE; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $p } | ForEach-Object { $_.ProcessId }";

export const nodeProcessOps: ProcessOps = {
  findByExe(exe) {
    if (process.platform !== "win32") return Promise.resolve(null);
    return new Promise((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", FIND_SCRIPT],
        { env: { ...process.env, RPGV_GAME_EXE: exe }, windowsHide: true, timeout: 15_000 },
        (err, stdout) => {
          if (err) { resolve(null); return; }
          resolve(parsePids(String(stdout)));
        },
      );
    });
  },
  killTree(pid) {
    return new Promise((resolve) => {
      if (process.platform === "win32") {
        execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 15_000 }, () => resolve());
      } else {
        try { process.kill(pid, "SIGKILL"); } catch { /* 이미 꺼짐 */ }
        resolve();
      }
    });
  },
  isAlive(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function parsePids(text: string): number[] {
  const out: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n > 0 && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/**
 * 게임 프로세스 추적: 뷰어가 띄운 pid를 기억하고, 밖에서 띄운 것도 실행 파일 경로로 찾는다.
 * 경로 조회가 되면 그것만 믿는다(기억한 pid는 다른 프로세스가 재사용했을 수 있다).
 */
export class GameProcesses {
  private readonly spawned = new Map<string, Set<number>>();
  private readonly ops: ProcessOps;

  constructor(ops: ProcessOps) {
    this.ops = ops;
  }

  private key(exe: string): string {
    return exe.toLowerCase();
  }

  track(exe: string, pid: number | undefined): void {
    if (pid === undefined) return;
    const k = this.key(exe);
    if (!this.spawned.has(k)) this.spawned.set(k, new Set());
    this.spawned.get(k)!.add(pid);
  }

  async find(exe: string): Promise<number[]> {
    const found = await this.ops.findByExe(exe);
    const tracked = this.spawned.get(this.key(exe)) ?? new Set<number>();
    if (found !== null) {
      for (const pid of [...tracked]) if (!found.includes(pid)) tracked.delete(pid);
      return found;
    }
    const alive = [...tracked].filter((pid) => this.ops.isAlive(pid));
    for (const pid of [...tracked]) if (!alive.includes(pid)) tracked.delete(pid);
    return alive;
  }

  async running(exe: string): Promise<boolean> {
    return (await this.find(exe)).length > 0;
  }

  /** 실행 중이면 강제로 끄고 다 꺼질 때까지 기다린다. 끈 개수 또는 시간 초과 오류. */
  async killAndWait(exe: string, timeoutMs = 10_000, stepMs = 250): Promise<{ ok: true; killed: number } | { ok: false; error: string }> {
    const pids = await this.find(exe);
    if (pids.length === 0) return { ok: true, killed: 0 };
    for (const pid of pids) await this.ops.killTree(pid);
    for (let waited = 0; ; waited += stepMs) {
      if ((await this.find(exe)).length === 0) return { ok: true, killed: pids.length };
      if (waited >= timeoutMs) return { ok: false, error: ERR_STILL_RUNNING };
      await this.ops.sleep(stepMs);
    }
  }
}
