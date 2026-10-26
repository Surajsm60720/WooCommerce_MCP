import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { newId } from '../lib/id';
import type { ChatMessage, ChatResponse, ChatToolCall } from '../types';

interface UiMessage extends ChatMessage {
  id: string;
  toolCalls?: ChatToolCall[];
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const ADMIN_STARTERS = [
  'Create a product named Harbor Flask SKU HF-240 priced 29.99',
  'What orders came in today? Prefer list_orders with today=true.',
  'Compare today\'s orders across every WooCommerce store (woocommerce and woo-* tools).',
  'Mark the most recent processing order as completed',
];

const MEMBER_STARTERS = [
  'What orders came in today in UTC? Use current time then list orders.',
  'List products and summarize the three most expensive.',
  'Create a product named Should Fail priced 1',
];

export function ChatPage() {
  const { isAdmin } = useAuth();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const starters = isAdmin ? ADMIN_STARTERS : MEMBER_STARTERS;

  async function sendMessage(text: string) {
    if (!text || loading) return;

    const userMsg: UiMessage = { id: newId(), role: 'user', content: text };
    const history: ChatMessage[] = [...messages, userMsg].map(({ role, content }) => ({
      role,
      content,
    }));

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await api.post<ChatResponse>('/api/chat', {
        message: text,
        history: history.slice(0, -1),
      });
      const assistantMsg: UiMessage = {
        id: newId(),
        role: 'assistant',
        content: res.reply,
        toolCalls: res.toolCalls?.length ? res.toolCalls : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Chat request failed');
    } finally {
      setLoading(false);
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await sendMessage(input.trim());
  }

  return (
    <div className="page chat-page">
      <header className="page-header">
        <div>
          <h1>Chat</h1>
          <p className="muted">
            Tool loop runs as you. Calls are audited under your account. Members only get read
            tools.
          </p>
        </div>
      </header>

      {error && <p className="alert alert--error">{error}</p>}

      <div className="chat-layout">
        <div className="chat-thread" ref={listRef}>
          {messages.length === 0 && (
            <div className="chat-empty-block">
              <p className="muted">Try a business prompt that forces real tool use:</p>
              <ul className="starter-list">
                {starters.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className="starter-btn"
                      onClick={() => void sendMessage(s)}
                      disabled={loading}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((msg) => (
            <article
              key={msg.id}
              className={`chat-bubble chat-bubble--${msg.role}`}
            >
              <p className="chat-role">{msg.role === 'user' ? 'You' : 'Assistant'}</p>
              <p className="chat-content">{msg.content}</p>
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="tool-chips">
                  {msg.toolCalls.map((tc, i) => (
                    <details
                      key={`${msg.id}-${tc.name}-${i}`}
                      className={`tool-chip ${tc.success ? 'tool-chip--ok' : 'tool-chip--fail'}`}
                    >
                      <summary>
                        <span className="mono">{tc.name}</span>
                        <span className="chip-status">{tc.success ? 'success' : 'failed'}</span>
                      </summary>
                      <div className="tool-chip-body">
                        <p className="small muted">Arguments</p>
                        <pre>{formatJson(tc.arguments)}</pre>
                        <p className="small muted">Result</p>
                        <pre>{formatJson(tc.result)}</pre>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </article>
          ))}
          {loading && <p className="muted chat-typing">Assistant is thinking…</p>}
        </div>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message the gateway…"
            rows={3}
            disabled={loading}
          />
          <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
