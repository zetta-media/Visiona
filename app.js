/**
 * VISIONA - Vision Smart Assistant
 * Modular Architecture & Full Vanilla Implementation
 */

// ==========================================
// 1. STORAGE & CONFIGURATION STATE
// ==========================================
const CONFIG_KEY = 'visiona_config_v1';
const HISTORY_KEY = 'visiona_history_v1';

const defaultConfig = {
  provider: 'auto', // 'auto', 'gemini', 'grok'
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  grokKey: '',
  grokModel: 'grok-2-vision-128k',
  speechRate: 1.0,
  autoRead: true,
  vibration: true
};

function loadConfig() {
  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    return saved ? { ...defaultConfig, ...JSON.parse(saved) } : defaultConfig;
  } catch (e) {
    console.error("Gagal membaca storage:", e);
    return defaultConfig;
  }
}

function saveConfig(config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Gagal menyimpan storage:", e);
  }
}

let appConfig = loadConfig();

// ==========================================
// 2. AI PROVIDER ARCHITECTURE
// ==========================================
class BaseAIProvider {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = 25000; // 25s timeout limit
  }

  fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(id));
  }
}

class GeminiProvider extends BaseAIProvider {
  async analyzeImage(base64Image, promptText) {
    if (!this.apiKey) throw new Error("API Key Gemini belum diisi.");

    // Clean Base64 String
    const cleanedBase64 = base64Image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const payload = {
      contents: [{
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: "image/jpeg",
              data: cleanedBase64
            }
          }
        ]
      }]
    };

    try {
      const response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (response.status === 400 || response.status === 403) {
          throw new Error("API Key Gemini tidak valid atau tidak memiliki izin.");
        } else if (response.status === 429) {
          throw new Error("Kuota API Gemini telah habis.");
        }
        throw new Error(errData.error?.message || "Terjadi kesalahan pada layanan Gemini.");
      }

      const data = await response.json();
      const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textResult) throw new Error("Gemini tidak memberikan deskripsi yang valid.");

      return textResult;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error("Pemrosesan Gemini terlalu lama (timeout). Silakan coba lagi.");
      }
      throw err;
    }
  }

  async testConnection() {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
    const res = await this.fetchWithTimeout(endpoint, { method: 'GET' });
    if (!res.ok) throw new Error("API Key Gemini salah atau tidak aktif.");
    return true;
  }
}

class GrokProvider extends BaseAIProvider {
  async analyzeImage(base64Image, promptText) {
    if (!this.apiKey) throw new Error("API Key Grok belum diisi.");

    const endpoint = "https://api.x.ai/v1/chat/completions";

    const payload = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: promptText },
            {
              type: "image_url",
              image_url: { url: base64Image }
            }
          ]
        }
      ],
      temperature: 0.3
    };

    try {
      const response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (response.status === 401) throw new Error("API Key Grok tidak valid.");
        if (response.status === 429) throw new Error("Kuota API Grok telah habis.");
        throw new Error("Terjadi kesalahan pada layanan Grok.");
      }

      const data = await response.json();
      const textResult = data.choices?.[0]?.message?.content;
      if (!textResult) throw new Error("Grok tidak memberikan respon teks.");

      return textResult;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error("Pemrosesan Grok terlalu lama (timeout). Silakan coba lagi.");
      }
      throw err;
    }
  }

  async testConnection() {
    const endpoint = "https://api.x.ai/v1/models";
    const res = await this.fetchWithTimeout(endpoint, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    if (!res.ok) throw new Error("API Key Grok tidak valid.");
    return true;
  }
}

// Factory to select AI Service
function getAIService(overrideProvider = null) {
  const providerType = overrideProvider || appConfig.provider;

  let activeType = providerType;
  if (providerType === 'auto') {
    if (appConfig.geminiKey) activeType = 'gemini';
    else if (appConfig.grokKey) activeType = 'grok';
    else activeType = 'gemini';
  }

  if (activeType === 'gemini') {
    return {
      providerName: 'Gemini',
      service: new GeminiProvider(appConfig.geminiKey, appConfig.geminiModel)
    };
  } else {
    return {
      providerName: 'Grok',
      service: new GrokProvider(appConfig.grokKey, appConfig.grokModel)
    };
  }
}

