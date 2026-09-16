let currentMusic: HTMLAudioElement | null = null;

const GAME_TRACKS = [
  '/music/game.mp3',
  '/music/game2.mp3',
  '/music/game3.mp3',
  '/music/game4.mp3',
  '/music/game5.mp3',
];

let currentTrackIndex = 0;

export function playMenuMusic() {
  stopMusic();

  currentMusic = new Audio('/music/menu.mp3');
  currentMusic.loop = true;
  currentMusic.volume = 0.20;

  currentMusic.play().catch(() => {});
}

export function playGameMusic() {
  stopMusic();

  currentTrackIndex = Math.floor(
    Math.random() * GAME_TRACKS.length
  );

  playCurrentTrack();
}

function playCurrentTrack() {
  currentMusic = new Audio(GAME_TRACKS[currentTrackIndex]);

  currentMusic.volume = 0.08;

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
}