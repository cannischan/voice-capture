// ── Constants ───────────────────────────────────────────────
const STORAGE_KEYS = {
  apiKey: 'whisper_api_key',
  notes: 'voice_notes',
};
const NOTE_HISTORY_CAP = 50;
const NOTE_PREVIEW_CHARS = 200;
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

// ── State ───────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let isProcessing = false;
let startTime = null;
let timerInterval = null;
let notes = [];

// ── DOM refs ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const recordBtn = $('recordBtn');
const stopBtn = $('stopBtn');
const screwBtn = $('screwBtn');
const statusEl = $('status');
const lcdTimeEl = $('lcdTime');
const lcdDotEl = $('lcdDot');
const lcdCountEl = $('lcdCount');
const tapeStripEl = $('tapeStrip');
const recLedEl = $('recLed');
const recentSection = $('recentSection');
const recentList = $('recentList');
const settingsModal = $('settingsModal');
const apiKeyInput = $('apiKeyInput');
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
  downloadMarkdown(text, new Date(n.date));
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

// ── Recording flow ──────────────────────────────────────────
async function handleTap() {
  if (isProcessing) return;
  if (isRecording) stopRecording();
  else await startRecording();
}

function handleStop() {
  if (isRecording) stopRecording();
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
    recordBtn.classList.add('recording');
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
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  stopTimer();
  recordBtn.classList.remove('recording');
  recordBtn.classList.add('processing');
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
      downloadMarkdown(transcript, now);
      saveNoteToHistory(now.toISOString(), transcript);
      setStatus('SAVED');
    }
  } catch (err) {
    setStatus((err.message || 'ERROR').substring(0, 18), 'error');
  } finally {
    isProcessing = false;
    recordBtn.classList.remove('processing');
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
  const formData = new FormData();
  formData.append('file', audioBlob, `recording.${ext}`);
  formData.append('model', 'whisper-1');
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

function downloadMarkdown(transcript, date) {
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
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Wire up event listeners ─────────────────────────────────
recordBtn.addEventListener('click', handleTap);
stopBtn.addEventListener('click', handleStop);
screwBtn.addEventListener('click', openSettings);
settingsCancelBtn.addEventListener('click', closeSettings);
settingsSaveBtn.addEventListener('click', saveSettings);
noteCloseBtn.addEventListener('click', closeNote);
noteDownloadBtn.addEventListener('click', redownloadNote);
noteCopyBtn.addEventListener('click', copyNote);
noteModal.addEventListener('click', (e) => {
  if (e.target === noteModal) closeNote();
});

loadNotes();
