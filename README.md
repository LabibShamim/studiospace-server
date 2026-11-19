# StudioSpace API

Express 5 + MongoDB REST API and Better Auth server for StudioSpace.

## Local setup

1. Run `npm install`.
2. Copy `.env.example` to `.env` and set your MongoDB connection, Better Auth secret, JWT secret, and client origin.
3. Start the API using `npm run dev` (or `npm start` for production).
4. Check `GET /health` to confirm the service is running.
5. Configure the client `NEXT_PUBLIC_API_URL` to this API origin.

## API overview

- `GET /api/studios`, `GET /api/studios/:id`: public studio discovery.
- `POST /api/studios`, `PUT /api/studios/:id`, `DELETE /api/studios/:id`: owner-only listing mutations.
- `POST /api/bookings`, `GET /api/bookings`, booking status and cancellation routes: authenticated reservations.
- `/api/wishlist`: authenticated saved studios.
- `/api/upload`: authenticated ImgBB upload proxy.
- `/api/auth/*`: Better Auth email/password and optional Google OAuth.
- `POST /api/session-cookie`: exchanges a valid Better Auth session for a signed HTTPOnly JWT cookie.

All protected routes require the StudioSpace HTTPOnly JWT cookie. Booking requests are saved as `Pending`; only overlapping `Confirmed` reservations block a requested time range.

## Examiner account

Set `EXAMINER_EMAIL` and `EXAMINER_PASSWORD` in `.env` and run `npm run seed:examiner`. The example values are `examiner@studiospace.test` / `StudioSpace#2026`; change the password before using a public production database.
