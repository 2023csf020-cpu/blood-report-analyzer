/* ============================================================
   BloodIQ — Vanilla JS SPA Application Logic (Groq + SQLite Profiles)
   ============================================================ */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  file: null,
  reportData: null,
  chatHistory: [],     // [{role, content}]
  chatBusy: false,
  trendData: null,     // Holds current trends dataset
  trendsChart: null,   // Chart.js instance reference
  profiles: [],        // Lists of patient profiles
  activeProfileId: 1,  // Currently active profile ID
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const uploadZone       = $('upload-zone');
const fileInput        = $('file-input');
const browseBtn        = $('browse-btn');
const clearFileBtn     = $('clear-file-btn');
const filePreview      = $('file-preview');
const fileNameDisp     = $('file-name-display');
const fileSizeDisp     = $('file-size-display');
const analyzeBtn       = $('analyze-btn');
const useSampleBtn     = $('use-sample-btn');

const chatInput        = $('chat-input');
const chatSendBtn      = $('chat-send-btn');
const chatMessages     = $('chat-messages');

const exportJsonBtn    = $('export-json-btn');
const toast            = $('toast');

const sidebarDrawer    = $('sidebar-drawer');
const sidebarHistory   = $('sidebar-history-list');
const biomarkerSelect  = $('trends-biomarker-select');

const profileSelect    = $('profile-select');
const profileModal     = $('profile-modal');
const profileForm      = $('profile-form');
const profileNameInput = $('profile-name-input');
const profileRelInput  = $('profile-relation-input');

const actionPlanSection = $('action-plan-section');
const actionPlanChecklist = $('action-plan-checklist');

// ─── Screen management ────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`screen-${name}`);
  if (el) {
    el.classList.add('active');
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
  }

  // Nav visibility
  const navResults = $('nav-results');
  if (navResults && state.reportData) {
    navResults.style.display = '';
  } else if (navResults) {
    navResults.style.display = 'none';
  }

  // Active status on header
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.id === `nav-${name}`) {
      link.style.color = 'var(--text-primary)';
      link.style.borderBottom = '2px solid var(--accent-purple)';
    } else {
      link.style.color = 'var(--text-secondary)';
      link.style.borderBottom = 'none';
    }
  });

  if (name === 'trends') {
    loadTrends();
  }
}

// ─── Profiles Management ───────────────────────────────────────────────────────
async function fetchProfiles() {
  try {
    const res = await fetch('/api/profiles');
    if (!res.ok) throw new Error('Failed to load profiles');
    const data = await res.json();
    state.profiles = data;
    renderProfilesDropdown(data);
  } catch (err) {
    console.error('Error fetching profiles:', err);
  }
}

