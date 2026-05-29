// lib/llm.mjs — Multi-provider LLM router (ESM, dùng cho scripts batch).
// Mục đích: KHÔNG bao giờ đập thẳng Gemini trả tiền cho job batch.
//
// Priority enrich/extract: minimax → openrouter(free) → ollama(local).
// Gemini KHÔNG nằm trong default order. Chỉ fallback khi ALLOW_GEMINI_FALLBACK=1.
//
// Usage:
//   import { chat, listConfigured } from '../lib/llm.mjs';
//   const { content, provider } = await chat([{role:'user',content:'...'}], { json:true });

function env(k) {
  const v = process.env[k];
  return v == null ? undefined : String(v).trim().replace(/^["']|["']$/g, '');
}

// Đọc env LAZY (lúc gọi, không phải lúc import) — để script load .env trước khi gọi chat()
function buildProviders() {
  return {
    minimax: {
      baseUrl: env('MINIMAX_BASE_URL') || 'https://api.minimax.io/v1',
      key: env('MINIMAX_API_KEY'),
      model: env('MINIMAX_ENRICH_MODEL') || 'MiniMax-M2.7',
      style: 'openai',
    },
    openrouter: {
      baseUrl: env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1',
      key: env('OPENROUTER_API_KEY'),
      model: env('OPENROUTER_ENRICH_MODEL') || 'google/gemma-3-27b-it:free',
      style: 'openai',
    },
    ollama: {
      baseUrl: env('OLLAMA_BASE_URL') || 'https://ollama.com/api',
      key: env('OLLAMA_API_KEY'),
      model: env('OLLAMA_ENRICH_MODEL') || 'gemma2',
      style: 'ollama',
    },
  };
}

// Ollama đã gỡ (làm chậm máy CEO 2026-05-29). Full MiniMax, fallback OpenRouter free.
const DEFAULT_ORDER = ['minimax', 'openrouter']; // Gemini KHÔNG có ở đây — guard

async function openaiChat(p, messages, { json, temperature = 0.1, maxTokens = 4000, signal } = {}) {
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 250)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function ollamaChat(p, messages, { json, temperature = 0.1, signal } = {}) {
  const res = await fetch(`${p.baseUrl}/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      messages,
      stream: false,
      options: { temperature },
      ...(json ? { format: 'json' } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 250)}`);
  }
  const data = await res.json();
  return data.message?.content ?? '';
}

/**
 * chat(messages, opts) → { content, provider, model }
 * opts: { json, temperature, maxTokens, order, allowGemini, timeoutMs }
 */
export async function chat(messages, opts = {}) {
  const PROVIDERS = buildProviders();
  const order = (opts.order || DEFAULT_ORDER).slice();
  if (opts.allowGemini || env('ALLOW_GEMINI_FALLBACK') === '1') {
    order.push('__gemini_blocked__'); // vẫn block — Gemini không impl ở router này (an toàn tuyệt đối)
  }
  const errors = [];
  const ac = opts.timeoutMs ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), opts.timeoutMs) : null;
  try {
    for (const name of order) {
      if (name === '__gemini_blocked__') { errors.push('gemini: blocked by router (dùng script Gemini riêng nếu thực sự cần)'); continue; }
      const p = PROVIDERS[name];
      if (!p || !p.key) { errors.push(`${name}: no key`); continue; }
      try {
        const callOpts = { ...opts, signal: ac?.signal };
        const content = p.style === 'openai' ? await openaiChat(p, messages, callOpts) : await ollamaChat(p, messages, callOpts);
        if (!content || !content.trim()) { errors.push(`${name}: empty response`); continue; }
        return { content, provider: name, model: p.model };
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  throw new Error('All providers failed:\n  ' + errors.join('\n  '));
}

export function listConfigured() {
  return Object.entries(buildProviders()).map(([n, p]) => ({ provider: n, hasKey: !!p.key, model: p.model, baseUrl: p.baseUrl }));
}
