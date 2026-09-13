import { db } from "./firebase";
import { collection, addDoc } from "firebase/firestore";
// Free Fire Hosting Dashboard - Pure Vanilla JS Application
(function() {
  'use strict';

  // --- Audio Feedback (Web Audio API) ---
  const audioCtx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;
  function playBeep(type = 'click') {
    if (!state.settings.soundEnabled || !audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      if (type === 'click') {
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.04);
      } else if (type === 'success') {
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        osc.frequency.setValueAtTime(783.99, now + 0.16);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'cancel') {
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.linearRampToValueAtTime(200, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      }
    } catch (e) {
      console.warn('Audio feedback failed:', e);
    }
  }

  function triggerHaptic() {
    if (state.settings.hapticEnabled && navigator.vibrate) {
      try { navigator.vibrate(30); } catch (e) {}
    }
  }

  // --- Default State & Persistence ---
  const STORAGE_KEY = 'ff_hosting_data_v1';

  let state = {
    settings: {
      ratePerMatch: 3,
      countStartOverride: 1,
      idpUrlBase: 'https://skillclash.site/admin2020/matches/edit/',
      winningUrlBase: 'https://skillclash.site/admin2020/matches/member_join_match/',
      soundEnabled: true,
      hapticEnabled: true
    },
    todayMatches: [], // Array of 49 matches for the active date
    history: [],      // Array of completed & cancelled records
    activeDate: getTodayYMD(),
    manualCountStart: 1,
    simulatedMinutes: null // null for real time, or minute offset in day for testing
  };

  function getTodayYMD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = Object.assign(state, parsed);
        if (state.settings) {
          if (!state.settings.idpUrlBase || state.settings.idpUrlBase.includes('ffhost.app')) {
            state.settings.idpUrlBase = 'https://skillclash.site/admin2020/matches/edit/';
          }
          if (!state.settings.winningUrlBase || state.settings.winningUrlBase.includes('ffhost.app')) {
            state.settings.winningUrlBase = 'https://skillclash.site/admin2020/matches/member_join_match/';
          }
        }
      }
    } catch (e) {
      console.error('Failed to parse localStorage state:', e);
    }

    // If todayMatches is empty, populate demo matches for smooth initial experience
    if (!state.todayMatches || state.todayMatches.length === 0) {
      generateSampleMatches(336101, 336201);
    }
  }

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    
    // Firebase me data save karne ke liye:
    setDoc(doc(db, "dashboard", "mainData"), state)
      .catch(err => console.error("Firebase save error:", err));
      
  } catch (e) {
    console.error('Failed to save state to localstorage:', e);
  }
}  function showToast(message, type = 'orange') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : 'toast-orange'}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 2200);
  }

  // --- Dynamic Sequential Counting Engine ---
  // If cancelled, NOT counted. Next valid match inherits that count number.
  function recalculateCounts() {
    const start = parseInt(state.manualCountStart, 10) || 1;
    let currentCount = start;
    state.todayMatches.forEach(match => {
      if (match.status === 'cancelled') {
        match.seqCount = null;
      } else {
        match.seqCount = currentCount;
        currentCount++;
      }
    });
  }

  // --- Free Fire 49-Match Generator Math ---
  // 10:00 AM (First) to 10:00 PM (Last), 15 min intervals. Total 49 matches.
  function generateSchedule(dateYMD, val10_00, val11_00, val11_15, val11_30, val11_45) {
    const base10 = parseInt(val10_00, 10);
    const base11 = parseInt(val11_00, 10);
    if (isNaN(base10) || isNaN(base11)) return null;

    let v11_15 = parseInt(val11_15, 10);
    let v11_30 = parseInt(val11_30, 10);
    let v11_45 = parseInt(val11_45, 10);

    // Auto-calculate if not explicitly provided
    if (isNaN(v11_15)) v11_15 = base11 + 12;
    if (isNaN(v11_30)) v11_30 = base11 + 24;
    if (isNaN(v11_45)) v11_45 = base11 + 36;

    const matches = [];

    // Helper for 12-hr display
    function formatTime(hour, minute) {
      const period = hour >= 12 ? 'PM' : 'AM';
      const h = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
      const m = String(minute).padStart(2, '0');
      return `${h}:${m} ${period}`;
    }

    // 10:00 AM Block (+1 every 15 mins)
    matches.push({ id: `${dateYMD}_1000`, timeStr: '10:00 AM', hour: 10, minute: 0, matchNumber: base10, status: 'upcoming' });
    matches.push({ id: `${dateYMD}_1015`, timeStr: '10:15 AM', hour: 10, minute: 15, matchNumber: base10 + 1, status: 'upcoming' });
    matches.push({ id: `${dateYMD}_1030`, timeStr: '10:30 AM', hour: 10, minute: 30, matchNumber: base10 + 2, status: 'upcoming' });
    matches.push({ id: `${dateYMD}_1045`, timeStr: '10:45 AM', hour: 10, minute: 45, matchNumber: base10 + 3, status: 'upcoming' });

    // 11:00 AM Block (Base, Base+12, Base+24, Base+36 or manual override)
    matches.push({ id: `${dateYMD}_1100`, timeStr: '11:00 AM', hour: 11, minute: 0, matchNumber: base11, status: 'upcoming' });
    matches.push({ id: `${dateYMD}_1115`, timeStr: '11:15 AM', hour: 11, minute: 15, matchNumber: v11_15, status: 'upcoming' });
    matches.push({ id: `${dateYMD}_1130`, timeStr: '11:30 AM', hour: 11, minute: 30, matchNumber: v11_30, status: 'upcoming' });
    matches.push({ id: `${dateYMD}_1145`, timeStr: '11:45 AM', hour: 11, minute: 45, matchNumber: v11_45, status: 'upcoming' });

    // 12:00 PM to 10:00 PM (+1 every HOUR based on their 15-minute series)
    const seriesBases = {
      0: base11,   // :00 series
      15: v11_15,  // :15 series
      30: v11_30,  // :30 series
      45: v11_45   // :45 series
    };

    for (let h = 12; h <= 22; h++) {
      const hourOffset = h - 11; // 12pm is offset 1 from 11am, 10pm (22) is offset 11
      const minutesList = (h === 22) ? [0] : [0, 15, 30, 45]; // At 10:00 PM only :00 match exists!
      
      minutesList.forEach(m => {
        const base = seriesBases[m];
        const num = base + hourOffset;
        matches.push({
          id: `${dateYMD}_${h}${String(m).padStart(2, '0')}`,
          timeStr: formatTime(h, m),
          hour: h,
          minute: m,
          matchNumber: num,
          status: 'upcoming'
        });
      });
    }

    return matches;
  }

  function generateSampleMatches(base10 = 336101, base11 = 336201) {
    const list = generateSchedule(state.activeDate, base10, base11, null, null, null);
    if (list) {
      state.todayMatches = list;
      recalculateCounts();
      saveState();
    }
  }

  // --- Clock & 5-Minute Rule Logic ---
  // A match at scheduled time T is CURRENT MATCH up to 5 minutes after T (e.g. 3:00 is CURRENT until 3:05:59 PM).
  // At 3:06:00 PM it switches to 3:15 PM!
  function getCurrentEffectiveMinutes() {
    if (state.simulatedMinutes !== null) {
      return state.simulatedMinutes;
    }
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }

  function getActiveFocusMatch() {
    if (!state.todayMatches || state.todayMatches.length === 0) return null;
    const currentMin = getCurrentEffectiveMinutes();

    // Loop through matches
    for (let i = 0; i < state.todayMatches.length; i++) {
      const m = state.todayMatches[i];
      const matchMin = m.hour * 60 + m.minute;
      // 5-minute rule: current from matchMin to matchMin + 5.999 (i.e. < matchMin + 6)
      if (currentMin >= matchMin && currentMin < matchMin + 6) {
        return { match: m, isLiveCurrent: true, diffMin: currentMin - matchMin };
      }
      // If we are past the 5-min window of this match, but before the next match
      if (currentMin >= matchMin + 6 && i < state.todayMatches.length - 1) {
        const nextM = state.todayMatches[i + 1];
        const nextMin = nextM.hour * 60 + nextM.minute;
        if (currentMin < nextMin) {
          return { match: nextM, isLiveCurrent: false, diffMin: nextMin - currentMin };
        }
      }
    }

    // If before 10:00 AM (600 mins)
    if (currentMin < 600) {
      return { match: state.todayMatches[0], isLiveCurrent: false, diffMin: 600 - currentMin };
    }

    // If after 10:00 PM
    return { match: state.todayMatches[state.todayMatches.length - 1], isLiveCurrent: false, isEnded: true };
  }

  // --- Time-Based Match Window Filter (Section 2) ---
  // Dynamically filter and show matches from 30 minutes before current time to 15 minutes after (e.g., at 6:00, show 5:30, 5:45, 6:00, 6:15)
  function getWindowMatches() {
    if (!state.todayMatches || state.todayMatches.length === 0) return [];
    const currentMin = getCurrentEffectiveMinutes();
    const minBound = currentMin - 30;
    const maxBound = currentMin + 15;

    let filtered = state.todayMatches.filter(m => {
      const mMin = m.hour * 60 + m.minute;
      return mMin >= minBound && mMin <= maxBound;
    });

    // If outside active hours, fallback to nearest slice of 4 matches
    if (filtered.length === 0) {
      if (currentMin < 600) {
        filtered = state.todayMatches.slice(0, 4);
      } else {
        filtered = state.todayMatches.slice(-4);
      }
    }
    return filtered;
  }

  // --- Copy Functionality: [MatchNumber]#[Count] ---
  function copyMatchString(match) {
    if (!match) return;
    if (match.status === 'cancelled') {
      showToast(`Match ${match.matchNumber} is Cancelled!`, 'orange');
      return;
    }
    const count = match.seqCount !== null ? match.seqCount : (state.manualCountStart || 1);
    const textToCopy = `${match.matchNumber}#${count}`;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        showToast(`Copied: ${textToCopy} ✓`, 'success');
        playBeep('success');
        triggerHaptic();
      }).catch(() => fallbackCopy(textToCopy));
    } else {
      fallbackCopy(textToCopy);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(`Copied: ${text} ✓`, 'success');
      playBeep('success');
      triggerHaptic();
    } catch (e) {
      showToast(`Copy failed. Format: ${text}`, 'orange');
    }
    document.body.removeChild(ta);
  }

  // --- Match Action Handlers ---
  function handleCompleteMatch(matchId) {
    const match = state.todayMatches.find(m => m.id === matchId);
    if (!match) return;

    match.status = 'completed';
    match.completedAt = new Date().toISOString();
    const rate = state.settings.ratePerMatch || 3;
    match.payout = rate;

    // Add or update in history
    const existingIndex = state.history.findIndex(h => h.id === match.id);
    const historyItem = {
      ...match,
      dateYMD: state.activeDate
    };
    if (existingIndex >= 0) {
      state.history[existingIndex] = historyItem;
    } else {
      state.history.unshift(historyItem);
    }

    recalculateCounts();
    saveState();
    playBeep('success');
    triggerHaptic();
    showToast(`Match ${match.matchNumber} Completed! (+₹${rate}) ✓`, 'success');
    renderAll();
  }

  function handleCancelMatch(matchId) {
    const match = state.todayMatches.find(m => m.id === matchId);
    if (!match) return;

    match.status = 'cancelled';
    match.cancelledAt = new Date().toISOString();
    match.payout = 0;

    const existingIndex = state.history.findIndex(h => h.id === match.id);
    const historyItem = {
      ...match,
      dateYMD: state.activeDate
    };
    if (existingIndex >= 0) {
      state.history[existingIndex] = historyItem;
    } else {
      state.history.unshift(historyItem);
    }

    // Cancelled matches do NOT consume count. Next valid match inherits count!
    recalculateCounts();
    saveState();
    playBeep('cancel');
    triggerHaptic();
    showToast(`Match ${match.matchNumber} Cancelled. (Next inherits count) ✓`, 'orange');
    renderAll();
  }

  function handleUndoHistory(matchId) {
    const histIndex = state.history.findIndex(h => h.id === matchId);
    if (histIndex >= 0) {
      const removed = state.history.splice(histIndex, 1)[0];
      const todayMatch = state.todayMatches.find(m => m.id === matchId);
      if (todayMatch) {
        todayMatch.status = 'upcoming';
        delete todayMatch.completedAt;
        delete todayMatch.cancelledAt;
        delete todayMatch.payout;
      }
      recalculateCounts();
      saveState();
      playBeep('click');
      triggerHaptic();
      showToast(`Match ${removed.matchNumber} restored to Active! ✓`, 'success');
      renderAll();
    }
  }

  // --- Payment History & Monday Reset Math ---
  // Groups past matches into Monday-Sunday calendar week blocks.
  // Monday resets the current week to ₹0!
  function getPaymentWeeklyBlocks() {
    const blocks = {};

    state.history.forEach(item => {
      const dStr = item.dateYMD || state.activeDate;
      const [year, month, day] = dStr.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      
      // Calculate Monday of this week
      const dayOfWeek = d.getDay(); // 0 is Sun, 1 is Mon...
      const diffToMon = (dayOfWeek + 6) % 7;
      const mon = new Date(d);
      mon.setDate(d.getDate() - diffToMon);
      mon.setHours(0,0,0,0);

      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      sun.setHours(23,59,59,999);

      const weekKey = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;

      if (!blocks[weekKey]) {
        blocks[weekKey] = {
          weekKey,
          mondayDate: mon,
          sundayDate: sun,
          completedCount: 0,
          cancelledCount: 0,
          totalPayout: 0,
          days: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 0: 0 } // Mon to Sun
        };
      }

      if (item.status === 'completed') {
        blocks[weekKey].completedCount++;
        blocks[weekKey].totalPayout += (item.payout || state.settings.ratePerMatch || 3);
        blocks[weekKey].days[dayOfWeek]++;
      } else if (item.status === 'cancelled') {
        blocks[weekKey].cancelledCount++;
      }
    });

    // Check current week
    const now = new Date();
    const curDayOfWeek = now.getDay();
    const curDiffToMon = (curDayOfWeek + 6) % 7;
    const curMon = new Date(now);
    curMon.setDate(now.getDate() - curDiffToMon);
    curMon.setHours(0,0,0,0);
    const curSun = new Date(curMon);
    curSun.setDate(curMon.getDate() + 6);
    const curWeekKey = `${curMon.getFullYear()}-${String(curMon.getMonth() + 1).padStart(2, '0')}-${String(curMon.getDate()).padStart(2, '0')}`;

    // Ensure current week exists in blocks even if 0 matches
    if (!blocks[curWeekKey]) {
      blocks[curWeekKey] = {
        weekKey: curWeekKey,
        mondayDate: curMon,
        sundayDate: curSun,
        completedCount: 0,
        cancelledCount: 0,
        totalPayout: 0,
        days: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 0: 0 },
        isCurrentWeek: true
      };
    } else {
      blocks[curWeekKey].isCurrentWeek = true;
    }

    return Object.values(blocks).sort((a, b) => b.mondayDate - a.mondayDate);
  }

  // --- Rendering UI Components ---
  function renderAll() {
    renderHeader();
    renderLiveDashboard();
    renderTodaysMatches();
    renderHistory();
    renderPaymentHistory();
    renderSettingsValues();
  }

  function renderHeader() {
    const clockEl = document.getElementById('header-live-clock');
    if (clockEl) {
      const now = new Date();
      if (state.simulatedMinutes !== null) {
        const simH = Math.floor(state.simulatedMinutes / 60);
        const simM = Math.floor(state.simulatedMinutes % 60);
        const period = simH >= 12 ? 'PM' : 'AM';
        const displayH = simH > 12 ? simH - 12 : (simH === 0 ? 12 : simH);
        clockEl.textContent = `${displayH}:${String(simM).padStart(2, '0')} ${period} [TEST]`;
      } else {
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        clockEl.textContent = timeStr;
      }
    }

    const rateBadge = document.getElementById('header-rate-display');
    if (rateBadge) {
      rateBadge.textContent = `₹${state.settings.ratePerMatch || 3} / Match`;
    }

    // Update Tab Badges
    const remainingCount = state.todayMatches.filter(m => m.status === 'upcoming').length;
    const badgeRemaining = document.getElementById('badge-matches-remaining');
    if (badgeRemaining) badgeRemaining.textContent = `${remainingCount} left`;

    const badgeHistory = document.getElementById('badge-history-count');
    if (badgeHistory) badgeHistory.textContent = state.history.length;
  }

  function renderLiveDashboard() {
    const focus = getActiveFocusMatch();
    const heroBox = document.getElementById('live-hero-match-box');
    if (!heroBox) return;

    if (!focus || !focus.match) {
      heroBox.innerHTML = `
        <div class="empty-state">
          <p>No matches generated for today.</p>
          <button class="btn-secondary" style="margin-top:10px;" id="btn-quick-gen-hero">Generate Today's Schedule</button>
        </div>
      `;
      const btn = document.getElementById('btn-quick-gen-hero');
      if (btn) btn.onclick = () => switchTab('tab-generator');
      return;
    }

    const m = focus.match;
    const isCurrent = focus.isLiveCurrent;
    const countDisplay = m.seqCount ? `#${m.seqCount}` : `#${state.manualCountStart || 1}`;

    let statusHtml = '';
    if (isCurrent) {
      statusHtml = `
        <span class="hero-pill live">
          <span class="pulse-dot"></span> CURRENT MATCH
        </span>
        <span class="hero-time-tag">${m.timeStr} (Live Window)</span>
      `;
    } else if (focus.isEnded) {
      statusHtml = `
        <span class="hero-pill" style="background:rgba(255,255,255,0.1);color:#CBD5E1;">DAY FINISHED</span>
        <span class="hero-time-tag">All 49 Matches Ended</span>
      `;
    } else {
      statusHtml = `
        <span class="hero-pill upcoming">NEXT MATCH</span>
        <span class="hero-time-tag">${m.timeStr}</span>
      `;
    }

    // NOTE: Strictly respect prompt requirement: "Hide all series-related labels (e.g., 'Series 2')"
    heroBox.innerHTML = `
      <div class="hero-status-row">
        ${statusHtml}
      </div>
      <div class="hero-match-number-box" id="hero-copy-box" title="Click to copy ${m.matchNumber}${countDisplay}">
        <div>
          <div class="match-num-label">MATCH NUMBER</div>
          <div style="display:flex;align-items:center;">
            <span class="match-num-val">${m.matchNumber}</span>
            <span class="match-count-badge">${countDisplay}</span>
          </div>
        </div>
        <button class="copy-mini-btn" title="Copy Format: ${m.matchNumber}${countDisplay}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
      </div>

      <div class="match-actions-grid">
        <a href="https://skillclash.site/admin2020/matches/edit/${m.matchNumber}" target="_blank" rel="noopener noreferrer" class="btn-action btn-idp">
          IDP ↗
        </a>
        <a href="https://skillclash.site/admin2020/matches/member_join_match/${m.matchNumber}" target="_blank" rel="noopener noreferrer" class="btn-action btn-winning">
          Winning ↗
        </a>
        <button class="btn-action btn-complete" id="btn-hero-complete">
          Complete (+₹${state.settings.ratePerMatch || 3})
        </button>
        <button class="btn-action btn-cancel" id="btn-hero-cancel">
          Cancel (₹0)
        </button>
      </div>
    `;

    document.getElementById('hero-copy-box').onclick = () => copyMatchString(m);
    document.getElementById('btn-hero-complete').onclick = () => handleCompleteMatch(m.id);
    document.getElementById('btn-hero-cancel').onclick = () => handleCancelMatch(m.id);

    // Section 2: Time-based Match Window (-30m to +15m)
    const windowContainer = document.getElementById('live-window-list');
    if (windowContainer) {
      const windowMatches = getWindowMatches();
      if (windowMatches.length === 0) {
        windowContainer.innerHTML = '<div class="empty-state">No matches in current -30m / +15m window.</div>';
      } else {
        windowContainer.innerHTML = windowMatches.map(wm => {
          const isCurrentCard = (focus.isLiveCurrent && wm.id === focus.match.id);
          const wmCount = wm.seqCount ? `#${wm.seqCount}` : '—';
          return `
            <div class="timeline-match-card ${isCurrentCard ? 'is-current' : ''}">
              <div class="timeline-left">
                <div class="timeline-time-row">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>${wm.timeStr}</span>
                  <span class="match-seq-badge">${wmCount}</span>
                  <span class="match-status-badge status-${wm.status}">${wm.status}</span>
                </div>
                <div class="timeline-match-num">${wm.matchNumber}</div>
              </div>
              <div class="timeline-actions">
                <button class="copy-mini-btn" onclick="window.ffApp.copyMatch('${wm.id}')" title="Copy ${wm.matchNumber}${wmCount}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
                ${wm.status === 'upcoming' ? `
                  <button class="btn-action btn-complete" style="padding:6px 10px;font-size:0.75rem;" onclick="window.ffApp.completeMatch('${wm.id}')">✓</button>
                  <button class="btn-action btn-cancel" style="padding:6px 10px;font-size:0.75rem;" onclick="window.ffApp.cancelMatch('${wm.id}')">✕</button>
                ` : ''}
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Section 3: Today's Progress & Earnings (Today & Current Week)
    const completedToday = state.todayMatches.filter(m => m.status === 'completed').length;
    const cancelledToday = state.todayMatches.filter(m => m.status === 'cancelled').length;
    const totalToday = state.todayMatches.length || 49;
    const rate = state.settings.ratePerMatch || 3;
    const earnedToday = completedToday * rate;

    // Calculate Current Week's Earnings (Monday to Sunday)
    const weeklyBlocks = getPaymentWeeklyBlocks();
    const curWeekBlock = weeklyBlocks.find(b => b.isCurrentWeek);
    const earnedWeek = curWeekBlock ? curWeekBlock.totalPayout : earnedToday;

    const elEarnedToday = document.getElementById('stat-earnings-today');
    if (elEarnedToday) elEarnedToday.textContent = `₹${earnedToday}`;

    const elEarnedWeek = document.getElementById('stat-earnings-week');
    if (elEarnedWeek) elEarnedWeek.textContent = `₹${earnedWeek}`;

    const elMatchesDone = document.getElementById('stat-matches-done');
    if (elMatchesDone) elMatchesDone.textContent = `${completedToday} / ${totalToday}`;

    const elMatchesCancelled = document.getElementById('stat-matches-cancelled');
    if (elMatchesCancelled) elMatchesCancelled.textContent = `${cancelledToday} (₹0)`;

    const barDone = document.getElementById('progress-bar-completed');
    const barCancel = document.getElementById('progress-bar-cancelled');
    if (barDone && barCancel) {
      const pctDone = (completedToday / totalToday) * 100;
      const pctCancel = (cancelledToday / totalToday) * 100;
      barDone.style.width = `${pctDone}%`;
      barCancel.style.width = `${pctCancel}%`;
    }
  }

  // --- Tab 3: Today's Matches Rendering (Specific Mobile Card UI) ---
  function renderTodaysMatches() {
    const listContainer = document.getElementById('today-matches-container');
    if (!listContainer) return;

    const searchVal = (document.getElementById('input-match-search')?.value || '').trim().toLowerCase();
    const filterVal = document.getElementById('select-match-filter')?.value || 'all';

    let list = state.todayMatches.slice();

    if (searchVal) {
      list = list.filter(m => 
        String(m.matchNumber).includes(searchVal) || 
        m.timeStr.toLowerCase().includes(searchVal) ||
        (m.seqCount && String(m.seqCount).includes(searchVal))
      );
    }

    if (filterVal !== 'all') {
      list = list.filter(m => m.status === filterVal);
    }

    if (list.length === 0) {
      listContainer.innerHTML = '<div class="empty-state">No matches match your filter criteria.</div>';
      return;
    }

    const focus = getActiveFocusMatch();
    const rate = state.settings.ratePerMatch || 3;

    listContainer.innerHTML = list.map(m => {
      const isCurrentCard = (focus && focus.isLiveCurrent && m.id === focus.match.id);
      const countLabel = m.seqCount ? `#${m.seqCount}` : '—';
      const cardStatusClass = `card-${m.status} ${isCurrentCard ? 'card-current' : ''}`;

      return `
        <div class="match-card-mobile ${cardStatusClass}" id="card-${m.id}">
          <!-- Header: Clock + Time on left, Count in subtle grey; Status on right -->
          <div class="match-card-header">
            <div class="header-time-group">
              <svg class="clock-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span class="match-time-text">${m.timeStr}</span>
              <span class="match-seq-badge">${countLabel}</span>
            </div>
            <div class="match-status-badge status-${m.status}">
              ${isCurrentCard ? 'Current' : m.status}
            </div>
          </div>

          <!-- Body: Match Number label on left, 6-digit number on right in bright orange -->
          <div class="match-card-body" onclick="window.ffApp.copyMatch('${m.id}')" title="Click to copy ${m.matchNumber}${countLabel}">
            <span class="match-card-label">Match Number</span>
            <div class="match-card-number-right">
              <span class="match-card-number-text">${m.matchNumber}</span>
              <button class="copy-mini-btn" title="Copy format: ${m.matchNumber}${countLabel}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>

          <!-- 2x2 Action Buttons -->
          <div class="match-actions-grid">
            <a href="https://skillclash.site/admin2020/matches/edit/${m.matchNumber}" target="_blank" rel="noopener noreferrer" class="btn-action btn-idp">
              IDP ↗
            </a>
            <a href="https://skillclash.site/admin2020/matches/member_join_match/${m.matchNumber}" target="_blank" rel="noopener noreferrer" class="btn-action btn-winning">
              Winning ↗
            </a>
            <button class="btn-action btn-complete" onclick="window.ffApp.completeMatch('${m.id}')" ${m.status === 'completed' ? 'disabled style="opacity:0.6"' : ''}>
              ${m.status === 'completed' ? 'Completed ✓' : `Complete (+₹${rate})`}
            </button>
            <button class="btn-action btn-cancel" onclick="window.ffApp.cancelMatch('${m.id}')" ${m.status === 'cancelled' ? 'disabled style="opacity:0.6"' : ''}>
              ${m.status === 'cancelled' ? 'Cancelled' : 'Cancel (₹0)'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Tab 4: Match History Rendering ---
  function renderHistory() {
    const container = document.getElementById('history-list-container');
    if (!container) return;

    const searchVal = (document.getElementById('input-history-search')?.value || '').trim().toLowerCase();
    const filterVal = document.getElementById('select-history-filter')?.value || 'all';

    let list = state.history.slice();

    if (searchVal) {
      list = list.filter(h => 
        String(h.matchNumber).includes(searchVal) ||
        h.timeStr.toLowerCase().includes(searchVal) ||
        (h.dateYMD && h.dateYMD.includes(searchVal))
      );
    }

    if (filterVal !== 'all') {
      list = list.filter(h => h.status === filterVal);
    }

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">No history records found.</div>';
      return;
    }

    container.innerHTML = list.map(item => {
      const isDone = item.status === 'completed';
      const countLabel = item.seqCount ? `#${item.seqCount}` : '—';
      const payoutText = isDone ? `+₹${item.payout || state.settings.ratePerMatch || 3}` : '₹0';
      const payoutClass = isDone ? 'payout-green' : 'payout-red';

      return `
        <div class="history-item ${item.status}">
          <div class="history-info">
            <div class="history-time">${item.dateYMD || 'Today'} • ${item.timeStr}</div>
            <div class="history-match-title">
              ${item.matchNumber} <span class="match-seq-badge">${countLabel}</span>
            </div>
            <div class="history-meta">
              Status: <span style="text-transform:capitalize;font-weight:700;">${item.status}</span>
            </div>
          </div>
          <div class="history-right">
            <span class="history-payout ${payoutClass}">${payoutText}</span>
            <button class="btn-undo" onclick="window.ffApp.undoHistory('${item.id}')" title="Restore back to active matches">
              Undo ↺
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Tab 5: Payment History Rendering ---
  function renderPaymentHistory() {
    const container = document.getElementById('payment-blocks-container');
    if (!container) return;

    const blocks = getPaymentWeeklyBlocks();
    if (blocks.length === 0) {
      container.innerHTML = '<div class="empty-state">No payment history recorded yet.</div>';
      return;
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    container.innerHTML = blocks.map(block => {
      const monStr = block.mondayDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const sunStr = block.sundayDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const statusBadge = block.isCurrentWeek 
        ? '<span class="week-status-badge" style="background:rgba(255,122,0,0.15);color:#FF7A00;border:1px solid #FF7A00;">CURRENT WEEK</span>'
        : '<span class="week-status-badge" style="background:rgba(16,185,129,0.15);color:#34D399;border:1px solid rgba(16,185,129,0.3);">SETTLED / READY</span>';

      return `
        <div class="week-card ${block.isCurrentWeek ? 'is-current-week' : ''}">
          <div class="week-header">
            <div>
              <div class="week-dates">${monStr} – ${sunStr}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                ${block.completedCount} Hosted • ${block.cancelledCount} Cancelled
              </div>
            </div>
            ${statusBadge}
          </div>

          <div class="week-payout-box">
            <span style="font-size:0.85rem;color:var(--text-muted);font-weight:600;">Total Payout</span>
            <span class="week-payout-amount">₹${block.totalPayout}</span>
          </div>

          <!-- Mon-Sun Daily Breakdown -->
          <table class="day-breakdown-table">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                <th>Day</th>
                <th>Matches</th>
                <th style="text-align:right;">Earned</th>
              </tr>
            </thead>
            <tbody>
              ${[1, 2, 3, 4, 5, 6, 0].map(dayIdx => {
                const count = block.days[dayIdx] || 0;
                const earned = count * (state.settings.ratePerMatch || 3);
                return `
                  <tr>
                    <td>${dayNames[dayIdx]}</td>
                    <td>${count} matches</td>
                    <td>₹${earned}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }).join('');
  }

  function renderSettingsValues() {
    const rateInput = document.getElementById('setting-rate');
    if (rateInput && document.activeElement !== rateInput) {
      rateInput.value = state.settings.ratePerMatch || 3;
    }
    const idpInput = document.getElementById('setting-idp-url');
    if (idpInput && document.activeElement !== idpInput) {
      idpInput.value = state.settings.idpUrlBase || 'https://skillclash.site/admin2020/matches/edit/';
    }
    const winInput = document.getElementById('setting-win-url');
    if (winInput && document.activeElement !== winInput) {
      winInput.value = state.settings.winningUrlBase || 'https://skillclash.site/admin2020/matches/member_join_match/';
    }
    const soundCb = document.getElementById('setting-sound');
    if (soundCb) soundCb.checked = !!state.settings.soundEnabled;
    const hapticCb = document.getElementById('setting-haptic');
    if (hapticCb) hapticCb.checked = !!state.settings.hapticEnabled;
  }

  // --- Tab Navigation System ---
  function switchTab(targetTabId) {
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      if (btn.dataset.tab === targetTabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      if (pane.id === targetTabId) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    playBeep('click');
    triggerHaptic();
    renderAll();
  }

  // --- Initial Setup & Event Listeners ---
  function init() {
    loadState();

    // Auto update live clock every second
    setInterval(() => {
      renderHeader();
      renderLiveDashboard();
    }, 1000);

    // Navigation Tabs Click
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Time Travel / Simulation Buttons (Testing Tool)
    document.querySelectorAll('.sim-pill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const timeVal = e.target.dataset.time;
        if (timeVal === 'real') {
          state.simulatedMinutes = null;
          showToast('Switched to Real System Clock ✓', 'orange');
        } else {
          const [h, m] = timeVal.split(':').map(Number);
          state.simulatedMinutes = h * 60 + m;
          showToast(`Simulating ${timeVal} (5-min rule test) ✓`, 'orange');
        }
        playBeep('click');
        renderAll();
      });
    });

    // Sequential Count Override Controls in Tab 3
    const inputCountOverride = document.getElementById('input-count-override');
    const btnSetCount = document.getElementById('btn-set-count');
    if (inputCountOverride && btnSetCount) {
      inputCountOverride.value = state.manualCountStart || 1;
      btnSetCount.onclick = () => {
        const val = parseInt(inputCountOverride.value, 10);
        if (!isNaN(val) && val >= 1) {
          state.manualCountStart = val;
          recalculateCounts();
          saveState();
          showToast(`Sequential Count Start set to #${val} ✓`, 'success');
          renderAll();
        }
      };
    }

    // Generator Tab Logic
    const genDateInput = document.getElementById('gen-date');
    if (genDateInput) genDateInput.value = state.activeDate;
    
    const in10 = document.getElementById('gen-10-00');
    const in11 = document.getElementById('gen-11-00');
    const in11_15 = document.getElementById('gen-11-15');
    const in11_30 = document.getElementById('gen-11-30');
    const in11_45 = document.getElementById('gen-11-45');

    // Live auto-calculation indicator for 11:00 block
    function updateAutoCalcIndicators() {
      const base11 = parseInt(in11.value, 10);
      const lbl15 = document.getElementById('lbl-auto-11-15');
      const lbl30 = document.getElementById('lbl-auto-11-30');
      const lbl45 = document.getElementById('lbl-auto-11-45');

      if (!isNaN(base11)) {
        if (lbl15) lbl15.textContent = in11_15.value ? '(Custom Override)' : `(Auto: Base+12 = ${base11 + 12})`;
        if (lbl30) lbl30.textContent = in11_30.value ? '(Custom Override)' : `(Auto: Base+24 = ${base11 + 24})`;
        if (lbl45) lbl45.textContent = in11_45.value ? '(Custom Override)' : `(Auto: Base+36 = ${base11 + 36})`;
      } else {
        if (lbl15) lbl15.textContent = '(Base + 12)';
        if (lbl30) lbl30.textContent = '(Base + 24)';
        if (lbl45) lbl45.textContent = '(Base + 36)';
      }
    }

    [in11, in11_15, in11_30, in11_45].forEach(el => {
      if (el) el.addEventListener('input', updateAutoCalcIndicators);
    });

    const btnGenerate = document.getElementById('btn-generate-schedule');
    if (btnGenerate) {
      btnGenerate.onclick = () => {
        const val10 = in10.value.trim();
        const val11 = in11.value.trim();
        if (!val10 || !val11) {
          showToast('Please enter at least 10:00 AM and 11:00 AM numbers!', 'orange');
          return;
        }

        const dateYMD = document.getElementById('gen-date')?.value || state.activeDate;
        const matches = generateSchedule(dateYMD, val10, val11, in11_15.value.trim(), in11_30.value.trim(), in11_45.value.trim());

        if (matches && matches.length === 49) {
          state.todayMatches = matches;
          state.activeDate = dateYMD;
          recalculateCounts();
          saveState();
          playBeep('success');
          triggerHaptic();
          showToast('49 Matches Generated Successfully! ✓', 'success');
          switchTab('tab-today');
        } else {
          showToast('Generation failed. Please verify input numbers.', 'orange');
        }
      };
    }

    const btnSampleFill = document.getElementById('btn-sample-fill');
    if (btnSampleFill) {
      btnSampleFill.onclick = () => {
        in10.value = '336101';
        in11.value = '336201';
        in11_15.value = '';
        in11_30.value = '';
        in11_45.value = '';
        updateAutoCalcIndicators();
        playBeep('click');
        showToast('Sample Match Numbers Filled ✓', 'orange');
      };
    }

    const btnClearGen = document.getElementById('btn-clear-gen');
    if (btnClearGen) {
      btnClearGen.onclick = () => {
        in10.value = '';
        in11.value = '';
        in11_15.value = '';
        in11_30.value = '';
        in11_45.value = '';
        updateAutoCalcIndicators();
        playBeep('click');
      };
    }

    // Search and Filter Listeners
    document.getElementById('input-match-search')?.addEventListener('input', renderTodaysMatches);
    document.getElementById('select-match-filter')?.addEventListener('change', renderTodaysMatches);
    document.getElementById('input-history-search')?.addEventListener('input', renderHistory);
    document.getElementById('select-history-filter')?.addEventListener('change', renderHistory);

    // Settings Inputs Auto-Save
    const rateInput = document.getElementById('setting-rate');
    if (rateInput) {
      rateInput.addEventListener('change', () => {
        const val = parseInt(rateInput.value, 10);
        if (!isNaN(val) && val >= 1) {
          state.settings.ratePerMatch = val;
          saveState();
          showToast(`Saved ✓ Rate set to ₹${val}`, 'success');
          renderAll();
        }
      });
    }

    const idpInput = document.getElementById('setting-idp-url');
    if (idpInput) {
      if (state.settings.idpUrlBase) idpInput.value = state.settings.idpUrlBase;
      idpInput.addEventListener('change', () => {
        state.settings.idpUrlBase = idpInput.value.trim();
        saveState();
        showToast('Saved ✓ IDP link updated', 'success');
        renderAll();
      });
    }

    const winInput = document.getElementById('setting-win-url');
    if (winInput) {
      if (state.settings.winningUrlBase) winInput.value = state.settings.winningUrlBase;
      winInput.addEventListener('change', () => {
        state.settings.winningUrlBase = winInput.value.trim();
        saveState();
        showToast('Saved ✓ Winning link updated', 'success');
        renderAll();
      });
    }

    const soundCb = document.getElementById('setting-sound');
    if (soundCb) {
      soundCb.addEventListener('change', () => {
        state.settings.soundEnabled = soundCb.checked;
        saveState();
        showToast(`Sound ${soundCb.checked ? 'Enabled' : 'Disabled'} ✓`, 'orange');
      });
    }

    const hapticCb = document.getElementById('setting-haptic');
    if (hapticCb) {
      hapticCb.addEventListener('change', () => {
        state.settings.hapticEnabled = hapticCb.checked;
        saveState();
        showToast(`Haptics ${hapticCb.checked ? 'Enabled' : 'Disabled'} ✓`, 'orange');
      });
    }

    // Export JSON Backup
    const btnExport = document.getElementById('btn-export-json');
    if (btnExport) {
      btnExport.onclick = () => {
        const dataStr = JSON.stringify(state, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `freefire_hosting_backup_${state.activeDate}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Exported Backup JSON ✓', 'success');
      };
    }

    // Import JSON Backup
    const fileImportInput = document.getElementById('input-import-json');
    if (fileImportInput) {
      fileImportInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const imported = JSON.parse(evt.target.result);
            if (imported.todayMatches || imported.settings) {
              state = Object.assign(state, imported);
              recalculateCounts();
              saveState();
              showToast('Backup JSON Restored Successfully! ✓', 'success');
              renderAll();
            } else {
              showToast('Invalid backup file format.', 'orange');
            }
          } catch (err) {
            showToast('Failed to read JSON file.', 'orange');
          }
        };
        reader.readAsText(file);
      });
    }

    // Reset All Data Button
    const btnResetAll = document.getElementById('btn-reset-data');
    if (btnResetAll) {
      btnResetAll.onclick = () => {
        if (confirm('Are you sure you want to reset all matches, history, and earnings back to defaults?')) {
          localStorage.removeItem(STORAGE_KEY);
          state = {
            settings: {
              ratePerMatch: 3,
              countStartOverride: 1,
              idpUrlBase: 'https://skillclash.site/admin2020/matches/edit/',
              winningUrlBase: 'https://skillclash.site/admin2020/matches/member_join_match/',
              soundEnabled: true,
              hapticEnabled: true
            },
            todayMatches: [],
            history: [],
            activeDate: getTodayYMD(),
            manualCountStart: 1,
            simulatedMinutes: null
          };
          generateSampleMatches(336101, 336201);
          showToast('All Data Reset to Defaults ✓', 'orange');
          renderAll();
        }
      };
    }

    // Global helper exposed for onclick handlers
    window.ffApp = {
      copyMatch: (id) => {
        const m = state.todayMatches.find(x => x.id === id);
        if (m) copyMatchString(m);
      },
      completeMatch: (id) => handleCompleteMatch(id),
      cancelMatch: (id) => handleCancelMatch(id),
      undoHistory: (id) => handleUndoHistory(id)
    };

    updateAutoCalcIndicators();
    renderAll();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