function renderProfilesDropdown(profiles) {
  profileSelect.innerHTML = '';
  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.relationship})`;
    profileSelect.appendChild(opt);
  });
  profileSelect.value = state.activeProfileId;
}

profileSelect.addEventListener('change', (e) => {
  const newProfileId = parseInt(e.target.value);
  state.activeProfileId = newProfileId;
  
  // Clear currently displayed report when shifting profiles
  state.reportData = null;
  showScreen('upload');
  
  // Refresh historical listings for active profile
  fetchHistory();
  showToast('Patient profile switched.', 'success');
});

function toggleProfileModal(isOpen) {
  if (isOpen) {
    profileModal.classList.add('active');
    profileNameInput.focus();
  } else {
    profileModal.classList.remove('active');
    profileForm.reset();
  }
}

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = profileNameInput.value.trim();
  const relationship = profileRelInput.value;
  if (!name) return;

  try {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, relationship })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create profile');

    showToast(`Profile "${name}" created.`, 'success');
    toggleProfileModal(false);
    
    // Refresh profiles lists, and set newly created profile active
    state.activeProfileId = data.id;
    await fetchProfiles();
    
    // Clear display, shift view, and update list history
    state.reportData = null;
    showScreen('upload');
    fetchHistory();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Close modal when clicking outside modal-content
profileModal.addEventListener('click', (e) => {
  if (e.target === profileModal) {
    toggleProfileModal(false);
  }
});

// ─── Sidebar Drawer (History) ──────────────────────────────────────────────────
function toggleSidebar(isOpen) {
  if (isOpen) {
    sidebarDrawer.classList.add('open');
    fetchHistory();
  } else {
    sidebarDrawer.classList.remove('open');
  }
}

async function fetchHistory() {
  try {
    const res = await fetch(`/api/history?profile_id=${state.activeProfileId}`);
    if (!res.ok) throw new Error('Failed to load history');
    const reports = await res.json();
    renderHistoryList(reports);
  } catch (err) {
    console.error('Error fetching history:', err);
  }
}

function renderHistoryList(reports) {
  sidebarHistory.innerHTML = '';
  if (!reports || reports.length === 0) {
    sidebarHistory.innerHTML = '<p class="sidebar-empty">No reports analyzed yet.</p>';
    return;
  }

  reports.forEach(report => {
    const card = document.createElement('div');
    card.className = `history-item-card ${state.reportData && state.reportData.db_id === report.id ? 'active' : ''}`;
    
    let scoreColor = 'var(--text-muted)';
    if (report.health_score !== null) {
      if (report.health_score >= 80) scoreColor = '#10b981';
      else if (report.health_score >= 60) scoreColor = '#f59e0b';
      else scoreColor = '#ef4444';
    }

    card.innerHTML = `
      <div class="history-item-name">${escHtml(report.patient_name || 'Anonymous Patient')}</div>
      <div class="history-item-date">📅 ${escHtml(report.report_date || report.created_at.slice(0, 10))}</div>
      <div class="history-item-meta">${escHtml(report.lab_name || 'Unknown Lab')}</div>
      ${report.health_score !== null ? `<div class="history-item-score" style="color:${scoreColor}; border: 1px solid ${scoreColor}22; background: ${scoreColor}10;">${report.health_score}</div>` : ''}
      <button class="history-delete-btn" title="Delete report">✕</button>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('history-delete-btn')) return;
      loadHistoricalReport(report.id);
    });

    card.querySelector('.history-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete this report?`)) {
        await deleteHistoricalReport(report.id);
      }
    });

    sidebarHistory.appendChild(card);
  });
}

async function loadHistoricalReport(id) {
  try {
    showToast('Loading report details…');
    const res = await fetch(`/api/history/${id}`);
    if (!res.ok) throw new Error('Failed to fetch details');
    const data = await res.json();
    
    state.reportData = data;
    state.chatHistory = [];
    renderResults(data);
    toggleSidebar(false);
    showScreen('results');
    showToast('Report loaded successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteHistoricalReport(id) {
  try {
    const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Deletion failed');
    
    showToast('Report deleted.', 'success');
    if (state.reportData && state.reportData.db_id === id) {
      state.reportData = null;
      showScreen('upload');
    }
    fetchHistory();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── File handling ─────────────────────────────────────────────────────────────
browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
uploadZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', ()  => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type === 'application/pdf') {
    setFile(f);
  } else {
    showToast('Please drop a PDF file.', 'error');
  }
});

function setFile(file) {
  state.file = file;
  fileNameDisp.textContent = file.name;
  fileSizeDisp.textContent = formatBytes(file.size);
  filePreview.style.display = 'flex';
  analyzeBtn.disabled = false;
}

clearFileBtn.addEventListener('click', e => {
  e.stopPropagation();
  state.file = null;
  fileInput.value = '';
  filePreview.style.display = 'none';
  analyzeBtn.disabled = true;
});

useSampleBtn.addEventListener('click', async () => {
  try {
    showToast('Loading sample report…');
    const res = await fetch('/samples/waseela_cbc_lft.pdf');
    if (!res.ok) throw new Error('Sample not found');
    const blob = await res.blob();
    const file = new File([blob], 'waseela_cbc_lft.pdf', { type: 'application/pdf' });
    setFile(file);
    showToast('Sample loaded! Click "Analyze Report" to continue.', 'success');
  } catch {
    showToast('Could not load sample. Upload your own PDF.', 'error');
  }
});

// ─── Analyze ──────────────────────────────────────────────────────────────────
analyzeBtn.addEventListener('click', runAnalysis);

async function runAnalysis() {
  if (!state.file) return;

  showScreen('loading');
  animateLoadingSteps();

  const formData = new FormData();
  formData.append('file', state.file);
  formData.append('profile_id', state.activeProfileId);

  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    state.reportData = data;
    state.chatHistory = [];
    renderResults(data);
    showScreen('results');
    // Refresh history
    fetchHistory();
  } catch (err) {
    showScreen('upload');
    showToast(`Error: ${err.message}`, 'error');
  }
}

