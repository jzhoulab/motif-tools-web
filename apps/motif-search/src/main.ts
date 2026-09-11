// @ts-nocheck
import './style.css';
import { embedLogo } from './logo';
import { DATABASES, DB_ORDER } from './databases';
import { BASES, BASE_IDX, COMP, IUPAC, LOGO_LIMIT } from './constants';
// @ts-ignore
import SearchWorker from './worker?worker&inline';
    const worker = new SearchWorker();

    const $ = (sel) => document.querySelector(sel);
    const tbody = $("#results tbody");
    const q = $("#query"), stat = $("#stats"), err = $("#error"), dbname = $("#dbname"), motcount = $("#motcount");
    const file = $("#file"), loadBtn = $("#loadBtn"), rcBox = $("#rc"), rankModeSel = $("#rankMode"), modeSel = $("#modeSelect");
    const scoreHeader = document.querySelector('th[data-sort="score"]');
    const llrHeader = document.querySelector('th[data-sort="llr"]');

    let currentSort = { key: "score", dir: "desc" };
    let lastResults = [];
    let currentMode = modeSel ? modeSel.value : "ncc";
    let rankMode = rankModeSel ? rankModeSel.value : "ncc"; // "ncc" or "llr"
    let rnaMode = false;
    // Display helper: RNA databases store U in the T slot internally
    const toDisplaySeq = (s) => rnaMode ? String(s).replace(/T/g, "U").replace(/t/g, "u") : s;

    function updateModeUI() {
      if (rankModeSel) rankModeSel.disabled = currentMode === "tomtom";
      if (scoreHeader) scoreHeader.textContent = (currentMode === "tomtom") ? "p-value" : "Score";
      if (llrHeader) {
        if (currentMode === "tomtom") {
          llrHeader.style.display = "none";
        } else {
          llrHeader.style.display = "";
          llrHeader.textContent = "LLR (bits)";
        }
      }
    }

    updateModeUI();
    if (modeSel) {
      modeSel.addEventListener("change", () => {
        currentMode = modeSel.value;
        updateModeUI();
        if (currentMode === "tomtom") {
          currentSort.key = "pvalue";
          currentSort.dir = "asc";
        } else {
          rankMode = rankModeSel ? rankModeSel.value : "ncc";
          currentSort.key = (rankMode === "ncc") ? "score" : "llr";
          currentSort.dir = "desc";
        }
        scheduleQuery();
      });
    }


    // --- MEME PARSER ---
    function parseMeme(text) {
      const lines = text.split(/\r?\n/);
      const motifs = [];

      let alphabet = 'dna';
      let currentId = null;
      let currentName = null;
      let matrixRows = [];
      let inMatrix = false;

      const finalizeMotif = () => {
        if (!currentId || matrixRows.length === 0) return;

        // Transpose L x 4 (MEME) -> 4 x L (App internal)
        const L = matrixRows.length;
        const pwm = [[], [], [], []]; // A, C, G, T
        let consensus = "";
        const bases = ['A', 'C', 'G', 'T'];

        for (let i = 0; i < L; i++) {
          let maxVal = -1;
          let maxIdx = 0;
          for (let b = 0; b < 4; b++) {
            const val = matrixRows[i][b];
            pwm[b].push(val);
            if (val > maxVal) {
              maxVal = val;
              maxIdx = b;
            }
          }
          consensus += bases[maxIdx];
        }

        motifs.push({
          id: currentId,
          name: currentName || currentId,
          pwm: pwm,
          consensus: consensus
        });
      };

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('#')) continue;

        if (trimmed.toUpperCase().startsWith('ALPHABET')) {
          if (trimmed.toUpperCase().replace('ALPHABET', '').includes('U')) alphabet = 'rna';
          continue;
        }

        if (trimmed.startsWith("MOTIF")) {
          if (currentId) finalizeMotif();
          const parts = trimmed.split(/\s+/);
          currentId = parts[1];
          currentName = parts.slice(2).join(" ") || parts[1];
          matrixRows = [];
          inMatrix = false;
          continue;
        }

        if (trimmed.startsWith("letter-probability matrix")) {
          inMatrix = true;
          continue;
        }

        if (inMatrix) {
          const parts = trimmed.split(/\s+/);
          if (!/^[0-9.]/.test(parts[0])) {
            inMatrix = false;
            continue;
          }
          const nums = parts.slice(0, 4).map(parseFloat);
          if (nums.length >= 4 && !nums.some(isNaN)) {
            matrixRows.push(nums);
          } else {
            inMatrix = false;
          }
        }
      }
      if (currentId) finalizeMotif();

      if (motifs.length === 0) throw new Error("No valid motifs found in MEME file.");
      return { name: "Imported MEME", motifs, alphabet };
    }

    // --- MULTI-SELECT DATABASE LOGIC ---
    // DNA databases combine into one search set; RNA is its own alphabet and is
    // never mixed with DNA (the chip UI enforces this). Custom uploads are their
    // own single selection.
    let selectedKeys = ['jaspar'];
    let customDb = null;
    const chipHost = document.getElementById('dbChips');

    function entriesFor(keys) {
      return keys.map(k => k === 'custom' ? customDb : DATABASES[k]).filter(Boolean);
    }

    function combineSelected() {
      const entries = entriesFor(selectedKeys);
      let alphabet = 'dna';
      const motifs = [];
      const names = [];
      for (const db of entries) {
        const d = (db.type === 'meme') ? parseMeme(db.data) : db.data;
        const a = d.alphabet || db.alphabet || 'dna';
        if (a === 'rna') alphabet = 'rna';
        for (const m of d.motifs) motifs.push(m);
        names.push(db.name);
      }
      const name = entries.length === 1 ? names[0] : `${entries.length} databases`;
      return { name, motifs, alphabet };
    }

    function loadSelected() {
      const entries = entriesFor(selectedKeys);
      if (!entries.length) return;
      dbname.textContent = "Loading...";
      stat.textContent = "processing...";
      try {
        const data = combineSelected();
        rnaMode = data.alphabet === 'rna';
        rcBox.checked = !rnaMode;
        worker.postMessage({ type: "load-db", payload: data });
      } catch (ex) {
        showError(`Failed to load databases: ${ex.message}`);
        dbname.textContent = "Error";
        stat.textContent = "error";
      }
    }

    function toggleDb(key) {
      const db = DATABASES[key];
      const base = selectedKeys.filter(k => k !== 'custom');
      if (db.alphabet === 'rna') { selectedKeys = [key]; }
      else {
        const baseAlpha = base.length ? DATABASES[base[0]].alphabet : 'dna';
        if (baseAlpha === 'rna') selectedKeys = [key];
        else if (base.includes(key)) {
          const next = base.filter(k => k !== key);
          selectedKeys = next.length ? next : base;
        } else selectedKeys = [...base, key];
      }
      renderChips();
      loadSelected();
    }

    function renderChips() {
      if (!chipHost) return;
      chipHost.innerHTML = "";
      const mk = (key, label, alphabet, active) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (active ? ' active' : '');
        b.title = key === 'custom' && customDb ? customDb.name : (DATABASES[key] ? DATABASES[key].name : label);
        const dot = document.createElement('i');
        dot.className = 'dot ' + (alphabet === 'rna' ? 'rna' : (key === 'custom' ? 'custom' : 'dna'));
        b.appendChild(dot);
        b.appendChild(document.createTextNode(label));
        return b;
      };
      for (const key of DB_ORDER) {
        const db = DATABASES[key];
        const b = mk(key, db.short, db.alphabet, selectedKeys.includes(key));
        b.addEventListener('click', () => toggleDb(key));
        chipHost.appendChild(b);
      }
      if (customDb) {
        const b = mk('custom', 'Custom', customDb.alphabet, selectedKeys.includes('custom'));
        b.addEventListener('click', () => { selectedKeys = ['custom']; renderChips(); loadSelected(); });
        chipHost.appendChild(b);
      }
    }

    loadBtn.addEventListener("click", () => file.click());

    file.addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const txt = await f.text();
        let parsed;
        try { parsed = JSON.parse(txt); }
        catch (e) { parsed = parseMeme(txt); }
        const alphabet = (parsed && parsed.alphabet === 'rna') ? 'rna' : 'dna';
        customDb = { name: f.name, short: f.name, data: parsed, type: 'json', alphabet };
        selectedKeys = ['custom'];
        renderChips();
        loadSelected();
        e.target.value = '';
      } catch (ex) {
        showError("Failed to read file: " + ex.message);
      }
    });

    if (rankModeSel) {
    rankModeSel.addEventListener("change", () => {
        if (currentMode === "tomtom") return;
      rankMode = rankModeSel.value;
      currentSort.key = (rankMode === "ncc") ? "score" : "llr";
      currentSort.dir = "desc";
      sortAndRender(lastResults);
    });
    }

    function showError(m) { err.style.display = "block"; err.textContent = m; }
    function clearError() { err.style.display = "none"; err.textContent = ""; }

    function render(rows) {
      tbody.innerHTML = "";
      const fmt3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : "—");
      const fmtP = (p) => {
        if (!Number.isFinite(p) || p <= 0) return "<1e-300";
        if (p >= 0.01) return p.toFixed(4);
        return p.toExponential(2);
      };

      if (currentMode === "tomtom") {
        rows.forEach((r, i) => {
          const disp = r.tomtom;
          if (!disp) return;
          const pDisplay = fmtP(disp.pvalue);
          const neg = Number.isFinite(disp.neglogp) ? disp.neglogp : (disp.pvalue > 0 ? -Math.log10(disp.pvalue) : Infinity);
          const barPct = Math.max(0, Math.min(1, (neg || 0) / 8)) * 100;
          const tr = document.createElement("tr");
          const logoValues = r.logoColsTom || r.logoCols;
          tr.innerHTML = `
        <td>${i + 1}</td>
        <td class="motif"><span class="truncate mono" title="${escapeHtml(r.id)}">${escapeHtml(r.id)}</span></td>
        <td>${r.len}</td>
        <td data-col="pvalue">${pDisplay}</td>
        <td><div class="scorebar"><div style="width:${barPct}%"></div></div></td>
        <td class="logo"><div id="logo-${i}"></div></td>
        <td><span class="pill">${disp.ori}</span></td>
        <td class="mono right">${disp.offset >= 0 ? "+" + disp.offset : disp.offset}</td>
        <td class="mono right">${disp.overlap}</td>
        <td class="mono best-overlap"><pre>${escapeHtml(toDisplaySeq(disp.preview || ""))}</pre></td>
      `;
          tbody.appendChild(tr);

          if (logoValues && i < LOGO_LIMIT) {
            const container = tr.querySelector(`#logo-${i}`);
            embedLogo(container, {
              values: logoValues,
              rna: rnaMode,
              glyphWidth: 14,
              stackHeight: 40,
              negativealpha: .25,
              outsideAlpha: .25,
              highlightStart: disp.mStart || 0,
              highlightLen: disp.overlap || 0
            });
          }
        });
        return;
      }

      rows.forEach((r, i) => {
        const disp = (rankMode === "ncc") ? r.ncc : r.llr;
        if (!disp) return;
        const dispScore = (rankMode === "ncc") ? r.ncc.score : r.llr.sum;
        const barPct = (rankMode === "ncc")
          ? Math.max(0, Math.min(1, (dispScore + 1) / 2)) * 100
          : Math.max(0, Math.min(1, (dispScore + 10) / 20)) * 100; // rough scale

        const tr = document.createElement("tr");
        const logoValues = r.logoCols;
        tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="motif"><span class="truncate mono" title="${escapeHtml(r.id)}">${escapeHtml(r.id)}</span></td>
      <td>${r.len}</td>
      <td>${fmt3(r.ncc.score)}</td>
      <td><div class="scorebar"><div style="width:${barPct}%"></div></div></td>
      <td>${fmt3(r.llr.sum)}</td>
      <td class="logo"><div id="logo-${i}"></div></td>
      <td><span class="pill">${disp.ori}</span></td>
      <td class="mono right">${disp.offset >= 0 ? "+" + disp.offset : disp.offset}</td>
      <td class="mono right">${disp.overlap}</td>
      <td class="mono best-overlap"><pre>${escapeHtml(toDisplaySeq(disp.preview))}</pre></td>
    `;
        tbody.appendChild(tr);

        if (logoValues && i < LOGO_LIMIT) {
          const container = tr.querySelector(`#logo-${i}`);
          const hlStart = (rankMode === "ncc") ? r.ncc.mStart : r.llr.mStart;
          const hlLen = (rankMode === "ncc") ? r.ncc.overlap : r.llr.overlap;
          embedLogo(container, {
            values: logoValues,
            rna: rnaMode,
            glyphWidth: 14, stackHeight: 40,
            negativealpha: .25, outsideAlpha: .25,
            highlightStart: hlStart || 0, highlightLen: hlLen || 0
          });
        }
      });
    }

    function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    document.querySelectorAll("th[data-sort]").forEach(th => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort");
        if (currentSort.key === key) { currentSort.dir = (currentSort.dir === "asc" ? "desc" : "asc"); }
        else { currentSort.key = key; currentSort.dir = "desc"; }
        sortAndRender(lastResults);
      });
    });

    function sortAndRender(list) {
      const dir = currentSort.dir === "asc" ? 1 : -1;
      const arr = [...list].sort((a, b) => {
        if (currentMode === "tomtom") {
        const ta = a.tomtom || {};
          const tb = b.tomtom || {};
          const key = currentSort.key;
          if (key === "score" || key === "pvalue") return dir * (((ta.pvalue ?? 1) - (tb.pvalue ?? 1)));
          if (key === "overlap") return dir * (((ta.overlap ?? 0) - (tb.overlap ?? 0)));
          if (key === "offset") return dir * (((ta.offset ?? 0) - (tb.offset ?? 0)));
          if (key === "ori") return dir * String(ta.ori || "").localeCompare(String(tb.ori || ""));
          if (key === "len") return dir * ((a.len || 0) - (b.len || 0));
          if (key === "id") return dir * String(a.id).localeCompare(String(b.id));
          return dir * (((ta.pvalue ?? 1) - (tb.pvalue ?? 1)));
        }
        const k = currentSort.key;
        if (k === "score") { return dir * ((a.ncc.score || -Infinity) - (b.ncc.score || -Infinity)); }
        if (k === "llr") { return dir * ((a.llr.sum || -Infinity) - (b.llr.sum || -Infinity)); }
        const da = (rankMode === "ncc") ? a.ncc : a.llr;
        const db = (rankMode === "ncc") ? b.ncc : b.llr;
        if (k === "overlap") return dir * ((da.overlap || 0) - (db.overlap || 0));
        if (k === "offset") return dir * ((da.offset || 0) - (db.offset || 0));
        if (k === "ori") return dir * String(da.ori).localeCompare(String(db.ori));
        if (k === "len") return dir * ((a.len || 0) - (b.len || 0));
        if (k === "id") return dir * String(a.id).localeCompare(String(b.id));
        return 0;
      });
      render(arr);
    }

    let raf = null;
    function scheduleQuery() {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        worker.postMessage({ type: "query", payload: { text: q.value, rc: rcBox.checked, mode: currentMode } });
      });
    }
    q.addEventListener("input", scheduleQuery);
    rcBox.addEventListener("change", scheduleQuery);

    worker.onmessage = (e) => {
      const { type, results, message, name, count, mode } = e.data;
      if (type === "loaded") {
        dbname.textContent = name;
        motcount.textContent = count;
        stat.textContent = "ready";
        clearError();
        scheduleQuery();
        return;
      }
      if (type === "results") {
        if (mode && mode !== currentMode) return;
        lastResults = results || [];
        if (currentMode === "tomtom") {
          currentSort.key = "pvalue";
          currentSort.dir = "asc";
          stat.textContent = (results?.length ? `${results.length} TomTom hits` : "no matches");
        } else {
        currentSort.key = (rankMode === "ncc") ? "score" : "llr";
        currentSort.dir = "desc";
        stat.textContent = (results?.length ? `${results.length} matches (top)` : "no matches");
        }
        sortAndRender(lastResults);
        clearError();
        return;
      }
      if (type === "error") {
        showError(message || "Unknown error");
      }
    };

    /* preload default */
    renderChips();
    loadSelected();
    q.focus();
