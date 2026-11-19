import { createHmac, timingSafeEqual } from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET;

export function signToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + 60 * 60 * 24 * 7 })).toString("base64url");
  const unsigned = `${header}.${body}`;
  const signature = createHmac("sha256", JWT_SECRET).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}
export function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  let actual;
  try { actual = Buffer.from(parts[2], "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
export function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  const entry = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}
export function requireAuth(req, res, next) {
  const payload = verifyToken(readCookie(req, COOKIE_NAME));
  if (!payload?.userId || !payload?.email) {
    return res.status(401).json({ message: "Please sign in to continue." });
  }
  req.user = payload;
  next();
}
