import { useState } from 'react';
import type { Card as CardType, Rank, Role } from '../game/types';
import { CARD_INFO } from '../game/cards';
import { getRoleName, MAX_PLAYERS, MIN_PLAYERS } from '../game/logic';
import { Card } from './Card';
import { RoleBadge } from './RoleBadge';
import { cn } from '../utils/cn';
import { X, BookOpen, ScrollText, Layers, Crown, Coins, Swords, Trophy, Hourglass, Sparkles } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

let seq = 0;
function mk(rank: Rank): CardType {
  seq += 1;
  return { id: `rules-${rank}-${seq}`, rank, name: CARD_INFO[rank].name };
}

function cardsOf(...ranks: Rank[]): CardType[] {
  return ranks.map(mk);
}

function Fan({ cards, size = 'sm' }: { cards: CardType[]; size?: 'xs' | 'sm' }) {
  return (
    <div className="flex shrink-0">
      {cards.map((c, i) => (
        <div key={c.id} className={i > 0 ? (size === 'xs' ? '-ml-3' : '-ml-5') : ''} style={{ zIndex: i }}>
          <Card card={c} size={size} />
        </div>
      ))}
    </div>
  );
}

type Verdict = 'lead' | 'beats' | 'pass' | 'invalid' | 'valid' | 'note';

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  lead: { label: 'LEADS', cls: 'bg-purple-700 text-amber-100 border-purple-400' },
  beats: { label: 'BEATS IT', cls: 'bg-emerald-700 text-emerald-50 border-emerald-400' },
  valid: { label: 'VALID', cls: 'bg-emerald-700 text-emerald-50 border-emerald-400' },
  pass: { label: 'PASSES', cls: 'bg-stone-600 text-stone-100 border-stone-400' },
  invalid: { label: 'NOT ALLOWED', cls: 'bg-red-800 text-red-50 border-red-400' },
  note: { label: 'NOTE', cls: 'bg-sky-800 text-sky-50 border-sky-400' },
};

