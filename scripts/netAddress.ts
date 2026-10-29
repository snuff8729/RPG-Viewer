/**
 * 요청을 보낸 쪽의 IP 주소 분류(휴대폰 보기용).
 * Host 헤더는 보낸 쪽이 마음대로 정할 수 있으므로, "누가 보냈나"는 늘 소켓 주소로 판단한다.
 */
import { isIP } from "node:net";

/** `::ffff:192.168.0.2` 같은 IPv4-mapped 주소를 IPv4로, IPv6 영역 표시(`%eth0`)는 떼고 소문자로. */
export function normalizeIp(addr: string | undefined | null): string {
  if (!addr) return "";
  let a = addr.trim().toLowerCase();
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) a = mapped[1];
  return a;
}

function v4Parts(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null;
  return ip.split(".").map(Number);
}

/** IPv6 첫 16비트(형식이 아니면 null). */
function v6First(ip: string): number | null {
  if (isIP(ip) !== 6) return null;
  const head = ip.split(":")[0];
  if (head === "") return 0; // `::1` 등
  const n = parseInt(head, 16);
  return Number.isFinite(n) ? n : null;
}

/** 127.0.0.0/8, ::1 */
export function isLoopbackIp(raw: string | undefined | null): boolean {
  const ip = normalizeIp(raw);
  const v4 = v4Parts(ip);
  if (v4) return v4[0] === 127;
  return ip === "::1";
}

/** 집·사무실 공유기 안쪽 주소: 10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10. 루프백은 여기 넣지 않는다. */
export function isPrivateIp(raw: string | undefined | null): boolean {
  const ip = normalizeIp(raw);
  const v4 = v4Parts(ip);
  if (v4) {
    const [a, b] = v4;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const first = v6First(ip);
  if (first === null) return false;
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/** 요청 소켓의 정규화한 상대 주소. */
export function clientIp(req: { socket?: { remoteAddress?: string } }): string {
  return normalizeIp(req.socket?.remoteAddress);
}
