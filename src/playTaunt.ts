let sfxVolume = 0.7;

export function setSfxVolume(volume: number) {
  sfxVolume = Math.max(0, Math.min(1, volume));
}

export function playTaunt(code: string) {
  if (document.hidden) return;

  const audio = new Audio(`/taunts/${code}.mp3`);

  audio.volume = sfxVolume;

  audio.play().catch(() => {
    console.warn('[TAUNT] could not play', code);
  });
}