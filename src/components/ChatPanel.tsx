import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../game/types';
import { cn } from '../utils/cn';
import { Send, X, ScrollText } from 'lucide-react';

const QUICK_PHRASES = [
  'Well played!',
  'Taxes again?!',
  'Vive la révolution!',
  'Mercy, your grace…',
  'The peon revolts!',
  'Good hand, friend.',
];

export function ChatPanel({
  open,
  messages,
  myName,
  onSend,
  onClose,
}: {
  open: boolean;
  messages: ChatMessage[];
  myName: string;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    const last = messages[messages.length - 1];
    if (last) console.log('[CHAT] rendered', last.id, last.name, ':', last.text);
  }, [messages, open]);

  if (!open) return null;

  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
  };

  return (
    <div
      className="fixed right-3 bottom-3 z-[65] flex flex-col rounded-xl border-2 border-amber-500/50 shadow-2xl overflow-hidden slide-up"
      style={{
        width: 'clamp(300px, 28vw, 480px)',
        height: 'clamp(360px, 52vh, 620px)',
        background: 'linear-gradient(180deg, rgba(26,10,46,0.96), rgba(10,5,24,0.96))',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-purple-900/90 border-b border-amber-500/40">
        <h3 className="font-heading font-bold text-amber-300 italic flex items-center gap-2" style={{ fontSize: 'var(--font-sm)' }}>
          <ScrollText size="1em" /> Table Chat
        </h3>
        <button onClick={onClose} className="text-amber-200 hover:text-white" aria-label="Close chat">
          <X size="1.1rem" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {messages.length === 0 && (
          <p className="text-amber-100/50 font-serif italic text-center py-6" style={{ fontSize: 'var(--font-xs)' }}>
            No words yet at the table…
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn('font-serif leading-snug', m.system && 'text-center')}>
            {m.system ? (
              <span className="text-amber-300/70 italic" style={{ fontSize: 'var(--font-tiny)' }}>
                — {m.text} —
              </span>
            ) : (
              <>
                <span
                  className={cn('font-bold', m.mine ? 'text-emerald-300' : 'text-amber-300')}
                  style={{ fontSize: 'var(--font-sm)' }}
                >
                  {m.mine ? 'You' : m.name}:
                </span>{' '}
                <span className="text-amber-50" style={{ fontSize: 'var(--font-sm)' }}>
                  {m.text}
                </span>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="px-2 pt-1 pb-2 border-t border-amber-500/30 bg-black/30">
        <div className="flex flex-wrap gap-1 px-1 pb-1.5">
          {QUICK_PHRASES.slice(0, 4).map((q) => (
            <button
              key={q}
              onClick={() => submit(q)}
              className="px-2 py-0.5 rounded-full bg-amber-500/15 hover:bg-amber-500/30 border border-amber-400/30 text-amber-200 font-serif transition-colors"
              style={{ fontSize: 'var(--font-tiny)' }}
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex gap-1.5 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 120))}
            placeholder={`Speak as ${myName}…`}
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white/10 border border-amber-400/30 text-amber-50 placeholder-amber-100/40 font-serif focus:outline-none focus:border-amber-400"
            style={{ fontSize: 'var(--font-sm)' }}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-purple-950"
            aria-label="Send message"
          >
            <Send size="1rem" />
          </button>
        </form>
      </div>
    </div>
  );
}
