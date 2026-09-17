export function playTaunt(code: string) {
  if (document.hidden) return;

  const audio = new Audio(`/taunts/${code}.mp3`);

  audio.play().catch(() => {
    console.warn('[TAUNT] could not play', code);
  });
}