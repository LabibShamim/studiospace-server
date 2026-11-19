const REQUIRED_FIELDS = ["title", "category", "location", "imageUrl", "overview"];
const EDITABLE_FIELDS = ["title", "category", "hourlyRate", "securityDeposit", "maxCapacity", "location", "imageUrl", "images", "amenities", "overview"];

export function buildStudioDocument(body, user, now = new Date()) {
  for (const field of REQUIRED_FIELDS) {
    if (!String(body?.[field] || "").trim()) return { error: `${field} is required.` };
  }
  const document = {
    title: String(body.title).trim(),
    category: String(body.category).trim(),
    hourlyRate: Number(body.hourlyRate),
    securityDeposit: Number(body.securityDeposit || 0),
    maxCapacity: Number(body.maxCapacity || 1),
    location: String(body.location).trim(),
    imageUrl: String(body.imageUrl).trim(),
    images: Array.isArray(body.images) ? body.images.filter((value) => typeof value === "string").slice(0, 8) : [],
    amenities: Array.isArray(body.amenities) ? body.amenities.map(String).slice(0, 30) : [],
    overview: String(body.overview).trim(),
    hostName: user.name,
    hostEmail: user.email,
    ownerId: user.userId,
    ownerEmail: user.email,
    rating: 0,
    reviews: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (!Number.isFinite(document.hourlyRate) || document.hourlyRate <= 0 ||
      !Number.isFinite(document.securityDeposit) || document.securityDeposit < 0 ||
      !Number.isInteger(document.maxCapacity) || document.maxCapacity < 1) {
    return { error: "Enter valid rates, deposit and capacity." };
  }
  return { document };
}

export function normalizeStudioUpdate(body) {
  const update = {};
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) update[field] = body[field];
  }
  for (const field of ["title", "category", "location", "imageUrl", "overview"]) {
    if (update[field] !== undefined) {
      update[field] = String(update[field]).trim();
      if (!update[field]) return { error: `${field} cannot be empty.` };
    }
  }
  if (update.hourlyRate !== undefined) update.hourlyRate = Number(update.hourlyRate);
  if (update.securityDeposit !== undefined) update.securityDeposit = Number(update.securityDeposit);
  if (update.maxCapacity !== undefined) update.maxCapacity = Number(update.maxCapacity);
  if (update.hourlyRate !== undefined && (!Number.isFinite(update.hourlyRate) || update.hourlyRate <= 0)) return { error: "Hourly rate must be greater than zero." };
  if (update.securityDeposit !== undefined && (!Number.isFinite(update.securityDeposit) || update.securityDeposit < 0)) return { error: "Security deposit cannot be negative." };
  if (update.maxCapacity !== undefined && (!Number.isInteger(update.maxCapacity) || update.maxCapacity < 1)) return { error: "Maximum capacity must be a positive whole number." };
  update.updatedAt = new Date();
  return { update };
}