// ==========================================
// 3. PROMPTS FOR FEATURES
// ==========================================
const FEATURE_PROMPTS = {
  money: "Anda adalah asisten untuk tunanetra. Analisis gambar uang ini. Sebutkan negara/mata uang, nominal angka, pecahan kertas/logam, dan ciri visual khas. Jika gambar buram/tidak jelas, jawab persis: 'Saya belum dapat memastikan nominal uang dari gambar ini.'",
  env: "Anda adalah asisten navigasi tunanetra. Jelaskan kondisi lingkungan sekitar secara singkat dan praktis. Prioritaskan: objek utama, posisi relatif, orang, jalan, pintu, tangga, rintangan berbahaya, dan tulisan penting.",
  text: "Anda adalah pembaca teks untuk tunanetra. Bacakan seluruh teks yang terlihat pada gambar/buku ini sesuai urutan paragraf. Jangan tambahkan penjelasan eksternal. Jika tidak ada teks, katakan 'Tidak ada teks yang dapat dibaca.'",
  photo: "Jelaskan isi gambar ini secara menyeluruh namun mudah dipahami untuk penyandang tunanetra.",
  package: "Analisis kemasan produk ini. Sebutkan nama produk, merek, jenis produk, varian, dan informasi penting yang terlihat. Jangan mengarang jika tidak terbaca.",
  color: "Identifikasi warna utama objek pada gambar ini. Jawab singkat padat, contoh: 'Warna utama objek ini adalah biru tua.'"
};

const FEATURE_TITLES = {
  money: "Pindai Uang",
  env: "Deskripsi Lingkungan",
  text: "Baca Teks atau Buku",
  photo: "Pengenalan Foto",
  package: "Pengenalan Kemasan Produk",
  color: "Pengenalan Warna"
};

// ==========================================
// 4. SPEECH SYNTHESIS & HARDWARE API
// ==========================================
function speakText(text) {
  if (!('speechSynthesis' in window)) {
    announceToSR("Fitur suara tidak tersedia di browser ini.");
    return;
  }

  window.speechSynthesis.cancel(); // Stop current speech

  if (!text) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'id-ID';
  utterance.rate = parseFloat(appConfig.speechRate) || 1.0;

  utterance.onstart = () => {
    document.getElementById('btn-speak-stop').disabled = false;
  };

  utterance.onend = () => {
    document.getElementById('btn-speak-stop').disabled = true;
  };

  window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    document.getElementById('btn-speak-stop').disabled = true;
  }
}

function triggerVibration(pattern = 100) {
  if (appConfig.vibration && 'vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch (e) {}
  }
}

function announceToSR(message) {
  const el = document.getElementById('sr-announcer');
  if (el) {
    el.textContent = '';
    setTimeout(() => { el.textContent = message; }, 50);
  }
}

// ==========================================
// 5. APP STATE & CAMERA MANAGEMENT
// ==========================================
let currentView = 'sec-dashboard';
let currentFeature = null;
let mediaStream = null;
let imageCapturedBase64 = null;
let lastAnalysisResult = '';

// DOM Elements Cache
const views = document.querySelectorAll('.view-section');
const videoFeed = document.getElementById('camera-feed');
const cameraCanvas = document.getElementById('camera-canvas');
const imagePreview = document.getElementById('image-preview');
const cameraStatus = document.getElementById('camera-status');
const btnCapture = document.getElementById('btn-capture');
const btnRetake = document.getElementById('btn-retake');
const btnAnalyze = document.getElementById('btn-analyze');
const btnFlash = document.getElementById('btn-flash');
const resultText = document.getElementById('result-text');
const fallbackWrap = document.getElementById('fallback-provider-wrap');

