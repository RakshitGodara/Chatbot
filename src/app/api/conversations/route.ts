import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface PersistedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  citations?: {
    id: number;
    filename: string;
    pageNum: number;
    text: string;
  }[];
}

interface PersistedConversation {
  id: string;
  title: string;
  active: boolean;
  date: string;
  messages: PersistedMessage[];
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("id");

    if (error) {
      return NextResponse.json(
        { error: `Failed to retrieve conversations: ${error.message}` },
        { status: 500 }
      );
    }

    // Map snake_case DB rows back to camelCase frontend shape
    const conversations: PersistedConversation[] = (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      active: row.active,
      date: row.date,
      messages: row.messages ?? [],
    }));

    return NextResponse.json(conversations);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to retrieve conversations: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { conversations } = await req.json();

    if (!conversations || !Array.isArray(conversations)) {
      return NextResponse.json(
        { error: "Invalid payload. Conversations must be a valid array." },
        { status: 400 }
      );
    }

    if (conversations.length === 0) {
      // Delete all conversations when list is empty
      const { error } = await supabase.from("conversations").delete().neq("id", "");
      if (error) {
        return NextResponse.json(
          { error: `Failed to clear conversations: ${error.message}` },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true });
    }

    // Upsert all conversations
    const rows = (conversations as PersistedConversation[]).map((c) => ({
      id: c.id,
      title: c.title,
      active: c.active,
      date: c.date,
      messages: c.messages,
    }));

    const { error: upsertError } = await supabase
      .from("conversations")
      .upsert(rows, { onConflict: "id" });

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to save conversations: ${upsertError.message}` },
        { status: 500 }
      );
    }

    // Delete any conversations that were removed from the list
    const incomingIds = rows.map((r) => r.id);
    const { error: deleteError } = await supabase
      .from("conversations")
      .delete()
      .not("id", "in", `(${incomingIds.map((id) => `"${id}"`).join(",")})`);

    if (deleteError) {
      // Non-critical — log but don't fail
      console.error("Failed to prune old conversations:", deleteError.message);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json(
      { error: `Failed to save conversations: ${errorMessage}` },
      { status: 500 }
    );
  }
}
