import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { createHmac, timingSafeEqual } from "node:crypto";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins";

const app = express();
const PORT = Number(process.env.PORT || 5000);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const MONGODB_URL = process.env.MONGODB_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = "studiospace_token";
const isProduction = process.env.NODE_ENV === "production";

if (!MONGODB_URL) throw new Error("MONGODB_URL is required.");
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters.");
}

app.use(cors({
  origin: (origin, callback) => {
    const allowed = (process.env.CLIENT_URL || "http://localhost:3000")
      .split(",").map((item) => item.trim());
    if (!origin || allowed.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  credentials: true,
}));
const client = new MongoClient(MONGODB_URL);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "studiospace");
const studios = db.collection("Studios");
const bookings = db.collection("bookings");
const wishlists = db.collection("wishlists");

if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required.");

const auth = betterAuth({
  database: mongodbAdapter(db),
  baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${PORT}`,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (process.env.CLIENT_URL || CLIENT_URL).split(",").map((x) => x.trim()),
  emailAndPassword: { enabled: true, minPasswordLength: 6 },
  socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }
    : {},
  plugins: [jwt()],
});

app.all("/api/auth/{*any}", toNodeHandler(auth));
app.use(express.json({ limit: "8mb" }));

function signToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + 60 * 60 * 24 * 7 })).toString("base64url");
  const unsigned = `${header}.${body}`;
  const signature = createHmac("sha256", JWT_SECRET).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}
function verifyToken(token) {
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
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  const entry = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}
function requireAuth(req, res, next) {
  const payload = verifyToken(readCookie(req, COOKIE_NAME));
  if (!payload?.userId || !payload?.email) {
    return res.status(401).json({ message: "Please sign in to continue." });
  }
  req.user = payload;
  next();
}
function validId(id) {
  return ObjectId.isValid(id) && String(new ObjectId(id)) === id;
}
function serializeStudio(studio) {
  return { ...studio, _id: String(studio._id) };
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// Exchange a valid Better Auth session for a short-lived, HTTPOnly JWT cookie.
app.post("/api/session-cookie", asyncRoute(async (req, res) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session?.user) return res.status(401).json({ message: "No active session found." });
  const token = signToken({
    userId: session.user.id,
    email: session.user.email.toLowerCase(),
    name: session.user.name || "",
    image: session.user.image || "",
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ user: { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image } });
}));
app.get("/api/session", requireAuth, (req, res) => res.json({ user: req.user }));
app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: isProduction, sameSite: isProduction ? "none" : "lax", path: "/" });
  res.json({ message: "Signed out." });
});

// Studio discovery and CRUD
app.get(["/api/studios", "/Studios"], asyncRoute(async (req, res) => {
  const { category, search, featured } = req.query;
  const filter = {};
  if (category && category !== "All") filter.category = { $regex: `^${String(category).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" };
  if (search) filter.$or = [
    { title: { $regex: String(search), $options: "i" } },
    { location: { $regex: String(search), $options: "i" } },
  ];
  let cursor = studios.find(filter).sort({ rating: -1, createdAt: -1 });
  if (featured === "true") cursor = cursor.limit(6);
  res.json((await cursor.toArray()).map(serializeStudio));
}));
app.get("/api/my/studios", requireAuth, asyncRoute(async (req, res) => {
  const result = await studios.find({ $or: [{ ownerId: req.user.userId }, { hostEmail: req.user.email }, { ownerEmail: req.user.email }] }).sort({ createdAt: -1 }).toArray();
  res.json(result.map(serializeStudio));
}));
app.get("/api/studios/:id", asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid studio ID." });
  const studio = await studios.findOne({ _id: new ObjectId(req.params.id) });
  if (!studio) return res.status(404).json({ message: "Studio not found." });
  res.json(serializeStudio(studio));
}));
app.post(["/api/studios", "/add-studio"], requireAuth, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const required = ["title", "category", "location", "imageUrl", "overview"];
  for (const field of required) if (!String(body[field] || "").trim()) return res.status(400).json({ message: `${field} is required.` });
  const doc = {
    title: String(body.title).trim(),
    category: String(body.category).trim(),
    hourlyRate: Number(body.hourlyRate),
    securityDeposit: Number(body.securityDeposit || 0),
    maxCapacity: Number(body.maxCapacity || 1),
    location: String(body.location).trim(),
    imageUrl: String(body.imageUrl).trim(),
    images: Array.isArray(body.images) ? body.images.filter((x) => typeof x === "string").slice(0, 8) : [],
    amenities: Array.isArray(body.amenities) ? body.amenities.map(String).slice(0, 30) : [],
    overview: String(body.overview).trim(),
    hostName: req.user.name,
    hostEmail: req.user.email,
    ownerId: req.user.userId,
    ownerEmail: req.user.email,
    rating: 0,
    reviews: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (!Number.isFinite(doc.hourlyRate) || doc.hourlyRate <= 0 || !Number.isFinite(doc.securityDeposit) || doc.securityDeposit < 0 || !Number.isInteger(doc.maxCapacity) || doc.maxCapacity < 1) {
    return res.status(400).json({ message: "Enter valid rates, deposit and capacity." });
  }
  const result = await studios.insertOne(doc);
  res.status(201).json({ message: "Studio published successfully.", studio: serializeStudio({ ...doc, _id: result.insertedId }) });
}));
app.put("/api/studios/:id", requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid studio ID." });
  const allowed = ["title", "category", "hourlyRate", "securityDeposit", "maxCapacity", "location", "imageUrl", "images", "amenities", "overview"];
  const update = {};
  for (const key of allowed) if (req.body[key] !== undefined) update[key] = req.body[key];
  if (update.hourlyRate !== undefined) update.hourlyRate = Number(update.hourlyRate);
  if (update.securityDeposit !== undefined) update.securityDeposit = Number(update.securityDeposit);
  if (update.maxCapacity !== undefined) update.maxCapacity = Number(update.maxCapacity);
  update.updatedAt = new Date();
  const result = await studios.updateOne({ _id: new ObjectId(req.params.id), $or: [{ ownerId: req.user.userId }, { hostEmail: req.user.email }, { ownerEmail: req.user.email }] }, { $set: update });
  if (!result.matchedCount) return res.status(404).json({ message: "Studio not found or you do not own it." });
  res.json({ message: "Studio updated successfully." });
}));
app.delete("/api/studios/:id", requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid studio ID." });
  const result = await studios.deleteOne({ _id: new ObjectId(req.params.id), $or: [{ ownerId: req.user.userId }, { hostEmail: req.user.email }, { ownerEmail: req.user.email }] });
  if (!result.deletedCount) return res.status(404).json({ message: "Studio not found or you do not own it." });
  res.json({ message: "Studio deleted successfully." });
}));