function switchView(targetViewId) {
  stopSpeech();
  stopCamera();

  views.forEach(view => {
    if (view.id === targetViewId) {
      view.removeAttribute('hidden');
      view.classList.add('active');
    } else {
      view.setAttribute('hidden', '');
      view.classList.remove('active');
    }
  });

  currentView = targetViewId;
  window.scrollTo(0, 0);

  // Auto focus heading for accessibility
  const heading = document.getElementById(targetViewId).querySelector('h2');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}

async function startCamera() {
  stopCamera();
  imageCapturedBase64 = null;
  imagePreview.hidden = true;
  videoFeed.hidden = false;

  btnCapture.disabled = false;
  btnRetake.disabled = true;
  btnAnalyze.disabled = true;
  cameraStatus.textContent = "Membuka Kamera...";

  try {
    const constraints = {
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    };
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoFeed.srcObject = mediaStream;
    cameraStatus.textContent = "Kamera Aktif";
    announceToSR("Kamera berhasil dibuka.");

    // Flash Support Check
    const track = mediaStream.getVideoTracks()[0];
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (capabilities.torch) {
      btnFlash.hidden = false;
    } else {
      btnFlash.hidden = true;
    }

  } catch (err) {
    console.error("Camera Error:", err);
    cameraStatus.textContent = "Kamera tidak dapat diakses.";
    announceToSR("Tidak dapat mengakses kamera. Pastikan izin kamera telah diberikan.");
    btnCapture.disabled = true;
  }
}

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (videoFeed) videoFeed.srcObject = null;
}

function capturePhoto() {
  if (!mediaStream && currentFeature !== 'photo') return;

  const ctx = cameraCanvas.getContext('2d');
  cameraCanvas.width = videoFeed.videoWidth || 640;
  cameraCanvas.height = videoFeed.videoHeight || 480;

  ctx.drawImage(videoFeed, 0, 0, cameraCanvas.width, cameraCanvas.height);
  imageCapturedBase64 = cameraCanvas.toDataURL('image/jpeg', 0.85);

  imagePreview.src = imageCapturedBase64;
  imagePreview.hidden = false;
  videoFeed.hidden = true;

  btnCapture.disabled = true;
  btnRetake.disabled = false;
  btnAnalyze.disabled = false;

  cameraStatus.textContent = "Gambar Diambil";
  triggerVibration([80, 50, 80]);
  announceToSR("Gambar berhasil diambil. Tekan tombol Analisis Gambar untuk memproses.");
}

function resetPhoto() {
  imageCapturedBase64 = null;
  if (currentFeature === 'photo' && document.getElementById('photo-file-input').files.length > 0) {
    document.getElementById('photo-file-input').value = '';
  }
  startCamera();
}

async function toggleFlash() {
  if (!mediaStream) return;
  const track = mediaStream.getVideoTracks()[0];
  try {
    const currentConstraints = track.getConstraints();
    const newTorchState = !currentConstraints.advanced?.[0]?.torch;
    await track.applyConstraints({
      advanced: [{ torch: newTorchState }]
    });
    btnFlash.textContent = newTorchState ? "⚡ Flash Aktif" : "⚡ Flash Nonaktif";
    announceToSR(newTorchState ? "Flash kamera dinyalakan" : "Flash kamera dimatikan");
  } catch (e) {
    announceToSR("Perangkat tidak mendukung kontrol flash.");
  }
}

