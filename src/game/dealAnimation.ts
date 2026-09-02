export function dealAnimationFrames(): number[] {
  // Slight delay for animation sequencing (not a true CSS animation, handled in App via setTimeout)
  return [200, 350, 550, 800, 1050, 1350];
}
