/* eslint-disable react-hooks/purity */
"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  citations?: {
    id: number;
    filename: string;
    pageNum: number;
    text: string;
  }[];
}

interface Conversation {
  id: string;
  title: string;
  active: boolean;
  date: string;
  messages: Message[];
  mode?: "ai-only" | "rag";
}

export default function Home() {
  // State variables
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Document management states
  interface DocumentInfo {
    name: string;
    displayName: string;
    size: number;
    uploadedAt: string;
    indexed: boolean;
  }
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [indexingDoc, setIndexingDoc] = useState<string | null>(null);
  const mode = "rag";
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [activeRagDocs, setActiveRagDocs] = useState<string[]>([]);
  const [activeCitationId, setActiveCitationId] = useState<string | null>(null);

  // Text extraction states
  const [activeDocForText, setActiveDocForText] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [extractedPages, setExtractedPages] = useState<number>(0);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseResponseError = async (res: Response, fallbackMsg: string): Promise<string> => {
    try {
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const data = await res.json();
        return data.error || fallbackMsg;
      }
      const text = await res.text();
      return `Server error (${res.status}): ${text.substring(0, 150)}...`;
    } catch {
      return fallbackMsg;
    }
  };

  // Derived states
  const activeConversation = conversations.find((c) => c.active);
  const messages = useMemo(() => {
    return activeConversation ? activeConversation.messages : [];
  }, [activeConversation]);

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // Persistent storage synchronizer helper
  const saveConversationsToServer = async (list: Conversation[]) => {
    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ conversations: list }),
      });
    } catch (err) {
      console.error("Failed to sync persistence with local filesystem:", err);
    }
  };

  // Retrieve document catalog helper
  const fetchDocuments = async (conversationId?: string) => {
    const targetId = conversationId || activeConversation?.id;
    if (!targetId) {
      setDocuments([]);
      return;
    }
    try {
      const res = await fetch(`/api/documents?conversationId=${encodeURIComponent(targetId)}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error("Failed to fetch documents catalog:", err);
    }
  };

  // Rehydrate state and catalog on mount
  useEffect(() => {
    const initializePage = async () => {
      let activeId = "default";
      // Fetch conversations
      try {
        const res = await fetch("/api/conversations");
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data) && data.length > 0) {
            interface SerializedMessage {
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
            interface SerializedConversation {
              id: string;
              title: string;
              active: boolean;
              date: string;
              messages: SerializedMessage[];
            }
            const hydrated = (data as SerializedConversation[]).map((c) => ({
              ...c,
              messages: c.messages.map((m) => ({
                ...m,
                timestamp: new Date(m.timestamp),
                citations: m.citations || [],
              })),
            })) as Conversation[];
            setConversations(hydrated);
            const active = hydrated.find((c) => c.active);
            if (active) {
              activeId = active.id;
            }
          } else {
            // Default initial conversation
            const defaultConv: Conversation = {
              id: "default",
              title: "New Conversation",
              active: true,
              date: "Just now",
              messages: [],
            };
            setConversations([defaultConv]);
            await saveConversationsToServer([defaultConv]);
          }
        }
      } catch (err) {
        console.error("Failed to fetch persisted conversations:", err);
      } finally {
        setIsLoading(false);
      }

      // Fetch documents catalog for active chat
      await fetchDocuments(activeId);
    };

    initializePage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle PDF file upload operations
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConversation) return;

    setIsUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("conversationId", activeConversation.id);

    let uploadedFilename: string | null = null;

    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errMsg = await parseResponseError(res, "Failed to upload the file.");
        throw new Error(errMsg);
      }

      const data = await res.json();
      uploadedFilename = data.name;

      await fetchDocuments(activeConversation.id);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred during file upload.";
      setUploadError(msg);
    } finally {
      setIsUploading(false);
    }

    if (uploadedFilename) {
      setActiveRagDocs((prev) => [...prev, uploadedFilename as string]);
      await handleIndexDocument(uploadedFilename);
    }
  };

  // Handle PDF text extraction operations
  const handleViewText = async (filename: string) => {
    setActiveDocForText(filename);
    setIsExtracting(true);
    setExtractionError(null);
    setExtractedText(null);
    setExtractedPages(0);
    setIsCopied(false);

    try {
      const res = await fetch(`/api/documents/extract?name=${encodeURIComponent(filename)}`);
      if (!res.ok) {
        const errMsg = await parseResponseError(res, "Failed to extract text from document.");
        throw new Error(errMsg);
      }

      const data = await res.json();
      setExtractedText(data.text || "No readable text content found in this document.");
      setExtractedPages(data.numPages || 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred during extraction.";
      setExtractionError(msg);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleCopyText = async () => {
    if (!extractedText) return;
    try {
      await navigator.clipboard.writeText(extractedText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  // Handle PDF vector indexing operations
  const handleIndexDocument = async (filename: string) => {
    setIndexingDoc(filename);
    setUploadError(null);

    try {
      const res = await fetch("/api/documents/index", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: filename }),
      });

      if (!res.ok) {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const errorData = await res.json().catch(() => ({}));
          if (errorData.code === "MISSING_API_KEY") {
            throw new Error("OpenAI API Key is missing. Please configure `OPENAI_API_KEY` in your Vercel Project Settings.");
          }
          throw new Error(errorData.error || "Failed to index the document.");
        }
        const text = await res.text().catch(() => "");
        throw new Error(`Server error (${res.status}): ${text.substring(0, 150)}...`);
      }

      await fetchDocuments(activeConversation?.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred during indexing.";
      setUploadError(msg);
      // Remove from active RAG documents if indexing failed
      setActiveRagDocs((prev) => prev.filter((name) => name !== filename));
    } finally {
      setIndexingDoc(null);
    }
  };

  // Handle PDF deletion operations
  const handleDeleteDocument = async (filename: string) => {
    if (!activeConversation) return;
    setUploadError(null);

    try {
      const res = await fetch("/api/documents", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: filename }),
      });

      if (!res.ok) {
        const errMsg = await parseResponseError(res, "Failed to delete the document.");
        throw new Error(errMsg);
      }

      // Clear active RAG document if it was the one deleted
      setActiveRagDocs((prev) => prev.filter(name => name !== filename));

      await fetchDocuments(activeConversation.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred during document deletion.";
      setUploadError(msg);
    }
  };

  // Pre-configured suggestions to trigger message sending
  const suggestions = [
    { label: "Document Summarization", text: "Can you summarize the main contents of my uploaded document?" },
    { label: "Extract Key Findings", text: "Extract the main findings or important metrics from the file." },
    { label: "Specific Search", text: "Find exact details or tables related to my query inside the document." }
  ];

  const RAGsuggestions = [
    { label: "Document Summarization", text: "Can you summarize the main contents of my uploaded document?" },
    { label: "Extract Key Findings", text: "Extract the main findings or important metrics from the file." },
    { label: "Specific Search", text: "Find exact details or tables related to my query inside the document." }
  ];

  // Send a message
  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || isTyping || !activeConversation) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: textToSend.trim(),
      timestamp: new Date(),
    };

    const updatedMessages = [...activeConversation.messages, userMessage];

    // Auto-update conversation title if it is the first user query
    const newTitle = activeConversation.messages.length === 0
      ? (textToSend.length > 25 ? textToSend.substring(0, 22) + "..." : textToSend)
      : activeConversation.title;

    let updatedConversations: Conversation[] = [];

    setConversations((prev) => {
      updatedConversations = prev.map((c) => {
        if (c.active) {
          return {
            ...c,
            title: newTitle,
            messages: updatedMessages,
          };
        }
        return c;
      });
      saveConversationsToServer(updatedConversations);
      return updatedConversations;
    });

    setInput("");
    setIsTyping(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          mode: mode,
          filenames: activeRagDocs.length > 0 ? activeRagDocs : undefined,
          conversationId: activeConversation?.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.code === "MISSING_API_KEY") {
          throw new Error("OpenAI API Key is missing. Please configure `OPENAI_API_KEY` in your `.env.local` file and restart the development server.");
        }
        throw new Error(errorData.error || `Failed to fetch response from assistant (status: ${response.status}).`);
      }

      const data = await response.json();
      const reply = data.content || "";
      const citations = data.citations || [];

      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: reply,
        citations: citations,
        timestamp: new Date(),
      };

      setConversations((prev) => {
        const nextList = prev.map((c) => {
          if (c.active) {
            return {
              ...c,
              messages: [...c.messages, assistantMessage],
            };
          }
          return c;
        });
        saveConversationsToServer(nextList);
        return nextList;
      });
    } catch (err: unknown) {
      const errorMessageString = err instanceof Error ? err.message : "An unexpected error occurred while communicating with OpenAI.";
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: `⚠️ **Connection Failure / Configuration Issue**\n\n${errorMessageString}\n\n*If you are running this sandbox locally, create a file named \`.env.local\` in the project root containing:*\n\`\`\`env\nOPENAI_API_KEY=your-actual-api-key\n\`\`\`\n*After adding the key, make sure to restart your \`npm run dev\` server.*`,
        timestamp: new Date(),
      };

      setConversations((prev) => {
        const nextList = prev.map((c) => {
          if (c.active) {
            return {
              ...c,
              messages: [...c.messages, errorMessage],
            };
          }
          return c;
        });
        saveConversationsToServer(nextList);
        return nextList;
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(input);
    }
  };

  // Reset or clear conversation
  const handleNewChat = () => {
    const newId = Date.now().toString();
    const newConv: Conversation = {
      id: newId,
      title: `Conversation ${conversations.length + 1}`,
      active: true,
      date: "Just now",
      messages: [],
      mode: "rag",
    };

    setConversations((prev) => {
      const nextList = [
        newConv,
        ...prev.map((c) => ({ ...c, active: false })),
      ];
      saveConversationsToServer(nextList);
      return nextList;
    });

    setInput("");
    setIsTyping(false);
    setActiveRagDocs([]);
    fetchDocuments(newId);
  };

  const selectConversation = (id: string) => {
    setConversations((prev) => {
      const nextList = prev.map((c) => {
        if (c.id === id) {
          return { ...c, active: true };
        }
        return { ...c, active: false };
      });
      saveConversationsToServer(nextList);
      return nextList;
    });
    setActiveRagDocs([]);
    fetchDocuments(id);
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat session?")) return;

    try {
      // 1. Fetch documents that belong to this conversation
      const docsRes = await fetch(`/api/documents?conversationId=${encodeURIComponent(id)}`);
      if (docsRes.ok) {
        const docs = await docsRes.json();
        // 2. Delete each document
        for (const doc of docs) {
          await fetch("/api/documents", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: doc.name }),
          });
        }
      }
    } catch (err) {
      console.error("Failed to delete conversation documents:", err);
    }

    // 3. Delete conversation from the list
    setConversations((prev) => {
      const nextList = prev.filter((c) => c.id !== id);

      const wasActive = prev.find((c) => c.id === id)?.active;
      if (wasActive && nextList.length > 0) {
        // Shift active to first available chat
        nextList[0].active = true;
        setTimeout(() => {
          selectConversation(nextList[0].id);
        }, 0);
      } else if (wasActive) {
        // No conversations left, create a fresh new one
        setTimeout(() => {
          handleNewChat();
        }, 0);
      } else {
        // If not deleting the active one, refresh active documents just in case
        setTimeout(() => {
          if (activeConversation) {
            fetchDocuments(activeConversation.id);
          }
        }, 0);
      }

      saveConversationsToServer(nextList);
      return nextList;
    });
  };

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-50 overflow-hidden font-sans">
      {/* Sidebar - Left Column */}
      <aside className="w-80 border-r border-zinc-800 bg-zinc-900/50 backdrop-blur-md flex flex-col justify-between shrink-0 hidden md:flex">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
              </svg>
            </div>
            <div>
              <h1 className="font-semibold text-zinc-200 tracking-wide text-sm">AI Document Chat</h1>
            </div>
          </div>
          <button
            onClick={handleNewChat}
            id="new-chat-btn"
            className="w-full mt-5 py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-750 text-zinc-300 font-medium text-xs transition-all duration-200 flex items-center justify-center gap-2 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Session
          </button>
          {/* Rename chat functionality */}
          {editingConversationId && (
            <div className="p-2">
              <input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => {
                  // Save title
                  setConversations((prev) => {
                    const updated = prev.map((c) => c.id === editingConversationId ? { ...c, title: editingTitle } : c);
                    saveConversationsToServer(updated);
                    return updated;
                  });
                  setEditingConversationId(null);
                }}
                className="w-full p-2 bg-zinc-800 text-zinc-200 rounded"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Navigation & List */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
          <div className="space-y-1">
            <span className="px-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-2">Active Sessions</span>
            {conversations.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => selectConversation(c.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectConversation(c.id); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 text-left group cursor-pointer ${c.active
                    ? "bg-zinc-850 text-white border border-zinc-800"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                  }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <svg className={`h-4.5 w-4.5 shrink-0 ${c.active ? "text-violet-400" : "text-zinc-500"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                  </svg>
                  <span className="text-xs truncate font-medium">{c.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-[9px] text-zinc-500 select-none">{c.date}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingConversationId(c.id); setEditingTitle(c.title); }}
                    title="Rename Chat"
                    className="h-5 w-5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 flex items-center justify-center transition-all duration-150 border border-transparent cursor-pointer"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                  </button>
                  {/* Delete chat button always visible */}
                  <button
                    onClick={(e) => handleDeleteConversation(c.id, e)}
                    title="Delete Chat"
                    className="h-5 w-5 rounded bg-zinc-800/80 hover:bg-red-950/30 text-zinc-500 hover:text-red-400 flex items-center justify-center transition-all duration-150 border border-transparent hover:border-red-900/30 cursor-pointer"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer info */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/30 text-center">
          <p className="text-[10px] text-zinc-500 font-medium">AI Document Chat</p>
        </div>
      </aside>

      {/* Main Chat Area - Right Column */}
      <main className="flex-1 flex flex-row bg-zinc-950 overflow-hidden relative">
        {/* Chat Column */}
        <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
          {/* Glow Effects */}
          <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-violet-600/10 blur-[120px] pointer-events-none"></div>
          <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-600/10 blur-[120px] pointer-events-none"></div>

          {/* Header */}
          <header className="h-16 border-b border-zinc-900 bg-zinc-950/60 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-10">
            <div className="flex items-center gap-3">
              {/* Mobile Sidebar Trigger - Menu Icon */}
              <div className="h-8 w-8 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800 md:hidden">
                <svg className="h-4.5 w-4.5 text-zinc-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-zinc-200 text-sm tracking-wide">Workspace Channel</h2>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span className="text-[9px] font-semibold text-emerald-400 uppercase tracking-wider">OpenAI + JSON</span>
                  </div>
                </div>
                <p className="text-[10px] text-zinc-500 hidden sm:block">Conversations are stored securely inside your local workspace</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
            </div>
          </header>

          {uploadError && (
            <div className="bg-red-950/40 border-b border-red-900/50 px-6 py-2.5 flex items-center justify-between gap-4 animate-fade-in z-10">
              <div className="flex items-center gap-2 text-red-400 text-xs">
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                </svg>
                <span>{uploadError}</span>
              </div>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 font-medium uppercase tracking-wider cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}


          {/* Message Log Box */}
          <section className="flex-1 overflow-y-auto px-6 py-6 space-y-6 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            {isLoading ? (
              /* Loading Skeleton */
              <div className="h-full flex flex-col justify-center items-center gap-4 max-w-md mx-auto text-center py-12">
                <svg className="h-10 w-10 text-violet-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <div>
                  <p className="text-sm font-semibold text-zinc-300">Retrieving local conversation history...</p>
                  <p className="text-xs text-zinc-500 mt-1">Reading database records from storage/conversations.json</p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              /* Onboarding Panel */
              <div className="h-full flex items-center justify-center max-w-xl mx-auto py-12">
                <div className="p-8 rounded-2xl border border-zinc-900 bg-zinc-900/20 backdrop-blur-sm space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/10 shrink-0">
                      <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-zinc-100 tracking-wide">
                        AI Document Chat
                      </h3>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Ask questions, find details, and summarize your uploaded PDF documents.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Key Features</h4>
                    <div className="grid grid-cols-1 gap-2.5 text-xs text-zinc-350">
                      <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-900 flex items-start gap-3">
                        <span className="text-violet-400 font-bold">1</span>
                        <div>
                          <p className="font-semibold text-zinc-200">Semantic Chat (RAG)</p>
                          <p className="text-[11px] text-zinc-500">Retrieves exact context from your documents to ground AI responses.</p>
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-900 flex items-start gap-3">
                        <span className="text-violet-400 font-bold">2</span>
                        <div>
                          <p className="font-semibold text-zinc-200">Inline Citations</p>
                          <p className="text-[11px] text-zinc-500">Every response links directly back to specific page numbers and sources.</p>
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-900 flex items-start gap-3">
                        <span className="text-violet-400 font-bold">3</span>
                        <div>
                          <p className="font-semibold text-zinc-200">Instant Text Viewer</p>
                          <p className="text-[11px] text-zinc-500">View parsed text contents of your uploaded PDFs directly in the application.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Suggested Prompts</h4>
                    <div className="grid grid-cols-1 gap-2.5">
                      {(documents.length > 0 ? RAGsuggestions : suggestions).map((s, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSendMessage(s.text)}
                          className="w-full text-left p-3.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-850 border border-zinc-850 hover:border-zinc-750 transition-all duration-200 group flex items-start justify-between gap-3"
                        >
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-zinc-300 group-hover:text-zinc-100">{s.label}</p>
                            <p className="text-[11px] text-zinc-500 group-hover:text-zinc-450 line-clamp-1">{s.text}</p>
                          </div>
                          <svg className="h-4 w-4 text-zinc-650 group-hover:text-violet-400 transition-colors mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Active Message List */
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((m) => (
                  <div key={m.id} className={`flex items-start gap-4 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                    {/* Avatar */}
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 shadow-md ${m.role === "user"
                        ? "bg-violet-600 shadow-violet-500/10 text-white"
                        : "bg-zinc-800 shadow-zinc-950/40 text-zinc-300"
                      }`}>
                      {m.role === "user" ? (
                        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                        </svg>
                      ) : (
                        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 21l8.982-8.982M18 13.653V7.622c0-2.24-2.242-4.043-4.316-3.416L3.935 7.071c-1.547.47-1.545 2.655.004 3.122l4.89 1.474" />
                        </svg>
                      )}
                    </div>

                    {/* Message Bubble Container */}
                    <div className={`flex flex-col gap-1 max-w-[75%] ${m.role === "user" ? "items-end" : "items-start"}`}>
                      <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user"
                          ? "bg-gradient-to-tr from-violet-600 to-indigo-600 text-white rounded-tr-none font-medium shadow-md shadow-violet-500/5"
                          : "bg-zinc-900 border border-zinc-850 text-zinc-150 rounded-tl-none"
                        }`}>
                        {m.content}
                      </div>
                      {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                        <div className="mt-2.5 w-full space-y-2 select-none">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 px-1">
                            <svg className="h-3.5 w-3.5 text-violet-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                            </svg>
                            <span>Retrieved Sources</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 px-1">
                            {m.citations.map((citation) => {
                              const isExpanded = activeCitationId === `${m.id}-${citation.id}`;
                              return (
                                <button
                                  key={citation.id}
                                  onClick={() => {
                                    setActiveCitationId((prev) =>
                                      prev === `${m.id}-${citation.id}` ? null : `${m.id}-${citation.id}`
                                    );
                                  }}
                                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all duration-200 cursor-pointer ${isExpanded
                                      ? "bg-violet-950/30 border-violet-500/50 text-violet-300 shadow-md shadow-violet-500/5"
                                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 hover:bg-zinc-850"
                                    }`}
                                >
                                  <span className="font-bold text-[9px] bg-zinc-950/40 text-violet-400 px-1 py-0.5 rounded border border-zinc-850 min-w-[16px] text-center">
                                    {citation.id}
                                  </span>
                                  <span className="truncate max-w-[110px]" title={citation.filename}>
                                    {citation.filename}
                                  </span>
                                  <span className="text-[9px] text-zinc-500 font-bold px-1.5 py-0.5 rounded bg-zinc-950/40 border border-zinc-850/60">
                                    p. {citation.pageNum}
                                  </span>
                                  <svg
                                    className={`h-2.5 w-2.5 text-zinc-550 transition-transform duration-200 ${isExpanded ? "rotate-180 text-violet-400" : ""}`}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                                  </svg>
                                </button>
                              );
                            })}
                          </div>
                          {/* Citation Content Snippet Drawer */}
                          {m.citations.map((citation) => {
                            const isExpanded = activeCitationId === `${m.id}-${citation.id}`;
                            if (!isExpanded) return null;
                            return (
                              <div
                                key={`snippet-${citation.id}`}
                                className="p-3.5 rounded-xl bg-zinc-900 border border-violet-950/20 text-[11px] text-zinc-300 animate-fadeIn space-y-1.5 leading-relaxed shadow-lg shadow-black/20"
                              >
                                <div className="flex items-center justify-between text-[9px] text-zinc-550 font-bold uppercase tracking-wider border-b border-zinc-850 pb-1.5">
                                  <span>Snippet Source {citation.id}</span>
                                  <span>{citation.filename} • Page {citation.pageNum}</span>
                                </div>
                                <p className="whitespace-pre-wrap leading-relaxed select-text font-serif italic text-zinc-400 pt-0.5">
                                  &quot;{citation.text.trim()}&quot;
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <span className="text-[9px] text-zinc-650 px-1 font-medium select-none">
                        {m.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Typing Animation */}
                {isTyping && (
                  <div className="flex items-start gap-4">
                    <div className="h-8 w-8 rounded-lg bg-zinc-800 shadow-zinc-950/40 text-zinc-300 flex items-center justify-center shrink-0">
                      <svg className="h-4.5 w-4.5 animate-spin text-violet-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                    </div>
                    <div className="px-5 py-3.5 rounded-2xl rounded-tl-none bg-zinc-900 border border-zinc-850 flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-zinc-600 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                      <span className="h-2 w-2 rounded-full bg-zinc-600 animate-bounce" style={{ animationDelay: "150ms" }}></span>
                      <span className="h-2 w-2 rounded-full bg-zinc-600 animate-bounce" style={{ animationDelay: "300ms" }}></span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </section>

          {/* Input box bottom panel */}
          <footer className="p-6 border-t border-zinc-900 bg-zinc-950/80 backdrop-blur-md shrink-0 z-10">
            <div className="max-w-3xl mx-auto">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage(input);
                }}
                className="relative rounded-2xl border border-zinc-800 bg-zinc-900/60 focus-within:border-zinc-700/80 focus-within:ring-2 focus-within:ring-violet-600/10 transition-all duration-300"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your question here (Press Enter to send)..."
                  rows={2}
                  id="message-input"
                  className="w-full pl-5 pr-14 py-4 bg-transparent text-sm text-zinc-150 placeholder-zinc-550 border-none outline-none resize-none focus:ring-0 focus:outline-none min-h-[56px] scrollbar-none"
                />
                {/* Upload PDF Button */}
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload PDF"
                  className={`absolute right-16 bottom-3.5 h-8 w-8 rounded-xl flex items-center justify-center bg-zinc-800 hover:bg-violet-900/40 text-zinc-300 hover:text-violet-400 transition-all duration-200 border border-zinc-750 hover:border-violet-500/30 ${
                    isUploading ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {isUploading ? (
                    <svg className="animate-spin h-4 w-4 text-violet-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <span className="text-xl font-bold text-white">+</span>
                  )}
                </button>

                <div className="absolute right-3.5 bottom-3.5 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={!input.trim() || isTyping}
                    id="send-button"
                    className={`h-8 w-8 rounded-xl flex items-center justify-center transition-all duration-200 shrink-0 ${input.trim() && !isTyping
                        ? "bg-violet-600 hover:bg-violet-500 shadow-md shadow-violet-500/20 text-white cursor-pointer"
                        : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-750"
                      }`}
                  >
                    <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                    </svg>
                  </button>
                </div>
              </form>

              <div className="mt-3">
              </div>
            </div>
          </footer>
        </div>{/* end chat column */}

        {/* Context Controller - Right Sidebar Panel, shown only when PDFs exist */}
        {documents.length > 0 && (
          <aside className="w-64 shrink-0 border-l border-zinc-800 bg-zinc-900/50 backdrop-blur-md flex flex-col overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            <div className="p-3 border-b border-zinc-800">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Context Controller</span>
            </div>
            <div className="p-3 space-y-1.5">
              <span className="px-1 text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">Uploaded PDFs ({documents.length})</span>
              {documents.map((doc, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    if (doc.indexed) {
                      setActiveRagDocs((prev) => {
                        if (prev.includes(doc.name)) {
                          return prev.filter((name) => name !== doc.name);
                        } else {
                          return [...prev, doc.name];
                        }
                      });
                    }
                  }}
                  className={`flex flex-col p-2.5 rounded-xl border text-[11px] transition-all duration-200 ${doc.indexed ? "cursor-pointer" : ""} ${activeRagDocs.includes(doc.name) ? "bg-violet-950/20 border-violet-700/50 text-zinc-100 shadow-md shadow-violet-500/5" : "bg-zinc-900/40 border-zinc-800 hover:border-zinc-700 text-zinc-300"}`}
                >
                  <div className="flex items-center justify-between min-w-0 gap-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <svg className="h-4 w-4 text-violet-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      <span className="truncate font-medium text-xs text-zinc-300" title={doc.displayName}>{doc.displayName}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleViewText(doc.name); }}
                        title="View Extracted Text"
                        className="h-5 w-5 rounded bg-zinc-800 hover:bg-violet-900/40 text-zinc-400 hover:text-violet-400 flex items-center justify-center transition-all duration-150 cursor-pointer border border-zinc-750"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteDocument(doc.name); }}
                        title="Delete Document"
                        className="h-5 w-5 rounded bg-zinc-800 hover:bg-red-900/40 text-zinc-400 hover:text-red-400 flex items-center justify-center transition-all duration-150 cursor-pointer border border-zinc-750"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* Status row */}
                  <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-zinc-800/50 text-[9px] text-zinc-500 select-none">
                    <span className="font-medium">{(doc.size / 1024 / 1024).toFixed(1)} MB</span>
                    {activeRagDocs.includes(doc.name) && (
                      <span className="text-[7px] bg-violet-600/30 text-violet-400 border border-violet-500/25 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">Active</span>
                    )}
                    {indexingDoc === doc.name ? (
                      <div className="flex items-center gap-1 text-violet-400 font-semibold animate-pulse">
                        <svg className="h-2.5 w-2.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                        <span>Indexing...</span>
                      </div>
                    ) : doc.indexed ? (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-[8px] uppercase">
                        <span className="h-1 w-1 rounded-full bg-emerald-400"></span>
                        <span>Indexed</span>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleIndexDocument(doc.name); }}
                        disabled={indexingDoc !== null}
                        className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-violet-600 hover:text-white border border-zinc-750 hover:border-violet-500 text-zinc-400 font-semibold transition-all duration-150 cursor-pointer text-[9px] flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 21l8.982-8.982M18 13.653V7.622c0-2.24-2.242-4.043-4.316-3.416L3.935 7.071c-1.547.47-1.545 2.655.004 3.122l4.89 1.474" /></svg>
                        <span>Index</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </main>

      {/* Extracted Text Viewer Modal */}
      {activeDocForText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
          <div className="w-full max-w-3xl h-[80vh] flex flex-col rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden">

            {/* Modal Header */}
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-violet-600/10 border border-violet-500/20 text-violet-400 flex items-center justify-center">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-100 text-sm tracking-wide truncate max-w-md">{activeDocForText}</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {isExtracting ? "Extracting..." : `Parsed Successfully • ${extractedPages} Pages`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {extractedText && (
                  <button
                    onClick={handleCopyText}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700/80 text-zinc-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border border-zinc-750"
                  >
                    {isCopied ? (
                      <>
                        <svg className="h-3.5 w-3.5 text-emerald-400 animate-pulse" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M16.5 7.5h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25H16.5V7.5z" />
                        </svg>
                        <span>Copy Text</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  onClick={() => setActiveDocForText(null)}
                  className="h-8 w-8 rounded-lg bg-zinc-800 hover:bg-zinc-700/80 text-zinc-400 hover:text-white flex items-center justify-center transition-all duration-150 cursor-pointer border border-zinc-750"
                >
                  <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 bg-zinc-950/20 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
              {isExtracting ? (
                <div className="h-full flex flex-col justify-center items-center gap-3 text-center">
                  <svg className="h-10 w-10 text-violet-500 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-200">Parsing PDF Stream...</h4>
                    <p className="text-xs text-zinc-500 mt-1">Extracting character positions using pdf-parse</p>
                  </div>
                </div>
              ) : extractionError ? (
                <div className="h-full flex flex-col justify-center items-center gap-3 text-center max-w-md mx-auto">
                  <div className="h-10 w-10 rounded-full bg-red-950/20 border border-red-900/30 text-red-400 flex items-center justify-center">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-200">Extraction Failed</h4>
                    <p className="text-xs text-red-450 mt-1.5 leading-relaxed">{extractionError}</p>
                  </div>
                </div>
              ) : (
                <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap break-words leading-relaxed select-text">
                  {extractedText}
                </pre>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/30 flex items-center justify-between text-[10px] text-zinc-500 shrink-0">
              <span>Next.js Character Extraction Engine</span>
              <span>Isolated Local Storage Sandbox</span>
            </div>
          </div>
        </div>
      )}
      {/* Hidden file input for PDF upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFileUpload}
      />
    </div>
  );
}
