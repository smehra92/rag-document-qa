// lib/db.js — one shared MongoDB connection for the whole app.
import "dotenv/config";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);
let connected = false;

// Returns the ragdb.docs collection. Connects once, then reuses the connection
// on every later call (so you're not opening a new connection per request).
export async function getCollection() {
  if (!connected) {
    await client.connect();
    connected = true;
  }
  return client.db("ragdb").collection("docs");
}