let loadingTimer = null;
function animateLoadingSteps() {
  const steps = ['step-1', 'step-2', 'step-3', 'step-4'];
  steps.forEach(id => {
    const el = $(id);
    if (el) { el.classList.remove('active', 'done'); }
  });
  if (steps[0]) $(steps[0]).classList.add('active');

  let i = 0;
  if (loadingTimer) clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    const cur = $(steps[i]);
    if (cur) { cur.classList.remove('active'); cur.classList.add('done'); }
    i++;
    if (i < steps.length) {
      const next = $(steps[i]);
      if (next) next.classList.add('active');
    } else {
      clearInterval(loadingTimer);
    }
  }, 1800);
}

// ─── Render Results ────────────────────────────────────────────────────────────
function renderResults(data) {
  renderPatientCard(data);
  renderHealthScore(data);
  renderInsights(data);
  renderActionPlan(data);
  renderPanels(data);
  resetChat();
}

function renderPatientCard(data) {
  const patient = data.patient || {};
  const name = patient.name || 'Anonymous Patient';
  const initials = name === 'Anonymous Patient' ? '?' : name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();

  $('patient-avatar').textContent = initials;
  $('patient-name').textContent = name;

  const metaParts = [];
  if (patient.age) metaParts.push(`Age: ${patient.age}`);
  if (patient.sex) metaParts.push(`Sex: ${patient.sex}`);
  if (data.report_date) metaParts.push(`Date: ${data.report_date}`);
  $('patient-meta').innerHTML = metaParts.join(' &nbsp;·&nbsp; ');

  if (data.lab_name) $('patient-lab').textContent = data.lab_name;
}

