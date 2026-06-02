import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Helper: cosine similarity for normalized embeddings
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let score = 0;
  for (let i = 0; i < a.length; i++) {
    score += a[i] * b[i];
  }
  return score;
}

function stripConversationPrefix(filename: string): string {
  const index = filename.indexOf("_");
  if (index !== -1) {
    const prefix = filename.substring(0, index);
    if (prefix === "default" || /^\d+$/.test(prefix)) {
      return filename.substring(index + 1);
    }
  }
  return filename;
}

interface ChunkData {
  index: number;
  text: string;
  embedding: number[];
  pageNum?: number;
  filename?: string;
}

export async function POST(req: Request) {
  try {
    const { messages, filename, filenames, conversationId } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Invalid request payload. Messages must be an array." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "OpenAI API Key is not configured.",
          code: "MISSING_API_KEY",
        },
        { status: 500 }
      );
    }

    let finalPromptMessages = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })
    );

    let citations: {
      id: number;
      filename: string;
      pageNum: number;
      text: string;
    }[] = [];

    const lastUserMessage = messages[messages.length - 1]?.content || "";

    if (lastUserMessage.trim()) {
      // Determine which embedding documents to query
      const targetDocNames: string[] = [];

      if (filenames && Array.isArray(filenames) && filenames.length > 0) {
        // Multiple selected docs passed from frontend
        for (const f of filenames as string[]) {
          const safe = f.replace(/[^a-zA-Z0-9._-]/g, "_");
          targetDocNames.push(safe);
        }
      } else if (filename) {
        const safe = (filename as string).replace(/[^a-zA-Z0-9._-]/g, "_");
        targetDocNames.push(safe);
      } else if (conversationId) {
        // Find all embeddings for this conversation
        const { data: rows } = await supabase
          .from("embeddings")
          .select("document_name")
          .like("document_name", `${conversationId}_%`);
        for (const row of rows ?? []) {
          targetDocNames.push(row.document_name);
        }
      }

      if (targetDocNames.length > 0) {
        // 1. Generate query embedding
        const embResponse = await fetch(
          "https://api.openai.com/v1/embeddings",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "text-embedding-3-small",
              input: lastUserMessage.trim(),
            }),
          }
        );

        if (!embResponse.ok) {
          const errorData = await embResponse.json().catch(() => ({}));
          const errMsg =
            errorData.error?.message ||
            `HTTP error! status: ${embResponse.status}`;
          return NextResponse.json(
            { error: `OpenAI Embeddings API error: ${errMsg}` },
            { status: embResponse.status }
          );
        }

        const embData = await embResponse.json();
        const queryEmbedding = embData.data?.[0]?.embedding as number[];

        if (queryEmbedding) {
          // 2. Load chunks from Supabase for the target documents
          const { data: rows, error: embError } = await supabase
            .from("embeddings")
            .select("chunks, filename, document_name")
            .in("document_name", targetDocNames);

          if (!embError && rows && rows.length > 0) {
            const allChunks: ChunkData[] = [];

            for (const row of rows) {
              const chunks = (row.chunks as ChunkData[]).map((c) => ({
                ...c,
                filename: row.filename || row.document_name,
              }));
              allChunks.push(...chunks);
            }

            if (allChunks.length > 0) {
              // 3. Score and select top 3 chunks
              const scoredChunks = allChunks.map((chunk) => ({
                index: chunk.index,
                text: chunk.text,
                pageNum: chunk.pageNum || 1,
                score: cosineSimilarity(queryEmbedding, chunk.embedding),
                filename: chunk.filename || "unknown",
              }));

              scoredChunks.sort((a, b) => b.score - a.score);
              const topChunks = scoredChunks.slice(0, 3);

              // 4. Build context block
              const contextText = topChunks
                .map(
                  (c, i) =>
                    `[Source ${i + 1}] File: ${stripConversationPrefix(c.filename)} | Page: ${c.pageNum} | Index: ${c.index}\nContent:\n${c.text}`
                )
                .join("\n\n");

              const systemPrompt = `You are a helpful AI assistant. You must answer the user's question using only the retrieved context chunks provided below.

When you use information from a retrieved context chunk, you MUST cite it in the text using inline citation bracket indicators like [1], [2], or [3] corresponding to the [Source 1], [Source 2], or [Source 3] number.
For example: "The company reported a growth of 15% in Q3 [1]." or "According to the annual report, revenues increased [2] and expenses decreased [3]."
Only cite sources that were actually used to answer the question. Do not cite general knowledge or outside sources.

If the user asks a high-level question, summary query, or meta-question about the document (e.g., "what's in the attached doc?" or "summarize this file"), you should synthesize, summarize, and properly structure your response to give a comprehensive overview of the information the context chunks contain, and cite them accordingly.

If the context does not contain the answer or if you are unsure, say: "I am sorry, but the provided document context does not contain the information needed to answer your question." Do not make up or assume any facts outside the context.

Retrieved Context Chunks:
${contextText}`;

              finalPromptMessages = [
                { role: "system", content: systemPrompt },
                ...finalPromptMessages,
              ];

              citations = topChunks.map((c, i) => ({
                id: i + 1,
                filename: stripConversationPrefix(c.filename),
                pageNum: c.pageNum || 1,
                text: c.text,
              }));
            }
          }
        }
      }
    }

    // Call OpenAI Chat Completions
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: finalPromptMessages,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        errorData.error?.message || `HTTP error! status: ${response.status}`;
      return NextResponse.json(
        { error: `OpenAI API error: ${errorMessage}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "";

    return NextResponse.json({
      content: reply,
      citations: citations,
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