// ==========================================
// 6. CORE AI PROCESSING & HANDLERS
// ==========================================
async function runAnalysis(overrideProvider = null) {
  if (!imageCapturedBase64) {
    alert("Silakan ambil gambar atau pilih foto terlebih dahulu.");
    return;
  }

  const prompt = FEATURE_PROMPTS[currentFeature] || "Deskripsikan gambar ini.";
  const { service, providerName } = getAIService(overrideProvider);

  resultText.textContent = `Memproses gambar menggunakan ${providerName}... Mohon tunggu.`;
  announceToSR(`Sedang memproses gambar menggunakan ${providerName}`);
  btnAnalyze.disabled = true;
  fallbackWrap.hidden = true;

  try {
    const response = await service.analyzeImage(imageCapturedBase64, prompt);
    lastAnalysisResult = response;
    resultText.textContent = response;
    
    document.getElementById('btn-speak-repeat').disabled = false;
    triggerVibration(200);
    announceToSR("Analisis selesai. " + response);

    // Save History
    saveHistoryItem({
      feature: FEATURE_TITLES[currentFeature] || "Pengenalan",
      result: response,
      provider: providerName,
      model: service.model,
      timestamp: new Date().toLocaleString('id-ID')
    });

    if (appConfig.autoRead) {
      speakText(response);
    }

  } catch (err) {
    console.error("Analysis Error:", err);
    resultText.textContent = `Gagal: ${err.message}`;
    announceToSR(`Gagal memproses. ${err.message}`);
    triggerVibration([200, 100, 200]);

    // Show Grok fallback button if Gemini failed in auto/gemini mode
    if (providerName === 'Gemini' && appConfig.grokKey) {
      fallbackWrap.hidden = false;
    }
  } finally {
    btnAnalyze.disabled = false;
  }
}

// ==========================================
// 7. HISTORY MANAGEMENT
// ==========================================
function getHistory() {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) { return []; }
}

function saveHistoryItem(item) {
  const list = getHistory();
  list.unshift({ id: Date.now(), ...item });
  if (list.length > 30) list.pop(); // Max 30 history items
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function renderHistory() {
  const container = document.getElementById('history-list');
  const items = getHistory();

  if (items.length === 0) {
    container.innerHTML = `<p class="result-content">Belum ada riwayat pengenalan.</p>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <article class="history-card">
      <div class="history-header">
        <strong>${item.feature}</strong>
        <span>${item.timestamp}</span>
      </div>
      <p class="history-body">${item.result}</p>
      <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.4rem;">
        Provider: ${item.provider} (${item.model})
      </div>
      <div class="history-actions-row">
        <button class="btn btn-secondary" onclick="speakText('${escapeQuotes(item.result)}')">🔊 Baca</button>
        <button class="btn btn-danger" onclick="deleteHistoryItem(${item.id})">🗑️ Hapus</button>
      </div>
    </article>
  `).join('');
}

function escapeQuotes(str) {
  return str.replace(/'/g, "\\'").replace(/\n/g, ' ');
}

function deleteHistoryItem(id) {
  let list = getHistory();
  list = list.filter(item => item.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  renderHistory();
  announceToSR("Riwayat berhasil dihapus.");
}

function clearAllHistory() {
  showConfirmModal("Hapus Semua Riwayat", "Apakah Anda yakin ingin menghapus seluruh riwayat pengenalan?", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    announceToSR("Seluruh riwayat berhasil dibersihkan.");
  });
}

// ==========================================
// 8. DIALOG MODAL HELPER
// ==========================================
const dialogEl = document.getElementById('confirm-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalConfirmBtn = document.getElementById('modal-btn-confirm');
const modalCancelBtn = document.getElementById('modal-btn-cancel');
let activeModalCallback = null;

function showConfirmModal(title, message, onConfirm) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  activeModalCallback = onConfirm;
  dialogEl.showModal();
}

modalConfirmBtn.addEventListener('click', () => {
  if (activeModalCallback) activeModalCallback();
  dialogEl.close();
});

modalCancelBtn.addEventListener('click', () => {
  dialogEl.close();
});

// ==========================================
// 9. EVENT LISTENERS & ROUTING
// ==========================================
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.getAttribute('data-action');

  switch (action) {
    case 'open-feature': {
      const feat = target.getAttribute('data-feature');
      currentFeature = feat;
      document.getElementById('feature-title').textContent = FEATURE_TITLES[feat] || 'Fitur';
      
      const fileWrap = document.getElementById('file-input-wrapper');
      if (feat === 'photo') {
        fileWrap.hidden = false;
      } else {
        fileWrap.hidden = true;
      }

      switchView('sec-feature');
      startCamera();
      break;
    }

    case 'open-settings':
      syncSettingsUI();
      switchView('sec-settings');
      break;

    case 'open-history':
      renderHistory();
      switchView('sec-history');
      break;

    case 'open-guide':
      switchView('sec-guide');
      break;

    case 'open-contact':
      switchView('sec-contact');
      break;

    case 'open-other':
      switchView('sec-other');
      break;

    case 'back-to-dashboard':
      switchView('sec-dashboard');
      break;

    case 'capture':
      capturePhoto();
      break;

    case 'retake':
      resetPhoto();
      break;

    case 'analyze':
      runAnalysis();
      break;

    case 'try-grok':
      runAnalysis('grok');
      break;

    case 'toggle-flash':
      toggleFlash();
      break;

    case 'speech-repeat':
      if (lastAnalysisResult) speakText(lastAnalysisResult);
      break;

    case 'speech-stop':
      stopSpeech();
      break;

    case 'toggle-key-visibility': {
      const targetId = target.getAttribute('data-target');
      const inputEl = document.getElementById(targetId);
      if (inputEl) {
        inputEl.type = inputEl.type === 'password' ? 'text' : 'password';
      }
      break;
    }

    case 'save-gemini':
      appConfig.geminiKey = document.getElementById('input-gemini-key').value.trim();
      appConfig.geminiModel = document.getElementById('select-gemini-model').value;
      saveConfig(appConfig);
      updateStatusIndicators();
      alert("API Key Gemini disimpan.");
      break;

    case 'delete-gemini':
      appConfig.geminiKey = '';
      document.getElementById('input-gemini-key').value = '';
      saveConfig(appConfig);
      updateStatusIndicators();
      alert("API Key Gemini dihapus.");
      break;

    case 'test-gemini':
      testGeminiKey();
      break;

    case 'save-grok':
      appConfig.grokKey = document.getElementById('input-grok-key').value.trim();
      appConfig.grokModel = document.getElementById('select-grok-model').value;
      saveConfig(appConfig);
      updateStatusIndicators();
      alert("API Key Grok disimpan.");
      break;

    case 'delete-grok':
      appConfig.grokKey = '';
      document.getElementById('input-grok-key').value = '';
      saveConfig(appConfig);
      updateStatusIndicators();
      alert("API Key Grok dihapus.");
      break;

    case 'test-grok':
      testGrokKey();
      break;

    case 'clear-all-history':
      clearAllHistory();
      break;

    case 'check-api-status':
      checkSystemStatus();
      break;

    case 'wipe-all-data':
      showConfirmModal("Hapus Semua Data", "Apakah Anda yakin ingin menghapus SELURUH data lokal (API key, pengaturan, riwayat)?", () => {
        localStorage.clear();
        appConfig = { ...defaultConfig };
        syncSettingsUI();
        announceToSR("Seluruh data lokal berhasil dibersihkan.");
        alert("Semua data lokal telah dihapus.");
        switchView('sec-dashboard');
      });
      break;
  }
});