function renderHealthScore(data) {
  const hs = data.health_score;
  if (!hs) return;

  const score = hs.score;
  $('score-number').textContent = score;

  const numEl = $('score-number');
  if (score >= 80)      numEl.style.color = '#10b981';
  else if (score >= 60) numEl.style.color = '#f59e0b';
  else                  numEl.style.color = '#ef4444';

  const circ = 326.73;
  const offset = circ - (score / 100) * circ;
  const ringFill = $('score-ring-fill');

  const svgEl = ringFill.closest('svg');
  if (!svgEl.querySelector('defs')) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="score-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stop-color="#8b5cf6"/>
        <stop offset="50%"  stop-color="#3b82f6"/>
        <stop offset="100%" stop-color="#14b8a6"/>
      </linearGradient>`;
    svgEl.insertBefore(defs, svgEl.firstChild);
  }

  requestAnimationFrame(() => {
    ringFill.style.strokeDashoffset = offset;
  });

  const breakdown = $('score-breakdown');
  breakdown.innerHTML = `
    <span class="score-stat"><span class="score-stat-dot" style="background:#10b981"></span>${hs.normal_count} Normal</span>
    <span class="score-stat"><span class="score-stat-dot" style="background:#ef4444"></span>${hs.high_count} High</span>
    <span class="score-stat"><span class="score-stat-dot" style="background:#f59e0b"></span>${hs.low_count} Low</span>
  `;
}

function renderInsights(data) {
  const ins = data.insights;
  if (!ins) return;
  $('insights-text').innerHTML = colorifyMedicalText(ins.overall_summary) || 'No overall summary available.';
}

function renderActionPlan(data) {
  actionPlanChecklist.innerHTML = '';
  const ins = data.insights || {};
  const plan = ins.action_plan || [];

  if (plan.length === 0) {
    actionPlanSection.style.display = 'none';
    return;
  }

  actionPlanSection.style.display = 'block';
  
  plan.forEach((item, index) => {
    const reportDbId = data.db_id || 0;
    const storageKey = `blood_action_${reportDbId}_${index}`;
    const isChecked = localStorage.getItem(storageKey) === 'true';

    const checklistItem = document.createElement('div');
    checklistItem.className = `checklist-item ${isChecked ? 'checked' : ''}`;
    
    const importanceClass = item.importance === 'high' ? 'importance-high' : 'importance-medium';

    checklistItem.innerHTML = `
      <div class="checklist-checkbox-container">
        <input type="checkbox" class="checklist-checkbox" id="action-check-${index}" ${isChecked ? 'checked' : ''} />
      </div>
      <div class="checklist-item-content">
        <div class="checklist-item-title-row">
          <label class="checklist-item-title" for="action-check-${index}">${escHtml(item.title)}</label>
          <span class="category-badge">${escHtml(item.category || 'General')}</span>
          <span class="importance-pill ${importanceClass}">${escHtml(item.importance || 'medium')}</span>
        </div>
        <p class="checklist-item-desc">${colorifyMedicalText(item.description)}</p>
      </div>
    `;

    // Interactive checkbox check state logic
    const checkbox = checklistItem.querySelector('.checklist-checkbox');
    checkbox.addEventListener('change', (e) => {
      const checked = e.target.checked;
      if (checked) {
        checklistItem.classList.add('checked');
        localStorage.setItem(storageKey, 'true');
      } else {
        checklistItem.classList.remove('checked');
        localStorage.removeItem(storageKey);
      }
    });

    actionPlanChecklist.appendChild(checklistItem);
  });
}

function renderPanels(data) {
  const container = $('panels-section');
  container.innerHTML = '';

  const panels = data.panels || [];
  const insights = (data.insights || {}).panel_insights || {};

  panels.forEach((panel, pi) => {
    const abnormals = panel.tests.filter(t => t.flag === 'high' || t.flag === 'low');
    const hasAbnormal = abnormals.length > 0;
    const insight = insights[panel.panel_name] || '';

    const card = document.createElement('div');
    card.className = 'panel-card glass';
    card.innerHTML = `
      <div class="panel-header" id="panel-header-${pi}">
        <div class="panel-header-left">
          <span class="panel-name">${escHtml(panel.panel_name)}</span>
          <span class="panel-badge ${hasAbnormal ? 'has-abnormal' : 'all-normal'}">
            ${hasAbnormal ? `${abnormals.length} Abnormal` : 'All Normal'}
          </span>
        </div>
        ${insight ? `<span class="panel-insight">${colorifyMedicalText(insight)}</span>` : ''}
        <span class="panel-chevron">▾</span>
      </div>
      <div class="panel-body" id="panel-body-${pi}">
        <table class="test-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>Result</th>
              <th>Status</th>
              <th>Range vs. Normal</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody id="panel-tbody-${pi}"></tbody>
        </table>
      </div>
    `;
    container.appendChild(card);

    const body = $(`panel-body-${pi}`);
    const tbody = $(`panel-tbody-${pi}`);

    panel.tests.forEach(test => {
      const tr = buildTestRow(test);
      tbody.appendChild(tr);
    });

    requestAnimationFrame(() => {
      body.style.maxHeight = body.scrollHeight + 'px';
    });

    const header = $(`panel-header-${pi}`);
    header.addEventListener('click', () => {
      if (card.classList.contains('collapsed')) {
        card.classList.remove('collapsed');
        body.style.maxHeight = body.scrollHeight + 'px';
      } else {
        card.classList.add('collapsed');
        body.style.maxHeight = '0px';
      }
    });
  });
}

function buildTestRow(test) {
  const tr = document.createElement('tr');
  tr.className = 'test-row';

  const flagClass = {
    high: 'flag-high', low: 'flag-low', normal: 'flag-normal', unknown: 'flag-unknown'
  }[test.flag] || 'flag-unknown';

  const flagLabel = { high: '↑ High', low: '↓ Low', normal: '✓ Normal', unknown: '— N/A' }[test.flag] || '— N/A';
  const flagColor = { high: '#ef4444', low: '#f59e0b', normal: '#10b981', unknown: '#6b7280' }[test.flag] || '#6b7280';

  let deviationBadgeHTML = '';
  if (typeof test.value === 'number') {
    if (test.flag === 'high' && test.ref_range_high != null && test.ref_range_high > 0) {
      const diff = ((test.value - test.ref_range_high) / test.ref_range_high) * 100;
      deviationBadgeHTML = `<span class="deviation-badge deviation-high">+${diff.toFixed(1)}% above range</span>`;
    } else if (test.flag === 'low' && test.ref_range_low != null && test.ref_range_low > 0) {
      const diff = ((test.ref_range_low - test.value) / test.ref_range_low) * 100;
      deviationBadgeHTML = `<span class="deviation-badge deviation-low">-${diff.toFixed(1)}% below range</span>`;
    }
  }

  let barHTML = '<span style="color:var(--text-muted);font-size:0.78rem">—</span>';
  if (typeof test.value === 'number' && (test.ref_range_low != null || test.ref_range_high != null)) {
    const lo  = test.ref_range_low  ?? test.value * 0.5;
    const hi  = test.ref_range_high ?? test.value * 1.5;
    const min = Math.min(lo * 0.7, test.value * 0.7);
    const max = Math.max(hi * 1.3, test.value * 1.3);
    const pct     = clamp((test.value - min) / (max - min), 0, 1) * 100;
    const barW    = Math.max(0, Math.min(pct, 100));

    barHTML = `
      <div class="bar-wrapper">
        <div class="bar-fill" style="width:${barW}%; background:${flagColor}; opacity:0.7;"></div>
        <div class="bar-marker" style="left:${pct}%; background:${flagColor};"></div>
      </div>
      <div class="bar-ref">
        <span>${test.ref_range_low ?? ''}</span>
        <span>${test.ref_range_high ?? ''}</span>
      </div>`;
  }

  tr.innerHTML = `
    <td class="test-name-cell">
      <div class="test-name">${escHtml(test.test_name)}</div>
      ${test.raw_label && test.raw_label !== test.test_name
        ? `<div class="test-raw-label">${escHtml(test.raw_label)}</div>`
        : ''}
    </td>
    <td class="test-value-cell">
      <span class="test-value">${formatValue(test.value)}</span>
      ${test.unit ? `<span class="test-unit">${escHtml(test.unit)}</span>` : ''}
    </td>
    <td>
      <div class="test-flag-container">
        <span class="test-flag ${flagClass}">${flagLabel}</span>
        ${deviationBadgeHTML}
      </div>
    </td>
    <td class="bar-cell">${barHTML}</td>
    <td><span style="color:var(--text-muted);font-size:0.8rem;font-family:var(--font-mono)">${escHtml(test.ref_range_raw || '—')}</span></td>
  `;

  return tr;
}

// ─── Chat ──────────────────────────────────────────────────────────────────────
function resetChat() {
  state.chatHistory = [];
  chatMessages.innerHTML = `
    <div class="chat-bubble assistant-bubble">
      <div class="bubble-avatar">🤖</div>
      <div class="bubble-content">Hi! I've reviewed your blood report. Ask me anything — like <em>"What does my hemoglobin level mean?"</em> or <em>"Which results should I discuss with my doctor?"</em></div>
    </div>`;
}

chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });

async function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg || state.chatBusy || !state.reportData) return;

  state.chatBusy = true;
  chatSendBtn.disabled = true;

  appendBubble('user', msg);
  chatInput.value = '';

  const typingId = appendTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        report_context: state.reportData,
        history: state.chatHistory,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Chat failed');

    removeTyping(typingId);
    appendBubble('assistant', data.reply);

    state.chatHistory.push({ role: 'user', content: msg });
    state.chatHistory.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    removeTyping(typingId);
    appendBubble('assistant', `Sorry, I encountered an error: ${err.message}`);
  } finally {
    state.chatBusy = false;
    chatSendBtn.disabled = false;
    chatInput.focus();
  }
}

function appendBubble(role, text) {
  const isUser = role === 'user';
  const div = document.createElement('div');
  div.className = `chat-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'}`;
  div.innerHTML = `
    <div class="bubble-avatar">${isUser ? '👤' : '🤖'}</div>
    <div class="bubble-content">${formatChatText(text)}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function appendTyping() {
  const id = `typing-${Date.now()}`;
  const div = document.createElement('div');
  div.className = 'chat-bubble assistant-bubble';
  div.id = id;
  div.innerHTML = `
    <div class="bubble-avatar">🤖</div>
    <div class="bubble-content">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = $(id);
  if (el) el.remove();
}

