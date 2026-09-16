
export function playTaunt(code: string) {
  const audio = new Audio(`/taunts/${code}.mp3`);

  audio.play().catch(() => {
    console.warn('[TAUNT] could not play', code);
  });
}