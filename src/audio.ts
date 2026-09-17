let currentMusic: HTMLAudioElement | null = null;
let currentMode: 'menu' | 'game' | null = null;
let audioUnlocked = false;
let musicVolume = 0.7;

export function unlockAudio() {
  audioUnlocked = true;
}

export function canPlayAudio() {
  return audioUnlocked;
}

export function setMusicVolume(volume: number) {
  musicVolume = Math.max(0, Math.min(1, volume));

  if (currentMusic) {
    currentMusic.volume = musicVolume;
  }
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

  if (currentMode === 'menu' && currentMusic) {
    currentMusic.play().catch(() => {});
    return;
  }

  stopMusic();

  currentMode = 'menu';

  currentMusic = new Audio('/music/menu.mp3');
  currentMusic.loop = true;
  currentMusic.volume = musicVolume;

  currentMusic.play().catch(() => {});
}

export function playGameMusic() {
  if (!audioUnlocked) return;

  if (currentMode === 'game' && currentMusic) {
    currentMusic.play().catch(() => {});
    return;
  }

  stopMusic();

  currentMode = 'game';

  currentTrackIndex = Math.floor(
    Math.random() * GAME_TRACKS.length
  );

  playCurrentTrack();
}

function playCurrentTrack() {
  currentMusic = new Audio(
    GAME_TRACKS[currentTrackIndex]
  );

  currentMusic.volume = musicVolume;

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