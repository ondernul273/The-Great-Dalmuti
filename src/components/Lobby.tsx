import { useEffect, useRef, useState } from 'react';
import type { PeerStatus } from '../hooks/useMultiplayer';
import type { IceDiagnostics, NetworkTestResult } from '../net/webrtcConfig';
import type { BanquetView, LobbyChatLine } from '../net/types';
import type { RosterEntry } from '../game/types';
import { Card } from './Card';
import { IceDiagnosticsBox, NetworkTestBox } from './NetworkPanel';
import { RulesPanel } from './RulesPanel';
import { cn } from '../utils/cn';
import lobbyHall from '../assets/lobby-hall.jpg';
import {
  Crown,
  Bot,
  User,
  X,
  UserPlus,
  Hourglass,
  BookOpen,
  Link2,
  Server,
  ListChecks,
  PlusCircle,
  RefreshCw,
  Lock,
  Swords,
  CircleCheck,
  CircleDashed,
  Send,
  LogOut,
  Play,
  Users,
} from 'lucide-react';

interface LobbyProps {
  /* shared */
  myName: string;
  onNameChange: (n: string) => void;
  onStartAI: (numAI: number) => void;
  timerEnabled: boolean;
  onToggleTimer: (v: boolean) => void;
  timerSeconds: number;
  onTimerSeconds: (s: number) => void;
  maxSeats: number;
  minSeats: number;
  error?: string | null;
  /* direct connect (PeerJS) */
  status: PeerStatus;
  roomCode: string;
  onHost: () => void;
  onJoin: (code: string) => void;
  onStart: () => void;
  canStart: boolean;
  peers: { id: string; name?: string }[];
  roster: RosterEntry[];
  onAddAI: () => void;
  onRemoveAI: (id: string) => void;
  canAddAI: boolean;
  diagnostics?: IceDiagnostics;
  networkTest?: NetworkTestResult | null;
  testingNetwork?: boolean;
  hasDedicatedTurn?: boolean;
  onTestNetwork?: () => void;
  /* banquet browser (Socket.IO) */
  banquet: BanquetView;
  banquetChat: LobbyChatLine[];
  banquetInLobby: boolean;
  banquetIsHost: boolean;
  canStartBanquet: boolean;
  onBanquetCreate: (o: { lobbyName: string; password: string; maxPlayers: number }) => void;
  onBanquetRefresh: () => void;
  onBanquetJoin: (id: string, pw: string) => void;
  onBanquetLeave: () => void;
  onBanquetReady: (r: boolean) => void;
  onBanquetStart: () => void;
  onBanquetChat: (t: string) => void;
  onBanquetAddAI: () => void;
  onBanquetRemoveAI: (id: string) => void;
}

type Screen =
  | 'menu'
  | 'local'
  | 'dchoose'
  | 'dhost'
  | 'djoin'
  | 'bchoose'
  | 'bcreate'
  | 'browse'
  | 'broom';

const FLOATING = [
  { top: '8%', left: '6%', r: '-18deg', dx: '22px', dy: '-26px', delay: '0s' },
  { top: '14%', right: '8%', r: '12deg', dx: '-18px', dy: '-22px', delay: '1.2s' },
  { top: '62%', left: '4%', r: '22deg', dx: '16px', dy: '20px', delay: '2.1s' },
  { top: '68%', right: '5%', r: '-10deg', dx: '-24px', dy: '18px', delay: '0.6s' },
  { top: '40%', left: '2%', r: '8deg', dx: '10px', dy: '-30px', delay: '2.8s' },
  { top: '38%', right: '3%', r: '-14deg', dx: '-12px', dy: '-16px', delay: '1.7s' },
];

