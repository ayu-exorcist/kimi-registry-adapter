const modifierLabels = (): { alt: string; ctrl: string; enter: string } => {
  return process.platform === 'darwin'
    ? { alt: 'option', ctrl: 'control', enter: 'enter' }
    : { alt: 'alt', ctrl: 'ctrl', enter: 'enter' };
};

export const formatShortcutHint = (hint: string): string => {
  const labels = modifierLabels();
  return hint
    .replaceAll(/\balt\+/gu, `${labels.alt}+`)
    .replaceAll(/\bctrl\+/gu, `${labels.ctrl}+`)
    .replaceAll(/\benter\b/gu, labels.enter);
};
