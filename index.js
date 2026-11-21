
import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { signToken, requireAuth } from "./lib/security.js";
import {
  isValidBookingRange,
  confirmedOverlapFilter,
} from "./lib/booking-utils.js";
import { ensureIndexes } from "./lib/indexes.js";
import {
  buildStudioDocument,
  normalizeStudioUpdate,
} from "./lib/studio-validation.js";
import { uploadImageToImgBB } from "./lib/imgbb.js";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins";

const app = express();

const PORT = Number(process.env.PORT || 5000);
const MONGODB_URL = process.env.MONGODB_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = "studiospace_token";
const isProduction = process.env.NODE_ENV === "production";

const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:3000";

const SERVER_URL =
  process.env.BETTER_AUTH_URL || `http://localhost:${PORT}`;

const allowedOrigins = CLIENT_URL.split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

if (!MONGODB_URL) {
  throw new Error("MONGODB_URL is required.");
}

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters.");
}

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET is required.");
}

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error("Google OAuth credentials are missing.");
}

app.use(
  cors({
    origin(origin, callback) {
      const normalizedOrigin = origin?.trim().replace(/\/+$/, "");

      if (
        !origin ||
        allowedOrigins.includes(normalizedOrigin)
      ) {
        return callback(null, true);
      }

      console.error("Blocked CORS Origin:", origin);

      const error = new Error("Origin is not allowed by CORS.");
      error.status = 403;

      return callback(error);
    },
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

const client = new MongoClient(MONGODB_URL);

await client.connect();

const db = client.db(
  process.env.MONGODB_DB || "studiospace"
);

const studios = db.collection("Studios");
const bookings = db.collection("bookings");
const wishlists = db.collection("wishlists");

await ensureIndexes({
  studios,
  bookings,
  wishlists,
});

const auth = betterAuth({
  database: mongodbAdapter(db),

  baseURL: SERVER_URL,

  secret: process.env.BETTER_AUTH_SECRET,

  trustedOrigins: [
    ...allowedOrigins,
    SERVER_URL,
  ],

  advanced: {
    defaultCookieAttributes: {
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
      httpOnly: true,
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },

  plugins: [jwt()],
});

app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json({ limit: "8mb" }));

function validId(id) {
  return (
    ObjectId.isValid(id) &&
    String(new ObjectId(id)) === id
  );
}

function serializeStudio(studio) {
  return {
    ...studio,
    _id: String(studio._id),
  };
}

function asyncRoute(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

app.post(
  "/api/session-cookie",
  asyncRoute(async (req, res) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      return res.status(401).json({
        message: "No active session found.",
      });
    }

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

    res.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      },
    });
  })
);

app.get(
  "/api/session",
  requireAuth,
  (req, res) => {
    res.json({
      user: req.user,
    });
  }
);

app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  });

  res.json({
    message: "Signed out.",
  });
});

app.get(
  ["/api/studios", "/Studios"],
  asyncRoute(async (req, res) => {
    const { category, search, featured } = req.query;

    const filter = {};

    if (category && category !== "All") {
      const safeCategory = String(category).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      filter.category = {
        $regex: `^${safeCategory}$`,
        $options: "i",
      };
    }

    if (search) {
      const safeSearch = String(search).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      filter.$or = [
        {
          title: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          location: {
            $regex: safeSearch,
            $options: "i",
          },
        },
      ];
    }

    let cursor = studios
      .find(filter)
      .sort({
        rating: -1,
        createdAt: -1,
      });

    if (featured === "true") {
      cursor = cursor.limit(6);
    }

    const result = await cursor.toArray();

    res.json(result.map(serializeStudio));
  })
);

app.get(
  "/api/my/studios",
  requireAuth,
  asyncRoute(async (req, res) => {
    const result = await studios
      .find({
        $or: [
          { ownerId: req.user.userId },
          { hostEmail: req.user.email },
          { ownerEmail: req.user.email },
        ],
      })
      .sort({
        createdAt: -1,
      })
      .toArray();

    res.json(result.map(serializeStudio));
  })
);

