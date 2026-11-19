import "dotenv/config";
import { MongoClient } from "mongodb";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";

const email = process.env.EXAMINER_EMAIL;
const password = process.env.EXAMINER_PASSWORD;
if (!process.env.MONGODB_URL || !process.env.BETTER_AUTH_SECRET || !email || !password) {
  throw new Error("Set MONGODB_URL, BETTER_AUTH_SECRET, EXAMINER_EMAIL and EXAMINER_PASSWORD first.");
}
const client = new MongoClient(process.env.MONGODB_URL);
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB || "studiospace");
  const auth = betterAuth({
    database: mongodbAdapter(db),
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true, minPasswordLength: 6 },
  });
  const existing = await db.collection("user").findOne({ email });
  if (existing) {
    console.log(`Examiner account already exists: ${email}`);
  } else {
    const result = await auth.api.signUpEmail({
      body: { name: "StudioSpace Examiner", email, password },
    });
    if (result.error) throw new Error(result.error.message || "Could not create examiner account.");
    console.log(`Examiner account created: ${email}`);
  }
} finally {
  await client.close();
}
