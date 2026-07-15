// lib/chunk.js — split long document text into chunks before embedding.

// Fixed-size chunks with overlap. Simple; overlap keeps a fact from being
// cut in half at a chunk boundary. (Not used by Week 3, but handy to have.)
export function fixedSizeChunks(text, chunkSize = 400, overlap = 80) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = start + chunkSize;
    chunks.push(text.slice(start, end).trim());
    start = end - overlap; // step back by `overlap` before the next chunk
  }
  return chunks.filter(Boolean);
}

// Recursive / structure-aware chunking. Splits on paragraphs first (natural
// boundaries), then falls back to grouping sentences if a paragraph is too long.
// THIS is the one Week 3's server.js uses.
export function recursiveChunks(text, maxLen = 400) {
  const paragraphs = text.split(/\n\s*\n/); // blank line = paragraph break
  const chunks = [];

  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;

    if (p.length <= maxLen) {
      chunks.push(p);
    } else {
      // paragraph too big → break into sentences, regroup up to maxLen
      const sentences = p.match(/[^.!?]+[.!?]+/g) || [p];
      let current = "";
      for (const s of sentences) {
        if ((current + s).length > maxLen) {
          if (current) chunks.push(current.trim());
          current = s;
        } else {
          current += s;
        }
      }
      if (current) chunks.push(current.trim());
    }
  }
  return chunks;
}