app.get(
  "/api/studios/:id",
  asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid studio ID.",
      });
    }

    const studio = await studios.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!studio) {
      return res.status(404).json({
        message: "Studio not found.",
      });
    }

    res.json(serializeStudio(studio));
  })
);

app.post(
  ["/api/studios", "/add-studio"],
  requireAuth,
  asyncRoute(async (req, res) => {
    const { document, error } = buildStudioDocument(
      req.body || {},
      req.user
    );

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const result = await studios.insertOne(document);

    res.status(201).json({
      message: "Studio published successfully.",
      studio: serializeStudio({
        ...document,
        _id: result.insertedId,
      }),
    });
  })
);

app.put(
  "/api/studios/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid studio ID.",
      });
    }

    const { update, error } = normalizeStudioUpdate(req.body || {});

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const result = await studios.updateOne(
      {
        _id: new ObjectId(req.params.id),
        $or: [
          { ownerId: req.user.userId },
          { hostEmail: req.user.email },
          { ownerEmail: req.user.email },
        ],
      },
      {
        $set: update,
      }
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: "Studio not found or you do not own it.",
      });
    }

    res.json({
      message: "Studio updated successfully.",
    });
  })
);

app.delete(
  "/api/studios/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid studio ID.",
      });
    }

    const result = await studios.deleteOne({
      _id: new ObjectId(req.params.id),
      $or: [
        { ownerId: req.user.userId },
        { hostEmail: req.user.email },
        { ownerEmail: req.user.email },
      ],
    });

    if (!result.deletedCount) {
      return res.status(404).json({
        message: "Studio not found or you do not own it.",
      });
    }

    res.json({
      message: "Studio deleted successfully.",
    });
  })
);

app.post(
  "/api/bookings",
  requireAuth,
  asyncRoute(async (req, res) => {
    const {
      studioId,
      date,
      startTime,
      endTime,
    } = req.body || {};

    if (
      !validId(studioId) ||
      !isValidBookingRange(date, startTime, endTime)
    ) {
      return res.status(400).json({
        message: "Choose a valid studio, date and time range.",
      });
    }

    const studio = await studios.findOne({
      _id: new ObjectId(studioId),
    });

    if (!studio) {
      return res.status(404).json({
        message: "Studio not found.",
      });
    }

    if (studio.ownerId === req.user.userId) {
      return res.status(400).json({
        message: "You cannot book your own studio.",
      });
    }

    const collision = await bookings.findOne(
      confirmedOverlapFilter({
        studioId,
        date,
        startTime,
        endTime,
      })
    );

    if (collision) {
      return res.status(409).json({
        message:
          "This time slot has already been confirmed. Please choose another time.",
      });
    }

    const hours =
      (new Date(`${date}T${endTime}:00`) -
        new Date(`${date}T${startTime}:00`)) /
      3600000;

    const booking = {
      studioId,
      studioTitle: studio.title,
      studioImage: studio.imageUrl,
      hostEmail: studio.hostEmail,
      hostName: studio.hostName,
      customerId: req.user.userId,
      customerEmail: req.user.email,
      customerName: req.user.name,
      date,
      startTime,
      endTime,
      hours,
      hourlyRate: Number(studio.hourlyRate || 0),
      securityDeposit: Number(studio.securityDeposit || 0),
      total:
        hours * Number(studio.hourlyRate || 0) +
        Number(studio.securityDeposit || 0),
      status: "Pending",
      createdAt: new Date(),
    };

    const result = await bookings.insertOne(booking);

    res.status(201).json({
      message: "Booking request sent to the host.",
      booking: {
        ...booking,
        _id: String(result.insertedId),
      },
    });
  })
);

