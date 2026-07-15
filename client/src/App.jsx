import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function App() {
  const [docId, setDocId] = useState(null);
  const [docName, setDocName] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDocId(data.docId);
      setDocName(`${data.docName} (${data.pages} pages,${data.chunks} chunks)`);
    } catch (err) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleAsk() {
    if (!question.trim() || !docId) return;
    setAsking(true);
    setAnswer("");
    setSources([]);

    const res = await fetch(`${API}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, docId }),
    });

    // Read the SSE stream manually (POST can't use EventSource).
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop();              // keep the incomplete trailing piece
      for (const part of parts) {
  const trimmed = part.trim();               // strip stray \n and spaces
  if (!trimmed.startsWith("data:")) continue; // note: "data:" not "data: "
  const jsonStr = trimmed.slice(trimmed.indexOf(":") + 1).trim(); // everything after "data:"
  let payload;
  try {
    payload = JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse SSE part:", JSON.stringify(part));
    continue;
  }
  if (payload.type === "sources") setSources(payload.sources);
  if (payload.type === "token") setAnswer((p) => p + payload.text);
  if (payload.type === "error") alert("Error: " + payload.message);
}
    }
    setAsking(false);
  }

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Chat with your Documents</h1>

      <section style={{ margin: "20px 0" }}>
        <input type="file" accept="application/pdf" onChange={handleUpload} disabled={uploading} />
        {uploading &&<p>Processing PDF…</p>}
        {docName &&<p>✅ Loaded: {docName}</p>}
      </section>

      {docId && (
        <section>
          <textarea
            rows={2} style={{ width: "100%" }}
            value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask something about the document…"
          />
          <button onClick={handleAsk} disabled={asking}>
            {asking ? "Thinking…" : "Ask"}
          </button>
        </section>
      )}

      {answer && (
        <section style={{ marginTop: 20 }}>
          <h3>Answer</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{answer}</p>
        </section>
      )}

      {sources.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h3>Sources</h3>
          {sources.map((s, i) => (
            <div key={i} style={{ fontSize: 13, color: "#555", marginBottom: 8 }}>
              <strong>[{i + 1}]</strong> (score {s.score.toFixed(2)}) {s.text.slice(0, 160)}…
            </div>
          ))}
        </section>
      )}
    </div>
  );
}