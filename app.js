// ── Constants ───────────────────────────────────────────────
const STORAGE_KEYS = {
  apiKey: 'whisper_api_key',
  notes: 'voice_notes',
  transcriptionMode: 'transcription_mode',
};
const NOTE_HISTORY_CAP = 50;
const NOTE_PREVIEW_CHARS = 200;
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const TRANSCRIPTION_MODEL = 'whisper-1';
const DEFAULT_TRANSCRIPTION_MODE = 'mixed';
const TRANSCRIPTION_MODES = {
  mixed: {
    label: 'AUTO',
    language: '',
    prompt: 'This voice note may contain English and Cantonese. Transcribe each language as spoken. Use Traditional Chinese for Cantonese. Do not rewrite Cantonese as Mandarin written Chinese. Do not translate Cantonese into English. Preserve English words, product names, and code.',
  },
  cantonese: {
    label: 'CANTONESE',
    language: 'zh',
    prompt: 'The speaker is speaking Cantonese, also called Yue Chinese. Transcribe as written Cantonese using Traditional Chinese characters. Preserve Cantonese vocabulary, particles, colloquial phrasing, tone, emphasis, and main points. Do not rewrite as Mandarin written Chinese. Do not translate Cantonese into English. Preserve any English words, product names, and code.',
  },
  english: {
    label: 'ENG',
    language: 'en',
    prompt: 'The speaker is speaking English. Transcribe accurately and preserve product names, technical terms, and code.',
  },
  mandarin: {
    label: 'MANDARIN',
    language: 'zh',
    prompt: 'The speaker is speaking Mandarin Chinese. Transcribe accurately in written Chinese and preserve any English words, product names, and code.',
  },
};

// ── State ───────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let isProcessing = false;
let startTime = null;
let timerInterval = null;
let notes = [];
let wakeLock = null;
let saveStatusTimer = null;
let activeRecordingMode = null;

// ── DOM refs ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const recordBtn = $('recordBtn');
const screwBtn = $('screwBtn');
const statusEl = $('status');
const lcdTimeEl = $('lcdTime');
const lcdDotEl = $('lcdDot');
const modeLabelEl = $('modeLabel');
const lcdCountEl = $('lcdCount');
const tapeStripEl = $('tapeStrip');
const recLedEl = $('recLed');
const recentSection = $('recentSection');
const recentList = $('recentList');
const settingsModal = $('settingsModal');
const apiKeyInput = $('apiKeyInput');
const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
const settingsCancelBtn = $('settingsCancelBtn');
const settingsSaveBtn = $('settingsSaveBtn');
const noteModal = $('noteModal');
const noteModalDate = $('noteModalDate');
const noteModalBody = $('noteModalBody');
const noteCloseBtn = $('noteCloseBtn');
const noteDownloadBtn = $('noteDownloadBtn');
const noteCopyBtn = $('noteCopyBtn');

// ── Storage helpers ─────────────────────────────────────────
function getApiKey() {
  return localStorage.getItem(STORAGE_KEYS.apiKey) || '';
}

function getTranscriptionMode() {
  const mode = localStorage.getItem(STORAGE_KEYS.transcriptionMode) || DEFAULT_TRANSCRIPTION_MODE;
  return TRANSCRIPTION_MODES[mode] ? mode : DEFAULT_TRANSCRIPTION_MODE;
}

function setTranscriptionMode(mode) {
  const nextMode = TRANSCRIPTION_MODES[mode] ? mode : DEFAULT_TRANSCRIPTION_MODE;
  localStorage.setItem(STORAGE_KEYS.transcriptionMode, nextMode);
  renderTranscriptionMode();
}

function loadNotes() {
  try {
    notes = JSON.parse(localStorage.getItem(STORAGE_KEYS.notes) || '[]');
  } catch (e) {
    notes = [];
  }
  renderNotes();
  updateCount();
}

function saveNoteToHistory(date, transcript) {
  notes.unshift({
    date,
    text: transcript,
    preview: transcript.substring(0, NOTE_PREVIEW_CHARS),
  });
  if (notes.length > NOTE_HISTORY_CAP) {
    notes = notes.slice(0, NOTE_HISTORY_CAP);
  }
  localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notes));
  renderNotes();
  updateCount();
}

function updateCount() {
  const n = notes.length;
  lcdCountEl.textContent = `${n} NOTE${n === 1 ? '' : 'S'}`;
}

// ── Tape library rendering ──────────────────────────────────
function renderNotes() {
  if (notes.length === 0) {
    recentSection.hidden = true;
    return;
  }
  recentSection.hidden = false;
  recentList.replaceChildren(...notes.map((n, i) => buildNoteCard(n, i)));
}

