let currentMusic: HTMLAudioElement | null = null;
let currentMode: 'menu' | 'game' | null = null;
let audioUnlocked = false;

export function unlockAudio() {
  audioUnlocked = true;
}

export function canPlayAudio() {
  return audioUnlocked;
}

const GAME_TRACKS = [
  '/music/game.mp3',
  '/music/game2.mp3',
  '/music/game3.mp3',
  '/music/game4.mp3',
  '/music/game5.mp3',
];

let currentTrackIndex = 0;

export function playMenuMusic() {
    if (!audioUnlocked) return;
  if (currentMode === 'menu') return;
  currentMode = 'menu';
    stopMusic();

  currentMusic = new Audio('/music/menu.mp3');
  currentMusic.loop = true;
  currentMusic.volume = 0.10;

  currentMusic.play().catch(() => {});
}

export function playGameMusic() {
  if (!audioUnlocked) return;
  if (currentMode === 'game') return; 
  currentMode = 'game';
  stopMusic();

  currentTrackIndex = Math.floor(
    Math.random() * GAME_TRACKS.length
  );

  playCurrentTrack();
}

function playCurrentTrack() {
  currentMusic = new Audio(GAME_TRACKS[currentTrackIndex]);

  currentMusic.volume = 0.05;

  currentMusic.addEventListener('ended', () => {
    currentTrackIndex =
      (currentTrackIndex + 1) % GAME_TRACKS.length;

    playCurrentTrack();
  });

  currentMusic.play().catch(() => {});
}

export function stopMusic() {
  if (currentMusic) {
    currentMusic.pause();
    currentMusic.currentTime = 0;
  }

  currentMusic = null;
  currentMode = null;
}

export function pauseMusic() {
  currentMusic?.pause();
}

export function resumeMusic() {
  if (!audioUnlocked) return;

  currentMusic?.play().catch(() => {});
}