// File Input Handler for Photo Recognition
document.getElementById('photo-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    imageCapturedBase64 = event.target.result;
    imagePreview.src = imageCapturedBase64;
    imagePreview.hidden = false;
    videoFeed.hidden = true;

    btnCapture.disabled = true;
    btnRetake.disabled = false;
    btnAnalyze.disabled = false;
    cameraStatus.textContent = "Foto Dipilih dari Perangkat";
    announceToSR("Foto berhasil dipilih. Tekan tombol Analisis Gambar untuk memproses.");
  };
  reader.readAsDataURL(file);
});

// Settings Input Change Bindings
document.getElementById('select-provider').addEventListener('change', (e) => {
  appConfig.provider = e.target.value;
  saveConfig(appConfig);
});

document.getElementById('range-speech-rate').addEventListener('input', (e) => {
  appConfig.speechRate = parseFloat(e.target.value);
  document.getElementById('val-speech-rate').textContent = e.target.value;
  saveConfig(appConfig);
});

document.getElementById('check-auto-read').addEventListener('change', (e) => {
  appConfig.autoRead = e.target.checked;
  saveConfig(appConfig);
});

document.getElementById('check-vibration').addEventListener('change', (e) => {
  appConfig.vibration = e.target.checked;
  saveConfig(appConfig);
});