function buildNoteCard(note, index) {
  const item = document.createElement('div');
  item.className = 'note-item';
  item.dataset.idx = String(index);

  const date = document.createElement('div');
  date.className = 'note-date';
  date.textContent = new Date(note.date).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const preview = document.createElement('div');
  preview.className = 'note-preview';
  preview.textContent = note.preview || '';

  item.append(date, preview);
  item.addEventListener('click', () => openNote(index));
  return item;
}

// ── Transcript modal ────────────────────────────────────────
function openNote(i) {
  const n = notes[i];
  if (!n) return;
  const full = n.text || n.preview || '';
  noteModalDate.textContent = new Date(n.date).toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  noteModalBody.textContent = full;
  noteModal.classList.add('open');
  noteModal.dataset.idx = String(i);
}

function closeNote() {
  noteModal.classList.remove('open');
}

function copyNote() {
  const text = noteModalBody.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const label = noteCopyBtn.querySelector('.lbl');
    const glyph = noteCopyBtn.querySelector('.glyph');
    const origLbl = label.textContent;
    const origGlyph = glyph.textContent;
    label.textContent = 'Copied';
    glyph.textContent = '✓';
    setTimeout(() => {
      label.textContent = origLbl;
      glyph.textContent = origGlyph;
    }, 1500);
  });
}

function redownloadNote() {
  const i = parseInt(noteModal.dataset.idx, 10);
  const n = notes[i];
  if (!n) return;
  const text = n.text || n.preview || '';
  void saveMarkdown(text, new Date(n.date), { preferShare: true });
}

// ── Settings ────────────────────────────────────────────────
function openSettings() {
  apiKeyInput.value = getApiKey();
  settingsModal.classList.add('open');
}

function closeSettings() {
  settingsModal.classList.remove('open');
}

function saveSettings() {
  const key = apiKeyInput.value.trim();
  localStorage.setItem(STORAGE_KEYS.apiKey, key);
  closeSettings();
  setStatus('SAVED');
  setTimeout(() => {
    if (!isRecording && !isProcessing) setStatus('READY');
  }, 1500);
}

// ── LCD / status helpers ────────────────────────────────────
function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = 'lcd-mode' + (type ? ' ' + type : '');
}

function setRecLed(on) {
  recLedEl.classList.toggle('on', on);
}

function setRecordButtonState(state) {
  const label = recordBtn.querySelector('.rec-label');
  recordBtn.classList.toggle('recording', state === 'recording');
  recordBtn.classList.toggle('processing', state === 'processing');
  recordBtn.disabled = state === 'processing';
  recordBtn.setAttribute('aria-label', state === 'recording' ? 'Stop recording' : 'Record');
  if (label) label.textContent = state === 'recording' ? 'STOP' : 'REC';
  modeButtons.forEach((btn) => {
    btn.disabled = state !== 'ready';
  });
}

function renderTranscriptionMode() {
  const mode = getTranscriptionMode();
  const modeConfig = TRANSCRIPTION_MODES[mode];
  modeLabelEl.textContent = modeConfig.label;
  modeButtons.forEach((btn) => {
    const selected = btn.dataset.mode === mode;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-checked', selected ? 'true' : 'false');
  });
}

function isIOSLike() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function startTimer() {
  startTime = Date.now();
  lcdTimeEl.textContent = '00:00';
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    lcdTimeEl.textContent = `${mins}:${secs}`;
  }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ── Screen wake lock ────────────────────────────────────────
async function requestRecordingWakeLock() {
  if (!('wakeLock' in navigator) || !isRecording || document.visibilityState !== 'visible') {
    return;
  }

  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!isRecording) {
      await lock.release();
      return;
    }

    wakeLock = lock;
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    }, { once: true });
  } catch (err) {
    wakeLock = null;
  }
}

async function releaseRecordingWakeLock() {
  const lock = wakeLock;
  wakeLock = null;

  if (lock) {
    try {
      await lock.release();
    } catch (err) {
      // The browser may already have released it when the page lost visibility.
    }
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && isRecording && !wakeLock) {
    void requestRecordingWakeLock();
  }
}

// ── Recording flow ──────────────────────────────────────────
async function handleTap() {
  if (isProcessing) return;
  if (isRecording) stopRecording();
  else await startRecording();
}

async function startRecording() {
  const apiKey = getApiKey();
  if (!apiKey) {
    setStatus('NO KEY', 'error');
    openSettings();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    let mimeType = 'audio/mp4';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

    const options = mimeType ? { mimeType } : {};
    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      await processRecording();
    };

    mediaRecorder.start(1000);
    isRecording = true;
    activeRecordingMode = getTranscriptionMode();
    void requestRecordingWakeLock();
    setRecordButtonState('recording');
    setStatus('REC');
    setRecLed(true);
    lcdDotEl.classList.add('live');
    tapeStripEl.classList.add('rolling');
    startTimer();
  } catch (err) {
    setStatus('MIC DENIED', 'error');
  }
}

