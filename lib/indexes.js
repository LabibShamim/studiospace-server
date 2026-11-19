export async function ensureIndexes({ studios, bookings, wishlists }) {
  await Promise.all([
    studios.createIndex({ ownerId: 1, createdAt: -1 }),
    studios.createIndex({ rating: -1, createdAt: -1 }),
    bookings.createIndex({ studioId: 1, date: 1, status: 1, startTime: 1, endTime: 1 }),
    bookings.createIndex({ customerId: 1, createdAt: -1 }),
    bookings.createIndex({ hostEmail: 1, createdAt: -1 }),
    wishlists.createIndex({ userId: 1 }, { unique: true }),
  ]);
}
