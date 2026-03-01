/**
 * Project color palette — deterministic accent colors per project name.
 */

const PALETTE = [
  { name: 'red',    hue: 0,   s: 70, l: 55 },
  { name: 'orange', hue: 25,  s: 80, l: 55 },
  { name: 'amber',  hue: 45,  s: 80, l: 50 },
  { name: 'lime',   hue: 85,  s: 60, l: 45 },
  { name: 'green',  hue: 140, s: 60, l: 45 },
  { name: 'teal',   hue: 175, s: 60, l: 45 },
  { name: 'cyan',   hue: 195, s: 70, l: 50 },
  { name: 'blue',   hue: 215, s: 70, l: 55 },
  { name: 'indigo', hue: 245, s: 60, l: 60 },
  { name: 'purple', hue: 270, s: 60, l: 60 },
  { name: 'pink',   hue: 330, s: 65, l: 55 },
  { name: 'rose',   hue: 350, s: 70, l: 55 },
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getProjectColor(projectName) {
  const index = hashString(projectName) % PALETTE.length;
  const { hue, s, l, name } = PALETTE[index];
  return { index, hue, s, l, name };
}