function stopRecording() {
  void releaseRecordingWakeLock();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  stopTimer();
  setRecordButtonState('processing');
  setStatus('TRANSCRIBING');
  setRecLed(false);
  lcdDotEl.classList.remove('live');
  isProcessing = true;
}

async function processRecording() {
  try {
    const mime = mediaRecorder.mimeType;
    let ext = 'm4a';
    if (mime.includes('webm')) ext = 'webm';
    else if (mime.includes('ogg')) ext = 'ogg';
    else if (mime.includes('mp4') || mime.includes('m4a')) ext = 'm4a';

    const blob = new Blob(audioChunks, { type: mime });
    const transcript = await transcribeWithWhisper(blob, ext);

    if (transcript) {
      const now = new Date();
      saveNoteToHistory(now.toISOString(), transcript);
      const saved = await saveMarkdown(transcript, now, { preferShare: isIOSLike() });
      if (saved) {
        setStatus('SAVED');
      } else {
        openNote(0);
        setStatus('TAP .MD');
      }
    }
  } catch (err) {
    setStatus((err.message || 'ERROR').substring(0, 18), 'error');
  } finally {
    isProcessing = false;
    activeRecordingMode = null;
    setRecordButtonState('ready');
    tapeStripEl.classList.remove('rolling');
    setTimeout(() => {
      if (!isRecording && !isProcessing) {
        setStatus('READY');
        lcdTimeEl.textContent = '00:00';
      }
    }, 2000);
  }
}

async function transcribeWithWhisper(audioBlob, ext) {
  const apiKey = getApiKey();
  const transcriptionMode = TRANSCRIPTION_MODES[activeRecordingMode || getTranscriptionMode()];
  const formData = new FormData();
  formData.append('file', audioBlob, `recording.${ext}`);
  formData.append('model', TRANSCRIPTION_MODEL);
  if (transcriptionMode.language) formData.append('language', transcriptionMode.language);
  formData.append('prompt', transcriptionMode.prompt);
  formData.append('response_format', 'text');

  const response = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }

  return (await response.text()).trim();
}

function buildMarkdownFile(transcript, date) {
  const pad = (n) => String(n).padStart(2, '0');
  const dateStamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  const isoDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

  const markdown = `---
type: voice-note
date: ${isoDate}
---

${transcript}
`;

  const filename = `${dateStamp}_voice-note.md`;
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const file = new File([blob], filename, { type: 'text/markdown' });

  return { blob, file, filename };
}

function canShareFile(file) {
  return 'share' in navigator
    && 'canShare' in navigator
    && navigator.canShare({ files: [file] });
}

function downloadMarkdownFile(blob, filename) {
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showSaveFeedback(text) {
  clearTimeout(saveStatusTimer);
  const label = noteDownloadBtn.querySelector('.lbl');
  const glyph = noteDownloadBtn.querySelector('.glyph');
  const origLbl = label.textContent;
  const origGlyph = glyph.textContent;
  label.textContent = text;
  glyph.textContent = text === 'Saved' ? '✓' : '!';
  saveStatusTimer = setTimeout(() => {
    label.textContent = origLbl;
    glyph.textContent = origGlyph;
  }, 1500);
}

async function saveMarkdown(transcript, date, options = {}) {
  const { blob, file, filename } = buildMarkdownFile(transcript, date);

  if (options.preferShare && canShareFile(file)) {
    try {
      await navigator.share({
        files: [file],
        title: filename,
        text: 'Dictamate voice note',
      });
      if (noteModal.classList.contains('open')) showSaveFeedback('Saved');
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return true;
      if (noteModal.classList.contains('open')) showSaveFeedback('Try Save');
      return false;
    }
  }

  if (isIOSLike()) return false;

  downloadMarkdownFile(blob, filename);
  return true;
}

// ── Wire up event listeners ─────────────────────────────────
recordBtn.addEventListener('click', handleTap);
screwBtn.addEventListener('click', openSettings);
modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!isRecording && !isProcessing) setTranscriptionMode(btn.dataset.mode);
  });
});
settingsCancelBtn.addEventListener('click', closeSettings);
settingsSaveBtn.addEventListener('click', saveSettings);
noteCloseBtn.addEventListener('click', closeNote);
noteDownloadBtn.addEventListener('click', redownloadNote);
noteCopyBtn.addEventListener('click', copyNote);
noteModal.addEventListener('click', (e) => {
  if (e.target === noteModal) closeNote();
});
document.addEventListener('visibilitychange', handleVisibilityChange);

loadNotes();
renderTranscriptionMode();
setRecordButtonState('ready');
