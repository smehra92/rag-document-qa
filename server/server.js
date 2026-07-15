// server.js — upload endpoint (we add /ask on Day 12).
import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import crypto from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import { embed } from "./lib/embed.js";
import { getCollection } from "./lib/db.js";
import { recursiveChunks } from "./lib/chunk.js";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const app = express();
app.use(cors());            // allow the React client (different origin) to call us
app.use(express.json());

// Keep the uploaded file in memory as a Buffer (no disk writes).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // 1. Extract text from the PDF buffer (unpdf — zero native deps).
    const pdf = await getDocumentProxy(new Uint8Array(req.file.buffer));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });

    if (!text || !text.trim()) {
      // Scanned/image-only PDFs have no extractable text.
      return res.status(422).json({ error: "No extractable text (is this a scanned PDF?)" });
    }

    // 2. Chunk the text (your Day 9 function).
    const chunks = recursiveChunks(text);

    // 3. Embed each chunk and store, tagged with a docId so we can filter later.
    const docId = crypto.randomUUID();
    const docName = req.file.originalname;
    const col = await getCollection();

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embed(chunks[i]);
      await col.insertOne({ docId, docName, chunkIndex: i, text: chunks[i], embedding });
    }

    res.json({ docId, docName, pages: totalPages, chunks: chunks.length });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});


// app.post("/ask", async (req, res) => {
//   try {
//     const { question, docId } = req.body;
//     if (!question?.trim()) return res.status(400).json({ error: "Missing question" });

//     const col = await getCollection();
//     const queryVector = await embed(question);

//     // Retrieve top chunks. If docId given, restrict search to that document.
//     const vectorStage = {
//       index: "vector_index",
//       path: "embedding",
//       queryVector,
//       numCandidates: 100,
//       limit: 4,
//     };
//     if (docId) vectorStage.filter = { docId: { $eq: docId } };

//     const chunks = await col.aggregate([
//       { $vectorSearch: vectorStage },
//       { $project: { _id: 0, text: 1, chunkIndex: 1, docName: 1, score: { $meta: "vectorSearchScore" } } },
//     ]).toArray();

//     // Build the augmented prompt. Number the chunks so the model can cite them.
//     const context = chunks.map((c, i) => `[${i + 1}]${c.text}`).join("\n\n");
//     const prompt = `Answer the question using ONLY the context below.
// Cite the sources you use with bracket numbers like [1], [2].
// If the answer is not in the context, say "I couldn't find that in the document."

// Context:
// ${context}

// Question:${question}`;

//     const r = await ai.models.generateContent({
//       model: "gemini-2.5-flash",
//       contents: prompt,
//       config: { temperature: 0 },
//     });

//     res.json({ answer: r.text, sources: chunks });
//   } catch (err) {
//     console.error("Ask error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

app.post("/ask", async (req, res) => {
  try {
    const { question, docId } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: "Missing question" });

    const col = await getCollection();
    const queryVector = await embed(question);

    const vectorStage = { index: "vector_index", path: "embedding", queryVector, numCandidates: 100, limit: 4 };
    if (docId) vectorStage.filter = { docId: { $eq: docId } };

    const chunks = await col.aggregate([
      { $vectorSearch: vectorStage },
      { $project: { _id: 0, text: 1, chunkIndex: 1, docName: 1, score: { $meta: "vectorSearchScore" } } },
    ]).toArray();

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // 1) send the sources up front
    res.write(`data:${JSON.stringify({ type: "sources", sources: chunks })}\n\n`);

    // 2) stream the answer
    const context = chunks.map((c, i) => `[${i + 1}]${c.text}`).join("\n\n");
    const prompt = `Answer using ONLY the context. Cite sources like [1], [2]. If not present, say "I couldn't find that in the document."

Context:
${context}

Question:${question}`;

    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash", contents: prompt, config: { temperature: 0 },
    });
    for await (const chunk of stream) {
      if (chunk.text) res.write(`data:${JSON.stringify({ type: "token", text: chunk.text })}\n\n`);
    }

    // 3) done
    res.write(`data:${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Ask error:", err);
    res.write(`data:${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    res.end();
  }
});


const PORT = 3000;
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));