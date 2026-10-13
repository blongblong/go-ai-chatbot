/**
 * Go-AI Chatbot - Cloudflare Worker
 * Backend chính: Auth + Chat + RAG (Vectorize + Workers AI)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ========== AUTH ==========
      if (path === "/api/register" && request.method === "POST") {
        return handleRegister(request, env, corsHeaders);
      }
      if (path === "/api/login" && request.method === "POST") {
        return handleLogin(request, env, corsHeaders);
      }

      // ========== CHAT ==========
      if (path === "/api/chat" && request.method === "POST") {
        return handleChat(request, env, corsHeaders);
      }

      // ========== ADMIN - KB ==========
      if (path === "/api/admin/upload-kb" && request.method === "POST") {
        return handleUploadKB(request, env, corsHeaders);
      }
      if (path === "/api/admin/list-kb" && request.method === "GET") {
        return handleListKB(request, env, corsHeaders);
      }

      // Health check
      if (path === "/api/health") {
        return json({ status: "ok", service: "go-ai-chatbot" }, corsHeaders);
      }

      return json({ error: "Not found" }, corsHeaders, 404);
    } catch (err) {
      console.error(err);
      return json({ error: err.message || "Internal error" }, corsHeaders, 500);
    }
  },
};

// ========== HELPERS ==========
function json(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getUserFromToken(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  // Token đơn giản: base64(email:timestamp) - chỉ dùng cho demo!
  try {
    const decoded = atob(token);
    const [email] = decoded.split(":");
    const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
      .bind(email)
      .first();
    return user;
  } catch {
    return null;
  }
}

// ========== AUTH HANDLERS ==========
async function handleRegister(request, env, corsHeaders) {
  const { email, password, full_name } = await request.json();
  if (!email || !password) {
    return json({ error: "Email và password bắt buộc" }, corsHeaders, 400);
  }

  const password_hash = await hashPassword(password);
  try {
    await env.DB.prepare(
      "INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, 'user')"
    )
      .bind(email.toLowerCase(), password_hash, full_name || "")
      .run();
    return json({ success: true, message: "Đăng ký thành công" }, corsHeaders);
  } catch (e) {
    return json({ error: "Email đã tồn tại" }, corsHeaders, 400);
  }
}

async function handleLogin(request, env, corsHeaders) {
  const { email, password } = await request.json();
  if (!email || !password) {
    return json({ error: "Email và password bắt buộc" }, corsHeaders, 400);
  }

  const password_hash = await hashPassword(password);
  const user = await env.DB.prepare(
    "SELECT id, email, full_name, role FROM users WHERE email = ? AND password_hash = ?"
  )
    .bind(email.toLowerCase(), password_hash)
    .first();

  if (!user) {
    return json({ error: "Sai email hoặc mật khẩu" }, corsHeaders, 401);
  }

  // Cập nhật last_login
  await env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?")
    .bind(user.id)
    .run();

  // Token đơn giản cho demo (production nên dùng JWT thật)
  const token = btoa(`${user.email}:${Date.now()}`);

  return json(
    {
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    },
    corsHeaders
  );
}

// ========== CHAT + RAG ==========
async function handleChat(request, env, corsHeaders) {
  const user = await getUserFromToken(request, env);
  if (!user) {
    return json({ error: "Unauthorized" }, corsHeaders, 401);
  }

  const { message, session_id } = await request.json();
  if (!message) {
    return json({ error: "Thiếu nội dung tin nhắn" }, corsHeaders, 400);
  }

  // 1. Embed câu hỏi của user
  const embeddingResponse = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [message],
  });
  const queryVector = embeddingResponse.data[0];

  // 2. Tìm kiếm trong Vectorize (top 5 đoạn liên quan)
  let contextText = "";
  try {
    const matches = await env.VECTORIZE.query(queryVector, {
      topK: 5,
      returnMetadata: true,
    });

    if (matches && matches.matches && matches.matches.length > 0) {
      contextText = matches.matches
        .map((m, i) => `[Đoạn ${i + 1} - Nguồn: ${m.metadata?.source || "KB"}]\n${m.metadata?.text || ""}`)
        .join("\n\n");
    }
  } catch (e) {
    console.log("Vectorize query error (có thể chưa có data):", e.message);
  }

  // 3. Tạo prompt RAG
  const systemPrompt = `Bạn là trợ lý AI chuyên về pháp luật Việt Nam dành cho doanh nghiệp sản xuất và kinh doanh trong khu công nghiệp (KCN).
Hãy trả lời bằng tiếng Việt, rõ ràng, chính xác, và trích dẫn nguồn nếu có trong ngữ cảnh.
Nếu không tìm thấy thông tin trong ngữ cảnh, hãy nói rõ "Tôi chưa có thông tin về vấn đề này trong kho tri thức hiện tại" và đưa ra lời khuyên chung.

Ngữ cảnh từ Knowledge Base:
${contextText || "(Chưa có dữ liệu KB hoặc không tìm thấy đoạn liên quan)"}`;

  // 4. Gọi LLM
  const llmResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message },
    ],
    max_tokens: 1024,
  });

  const reply = llmResponse.response || llmResponse.result?.response || "Xin lỗi, tôi không thể trả lời lúc này.";

  // 5. Lưu lịch sử chat (tùy chọn)
  let currentSessionId = session_id;
  if (!currentSessionId) {
    const session = await env.DB.prepare(
      "INSERT INTO chat_sessions (user_id, title) VALUES (?, ?) RETURNING id"
    )
      .bind(user.id, message.slice(0, 50))
      .first();
    currentSessionId = session?.id;
  }

  if (currentSessionId) {
    await env.DB.prepare(
      "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)"
    )
      .bind(currentSessionId, message)
      .run();
    await env.DB.prepare(
      "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)"
    )
      .bind(currentSessionId, reply)
      .run();
  }

  return json(
    {
      success: true,
      reply,
      session_id: currentSessionId,
      sources_used: contextText ? true : false,
    },
    corsHeaders
  );
}

// ========== ADMIN: UPLOAD KB ==========
async function handleUploadKB(request, env, corsHeaders) {
  const user = await getUserFromToken(request, env);
  if (!user || user.role !== "admin") {
    return json({ error: "Chỉ admin mới được upload KB" }, corsHeaders, 403);
  }

  const { title, content, source } = await request.json();
  if (!content || !title) {
    return json({ error: "Thiếu title hoặc content" }, corsHeaders, 400);
  }

  // Chia nhỏ content thành các chunk ~800 ký tự
  const chunks = splitIntoChunks(content, 800);

  // Lưu metadata vào D1
  const doc = await env.DB.prepare(
    "INSERT INTO kb_documents (title, source, uploaded_by) VALUES (?, ?, ?) RETURNING id"
  )
    .bind(title, source || title, user.id)
    .first();

  // Embed từng chunk và insert vào Vectorize
  let inserted = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const emb = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [chunk],
      });
      const vector = emb.data[0];

      await env.VECTORIZE.insert([
        {
          id: `doc-${doc.id}-chunk-${i}`,
          values: vector,
          metadata: {
            text: chunk,
            source: source || title,
            doc_id: String(doc.id),
            chunk_index: i,
          },
        },
      ]);
      inserted++;
    } catch (e) {
      console.error("Embed error chunk", i, e.message);
    }
  }

  return json(
    {
      success: true,
      document_id: doc.id,
      chunks_inserted: inserted,
      total_chunks: chunks.length,
    },
    corsHeaders
  );
}

async function handleListKB(request, env, corsHeaders) {
  const user = await getUserFromToken(request, env);
  if (!user || user.role !== "admin") {
    return json({ error: "Unauthorized" }, corsHeaders, 403);
  }

  const docs = await env.DB.prepare(
    "SELECT id, title, source, created_at FROM kb_documents ORDER BY created_at DESC"
  ).all();

  return json({ success: true, documents: docs.results || [] }, corsHeaders);
}

// Helper chia text thành chunk
function splitIntoChunks(text, maxLen = 800) {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let current = "";

  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > maxLen && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