// ─── Trends View ───────────────────────────────────────────────────────────────
async function loadTrends() {
  try {
    biomarkerSelect.innerHTML = '<option value="">Loading markers...</option>';
    const res = await fetch(`/api/trends?profile_id=${state.activeProfileId}`);
    if (!res.ok) throw new Error('Failed to load trend data');
    const data = await res.json();
    
    state.trendData = data;
    populateBiomarkerSelect(data);
  } catch (err) {
    showToast(err.message, 'error');
    biomarkerSelect.innerHTML = '<option value="">Failed to load data</option>';
  }
}

function populateBiomarkerSelect(trendData) {
  biomarkerSelect.innerHTML = '';
  const markers = Object.keys(trendData);

  if (markers.length === 0) {
    biomarkerSelect.innerHTML = '<option value="">-- No numeric data available --</option>';
    if (state.trendsChart) {
      state.trendsChart.destroy();
      state.trendsChart = null;
    }
    return;
  }

  markers.sort();

  markers.forEach(marker => {
    const opt = document.createElement('option');
    opt.value = marker;
    opt.textContent = `${marker} (${trendData[marker].unit || ''})`;
    biomarkerSelect.appendChild(opt);
  });

  biomarkerSelect.value = markers[0];
  renderTrendsChart(markers[0]);
}