function Step({
  who,
  cards,
  verdict,
  children,
}: {
  who: string;
  cards?: CardType[];
  verdict: Verdict;
  children: React.ReactNode;
}) {
  const v = VERDICT[verdict];
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-white/55 border border-amber-300/70">
      {cards && cards.length > 0 ? (
        <Fan cards={cards} />
      ) : (
        <div className="shrink-0 flex items-center justify-center rounded-md border-2 border-dashed border-stone-400 text-stone-500 font-serif italic"
          style={{ width: 'var(--card-w-sm)', height: 'var(--card-h-sm)', fontSize: 'var(--font-xs)' }}>
          no play
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="font-serif font-bold text-amber-950" style={{ fontSize: 'var(--font-sm)' }}>{who}</span>
          <span className={cn('px-2 py-0.5 rounded-full border font-heading font-bold tracking-wide', v.cls)} style={{ fontSize: 'var(--font-tiny)' }}>
            {v.label}
          </span>
        </div>
        <p className="font-serif text-amber-900/90 leading-snug" style={{ fontSize: 'var(--font-xs)' }}>{children}</p>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-heading font-black text-purple-900 italic flex items-center gap-2 border-b-2 border-amber-300 pb-1" style={{ fontSize: 'var(--font-base)' }}>
        {icon} {title}
      </h3>
      <div className="font-serif text-amber-950 leading-relaxed space-y-2" style={{ fontSize: 'var(--font-sm)' }}>
        {children}
      </div>
    </section>
  );
}

function RoleLine({ role, children }: { role: Role; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="w-8 text-center shrink-0" style={{ fontSize: 'var(--font-base)' }}>
        <RoleBadge role={role} />
      </span>
      <span>
        <span className="font-bold">{getRoleName(role)}</span> — {children}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  the panel                                                          */
/* ------------------------------------------------------------------ */

type Tab = 'rules' | 'examples';

export function RulesPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('rules');
  const allRanks: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm fade-in" onClick={onClose} />
      <div
        className="relative w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl slide-up overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, rgba(253,248,236,0.98) 0%, rgba(236,210,150,0.97) 100%)',
          border: '3px solid #d4af37',
          boxShadow: '0 0 0 6px rgba(90,48,24,0.55), 0 24px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* header */}
        <div className="shrink-0 bg-gradient-to-r from-purple-900 to-purple-800 px-5 py-3 flex items-center justify-between border-b-4 border-amber-500/60">
          <h2 className="font-heading font-black text-amber-300 italic flex items-center gap-2" style={{ fontSize: 'var(--font-lg)' }}>
            <BookOpen size="1em" /> The Rules of the Realm
          </h2>
          <button onClick={onClose} className="text-amber-200 hover:text-white transition-colors" aria-label="Close rules">
            <X size="1.5rem" />
          </button>
        </div>

        {/* tabs */}
        <div className="shrink-0 flex gap-2 px-5 pt-3">
          {(
            [
              ['rules', 'The rules', <ScrollText key="r" size="1em" />],
              ['examples', 'Example hands', <Sparkles key="e" size="1em" />],
            ] as [Tab, string, React.ReactNode][]
          ).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-1.5 rounded-t-lg font-heading font-bold border-2 border-b-0 transition-colors',
                tab === id
                  ? 'bg-white/70 text-purple-900 border-amber-400'
                  : 'bg-purple-900/10 text-purple-900/60 border-transparent hover:bg-purple-900/20'
              )}
              style={{ fontSize: 'var(--font-sm)' }}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4 space-y-6 bg-white/40 border-t-2 border-amber-400">
          {tab === 'rules' ? (
            <>
              <Section icon={<Crown size="1em" />} title="Object of the game">
                <p>
                  Each hand you race to shed every card in your hand. The first player out climbs to the top of the
                  court as the <b>Greater Dalmuti</b>; the last one left holding cards sinks to <b>Greater Peon</b>. Ranks are
                  reassigned after every hand, so fortunes rise and fall — and the mighty tax the lowly along the way.
                </p>
              </Section>

              <Section icon={<Layers size="1em" />} title="The deck — 80 cards">
                <p>
                  Cards are ranked <b>1 (best) to 12 (worst)</b>, and each rank appears in the deck as many times as its
                  number: one Dalmuti, two Archbishops, three Earl Marshals… twelve Peasants. Two wild <b>Jesters</b> complete
                  the deck. <b>A lower number always beats a higher number.</b>
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center py-1">
                  {allRanks.map((r) => (
                    <div key={r} className="flex flex-col items-center gap-0.5">
                      <Card card={mk(r)} size="xs" />
                      <span className="font-serif text-amber-900" style={{ fontSize: 'var(--font-tiny)' }}>
                        {r === 13 ? '×2 wild' : `×${r}`}
                      </span>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 'var(--font-xs)' }} className="italic text-amber-900/80">
                  1 Dalmuti · 2 Archbishop · 3 Earl Marshal · 4 Baroness · 5 Abbess · 6 Knight · 7 Seamstress · 8 Mason ·
                  9 Cook · 10 Shepherdess · 11 Stonecutter · 12 Peasant · Jester (13, wild)
                </p>
              </Section>

              <Section icon={<Crown size="1em" />} title="Players & ranks at the table">
                <p>
                  {MIN_PLAYERS} to {MAX_PLAYERS} players. With {MAX_PLAYERS} at the table everyone receives exactly 10
                  cards; otherwise the whole deck is still dealt out, even if some players get one card more than others.
                  Seats run clockwise from the Greater Dalmuti; the Greater Peon sits at the Dalmuti's right hand.
                </p>
                <ul className="space-y-1.5 pl-1">
                  <RoleLine role="greater-dalmuti">rules the table, collects the richest tribute and leads the first round.</RoleLine>
                  <RoleLine role="lesser-dalmuti">second in the court; sits to the left of the Greater Dalmuti.</RoleLine>
                  <RoleLine role="merchant">everyone in the middle — no taxes owed, none received.</RoleLine>
                  <RoleLine role="lesser-peon">sits to the right of the Greater Peon and pays a small tribute.</RoleLine>
                  <RoleLine role="greater-peon">bottom of the heap: shuffles, deals and pays the heaviest tax.</RoleLine>
                </ul>
              </Section>

              <Section icon={<ScrollText size="1em" />} title="Setup — the draw for seats">
                <p>
                  Before the first hand every player <b>draws one card</b>. The lowest card becomes the Greater Dalmuti, the
                  next lowest the Lesser Dalmuti, and so on around the table; the highest card is the Greater Peon. For this
                  draw the <b>Jester counts as the highest card</b>. Ties are settled by lot. The result is shown to everyone
                  before the Greater Peon shuffles and deals.
                </p>
              </Section>

              <Section icon={<Coins size="1em" />} title="Taxation">
                <p>
                  Before play begins the poor pay the rich:
                </p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>
                    The <b>Greater Peon</b> hands the <b>two lowest</b> (best) cards in their hand to the Greater Dalmuti; the
                    Greater Dalmuti gives back <b>any two</b> cards of their choosing.
                  </li>
                  <li>
                    The <b>Lesser Peon</b> hands their <b>single lowest</b> card to the Lesser Dalmuti, who returns <b>any one</b> card.
                    (At a table of three there is no Lesser Peon, so only the greater exchange happens.)
                  </li>
                  <li>
                    Tribute is <b>sealed</b>: the Dalmutis choose what to give back <i>before</i> they see what they receive.
                  </li>
                </ul>
              </Section>

              <Section icon={<Swords size="1em" />} title="Revolution!">
                <p>
                  A player dealt <b>both Jesters</b> may call for a <b>Revolution</b> before taxes are paid: taxation is
                  cancelled for that hand. If the player holding both Jesters is the <b>Greater Peon</b>, it is a{' '}
                  <b>Greater Revolution</b> — every rank at the table is reversed: the Greater Peon becomes Greater Dalmuti,
                  the Lesser Peon becomes Lesser Dalmuti, and so on.
                </p>
              </Section>

              <Section icon={<Swords size="1em" />} title="Playing a hand">
                <ul className="list-disc pl-6 space-y-1">
                  <li>
                    The <b>Greater Dalmuti leads</b> with a set of <b>one or more cards of the same rank</b> — four 12s, two 9s, a single 7.
                  </li>
                  <li>
                    Play passes clockwise. Each player must play <b>the same number of cards</b> of a <b>lower rank</b>
                    (a smaller number), or <b>pass</b>.
                  </li>
                  <li>
                    A <b>Jester is wild</b>: add it to a set to make up the numbers — a 6 and a Jester is a pair of 6s.
                  </li>
                  <li>
                    Passing does not lock you out: if the turn comes round to you again you may still play.
                  </li>
                  <li>
                    When every other player has passed in turn, the <b>round ends</b>. The last player to lay cards clears the
                    table and <b>leads the next round</b> with any set they like.
                  </li>
                  <li>
                    A Jester played <b>on its own</b> (or a set made only of Jesters) counts as rank <b>13 — the lowest card in
                    the game</b>. Anyone can beat it with the same number of cards of rank 12 or better.
                  </li>
                </ul>
              </Section>

              <Section icon={<Trophy size="1em" />} title="Going out, the end of a hand & reseating">
                <p>
                  When you play your last card you are <b>out</b> and sit back to watch. The hand ends when only one player
                  still holds cards. The order in which players went out sets the ranks for the next hand: first out is
                  Greater Dalmuti, second is Lesser Dalmuti, and so on; the player stuck with cards is the new Greater Peon,
                  who shuffles and deals again. There is no fixed finish — the court plays on until you agree to stop.
                </p>
              </Section>

              <Section icon={<Trophy size="1em" />} title="Scoring at this table">
                <p>
                  Points are tallied at the end of every hand. With <b>N players</b>, first out scores <b>N − 1</b>, second
                  <b> N − 2</b>, … and last place scores <b>0</b>. At a table of five that is 4 · 3 · 2 · 1 · 0. Totals carry
                  across hands and can be checked any time from the <b>Scores</b> button.
                </p>
              </Section>

              <Section icon={<Hourglass size="1em" />} title="The turn hourglass (optional)">
                <p>
                  Before starting or hosting a game you can switch on a <b>60-second turn timer</b>. A clock beneath the
                  cards counts down each turn; if it empties, you <b>pass automatically</b>. Switch it off for a relaxed game.
                </p>
              </Section>
            </>
          ) : (
            <>
              <Section icon={<Sparkles size="1em" />} title="Example 1 — the rulebook round (five players)">
                <div className="space-y-2">
                  <Step who="Greater Dalmuti" cards={cardsOf(9, 9)} verdict="lead">
                    Leads a pair of 9s (Cooks). Everyone must now play <b>two</b> cards of rank 8 or better, or pass.
                  </Step>
                  <Step who="Second player" cards={cardsOf(7, 7)} verdict="beats">
                    Two 7s (Seamstresses) — the same number of cards, and 7 is lower than 9.
                  </Step>
                  <Step who="Third player" cards={cardsOf(6, 13)} verdict="beats">
                    Holds only one 6 (Knight), so adds a <b>Jester as a wild card</b> to make a pair of 6s.
                  </Step>
                  <Step who="Fourth player" cards={cardsOf(5, 5, 5, 5)} verdict="pass">
                    Has four 5s (Abbesses) and could play two of them, but would rather keep the set of four together — passes.
                  </Step>
                  <Step who="Fifth player" verdict="pass">
                    No pair below rank 6 in hand — must pass.
                  </Step>
                  <Step who="Back to the Greater Dalmuti" verdict="note">
                    May still beat the pair of 6s with a lower pair, or pass. If everyone passes, the third player clears the
                    table and leads the next round.
                  </Step>
                </div>
              </Section>

              <Section icon={<Sparkles size="1em" />} title="Example 2 — a lone Jester is the weakest card">
                <div className="space-y-2">
                  <Step who="Leader" cards={cardsOf(13)} verdict="lead">
                    Leads a single Jester. On its own it counts as <b>rank 13</b>, so almost anything beats it.
                  </Step>
                  <Step who="Next player" cards={cardsOf(12)} verdict="beats">
                    A Peasant (12) is lower than 13 — a lowly Peasant beats the Jester.
                  </Step>
                  <Step who="Next player" cards={cardsOf(4)} verdict="beats">
                    A Baroness (4) beats the Peasant.
                  </Step>
                  <Step who="Next player" cards={cardsOf(1)} verdict="beats">
                    The Dalmuti (1) beats everything — nothing is lower than 1, so this round is won.
                  </Step>
                </div>
              </Section>

              <Section icon={<Sparkles size="1em" />} title="Example 3 — what can follow a pair of 8s?">
                <p style={{ fontSize: 'var(--font-xs)' }} className="italic text-amber-900/80">
                  The table shows two Masons (8, 8). Each candidate play below is judged against it.
                </p>
                <div className="space-y-2">
                  <Step who="One Earl Marshal" cards={cardsOf(3)} verdict="invalid">
                    A 3 is a great card, but it is only <b>one</b> card — you must match the count of two.
                  </Step>
                  <Step who="Two Masons" cards={cardsOf(8, 8)} verdict="invalid">
                    Equal rank is not enough — the play must be <b>strictly lower</b> than 8.
                  </Step>
                  <Step who="Two Peasants" cards={cardsOf(12, 12)} verdict="invalid">
                    12 is a <b>higher</b> number than 8, so it is a weaker set.
                  </Step>
                  <Step who="Two Abbesses" cards={cardsOf(5, 5)} verdict="valid">
                    Two cards, rank 5 — lower than 8. A proper follow.
                  </Step>
                  <Step who="Abbess + Jester" cards={cardsOf(5, 13)} verdict="valid">
                    The Jester stands in as a second Abbess: a pair of 5s.
                  </Step>
                </div>
              </Section>

              <Section icon={<Coins size="1em" />} title="Example 4 — paying taxes">
                <div className="space-y-2">
                  <Step who="Greater Peon gives" cards={cardsOf(3, 5)} verdict="note">
                    The <b>two lowest</b> cards in the Peon's hand — here a 3 and a 5 — go to the Greater Dalmuti automatically.
                  </Step>
                  <Step who="Greater Dalmuti returns" cards={cardsOf(12, 12)} verdict="note">
                    Any two cards of the Dalmuti's choosing — usually the worst in hand. The choice is made <b>before</b> seeing
                    the sealed tribute.
                  </Step>
                  <Step who="Lesser Peon ⇄ Lesser Dalmuti" cards={cardsOf(4)} verdict="note">
                    The same exchange with a single card each way.
                  </Step>
                </div>
              </Section>

              <Section icon={<Swords size="1em" />} title="Example 5 — Greater Revolution">
                <div className="space-y-2">
                  <Step who="Greater Peon is dealt" cards={cardsOf(13, 13)} verdict="note">
                    Both Jesters! Before taxes the Peon may call a <b>Greater Revolution</b>: no taxes are paid and every rank
                    at the table flips — the Peon rules as Greater Dalmuti for this hand. Had a Merchant held both Jesters,
                    calling a Revolution would only cancel the taxes.
                  </Step>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
