/**
 * Audio Trim UI — WaveSurfer-based waveform editor for trimming sound files
 */

import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { getSelectedProjectPath } from './sidebar.js';
import { loadSoundTheme } from './terminal.js';

const api = window.electron_api;

/**
 * Open a Voice Memos-style trim panel on the right side of settings.
 * Uses Web Audio API for waveform + OfflineAudioContext for export.
 */
export function openTrimUI(eventName, audioUrl, parentEl, scope, initTrimStart, initTrimEnd, onSave) {
  const settingsContent = parentEl.closest('.settings-content');
  if (!settingsContent) return;

  // Remove any existing trim panel
  const existingTrim = settingsContent.querySelector('.trim-ui');
  if (existingTrim) {
    existingTrim.querySelector('.trim-ui-close')?.click();
  }

  // Wrap existing content if not already wrapped
  let sectionWrap = settingsContent.querySelector('.settings-section-wrap');
  if (!sectionWrap) {
    sectionWrap = document.createElement('div');
    sectionWrap.className = 'settings-section-wrap';
    while (settingsContent.firstChild) {
      sectionWrap.appendChild(settingsContent.firstChild);
    }
    settingsContent.appendChild(sectionWrap);
  }
  settingsContent.classList.add('has-trim-panel');

  // ── Build trim panel ──
  const trimPanel = document.createElement('div');
  trimPanel.className = 'trim-ui';
  trimPanel.dataset.testid = `trim-ui-${eventName}`;

  let ws = null; // wavesurfer instance
  let wsRegions = null; // regions plugin
  let trimRegion = null;

  function closeTrimPanel() {
    if (ws) { ws.destroy(); ws = null; }
    trimPanel.remove();
    settingsContent.classList.remove('has-trim-panel');
    const wrap = settingsContent.querySelector('.settings-section-wrap');
    if (wrap) {
      while (wrap.firstChild) settingsContent.appendChild(wrap.firstChild);
      wrap.remove();
    }
  }

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'trim-ui-title';
  const titleSpan = document.createElement('span');
  titleSpan.textContent = `Trim: ${eventName}`;
  titleBar.appendChild(titleSpan);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'trim-ui-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', closeTrimPanel);
  titleBar.appendChild(closeBtn);
  trimPanel.appendChild(titleBar);

  // Body
  const body = document.createElement('div');
  body.className = 'trim-ui-body';

  // Waveform container (wavesurfer renders into this)
  const waveWrap = document.createElement('div');
  waveWrap.className = 'trim-ui-waveform-wrap';
  const waveContainer = document.createElement('div');
  waveContainer.className = 'trim-ui-wave-container';
  waveWrap.appendChild(waveContainer);
  body.appendChild(waveWrap);

  // Controls row
  const controls = document.createElement('div');
  controls.className = 'trim-ui-controls';

  const playBtn = document.createElement('button');
  playBtn.className = 'trim-ui-play-btn';
  playBtn.dataset.testid = 'trim-play-btn';
  playBtn.innerHTML = '&#9654;'; // play triangle
  controls.appendChild(playBtn);

  const timeDisplay = document.createElement('div');
  timeDisplay.className = 'trim-ui-time';
  controls.appendChild(timeDisplay);

  body.appendChild(controls);

  // Actions
  const btnRow = document.createElement('div');
  btnRow.className = 'trim-ui-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'settings-save-btn';
  saveBtn.textContent = 'Save Trimmed';
  btnRow.appendChild(saveBtn);
  body.appendChild(btnRow);

  trimPanel.appendChild(body);
  settingsContent.appendChild(trimPanel);

  // ── Helper ──
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }

  function updateTimeDisplay() {
    if (!trimRegion) return;
    timeDisplay.textContent = `${formatTime(trimRegion.start)} \u2014 ${formatTime(trimRegion.end)}`;
  }

  // ── Init wavesurfer ──
  wsRegions = RegionsPlugin.create();

  ws = WaveSurfer.create({
    container: waveContainer,
    height: 100,
    waveColor: 'rgba(255,255,255,0.25)',
    progressColor: 'rgba(232,167,53,0.6)',
    cursorColor: '#fff',
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 1,
    backend: 'WebAudio',
    normalize: true,
    plugins: [wsRegions],
  });

  ws.load(audioUrl);

  ws.on('ready', () => {
    const duration = ws.getDuration();
    trimRegion = wsRegions.addRegion({
      start: initTrimStart != null ? initTrimStart : 0,
      end: initTrimEnd != null ? initTrimEnd : duration,
      color: 'rgba(232, 167, 53, 0.15)',
      drag: false,
      resize: true,
    });
    updateTimeDisplay();
  });

  // Update time display when region is resized
  wsRegions.on('region-update', (region) => {
    if (region === trimRegion) updateTimeDisplay();
  });

  // ── Play/Pause — plays only the trimmed region ──
  playBtn.addEventListener('click', () => {
    if (!ws || !trimRegion) return;
    if (ws.isPlaying()) {
      ws.pause();
    } else {
      trimRegion.play();
    }
  });

  ws.on('play', () => { playBtn.innerHTML = '&#9646;&#9646;'; });
  ws.on('pause', () => { playBtn.innerHTML = '&#9654;'; });
  ws.on('finish', () => { playBtn.innerHTML = '&#9654;'; });

  // Stop at region end during playback
  ws.on('timeupdate', (currentTime) => {
    if (trimRegion && ws.isPlaying() && currentTime >= trimRegion.end) {
      ws.pause();
    }
  });

  // ── Save trim metadata ──
  saveBtn.addEventListener('click', async () => {
    if (!trimRegion || !api.soundThemes) return;
    const start = trimRegion.start;
    const end = trimRegion.end;
    const result = await api.soundThemes.saveTrim(eventName, start, end, getSelectedProjectPath());
    await loadSoundTheme();
    closeTrimPanel();
    if (onSave) onSave(result);
  });

  // ── Cleanup when panel is removed externally (e.g. section switch) ──
  const observer = new MutationObserver(() => {
    if (!trimPanel.isConnected) {
      if (ws) { ws.destroy(); ws = null; }
      observer.disconnect();
    }
  });
  observer.observe(settingsContent, { childList: true, subtree: true });
}