biomarkerSelect.addEventListener('change', (e) => {
  if (e.target.value) {
    renderTrendsChart(e.target.value);
  }
});

function renderTrendsChart(markerName) {
  const canvas = $('trends-chart');
  const ctx = canvas.getContext('2d');
  const dataset = state.trendData[markerName];

  if (!dataset || dataset.data.length === 0) return;

  const labels = dataset.data.map(d => d.date);
  const values = dataset.data.map(d => d.value);

  if (state.trendsChart) {
    state.trendsChart.destroy();
  }

  const accentColor = '#8b5cf6';
  const gridColor = 'rgba(255, 255, 255, 0.05)';
  const textColor = '#94a3b8';

  state.trendsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `${markerName} (${dataset.unit || ''})`,
        data: values,
        borderColor: accentColor,
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        borderWidth: 3,
        tension: 0.3,
        pointBackgroundColor: '#ec4899',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: textColor, font: { family: 'Inter', size: 12 } }
        },
        tooltip: {
          backgroundColor: 'rgba(11, 15, 42, 0.9)',
          titleFont: { family: 'Inter' },
          bodyFont: { family: 'Inter' },
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: 'Inter' } }
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: 'Inter' } }
        }
      }
    }
  });
}

// ─── Export ────────────────────────────────────────────────────────────────────
exportJsonBtn.addEventListener('click', () => {
  if (!state.reportData) return;
  const blob = new Blob([JSON.stringify(state.reportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blood_report_analysis.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON exported!', 'success');
});

// ─── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  void toast.offsetWidth;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatValue(val) {
  if (val == null) return '—';
  if (typeof val === 'number') {
    return parseFloat(val.toFixed(2)).toString();
  }
  return escHtml(String(val));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function formatChatText(text) {
  return colorifyMedicalText(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function colorifyMedicalText(text) {
  if (!text) return '';
  let html = escHtml(text);
  
  const biomarkers = [
    'hemoglobin', 'hb', 'mcv', 'mch', 'mchc', 'rbc', 'wbc', 'platelet', 'platelets',
    'sgpt', 'alt', 'sgot', 'ast', 'bilirubin', 'alkaline phosphatase', 'alp', 'cbc', 'lft', 'rft',
    'hematocrit', 'hct'
  ];
  
  biomarkers.forEach(bm => {
    const regex = new RegExp(`\\b(${bm})\\b`, 'gi');
    html = html.replace(regex, '<span style="color:#c4b5fd; font-weight:700;">$1</span>');
  });

  const normalRegex = /\b(normal|mostly normal|healthy|good)\b/gi;
  html = html.replace(normalRegex, '<span style="color:#10b981; font-weight:700;">$1</span>');

  const highRegex = /\b(high|higher|elevated|above range|increased)\b/gi;
  html = html.replace(highRegex, '<span style="color:#ef4444; font-weight:700;">$1</span>');

  const lowRegex = /\b(low|lower|decreased|below range|slightly low)\b/gi;
  html = html.replace(lowRegex, '<span style="color:#f59e0b; font-weight:700;">$1</span>');

  const abnormalRegex = /\b(abnormal|abnormality|abnormalities|warning)\b/gi;
  html = html.replace(abnormalRegex, '<span style="color:#ef4444; font-weight:700;">$1</span>');

  return html;
}

// ─── Init ──────────────────────────────────────────────────────────────────────
showScreen('upload');
// Populate profile select dropdown & history listing
fetchProfiles().then(() => {
  fetchHistory();
});