export function Lobby(props: LobbyProps) {
  const {
    myName,
    onNameChange,
    onStartAI,
    timerEnabled,
    onToggleTimer,
    timerSeconds,
    onTimerSeconds,
    maxSeats,
    minSeats,
    error,
    status,
    roomCode,
    onHost,
    onJoin,
    onStart,
    canStart,
    peers,
    roster,
    onAddAI,
    onRemoveAI,
    canAddAI,
    diagnostics,
    networkTest,
    testingNetwork = false,
    hasDedicatedTurn = false,
    onTestNetwork,
    banquet,
    banquetChat,
    banquetInLobby,
    banquetIsHost,
    canStartBanquet,
    onBanquetCreate,
    onBanquetRefresh,
    onBanquetJoin,
    onBanquetLeave,
    onBanquetReady,
    onBanquetStart,
    onBanquetChat,
    onBanquetAddAI,
    onBanquetRemoveAI,
  } = props;

  const [screen, setScreen] = useState<Screen>('menu');
  const [joinCode, setJoinCode] = useState('');
  const [numAI, setNumAI] = useState(3);
  const [showRules, setShowRules] = useState(false);

  /* banquet form state */
  const [lobbyName, setLobbyName] = useState('');
  const [lobbyPw, setLobbyPw] = useState('');
  const [lobbyMax, setLobbyMax] = useState(maxSeats);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pwInput, setPwInput] = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const seatCount = roster?.length || peers.length + 1;
  const aiOptions = Array.from({ length: maxSeats - 2 }, (_, i) => i + 2);

  /* keep the lobby room screen in sync with the socket session */
  useEffect(() => {
    if (banquetInLobby && screen !== 'broom') setScreen('broom');
    if (!banquetInLobby && screen === 'broom') setScreen('bchoose');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banquetInLobby]);

  /* auto-refresh the lobby list while browsing */
  useEffect(() => {
    if (screen !== 'browse') return;
    onBanquetRefresh();
    const t = setInterval(onBanquetRefresh, 5000);
    return () => clearInterval(t);
  }, [screen, onBanquetRefresh]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [banquetChat]);

  const me = banquet.lobby?.players.find((p) => p.id === banquet.myId);
  const iAmReady = me?.ready ?? false;

  return (
    <div
      className="h-screen relative overflow-x-hidden overflow-y-auto overscroll-contain"
      style={{ scrollbarGutter: 'stable' }}
    >
      {showRules && <RulesPanel onClose={() => setShowRules(false)} />}

      {/* Hall backdrop */}
      <div
        className="fixed inset-0 bg-cover bg-center scale-105"
        style={{ backgroundImage: `url(${lobbyHall})`, filter: 'brightness(0.55) saturate(1.15)' }}
      />
      <div className="fixed inset-0 bg-gradient-to-b from-purple-950/70 via-transparent to-black/80 pointer-events-none" />

      {/* Torch blooms */}
      <div className="torch-glow fixed left-[8%] bottom-[18%] w-40 h-40 rounded-full bg-amber-500/25 blur-3xl pointer-events-none" />
      <div className="torch-glow fixed right-[10%] bottom-[22%] w-48 h-48 rounded-full bg-orange-500/20 blur-3xl pointer-events-none" style={{ animationDelay: '0.8s' }} />
      <div className="torch-glow fixed left-1/2 top-[12%] w-64 h-32 -translate-x-1/2 rounded-full bg-amber-300/10 blur-3xl pointer-events-none" style={{ animationDelay: '1.4s' }} />

      {/* Dust motes — clipped in their own fixed layer so their motion can
          never add scrollable overflow to the menu (which would toggle the
          scrollbar and shift the centred column side to side). */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {Array.from({ length: 18 }).map((_, i) => (
          <span
            key={i}
            className="dust-mote"
            style={{
              left: `${6 + (i * 5.3) % 88}%`,
              bottom: '-8px',
              animationDuration: `${7 + (i % 6)}s`,
              animationDelay: `${(i * 0.4) % 6}s`,
              opacity: 0.4,
            }}
          />
        ))}
      </div>

      {/* Floating cards */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {FLOATING.map((p, i) => (
          <div
            key={i}
            className="absolute float-card opacity-70 drop-shadow-2xl"
            style={{
              top: p.top,
              left: (p as { left?: string }).left,
              right: (p as { right?: string }).right,
              ['--r' as string]: p.r,
              ['--dx' as string]: p.dx,
              ['--dy' as string]: p.dy,
              animationDelay: p.delay,
              animationDuration: `${8 + i}s`,
            }}
          >
            <Card faceDown />
          </div>
        ))}
      </div>

      {/* Centred column — scrolls when tall */}
      <div className="relative z-10 flex min-h-full flex-col items-center justify-center p-4 py-8">
        <div className="w-full max-w-xl">
          <div className="text-center mb-6">
            <div
              className="inline-block mb-3 px-4 py-1 rounded-full border border-amber-400/40 bg-black/30 text-amber-200 font-serif italic tracking-widest"
              style={{ fontSize: 'var(--font-xs)' }}
            >
              A game of ranks, taxes &amp; revolution
            </div>
            <h1
              className="font-heading font-black italic text-amber-100 leading-none"
              style={{ fontSize: 'var(--font-xl)', textShadow: '0 2px 0 #3b0764, 0 8px 24px rgba(0,0,0,0.6)' }}
            >
              The Great
            </h1>
            <h1 className="font-heading font-black italic title-shimmer leading-none mt-1" style={{ fontSize: 'var(--font-xxl)' }}>
              Dalmuti
            </h1>
          </div>

          <div
            className="relative rounded-2xl p-6 sm:p-7 shadow-2xl"
            style={{
              background: 'linear-gradient(160deg, rgba(253,248,236,0.96) 0%, rgba(236,210,150,0.94) 100%)',
              border: '3px solid #d4af37',
              boxShadow: '0 0 0 6px rgba(90,48,24,0.55), 0 24px 60px rgba(0,0,0,0.45)',
            }}
          >
            {error && (
              <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-800 font-serif" style={{ fontSize: 'var(--font-sm)' }}>
                {error}
              </div>
            )}

            <div className="mb-5">
              <label className="block text-amber-900 font-serif font-bold mb-1" style={{ fontSize: 'var(--font-sm)' }}>
                Your Name
              </label>
              <input
                type="text"
                value={myName}
                onChange={(e) => onNameChange(e.target.value.slice(0, 16))}
                placeholder="Enter your name"
                className="w-full px-4 py-2.5 rounded-lg border-2 border-amber-700/30 bg-white/80 focus:border-amber-600 focus:outline-none font-serif text-amber-900"
                style={{ fontSize: 'var(--font-base)' }}
                maxLength={16}
              />
            </div>

            {/* =============== MAIN MENU =============== */}
            {screen === 'menu' && (
              <div className="space-y-3">
                <MenuBtn onClick={() => setScreen('local')} tone="purple">
                  🎮 Play vs. the Court (AI)
                </MenuBtn>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ModeCard
                    icon={<Server size="1.4em" />}
                    title="Banquet Browser"
                    tagline="Most reliable multiplayer experience."
                    chips={['Create lobby', 'Browse & join', 'Passwords · ready · chat']}
                    onClick={() => setScreen('bchoose')}
                    recommended
                    statusDot={
                      banquet.serverStatus === 'online'
                        ? 'bg-emerald-500'
                        : banquet.serverStatus === 'error'
                        ? 'bg-red-500'
                        : 'bg-stone-400'
                    }
                  />
                  <ModeCard
                    icon={<Link2 size="1.4em" />}
                    title="Direct Connect"
                    tagline="Advanced peer-to-peer connection."
                    chips={['Host game', 'Join with code', 'No server needed']}
                    onClick={() => setScreen('dchoose')}
                  />
                </div>

                <button
                  onClick={() => setShowRules(true)}
                  className="w-full py-2.5 flex items-center justify-center gap-2 rounded-lg border-2 border-amber-600/50 bg-white/50 hover:bg-white/80 text-amber-900 font-heading font-bold transition-colors"
                  style={{ fontSize: 'var(--font-sm)' }}
                >
                  <BookOpen size="1.1em" /> Rules of the game &amp; example hands
                </button>
              </div>
            )}

            {/* =============== LOCAL =============== */}
            {screen === 'local' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-amber-900 font-serif font-bold mb-2" style={{ fontSize: 'var(--font-sm)' }}>
                    Number of AI opponents
                  </label>
                  <div className="flex gap-2">
                    {aiOptions.map((n) => (
                      <button
                        key={n}
                        onClick={() => setNumAI(n)}
                        className={cn(
                          'flex-1 py-2 rounded-lg font-serif font-bold border-2 transition-all',
                          numAI === n
                            ? 'bg-purple-700 text-white border-amber-400 scale-105'
                            : 'bg-white/50 text-amber-900 border-amber-300 hover:border-amber-500'
                        )}
                        style={{ fontSize: 'var(--font-base)' }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-amber-900/70 mt-2 italic" style={{ fontSize: 'var(--font-xs)' }}>
                    Total players: {numAI + 1} (you + {numAI} AI)
                    {numAI + 1 === maxSeats ? ' — a full table, 10 cards each' : ''}
                  </p>
                </div>
                <TimerToggle enabled={timerEnabled} onChange={onToggleTimer} seconds={timerSeconds} onSeconds={onTimerSeconds} />
                <div className="flex gap-2">
                  <BackBtn onClick={() => setScreen('menu')} />
                  <MenuBtn onClick={() => myName.trim() && onStartAI(numAI)} disabled={!myName.trim()} tone="purple">
                    Deal the Cards
                  </MenuBtn>
                </div>
              </div>
            )}

            {/* =============== DIRECT: choose =============== */}
            {screen === 'dchoose' && (
              <div className="space-y-3">
                <ScreenTitle icon={<Link2 size="1em" />} text="Direct Connect — peer to peer" />
                <MenuBtn
                  onClick={() => {
                    setScreen('dhost');
                    onHost();
                  }}
                  disabled={status === 'connecting'}
                  tone="gold"
                >
                  👑 Host a Game
                </MenuBtn>
                <MenuBtn onClick={() => setScreen('djoin')} tone="green">
                  🔗 Join with a Code
                </MenuBtn>
                {onTestNetwork && (
                  <NetworkTestBox result={networkTest ?? null} testing={testingNetwork} hasDedicatedTurn={hasDedicatedTurn} onRun={onTestNetwork} />
                )}
                <BackBtn onClick={() => setScreen('menu')} />
              </div>
            )}

            {/* =============== DIRECT: host =============== */}
            {screen === 'dhost' && (
              <div className="space-y-4">
                {status === 'hosting' ? (
                  <>
                    <div className="text-center p-4 bg-gradient-to-br from-purple-900 to-purple-950 rounded-lg border-2 border-amber-400">
                      <p className="text-amber-200 font-serif mb-1" style={{ fontSize: 'var(--font-sm)' }}>Room Code</p>
                      <p className="font-mono font-black text-amber-300 tracking-[0.35em]" style={{ fontSize: 'var(--font-xxl)' }}>
                        {roomCode}
                      </p>
                      <p className="text-amber-200/70 italic mt-1" style={{ fontSize: 'var(--font-xs)' }}>Share this code with friends</p>
                    </div>
                    <TimerToggle enabled={timerEnabled} onChange={onToggleTimer} seconds={timerSeconds} onSeconds={onTimerSeconds} />
                    <div>
                      <p className="text-amber-900 font-serif font-bold mb-2 flex items-center justify-between" style={{ fontSize: 'var(--font-sm)' }}>
                        <span>At the table ({seatCount}/{maxSeats})</span>
                        <span className="text-amber-700/80 italic font-normal" style={{ fontSize: 'var(--font-xs)' }}>live roster</span>
                      </p>
                      <div className="space-y-1 mb-2 max-h-52 overflow-y-auto pr-1">
                        {roster.map((r) => (
                          <RosterRow key={r.id} entry={r} onRemove={onRemoveAI} />
                        ))}
                        {roster.length === 0 && (
                          <div className="flex items-center gap-2 p-2 bg-white/60 rounded border border-amber-300">
                            <Crown className="text-amber-600" size="1.1em" />
                            <span className="font-serif text-amber-900 font-bold" style={{ fontSize: 'var(--font-sm)' }}>{myName} (You)</span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={onAddAI}
                        disabled={!canAddAI}
                        className="w-full mb-3 py-2 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-purple-400/60 bg-purple-100/60 hover:bg-purple-200/70 text-purple-900 font-serif font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ fontSize: 'var(--font-sm)' }}
                      >
                        <UserPlus size="1em" /> <Bot size="1em" /> Add an AI seat
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <BackBtn
                        onClick={() => {
                          setScreen('menu');
                        }}
                      />
                      <MenuBtn onClick={onStart} disabled={!canStart} tone="green">
                        {canStart ? `Begin (${seatCount} players)` : seatCount > maxSeats ? `Table is full — at most ${maxSeats}` : `Need at least ${minSeats} players`}
                      </MenuBtn>
                    </div>
                    {diagnostics && diagnostics.iceState !== 'unknown' && <IceDiagnosticsBox d={diagnostics} />}
                  </>
                ) : status === 'connecting' ? (
                  <p className="text-center py-8 text-amber-900 font-serif" style={{ fontSize: 'var(--font-base)' }}>Lighting the hall…</p>
                ) : status === 'error' ? (
                  <div className="py-2">
                    <p className="text-red-700 font-serif font-bold text-center" style={{ fontSize: 'var(--font-sm)' }}>Failed to create the room.</p>
                    <p className="text-red-700/90 font-serif italic text-center mb-3" style={{ fontSize: 'var(--font-xs)' }}>{error ?? 'Please try again.'}</p>
                    <MenuBtn onClick={onHost} tone="gold">Retry</MenuBtn>
                  </div>
                ) : null}
              </div>
            )}

            {/* =============== DIRECT: join =============== */}
            {screen === 'djoin' && (
              <div className="space-y-4">
                <ScreenTitle icon={<Link2 size="1em" />} text="Join with a room code" />
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
                  placeholder="ABCD"
                  className="w-full px-4 py-3 text-center font-mono tracking-widest rounded-lg border-2 border-amber-700/30 bg-white/80 focus:border-amber-600 focus:outline-none font-bold text-amber-900"
                  style={{ fontSize: 'var(--font-xl)' }}
                  maxLength={4}
                />
                <div className="flex gap-2">
                  <BackBtn onClick={() => setScreen('dchoose')} />
                  <MenuBtn
                    onClick={() => myName.trim() && joinCode.length === 4 && onJoin(joinCode)}
                    disabled={!myName.trim() || joinCode.length !== 4 || status === 'connecting'}
                    tone="green"
                  >
                    {status === 'connecting' ? 'Connecting…' : 'Take a Seat'}
                  </MenuBtn>
                </div>
                {status === 'connected' && (
                  <div className="p-4 bg-emerald-50/90 border-2 border-emerald-400 rounded-lg">
                    <p className="text-emerald-800 font-serif text-center" style={{ fontSize: 'var(--font-sm)' }}>
                      Connected! Waiting for the host to begin…
                    </p>
                    <p className="text-emerald-900/80 font-serif font-bold mt-3 mb-1" style={{ fontSize: 'var(--font-xs)' }}>
                      At the table ({roster.length || 1})
                    </p>
                    <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                      {roster.map((r) => (
                        <RosterRow key={r.id} entry={r} />
                      ))}
                      {roster.length === 0 && (
                        <p className="text-emerald-900/60 font-serif italic" style={{ fontSize: 'var(--font-xs)' }}>
                          Asking the herald for the guest list…
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {status === 'error' && (
                  <div className="p-4 bg-red-100 border border-red-400 rounded-lg">
                    <p className="text-red-800 font-serif font-bold text-center" style={{ fontSize: 'var(--font-sm)' }}>✖ Could not join the room.</p>
                    <p className="text-red-700 font-serif italic mt-1 text-center" style={{ fontSize: 'var(--font-xs)' }}>{error ?? 'Check the code and try again.'}</p>
                  </div>
                )}
                {diagnostics && (status === 'connecting' || status === 'error' || status === 'connected') && <IceDiagnosticsBox d={diagnostics} />}
              </div>
            )}

            {/* =============== BANQUET: choose =============== */}
            {screen === 'bchoose' && (
              <div className="space-y-3">
                <ScreenTitle icon={<Server size="1em" />} text="Banquet Browser — relay server" />
                <ServerStatusLine banquet={banquet} />
                <MenuBtn onClick={() => setScreen('bcreate')} tone="gold">
                  <span className="inline-flex items-center gap-2"><PlusCircle size="1em" /> Create a Lobby</span>
                </MenuBtn>
                <MenuBtn onClick={() => setScreen('browse')} tone="green">
                  <span className="inline-flex items-center gap-2"><ListChecks size="1em" /> Browse Active Lobbies</span>
                </MenuBtn>
                <BackBtn onClick={() => setScreen('menu')} />
              </div>
            )}

            {/* =============== BANQUET: create =============== */}
            {screen === 'bcreate' && (
              <div className="space-y-4">
                <ScreenTitle icon={<PlusCircle size="1em" />} text="Open a new banquet" />
                <ServerStatusLine banquet={banquet} />
                <Field label="Lobby name">
                  <input
                    value={lobbyName}
                    onChange={(e) => setLobbyName(e.target.value.slice(0, 40))}
                    placeholder={`${myName || 'Host'}'s banquet`}
                    className="w-full px-3 py-2 rounded-lg border-2 border-amber-700/30 bg-white/80 focus:border-amber-600 focus:outline-none font-serif text-amber-900"
                    style={{ fontSize: 'var(--font-sm)' }}
                  />
                </Field>
                <Field label="Password (optional)">
                  <input
                    value={lobbyPw}
                    onChange={(e) => setLobbyPw(e.target.value.slice(0, 24))}
                    type="text"
                    placeholder="leave empty for an open table"
                    className="w-full px-3 py-2 rounded-lg border-2 border-amber-700/30 bg-white/80 focus:border-amber-600 focus:outline-none font-serif text-amber-900"
                    style={{ fontSize: 'var(--font-sm)' }}
                  />
                </Field>
                <Field label={`Seats at the table (max ${maxSeats})`}>
                  <div className="flex gap-2 flex-wrap">
                    {Array.from({ length: maxSeats - minSeats + 1 }, (_, i) => minSeats + i).map((n) => (
                      <button
                        key={n}
                        onClick={() => setLobbyMax(n)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg font-serif font-bold border-2 transition-all',
                          lobbyMax === n
                            ? 'bg-purple-700 text-white border-amber-400 scale-105'
                            : 'bg-white/50 text-amber-900 border-amber-300 hover:border-amber-500'
                        )}
                        style={{ fontSize: 'var(--font-sm)' }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </Field>
                <TimerToggle enabled={timerEnabled} onChange={onToggleTimer} seconds={timerSeconds} onSeconds={onTimerSeconds} />
                <div className="flex gap-2">
                  <BackBtn onClick={() => setScreen('bchoose')} />
                  <MenuBtn
                    onClick={() =>
                      onBanquetCreate({
                        lobbyName: lobbyName.trim() || `${myName || 'Host'}'s banquet`,
                        password: lobbyPw.trim(),
                        maxPlayers: lobbyMax,
                      })
                    }
                    disabled={!myName.trim() || banquet.serverStatus === 'connecting'}
                    tone="gold"
                  >
                    Open the Doors
                  </MenuBtn>
                </div>
              </div>
            )}

            {/* =============== BANQUET: browse =============== */}
            {screen === 'browse' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <ScreenTitle icon={<ListChecks size="1em" />} text="Active banquets" />
                  <button
                    onClick={onBanquetRefresh}
                    disabled={banquet.listing}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-800 hover:bg-purple-700 disabled:opacity-50 text-amber-100 font-serif font-bold"
                    style={{ fontSize: 'var(--font-xs)' }}
                  >
                    <RefreshCw size="1em" className={banquet.listing ? 'animate-spin' : ''} /> Refresh
                  </button>
                </div>
                <ServerStatusLine banquet={banquet} />
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {banquet.lobbies.length === 0 && (
                    <p className="text-center text-amber-800/80 font-serif italic py-6" style={{ fontSize: 'var(--font-sm)' }}>
                      {banquet.serverStatus === 'online'
                        ? 'No open banquets right now — why not host one?'
                        : 'Waiting for the banquet server…'}
                    </p>
                  )}
                  {banquet.lobbies.map((l) => {
                    const full = l.players.length >= l.maxPlayers;
                    const askPw = pwFor === l.id;
                    return (
                      <div key={l.id} className="p-3 rounded-lg bg-white/60 border border-amber-300 slide-up">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-heading font-black text-purple-900 flex-1 min-w-0 truncate" style={{ fontSize: 'var(--font-base)' }}>
                            {l.name}
                          </span>
                          <span className="font-mono font-bold text-amber-800 bg-amber-200/70 border border-amber-400/60 rounded px-1.5" style={{ fontSize: 'var(--font-xs)' }}>
                            {l.id}
                          </span>
                          {l.passworded && <Lock size="1em" className="text-amber-700" aria-label="password protected" />}
                          {l.inGame && <Swords size="1em" className="text-red-700" aria-label="game running" />}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-amber-800 font-serif" style={{ fontSize: 'var(--font-xs)' }}>
                          <span className="inline-flex items-center gap-1"><Users size="1em" /> {l.players.length}/{l.maxPlayers}</span>
                          <span className="inline-flex items-center gap-1"><CircleCheck size="1em" /> {l.players.filter((p) => p.ready).length} ready</span>
                          <span className="italic">host {l.hostName}</span>
                        </div>
                        {askPw && (
                          <div className="flex gap-2 mt-2">
                            <input
                              value={pwInput}
                              onChange={(e) => setPwInput(e.target.value)}
                              placeholder="lobby password"
                              className="flex-1 px-2 py-1 rounded border border-amber-500 bg-white/90 font-serif text-amber-900"
                              style={{ fontSize: 'var(--font-xs)' }}
                            />
                            <button
                              onClick={() => {
                                onBanquetJoin(l.id, pwInput);
                                setPwFor(null);
                                setPwInput('');
                              }}
                              className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-serif font-bold"
                              style={{ fontSize: 'var(--font-xs)' }}
                            >
                              Enter
                            </button>
                          </div>
                        )}
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => (l.passworded ? setPwFor(l.id) : onBanquetJoin(l.id, ''))}
                            disabled={full || l.inGame}
                            className="px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-serif font-bold"
                            style={{ fontSize: 'var(--font-sm)' }}
                          >
                            {l.inGame ? 'In play' : full ? 'Full' : l.passworded ? 'Unlock & join' : 'Join'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <BackBtn onClick={() => setScreen('bchoose')} />
              </div>
            )}

            {/* =============== BANQUET: room =============== */}
            {screen === 'broom' && banquet.lobby && (
              <div className="space-y-3">
                <div className="text-center p-3 bg-gradient-to-br from-purple-900 to-purple-950 rounded-lg border-2 border-amber-400">
                  <p className="text-amber-200 font-serif font-bold truncate" style={{ fontSize: 'var(--font-base)' }}>
                    {banquet.lobby.name}
                  </p>
                  <p className="font-mono font-black text-amber-300 tracking-[0.3em]" style={{ fontSize: 'var(--font-xl)' }}>
                    {banquet.lobby.id}
                  </p>
                  <p className="text-amber-200/70 italic" style={{ fontSize: 'var(--font-tiny)' }}>
                    {banquet.lobby.passworded ? '🔒 password protected · ' : ''}
                    {banquet.lobby.players.length}/{banquet.lobby.maxPlayers} seats
                  </p>
                </div>

                {/* players + ready */}
                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {banquet.lobby.players.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 p-2 bg-white/60 rounded border border-amber-300 slide-up">
                      {p.isHost ? (
                        <Crown className="text-amber-600 shrink-0" size="1.15em" />
                      ) : p.isAI ? (
                        <Bot className="text-purple-700 shrink-0" size="1.15em" />
                      ) : (
                        <User className="text-emerald-700 shrink-0" size="1.15em" />
                      )}
                      <span className="font-serif text-amber-900 font-bold flex-1 truncate text-left" style={{ fontSize: 'var(--font-sm)' }}>
                        {p.name}
                        {p.id === banquet.myId ? ' (you)' : ''}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-serif',
                          p.ready
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-400'
                            : 'bg-stone-200 text-stone-700 border-stone-400'
                        )}
                        style={{ fontSize: 'var(--font-tiny)' }}
                      >
                        {p.ready ? <CircleCheck size="1em" /> : <CircleDashed size="1em" />}
                        {p.ready ? 'ready' : 'not ready'}
                      </span>
                      {p.isAI && banquetIsHost && (
                        <button onClick={() => onBanquetRemoveAI(p.id)} className="text-red-700 hover:text-red-500" aria-label={`Remove ${p.name}`}>
                          <X size="1em" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* controls */}
                <div className="flex gap-2 flex-wrap">
                  {!banquetIsHost && (
                    <MenuBtn onClick={() => onBanquetReady(!iAmReady)} tone={iAmReady ? 'green' : 'gold'}>
                      <span className="inline-flex items-center gap-2">
                        {iAmReady ? <CircleCheck size="1em" /> : <CircleDashed size="1em" />}
                        {iAmReady ? 'Ready — waiting for host' : 'I am ready'}
                      </span>
                    </MenuBtn>
                  )}
                  {banquetIsHost && (
                    <>
                      <button
                        onClick={onBanquetAddAI}
                        disabled={banquet.lobby.players.length >= banquet.lobby.maxPlayers}
                        className="flex-1 py-2 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-purple-400/60 bg-purple-100/60 hover:bg-purple-200/70 text-purple-900 font-serif font-bold disabled:opacity-40"
                        style={{ fontSize: 'var(--font-sm)' }}
                      >
                        <UserPlus size="1em" /> <Bot size="1em" /> Add AI
                      </button>
                      <MenuBtn onClick={onBanquetStart} disabled={!canStartBanquet} tone="green">
                        <span className="inline-flex items-center gap-2">
                          <Play size="1em" />
                          {canStartBanquet
                            ? `Begin (${banquet.lobby.players.length} players)`
                            : banquet.lobby.players.length < minSeats
                            ? `Need ${minSeats}+ players`
                            : 'Waiting for ready…'}
                        </span>
                      </MenuBtn>
                    </>
                  )}
                  <button
                    onClick={onBanquetLeave}
                    className="px-3 py-2 rounded-lg bg-red-900/80 hover:bg-red-800 text-amber-100 font-serif font-bold inline-flex items-center gap-1.5"
                    style={{ fontSize: 'var(--font-sm)' }}
                  >
                    <LogOut size="1em" /> Leave
                  </button>
                </div>
                {banquetIsHost && (
                  <TimerToggle enabled={timerEnabled} onChange={onToggleTimer} seconds={timerSeconds} onSeconds={onTimerSeconds} />
                )}

                {/* lobby chat */}
                <div className="rounded-lg border border-amber-400/60 bg-black/10 overflow-hidden">
                  <p className="px-3 py-1.5 bg-purple-900/90 text-amber-200 font-heading font-bold" style={{ fontSize: 'var(--font-xs)' }}>
                    Table talk
                  </p>
                  <div className="max-h-36 overflow-y-auto px-3 py-2 space-y-1">
                    {banquetChat.length === 0 && (
                      <p className="text-amber-800/60 font-serif italic" style={{ fontSize: 'var(--font-xs)' }}>
                        Say hello to the table…
                      </p>
                    )}
                    {banquetChat.map((m) => (
                      <p key={m.id} className={cn('font-serif leading-snug', m.system && 'text-center italic text-amber-700/80')} style={{ fontSize: 'var(--font-xs)' }}>
                        {m.system ? `— ${m.text} —` : (
                          <>
                            <span className="font-bold text-purple-900">{m.name}: </span>
                            <span className="text-amber-950">{m.text}</span>
                          </>
                        )}
                      </p>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <form
                    className="flex gap-1.5 px-2 py-1.5 bg-white/40 border-t border-amber-400/40"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (chatDraft.trim()) {
                        onBanquetChat(chatDraft.trim());
                        setChatDraft('');
                      }
                    }}
                  >
                    <input
                      value={chatDraft}
                      onChange={(e) => setChatDraft(e.target.value.slice(0, 200))}
                      placeholder="Message the lobby…"
                      className="flex-1 min-w-0 px-2 py-1 rounded border border-amber-500/60 bg-white/80 font-serif text-amber-900 focus:outline-none focus:border-amber-600"
                      style={{ fontSize: 'var(--font-xs)' }}
                    />
                    <button type="submit" disabled={!chatDraft.trim()} className="px-2 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-purple-950" aria-label="Send lobby message">
                      <Send size="1rem" />
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ScreenTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <p className="font-heading font-black text-purple-900 italic flex items-center gap-2" style={{ fontSize: 'var(--font-base)' }}>
      {icon} {text}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-amber-900 font-serif font-bold mb-1" style={{ fontSize: 'var(--font-xs)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="py-2 px-4 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-lg font-serif" style={{ fontSize: 'var(--font-sm)' }}>
      Back
    </button>
  );
}

function ServerStatusLine({ banquet }: { banquet: BanquetView }) {
  const dot =
    banquet.serverStatus === 'online' ? 'bg-emerald-500' : banquet.serverStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : banquet.serverStatus === 'error' ? 'bg-red-500' : 'bg-stone-400';
  const label =
    banquet.serverStatus === 'online'
      ? `server reachable · ${banquet.serverUrl}`
      : banquet.serverStatus === 'connecting'
      ? 'contacting the banquet server…'
      : banquet.serverStatus === 'error'
      ? (banquet.error ?? 'server unreachable')
      : 'server not contacted yet';
  return (
    <p className="flex items-center gap-2 text-amber-800 font-serif italic" style={{ fontSize: 'var(--font-tiny)' }}>
      <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', dot)} />
      <span className="truncate">{label}</span>
    </p>
  );
}

function ModeCard({
  icon,
  title,
  tagline,
  chips,
  onClick,
  statusDot,
  recommended,
}: {
  icon: React.ReactNode;
  title: string;
  tagline: string;
  chips: string[];
  onClick: () => void;
  statusDot?: string;
  recommended?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative text-left p-4 rounded-xl border-2 bg-white/50 hover:bg-white/80 hover:-translate-y-0.5 hover:shadow-lg transition-all',
        recommended
          ? 'border-amber-500 shadow-[0_0_0_3px_rgba(212,175,55,0.35),0_10px_30px_rgba(0,0,0,0.25)] hover:border-amber-400'
          : 'border-amber-600/40 hover:border-amber-500'
      )}
    >
      {recommended && (
        <span
          className="absolute -top-3 left-3 px-2.5 py-0.5 rounded-full font-heading font-black tracking-widest text-purple-950 border-2 border-amber-200 shadow-md"
          style={{ fontSize: 'var(--font-tiny)', background: 'linear-gradient(180deg,#ffe9a8,#d4af37)' }}
        >
          ★ RECOMMENDED
        </span>
      )}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-purple-800 group-hover:scale-110 transition-transform">{icon}</span>
        <span className="font-heading font-black text-purple-900 relative" style={{ fontSize: 'var(--font-base)' }}>
          {title}
          {statusDot && <span className={cn('absolute -right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full', statusDot)} />}
        </span>
      </div>
      <p className="font-serif italic text-amber-800/90 mb-2" style={{ fontSize: 'var(--font-xs)' }}>
        {tagline}
      </p>
      <div className="flex flex-wrap gap-1">
        {chips.map((c) => (
          <span key={c} className="px-1.5 py-0.5 rounded-full bg-purple-900/10 border border-purple-900/20 text-purple-900 font-serif" style={{ fontSize: 'var(--font-tiny)' }}>
            {c}
          </span>
        ))}
      </div>
    </button>
  );
}

const TIMER_CHOICES = [15, 30, 45, 60, 90, 120];

function TimerToggle({
  enabled,
  onChange,
  seconds,
  onSeconds,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  seconds: number;
  onSeconds: (s: number) => void;
}) {
  return (
    <div className="p-3 rounded-lg bg-white/55 border border-amber-300 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif font-bold text-amber-900 flex items-center gap-1.5" style={{ fontSize: 'var(--font-sm)' }}>
            <Hourglass size="1em" /> Turn timer
            <span
              className={cn(
                'ml-1 px-2 py-0.5 rounded-full border font-heading',
                enabled ? 'bg-emerald-100 text-emerald-800 border-emerald-400' : 'bg-stone-200 text-stone-700 border-stone-400'
              )}
              style={{ fontSize: 'var(--font-tiny)' }}
            >
              {enabled ? `${seconds} s` : 'OFF'}
            </span>
          </p>
          <p className="font-serif italic text-amber-800/80 leading-snug" style={{ fontSize: 'var(--font-xs)' }}>
            {enabled
              ? 'An hourglass counts down each turn — when the sand runs out, that player passes automatically.'
              : 'No time limit — every player may ponder as long as they like.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onChange(!enabled)}
          className={cn(
            'relative shrink-0 rounded-full border-2 transition-colors',
            enabled ? 'bg-emerald-600 border-emerald-300' : 'bg-stone-400 border-stone-300'
          )}
          style={{ width: '3.6em', height: '2em', fontSize: 'var(--font-sm)' }}
          title={enabled ? 'Turn the timer off' : 'Turn the timer on'}
        >
          <span
            className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-all"
            style={{ width: '1.45em', height: '1.45em', left: enabled ? 'calc(100% - 1.65em)' : '0.2em' }}
          />
        </button>
      </div>
      {enabled && (
        <div className="flex gap-1.5 flex-wrap">
          {TIMER_CHOICES.map((s) => (
            <button
              key={s}
              onClick={() => onSeconds(s)}
              className={cn(
                'px-2.5 py-1 rounded-lg font-serif font-bold border-2 transition-all',
                seconds === s
                  ? 'bg-purple-700 text-white border-amber-400 scale-105'
                  : 'bg-white/60 text-amber-900 border-amber-300 hover:border-amber-500'
              )}
              style={{ fontSize: 'var(--font-xs)' }}
            >
              {s}s
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RosterRow({ entry, onRemove }: { entry: RosterEntry; onRemove?: (id: string) => void }) {
  const icon =
    entry.kind === 'host' ? (
      <Crown className="text-amber-600 shrink-0" size="1.15em" />
    ) : entry.kind === 'ai' ? (
      <Bot className="text-purple-700 shrink-0" size="1.15em" />
    ) : (
      <User className="text-emerald-700 shrink-0" size="1.15em" />
    );
  const tag = entry.kind === 'host' ? 'host' : entry.kind === 'ai' ? 'court AI' : 'guest';
  return (
    <div className="flex items-center gap-2 p-2 bg-white/60 rounded border border-amber-300 slide-up">
      {icon}
      <span className="font-serif text-amber-900 font-bold flex-1 truncate text-left" style={{ fontSize: 'var(--font-sm)' }}>
        {entry.name}
      </span>
      <span className="font-serif italic text-amber-700/80 shrink-0" style={{ fontSize: 'var(--font-xs)' }}>
        {tag}
      </span>
      {entry.kind === 'ai' && onRemove && (
        <button onClick={() => onRemove(entry.id)} className="shrink-0 text-red-700 hover:text-red-500 transition-colors" aria-label={`Remove ${entry.name}`} title="Remove this AI seat">
          <X size="1em" />
        </button>
      )}
    </div>
  );
}

function MenuBtn({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: 'purple' | 'gold' | 'green';
}) {
  const tones = {
    purple: 'from-purple-700 to-purple-950 border-amber-400/50 text-amber-100',
    gold: 'from-amber-500 to-amber-800 border-purple-300/40 text-white',
    green: 'from-emerald-700 to-emerald-950 border-amber-400/40 text-amber-100',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-3 bg-gradient-to-r ${tones[tone]} font-heading font-bold rounded-lg shadow-lg border-2 transition-all hover:brightness-110 hover:-translate-y-0.5 hover:shadow-amber-500/20 disabled:opacity-50 disabled:hover:translate-y-0`}
      style={{ fontSize: 'var(--font-base)' }}
    >
      {children}
    </button>
  );
}