// Booking collision check: only confirmed reservations block a requested slot.
app.post("/api/bookings", requireAuth, asyncRoute(async (req, res) => {
  const { studioId, date, startTime, endTime } = req.body || {};
  if (!validId(studioId) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(String(date || "")) || !/^\\d{2}:\\d{2}$/.test(String(startTime || "")) || !/^\\d{2}:\\d{2}$/.test(String(endTime || "")) || startTime >= endTime) {
    return res.status(400).json({ message: "Choose a valid studio, date and time range." });
  }
  const studio = await studios.findOne({ _id: new ObjectId(studioId) });
  if (!studio) return res.status(404).json({ message: "Studio not found." });
  if (studio.ownerId === req.user.userId) return res.status(400).json({ message: "You cannot book your own studio." });
  const collision = await bookings.findOne({
    studioId, date, status: "Confirmed",
    startTime: { $lt: endTime }, endTime: { $gt: startTime },
  });
  if (collision) return res.status(409).json({ message: "This time slot has already been confirmed. Please choose another time." });
  const hours = (new Date(`${date}T${endTime}:00`) - new Date(`${date}T${startTime}:00`)) / 3600000;
  const booking = {
    studioId, studioTitle: studio.title, studioImage: studio.imageUrl,
    hostEmail: studio.hostEmail, hostName: studio.hostName,
    customerId: req.user.userId, customerEmail: req.user.email, customerName: req.user.name,
    date, startTime, endTime, hours, hourlyRate: Number(studio.hourlyRate || 0),
    securityDeposit: Number(studio.securityDeposit || 0),
    total: hours * Number(studio.hourlyRate || 0) + Number(studio.securityDeposit || 0),
    status: "Pending", createdAt: new Date(),
  };
  const result = await bookings.insertOne(booking);
  res.status(201).json({ message: "Booking request sent to the host.", booking: { ...booking, _id: String(result.insertedId) } });
}));
app.get("/api/bookings", requireAuth, asyncRoute(async (req, res) => {
  const result = await bookings.find({ $or: [{ customerId: req.user.userId }, { hostEmail: req.user.email }] }).sort({ createdAt: -1 }).toArray();
  res.json(result.map((item) => ({ ...item, _id: String(item._id) })));
}));
app.patch("/api/bookings/:id/cancel", requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid booking ID." });
  const result = await bookings.updateOne(
    { _id: new ObjectId(req.params.id), customerId: req.user.userId, status: "Pending" },
    { $set: { status: "Cancelled", updatedAt: new Date() } }
  );
  if (!result.matchedCount) return res.status(409).json({ message: "Only your pending bookings can be cancelled." });
  res.json({ message: "Booking cancelled." });
}));
app.patch("/api/bookings/:id/status", requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid booking ID." });
  const status = req.body.status;
  if (!["Confirmed", "Completed", "Cancelled"].includes(status)) return res.status(400).json({ message: "Invalid booking status." });
  const currentStatus = status === "Completed" ? "Confirmed" : "Pending";
  const booking = await bookings.findOne({ _id: new ObjectId(req.params.id), hostEmail: req.user.email, status: currentStatus });
  if (!booking) return res.status(404).json({ message: `A ${currentStatus.toLowerCase()} booking was not found for this host.` });
  if (status === "Confirmed") {
    const collision = await bookings.findOne({
      _id: { $ne: booking._id }, studioId: booking.studioId, date: booking.date, status: "Confirmed",
      startTime: { $lt: booking.endTime }, endTime: { $gt: booking.startTime },
    });
    if (collision) return res.status(409).json({ message: "This slot overlaps another confirmed booking." });
  }
  const result = await bookings.updateOne(
    { _id: booking._id, status: currentStatus },
    { $set: { status, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return res.status(404).json({ message: "Pending booking not found for this host." });
  res.json({ message: `Booking ${status.toLowerCase()}.` });
}));

app.get("/api/wishlist", requireAuth, asyncRoute(async (req, res) => {
  const item = await wishlists.findOne({ userId: req.user.userId });
  res.json(item?.studioIds || []);
}));
app.post("/api/wishlist/:studioId", requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.studioId)) return res.status(400).json({ message: "Invalid studio ID." });
  await wishlists.updateOne({ userId: req.user.userId }, { $addToSet: { studioIds: req.params.studioId } }, { upsert: true });
  res.json({ message: "Saved to wishlist." });
}));
app.delete("/api/wishlist/:studioId", requireAuth, asyncRoute(async (req, res) => {
  await wishlists.updateOne({ userId: req.user.userId }, { $pull: { studioIds: req.params.studioId } });
  res.json({ message: "Removed from wishlist." });
}));

app.post("/api/upload", requireAuth, asyncRoute(async (req, res) => {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) return res.status(503).json({ message: "Image upload is not configured. Add IMGBB_API_KEY on the server." });
  const image = String(req.body.image || "");
  if (!image || image.length > 8_000_000) return res.status(400).json({ message: "Choose an image smaller than 6 MB." });
  const form = new FormData();
  form.append("image", image.replace(/^data:image\/\w+;base64,/, ""));
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok || !data.success) return res.status(502).json({ message: "Image upload failed. Please try again." });
  res.json({ url: data.data.url });
}));

app.get("/health", (_req, res) => res.json({ status: "ok", service: "StudioSpace API" }));
app.get("/", (_req, res) => res.json({ message: "StudioSpace API is running." }));
app.use((error, _req, res, _next) => {
  console.error("API error:", error?.message || error);
  res.status(error.status || 500).json({ message: error.message || "An unexpected server error occurred." });
});

app.listen(PORT, () => console.log(`StudioSpace API listening on port ${PORT}`));
