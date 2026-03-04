/**
 * generate-sounds.js — Generate default theme MP3 files using ffmpeg
 *
 * Run: node scripts/generate-sounds.js
 * Requires: ffmpeg on PATH
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEST = path.join(__dirname, '..', 'assets', 'themes', 'default');

// Each sound: [filename, ffmpeg filter_complex expression]
const sounds = [
  [
    'session-start.mp3',
    // Rising tone: 400Hz → 800Hz over 0.3s
    'sine=frequency=400:duration=0.3,asetrate=44100*2,aresample=44100,afade=t=in:d=0.05,afade=t=out:st=0.2:d=0.1',
  ],
  [
    'session-end.mp3',
    // Falling tone: 600Hz → 300Hz over 0.3s
    'sine=frequency=600:duration=0.3,asetrate=44100/2,aresample=44100,afade=t=in:d=0.05,afade=t=out:st=0.2:d=0.1',
  ],
  [
    'task-completed.mp3',
    // Two-note chime: C5 (523Hz) then E5 (659Hz)
    'sine=frequency=523:duration=0.2,afade=t=out:st=0.1:d=0.1[a];sine=frequency=659:duration=0.3,adelay=200|200,afade=t=out:st=0.15:d=0.15[b];[a][b]amix=inputs=2:duration=longest',
  ],
  [
    'notification.mp3',
    // Short ping at 880Hz (A5)
    'sine=frequency=880:duration=0.15,afade=t=in:d=0.02,afade=t=out:st=0.05:d=0.1',
  ],
];

fs.mkdirSync(DEST, { recursive: true });

for (const [filename, filter] of sounds) {
  const dest = path.join(DEST, filename);
  console.log(`Generating ${filename}...`);
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', filter,
    '-codec:a', 'libmp3lame',
    '-b:a', '128k',
    dest,
  ], { stdio: 'pipe' });
}

console.log('Done. Files written to', DEST);
