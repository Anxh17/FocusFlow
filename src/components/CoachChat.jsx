import { useState } from 'react';
import { MessageSquare, Send, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { askCoachChat } from '../services/coachService.js';

const SUGGESTED_QUESTIONS = [
  'What should I focus on today?',
  'Why am I falling behind?',
  'Which task should I prioritize?',
  'How productive was my week?',
  'How can I improve my schedule?',
];

export default function CoachChat({ goal, tasks, milestones }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function sendQuestion(text) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const res = await askCoachChat({
        question: trimmed,
        history: nextHistory,
        goal,
        tasks,
        milestones,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.reply,
          provider: res.provider,
          model: res.model,
          isFallback: res.isFallback,
          fallbackMessage: res.fallbackMessage,
        },
      ]);
    } catch (err) {
      setError(err.message || 'Unable to reach AI Coach right now.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendQuestion(input);
  }

  return (
    <div className="coach-card">
      <div className="section-header" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>
          <MessageSquare /> Ask Your AI Coach
        </h3>
        <span className="badge badge-accent">Advisory only · Minimized context</span>
      </div>

      <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
        Ask questions about your current tasks, focus time, or weekly progress. Suggestions never modify your schedule without your approval.
      </p>

      <div className="recovery-chips" style={{ marginBottom: 14 }}>
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            className="recovery-chip"
            onClick={() => sendQuestion(q)}
            disabled={loading}
          >
            {q}
          </button>
        ))}
      </div>

      {messages.length > 0 && (
        <div className="coach-chat-thread" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`coach-chat-msg ${m.role}`}>
              <div className="coach-chat-meta">
                <span>{m.role === 'user' ? 'You' : 'FocusFlow Coach'}</span>
                {m.role === 'assistant' && m.provider && (
                  <span className={`badge ${m.isFallback || m.provider === 'deterministic' ? 'badge-info' : 'badge-accent'}`}>
                    {m.provider === 'deterministic'
                      ? 'Built-in Deterministic Coach'
                      : `AI: ${m.provider}${m.model ? ` (${m.model})` : ''}`}
                  </span>
                )}
              </div>
              {m.isFallback && m.fallbackMessage && (
                <div className="text-sm" style={{ color: 'var(--color-warning)', marginBottom: 4 }}>
                  {m.fallbackMessage}
                </div>
              )}
              <div className="coach-chat-body">{m.content}</div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="coach-chat-loading" role="status">
          <Loader2 size={16} className="spin" color="var(--accent-primary)" />
          <span className="text-sm text-muted">Analyzing your productivity context...</span>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert" style={{ marginTop: 12, marginBottom: 12 }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="coach-chat-form">
        <input
          type="text"
          aria-label="Ask AI Coach a question"
          placeholder="Ask about today's focus, deadlines, or your weekly pace..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>
          {loading ? <Sparkles size={16} /> : <Send size={16} />} Ask
        </button>
      </form>
    </div>
  );
}