// Sync Settings UI
function syncSettingsUI() {
  document.getElementById('select-provider').value = appConfig.provider;
  document.getElementById('input-gemini-key').value = appConfig.geminiKey || '';
  document.getElementById('select-gemini-model').value = appConfig.geminiModel;
  document.getElementById('input-grok-key').value = appConfig.grokKey || '';
  document.getElementById('select-grok-model').value = appConfig.grokModel;
  document.getElementById('range-speech-rate').value = appConfig.speechRate;
  document.getElementById('val-speech-rate').textContent = appConfig.speechRate;
  document.getElementById('check-auto-read').checked = appConfig.autoRead;
  document.getElementById('check-vibration').checked = appConfig.vibration;
  updateStatusIndicators();
}

function updateStatusIndicators() {
  const geminiStatus = document.getElementById('status-gemini');
  if (appConfig.geminiKey) {
    geminiStatus.textContent = "Status: Gemini siap digunakan.";
    geminiStatus.className = "status-indicator ready";
  } else {
    geminiStatus.textContent = "Status: Gemini belum dikonfigurasi.";
    geminiStatus.className = "status-indicator";
  }

  const grokStatus = document.getElementById('status-grok');
  if (appConfig.grokKey) {
    grokStatus.textContent = "Status: Grok siap digunakan.";
    grokStatus.className = "status-indicator ready";
  } else {
    grokStatus.textContent = "Status: Grok belum dikonfigurasi.";
    grokStatus.className = "status-indicator";
  }
}

async function testGeminiKey() {
  const key = document.getElementById('input-gemini-key').value.trim();
  if (!key) return alert("Masukkan API Key Gemini terlebih dahulu.");
  const provider = new GeminiProvider(key, document.getElementById('select-gemini-model').value);
  announceToSR("Menguji koneksi Gemini...");
  try {
    await provider.testConnection();
    alert("Koneksi Gemini Berhasil!");
    announceToSR("Koneksi Gemini berhasil.");
  } catch (e) {
    alert(`Tes Gagal: ${e.message}`);
    announceToSR(`Tes gagal: ${e.message}`);
  }
}

async function testGrokKey() {
  const key = document.getElementById('input-grok-key').value.trim();
  if (!key) return alert("Masukkan API Key Grok terlebih dahulu.");
  const provider = new GrokProvider(key, document.getElementById('select-grok-model').value);
  announceToSR("Menguji koneksi Grok...");
  try {
    await provider.testConnection();
    alert("Koneksi Grok Berhasil!");
    announceToSR("Koneksi Grok berhasil.");
  } catch (e) {
    alert(`Tes Gagal: ${e.message}`);
    announceToSR(`Tes gagal: ${e.message}`);
  }
}

function checkSystemStatus() {
  const isOnline = navigator.onLine;
  const hasGemini = !!appConfig.geminiKey;
  const hasGrok = !!appConfig.grokKey;
  alert(`Status Sistem:\n- Internet: ${isOnline ? 'Online' : 'Offline'}\n- Gemini Key: ${hasGemini ? 'Ada' : 'Kosong'}\n- Grok Key: ${hasGrok ? 'Ada' : 'Kosong'}`);
}

// Network Status Monitor
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

function updateNetworkStatus() {
  const badge = document.getElementById('network-status');
  if (navigator.onLine) {
    badge.textContent = "Online";
    badge.className = "status-badge online";
    announceToSR("Perangkat kembali online.");
  } else {
    badge.textContent = "Offline";
    badge.className = "status-badge offline";
    announceToSR("Anda sedang offline. Fitur AI membutuhkan koneksi internet.");
  }
}

// Service Worker Registration for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        document.getElementById('pwa-status').textContent = "PWA Terdaftar & Siap Offline";
      })
      .catch(err => {
        document.getElementById('pwa-status').textContent = "Browser Standard (Tanpa SW)";
      });
  });
}

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
  updateNetworkStatus();
  updateStatusIndicators();
});