app.get(
  "/api/bookings",
  requireAuth,
  asyncRoute(async (req, res) => {
    const result = await bookings
      .find({
        $or: [
          { customerId: req.user.userId },
          { hostEmail: req.user.email },
        ],
      })
      .sort({
        createdAt: -1,
      })
      .toArray();

    res.json(
      result.map((item) => ({
        ...item,
        _id: String(item._id),
      }))
    );
  })
);

app.patch(
  "/api/bookings/:id/cancel",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid booking ID.",
      });
    }

    const result = await bookings.updateOne(
      {
        _id: new ObjectId(req.params.id),
        customerId: req.user.userId,
        status: "Pending",
      },
      {
        $set: {
          status: "Cancelled",
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      return res.status(409).json({
        message: "Only your pending bookings can be cancelled.",
      });
    }

    res.json({
      message: "Booking cancelled.",
    });
  })
);

app.patch(
  "/api/bookings/:id/status",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid booking ID.",
      });
    }

    const status = req.body.status;

    if (
      !["Confirmed", "Completed", "Cancelled"].includes(status)
    ) {
      return res.status(400).json({
        message: "Invalid booking status.",
      });
    }

    const currentStatus =
      status === "Completed" ? "Confirmed" : "Pending";

    const booking = await bookings.findOne({
      _id: new ObjectId(req.params.id),
      hostEmail: req.user.email,
      status: currentStatus,
    });

    if (!booking) {
      return res.status(404).json({
        message: `A ${currentStatus.toLowerCase()} booking was not found for this host.`,
      });
    }

    if (status === "Confirmed") {
      const collision = await bookings.findOne(
        confirmedOverlapFilter({
          studioId: booking.studioId,
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
          excludeId: booking._id,
        })
      );

      if (collision) {
        return res.status(409).json({
          message: "This slot overlaps another confirmed booking.",
        });
      }
    }

    const result = await bookings.updateOne(
      {
        _id: booking._id,
        status: currentStatus,
      },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: "Pending booking not found for this host.",
      });
    }

    res.json({
      message: `Booking ${status.toLowerCase()}.`,
    });
  })
);

app.get(
  "/api/wishlist",
  requireAuth,
  asyncRoute(async (req, res) => {
    const item = await wishlists.findOne({
      userId: req.user.userId,
    });

    res.json(item?.studioIds || []);
  })
);

app.post(
  "/api/wishlist/:studioId",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!validId(req.params.studioId)) {
      return res.status(400).json({
        message: "Invalid studio ID.",
      });
    }

    await wishlists.updateOne(
      {
        userId: req.user.userId,
      },
      {
        $addToSet: {
          studioIds: req.params.studioId,
        },
      },
      {
        upsert: true,
      }
    );

    res.json({
      message: "Saved to wishlist.",
    });
  })
);

app.delete(
  "/api/wishlist/:studioId",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!validId(req.params.studioId)) {
      return res.status(400).json({
        message: "Invalid studio ID.",
      });
    }

    await wishlists.updateOne(
      {
        userId: req.user.userId,
      },
      {
        $pull: {
          studioIds: req.params.studioId,
        },
      }
    );

    res.json({
      message: "Removed from wishlist.",
    });
  })
);

app.post(
  "/api/upload",
  requireAuth,
  asyncRoute(async (req, res) => {
    const url = await uploadImageToImgBB(
      req.body?.image,
      process.env.IMGBB_API_KEY
    );

    res.json({
      url,
    });
  })
);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "StudioSpace API",
  });
});

app.get("/", (_req, res) => {
  res.json({
    message: "StudioSpace API is running.",
  });
});

app.use((error, _req, res, _next) => {
  console.error(
    "API error:",
    error?.stack || error?.message || error
  );

  res.status(error.status || 500).json({
    message:
      error.message || "An unexpected server error occurred.",
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`StudioSpace API listening on port ${PORT}`);
  });
}

export default app;
