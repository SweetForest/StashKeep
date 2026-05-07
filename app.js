const LOCAL_STORAGE_KEY = "local_stash_array";
const LOCAL_STORAGE_LIMIT_KEY = "local_stash_limit";
const LOCAL_LANG_KEY = "local_stash_lang";
const LOCAL_THEME_KEY = "local_stash_theme";

let SUPPORTED_LANGUAGES = {};
let MAX_STORAGE_BYTES = 4096;
let stashItems = [];
let deleteTimeouts = {};
let stashConfirmTimeout = null;
let pendingCleanCount = 0;
let draggedCardId = null;
let currentLang = "en";
let translations = {};
let currentSearchQuery = "";
let currentFilterTag = "";

const TYPE_MAP = {
    "": "text",
    "2": "md"
};


function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(LOCAL_THEME_KEY, theme);
    const btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = theme === "light" ? "🌙" : "☀️";
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
}


window.onload = async function () {
    const savedTheme = localStorage.getItem(LOCAL_THEME_KEY) || "light";
    applyTheme(savedTheme);
    detectAndSetStorageLimit(false);
    await initLanguageSystem();
    loadFromStorage();
    renderStash();
    updateStorageMonitor();
    setupSearch();
    renderTagFilter();
};

function getByteSize(str) {
    return new Blob([str]).size;
}

function getWordCount(str) {
    return str.trim() === "" ? 0 : str.trim().split(/\s+/).length;
}

function detectAndSetStorageLimit(force = false) {
    const savedLimit = localStorage.getItem(LOCAL_STORAGE_LIMIT_KEY);
    if (savedLimit && !force) {
        MAX_STORAGE_BYTES = parseInt(savedLimit, 10);
        return;
    }
    const testKey = "__storage_capacity_test__";
    let min = 0, max = 10 * 1024 * 1024, detectedLimit = 0;
    localStorage.removeItem(testKey);
    while (min <= max) {
        let mid = Math.floor((min + max) / 2);
        try {
            localStorage.setItem(testKey, "X".repeat(mid));
            detectedLimit = mid;
            min = mid + 1;
        } catch (e) {
            max = mid - 1;
        }
    }
    localStorage.removeItem(testKey);
    const currentUsedBytes = getByteSize(JSON.stringify(stashItems));
    const finalLimit = detectedLimit + currentUsedBytes;
    if (finalLimit > 0) {
        MAX_STORAGE_BYTES = finalLimit;
        localStorage.setItem(LOCAL_STORAGE_LIMIT_KEY, finalLimit.toString());
    } else {
        MAX_STORAGE_BYTES = 4096;
        localStorage.setItem(LOCAL_STORAGE_LIMIT_KEY, "4096");
    }
}


async function initLanguageSystem() {
    try {
        const response = await fetch("lang/languages.json");
        if (!response.ok) throw new Error();
        SUPPORTED_LANGUAGES = await response.json();
    } catch (e) {
        SUPPORTED_LANGUAGES = { "en": "English" };
    }
    renderLanguageSelector();
    const savedLang = localStorage.getItem(LOCAL_LANG_KEY);
    const browserLang = navigator.language.slice(0, 2);
    let targetLang = "en";
    if (savedLang && SUPPORTED_LANGUAGES[savedLang]) targetLang = savedLang;
    else if (SUPPORTED_LANGUAGES[browserLang]) targetLang = browserLang;
    else {
        const keys = Object.keys(SUPPORTED_LANGUAGES);
        if (keys.length > 0) targetLang = keys[0];
    }
    await loadLanguage(targetLang);
}

function renderLanguageSelector() {
    const selector = document.getElementById("langSelector");
    if (!selector) return;
    selector.innerHTML = "";
    Object.keys(SUPPORTED_LANGUAGES).forEach(code => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = SUPPORTED_LANGUAGES[code];
        selector.appendChild(opt);
    });
}

async function loadLanguage(langCode) {
    try {
        const response = await fetch(`lang/${langCode}.json`);
        if (!response.ok) throw new Error();
        translations = await response.json();
        currentLang = langCode;
        localStorage.setItem(LOCAL_LANG_KEY, langCode);
        const selector = document.getElementById("langSelector");
        if (selector) selector.value = langCode;
        translateUI();
    } catch (error) {
        translations = {
            "subtitle": "Save text in Local Storage. Raw Text, Markdown.",
            "storage_space": "Local Storage Space",
            "input_placeholder": "Type plain text or Markdown here...",
            "add_title_placeholder": "Add title...",
            "stash_button": "Stash It",
            "pinned_section": "Pinned",
            "notes_section": "Notes",
            "empty_state": "No stashed items found.",
            "untitled_note": "Untitled note",
            "card_placeholder_title": "Edit title...",
            "unpin_btn": "📌 Unpin",
            "pin_btn": "📌 Pin",
            "delete_btn": "🗑️ Delete",
            "delete_confirm": "⚠️ Confirm",
            "copied_btn": "✅ Copied!",
            "copy_btn": "📋 Copy",
            "char_counter": "{count} characters"
        };
        currentLang = "en";
        const selector = document.getElementById("langSelector");
        if (selector) selector.value = "en";
    }
}

async function changeLanguage(langCode) {
    await loadLanguage(langCode);
    renderStash();
    updateInputStats();
}

function t(key, replacements = {}) {
    let text = translations[key] || key;
    Object.keys(replacements).forEach(p => {
        text = text.replace(`{${p}}`, replacements[p]);
    });
    return text;
}

function translateUI() {
    const el = (id) => document.getElementById(id);
    if (el("subtext")) el("subtext").textContent = t("subtitle");
    if (el("labelStorage")) el("labelStorage").textContent = t("storage_space");
    if (el("mainInput")) el("mainInput").placeholder = t("input_placeholder");
    if (el("mainTitle")) el("mainTitle").placeholder = t("add_title_placeholder");
    if (el("pinnedTitle")) el("pinnedTitle").textContent = t("pinned_section");
    if (el("notesTitle")) el("notesTitle").textContent = t("notes_section");
    if (el("emptyMessage")) el("emptyMessage").textContent = t("empty_state");
    const btnAdd = el("btnAdd");
    if (btnAdd && !btnAdd.classList.contains("btn-add-warn")) {
        btnAdd.textContent = t("stash_button");
    }
}


function loadFromStorage() {
    const rawData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (rawData) {
        try {
            stashItems = JSON.parse(rawData);
            stashItems.forEach(item => {
                delete item.unlockedSession;
                delete item.activeKeyTemp;
                delete item.decryptedContentTemp;
                if (!item.tags) item.tags = [];
            });
        } catch (e) {
            stashItems = [];
        }
    }
}

function saveToStorage() {
    const cleanItems = stashItems.map(item => {
        const c = { ...item };
        delete c.unlockedSession;
        delete c.activeKeyTemp;
        delete c.decryptedContentTemp;
        return c;
    });
    const jsonString = JSON.stringify(cleanItems);
    try {
        if (getByteSize(jsonString) > MAX_STORAGE_BYTES) throw new Error();
        localStorage.setItem(LOCAL_STORAGE_KEY, jsonString);
        updateStorageMonitor();
        return true;
    } catch (e) {
        return false;
    }
}

function calculateCurrentBytes() {
    if (stashItems.length === 0) return 0;
    const cleanItems = stashItems.map(item => {
        const c = { ...item };
        delete c.unlockedSession;
        delete c.activeKeyTemp;
        delete c.decryptedContentTemp;
        return c;
    });
    return getByteSize(JSON.stringify(cleanItems));
}

function updateStorageMonitor() {
    const currentBytes = calculateCurrentBytes();
    const percentage = Math.min((currentBytes / MAX_STORAGE_BYTES) * 100, 100).toFixed(1);
    const storageText = document.getElementById("storageText");
    const progressBar = document.getElementById("progressBar");
    if (storageText && progressBar) {
        storageText.textContent = `${currentBytes.toLocaleString()} / ${MAX_STORAGE_BYTES.toLocaleString()} Bytes (${percentage}%)`;
        progressBar.style.width = `${percentage}%`;
        progressBar.className = "progress-bar";
        if (percentage > 90) progressBar.classList.add("danger");
        else if (percentage > 70) progressBar.classList.add("warning");
    }
}

function compileMarkdown(md) {
    if (!md) return "";
    
    marked.setOptions({
        breaks: true,
        gfm: true
    });

    return marked.parse(md);
}

function insertMd(before, after) {
    const textarea = document.getElementById("mainInput");
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const fullText = textarea.value;
    const selectedText = fullText.substring(start, end);
    
    const newText = fullText.substring(0, start) + before + selectedText + after + fullText.substring(end);
    textarea.value = newText;
    
    textarea.focus();
    const newCursorPos = start + before.length + selectedText.length + after.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);
    updateInputStats();
}


function parseStashText(rawText) {
    let title = "", type = "", text = rawText;
    if (rawText.startsWith("[")) {
        const closingIndex = rawText.indexOf("]");
        if (closingIndex !== -1) {
            const rawHeader = rawText.substring(1, closingIndex).trim();
            text = rawText.substring(closingIndex + 1);
            const match = rawHeader.match(/^(.*?)(?:\.(2))?$/);
            if (match) {
                title = match[1] ? match[1].trim() : "";
                type = match[2] || "";
            }
        }
    }
    return { title, type, text };
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}



async function getKeyMaterial(password) {
    return window.crypto.subtle.importKey(
        "raw", new TextEncoder().encode(password),
        { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]
    );
}

async function deriveKey(password, salt) {
    const km = await getKeyMaterial(password);
    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        km, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

async function cryptEngine(text, password) {
    if (!password) return text;
    try {
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt);
        const enc = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key, new TextEncoder().encode("SECURE|" + text)
        );
        const out = new Uint8Array(salt.byteLength + iv.byteLength + enc.byteLength);
        out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(enc), 28);
        return btoa(String.fromCharCode(...out));
    } catch (e) { return ""; }
}

async function decryptEngine(base64Text, password) {
    if (!password) return base64Text;
    try {
        const bytes = Uint8Array.from(atob(base64Text), c => c.charCodeAt(0));
        const key = await deriveKey(password, bytes.slice(0, 16));
        const dec = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: bytes.slice(16, 28) },
            key, bytes.slice(28)
        );
        const txt = new TextDecoder().decode(dec);
        return txt.startsWith("SECURE|") ? txt.substring(7) : null;
    } catch (e) { return null; }
}


function setupSearch() {
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            currentSearchQuery = e.target.value.toLowerCase();
            renderStash();
        });
    }
}

function getAllTags() {
    const tags = new Set();
    stashItems.forEach(item => (item.tags || []).forEach(t => tags.add(t)));
    return [...tags].sort();
}

function renderTagFilter() {
    const container = document.getElementById("tagFilterContainer");
    if (!container) return;
    const allTags = getAllTags();
    if (allTags.length === 0) {
        container.style.display = "none";
        return;
    }
    container.style.display = "flex";
    container.innerHTML = `<span class="tag-filter-label">Tags:</span>`;
    const allBtn = document.createElement("button");
    allBtn.className = "tag-filter-btn" + (currentFilterTag === "" ? " active" : "");
    allBtn.textContent = "All";
    allBtn.onclick = () => { currentFilterTag = ""; renderTagFilter(); renderStash(); };
    container.appendChild(allBtn);
    allTags.forEach(tag => {
        const btn = document.createElement("button");
        btn.className = "tag-filter-btn" + (currentFilterTag === tag ? " active" : "");
        btn.textContent = "#" + tag;
        btn.onclick = () => { currentFilterTag = tag; renderTagFilter(); renderStash(); };
        container.appendChild(btn);
    });
}

function filterItems(items) {
    return items.filter(item => {
        const { title, text } = parseStashText(item.text);
        const searchable = (title + " " + text + " " + (item.tags || []).join(" ")).toLowerCase();
        const matchSearch = !currentSearchQuery || searchable.includes(currentSearchQuery);
        const matchTag = !currentFilterTag || (item.tags || []).includes(currentFilterTag);
        return matchSearch && matchTag;
    });
}


async function handleStashClick() {
    const input = document.getElementById("mainInput");
    const titleInput = document.getElementById("mainTitle");
    const typeSelect = document.getElementById("mainType");
    const keyInput = document.getElementById("mainKey");
    const tagInput = document.getElementById("mainTags");
    const rawText = input.value;
    const titleText = titleInput.value.trim();
    const selectedType = typeSelect.value;
    const secretKey = keyInput.value;
    const tags = tagInput ? tagInput.value.split(",").map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    if (!rawText.trim()) return;
    const btn = document.getElementById("btnAdd");
    let headerString = "";
    if (titleText || selectedType) {
        const typeSuffix = selectedType ? `.${selectedType}` : "";
        headerString = `[${titleText}${typeSuffix}] `;
    }
    const processedText = secretKey ? await cryptEngine(rawText, secretKey) : rawText;
    const formattedText = `${headerString}${processedText}`;
    const newItem = {
        id: Date.now().toString(),
        text: formattedText,
        pinned: false,
        time: new Date().toLocaleDateString("en-US"),
        encrypted: !!secretKey,
        tags
    };
    let tempStash = [newItem, ...stashItems];
    let tempBytes = getByteSize(JSON.stringify(tempStash));
    if (tempBytes > MAX_STORAGE_BYTES) {
        if (!btn.classList.contains("btn-add-warn")) {
            let bytesFreed = 0; pendingCleanCount = 0;
            for (let i = stashItems.length - 1; i >= 0; i--) {
                if (!stashItems[i].pinned) {
                    bytesFreed += getByteSize(JSON.stringify(stashItems[i]));
                    pendingCleanCount++;
                    if ((tempBytes - bytesFreed) <= MAX_STORAGE_BYTES) break;
                }
            }
            if ((tempBytes - bytesFreed) > MAX_STORAGE_BYTES) return;
            btn.classList.add("btn-add-warn");
            btn.textContent = t("stash_button_warn", { count: pendingCleanCount });
            stashConfirmTimeout = setTimeout(resetStashButton, 4000);
            return;
        } else {
            clearTimeout(stashConfirmTimeout);
            let removed = 0;
            for (let i = stashItems.length - 1; i >= 0; i--) {
                if (removed >= pendingCleanCount) break;
                if (!stashItems[i].pinned) { stashItems.splice(i, 1); removed++; }
            }
        }
    }
    stashItems.unshift(newItem);
    if (saveToStorage()) {
        input.value = ""; titleInput.value = ""; typeSelect.value = "";
        keyInput.value = ""; if (tagInput) tagInput.value = "";
        updateInputStats();
        renderStash();
        renderTagFilter();
    } else {
        stashItems.shift();
    }
    resetStashButton();
}

function resetStashButton() {
    const btn = document.getElementById("btnAdd");
    if (btn) { btn.className = "btn-add"; btn.textContent = t("stash_button"); pendingCleanCount = 0; }
}


function exportAllData() {
    const cleanItems = stashItems.map(item => {
        const c = { ...item };
        delete c.unlockedSession;
        delete c.activeKeyTemp;
        delete c.decryptedContentTemp;
        return c;
    });
    const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: cleanItems }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stashkeep-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}


function triggerImportAll() {
    
    showImportConfirmModal();
}

function showImportConfirmModal() {
    let modal = document.getElementById("importConfirmModal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "importConfirmModal";
        modal.className = "modal-overlay";
        
        
        modal.innerHTML = `
            <div class="modal-box">
                <div class="modal-icon">⚠️</div>
                <h3 class="modal-title">${translations.import_warn_title}</h3>
                <p class="modal-body">${translations.import_warn_body}</p>
                <div class="modal-actions">
                    <button class="modal-btn modal-btn-cancel" onclick="closeImportConfirmModal()">
                        ${translations.btn_cancel}
                    </button>
                    <button class="modal-btn modal-btn-export" onclick="exportAllData()">
                        ${translations.btn_export_backup}
                    </button>
                    <button class="modal-btn modal-btn-danger" onclick="proceedImportAll()">
                        ${translations.btn_import_danger}
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        
        
        modal.addEventListener("click", (e) => { 
            if (e.target === modal) closeImportConfirmModal(); 
        });
    }

    modal.style.display = "flex";
    requestAnimationFrame(() => modal.classList.add("visible"));
}

function closeImportConfirmModal() {
    const modal = document.getElementById("importConfirmModal");
    if (modal) {
        modal.classList.remove("visible");
        setTimeout(() => { modal.style.display = "none"; }, 200);
    }
}

async function proceedImportAll() {
    closeImportConfirmModal();

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            let items = [];

            
            if (Array.isArray(data)) {
                items = data;
            } else if (data.items && Array.isArray(data.items)) {
                items = data.items;
            } else {
                throw new Error("Format mismatch");
            }

            
            
            items = items.filter(i => i && typeof i.id === "string" && (typeof i.content === "string" || typeof i.text === "string"));
            
            items.forEach(i => { 
                if (!i.tags) i.tags = []; 
                
                if (!i.content && i.text) i.content = i.text;
            });

            
            stashItems = items;

            if (saveToStorage()) {
                renderStash();
                if (typeof renderTagFilter === "function") renderTagFilter();
                
                const msg = translations.import_success.replace("{count}", items.length);
                showToast(msg);
            } else {
                showToast(translations.import_err_size, "danger");
            }
        } catch (err) {
            console.error("Import error:", err);
            showToast(translations.import_err_format, "danger");
        }
    };

    input.click();
}

function triggerImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.txt";
    input.multiple = true;
    input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            const text = await file.text();
            const name = file.name.replace(/\.(md|txt)$/, "");
            const type = file.name.endsWith(".md") ? ".2" : "";
            const newItem = {
                id: Date.now().toString() + Math.random().toString(36).slice(2),
                text: `[${name}${type}] ${text}`,
                pinned: false,
                time: new Date().toLocaleDateString("en-US"),
                encrypted: false,
                tags: []
            };
            stashItems.unshift(newItem);
        }
        saveToStorage();
        renderStash();
        renderTagFilter();
        showToast(`✅ Import ${files.length} success`);
    };
    input.click();
}


function showToast(msg, type = "success") {
    let toast = document.getElementById("stashToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "stashToast";
        toast.className = "stash-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = "stash-toast visible" + (type === "danger" ? " toast-danger" : "");
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove("visible"), 3000);
}


function exportNote(id) {
    const item = stashItems.find(i => i.id === id);
    if (!item) return;
    const { title, type, text } = parseStashText(item.text);
    const displayContent = item.unlockedSession ? item.decryptedContentTemp : text;
    const ext = type === "2" ? "md" : "txt";
    const filename = (title || "untitled") + "." + ext;
    const blob = new Blob([displayContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function exportAllNotes() {
    const items = filterItems(stashItems);
    let combined = "";
    items.forEach(item => {
        const { title, type, text } = parseStashText(item.text);
        const displayContent = item.unlockedSession ? item.decryptedContentTemp : text;
        combined += `# ${title || "Untitled"}\n${displayContent}\n\n---\n\n`;
    });
    const blob = new Blob([combined], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "stash-export.md"; a.click();
    URL.revokeObjectURL(url);
}


function duplicateNote(id) {
    const item = stashItems.find(i => i.id === id);
    if (!item) return;
    const copy = {
        ...item,
        id: Date.now().toString(),
        pinned: false,
        time: new Date().toLocaleDateString("en-US"),
        unlockedSession: false,
        activeKeyTemp: undefined,
        decryptedContentTemp: undefined,
        tags: [...(item.tags || [])]
    };
    const idx = stashItems.findIndex(i => i.id === id);
    stashItems.splice(idx + 1, 0, copy);
    saveToStorage();
    renderStash();
}


function addTagToNote(id, tag) {
    tag = tag.trim().toLowerCase();
    if (!tag) return;
    const item = stashItems.find(i => i.id === id);
    if (!item) return;
    if (!item.tags) item.tags = [];
    if (!item.tags.includes(tag)) {
        item.tags.push(tag);
        saveToStorage();
        renderStash();
        renderTagFilter();
    }
}

function removeTagFromNote(id, tag) {
    const item = stashItems.find(i => i.id === id);
    if (!item) return;
    item.tags = (item.tags || []).filter(t => t !== tag);
    saveToStorage();
    renderStash();
    renderTagFilter();
}


function renderStash() {
    const pinnedList = document.getElementById("pinnedList");
    const notesList = document.getElementById("notesList");
    const pinnedTitle = document.getElementById("pinnedTitle");
    const notesTitle = document.getElementById("notesTitle");
    const emptyMessage = document.getElementById("emptyMessage");
    if (!pinnedList || !notesList) return;
    pinnedList.innerHTML = ""; notesList.innerHTML = "";
    let hasPinned = false, hasNotes = false;
    const filtered = filterItems(stashItems);
    const pinnedItems = filtered.filter(i => i.pinned);
    const normalItems = filtered.filter(i => !i.pinned);
    pinnedItems.forEach(item => { pinnedList.appendChild(createCardElement(item)); hasPinned = true; });
    normalItems.forEach(item => { notesList.appendChild(createCardElement(item)); hasNotes = true; });
    if (pinnedTitle) pinnedTitle.style.display = hasPinned ? "block" : "none";
    if (notesTitle) notesTitle.style.display = (hasNotes && hasPinned) ? "block" : "none";
    if (emptyMessage) emptyMessage.style.display = (hasPinned || hasNotes) ? "none" : "block";
    setupDragAndDrop();
}

function createCardElement(item) {
    const card = document.createElement("div");
    const isLocked = item.encrypted && !item.unlockedSession;
    card.className = `stash-card ${item.pinned ? "pinned" : ""} ${isLocked ? "is-encrypted" : ""}`;
    card.setAttribute("data-id", item.id);
    const textBytes = getByteSize(item.text);
    const { title, type, text } = parseStashText(item.text);
    const typeLabel = TYPE_MAP[type] || "text";
    const badgeHtml = `<span class="card-badge badge-${typeLabel}">${typeLabel}</span>`;
    const encBadge = item.encrypted ? `<span class="card-badge badge-enc">🔒</span>` : "";
    const titleHtml = title
        ? `<div class="card-title-text" id="title-text-${item.id}">${escapeHtml(title)} ${badgeHtml}${encBadge}</div>`
        : `<div class="card-title-text no-title-placeholder" id="title-text-${item.id}">${t("untitled_note")} ${badgeHtml}${encBadge}</div>`;

    const displayContent = item.unlockedSession ? item.decryptedContentTemp : text;
    const wordCount = getWordCount(isLocked ? "" : displayContent);

    let previewHtml = "", topActionsHtml = "", copyButtonHtml = "";

    if (isLocked) {
        topActionsHtml = `
            <button class="top-action-btn btn-pin ${item.pinned ? "pin-active" : ""}" id="pin-btn-${item.id}">
                ${item.pinned ? t("unpin_btn") : t("pin_btn")}
            </button>`;
        previewHtml = `
            <div class="markdown-preview encrypted-placeholder" id="preview-${item.id}">
                <div id="lockLabel-${item.id}" style="font-weight:bold;font-family:monospace;font-size:0.9rem;display:flex;align-items:center;gap:6px;">
                    🔒 CLICK TO UNLOCK CONTENT
                </div>
                <div id="decryptForm-${item.id}" style="display:none;width:100%;max-width:280px;flex-direction:column;gap:8px;margin:4px 0;" onclick="event.stopPropagation()">
                    <div style="display:flex;gap:6px;width:100%;">
                        <input type="text" id="decryptKey-${item.id}" class="title-input secret-key-mask" placeholder="Enter key..." style="flex:1;height:32px;font-size:0.85rem;border:1px solid var(--warning);border-radius:4px;padding:0 8px;background:rgba(255,255,255,0.05);color:#fff;" autocomplete="off">
                        <button class="top-action-btn" onclick="submitInlineDecryption('${item.id}')" style="background:var(--warning);color:#000;font-weight:bold;height:32px;padding:0 12px;border-radius:4px;border:none;cursor:pointer;">Unlock</button>
                        <button class="top-action-btn" onclick="cancelInlineDecryption('${item.id}')" style="height:32px;padding:0 10px;border-radius:4px;border:1px solid var(--border);cursor:pointer;">Cancel</button>
                    </div>
                </div>
                <div id="decryptError-${item.id}" style="display:none;color:var(--danger);font-size:0.75rem;margin-top:4px;font-weight:bold;">Incorrect key!</div>
            </div>`;
    } else {
        topActionsHtml = `
            <button class="top-action-btn btn-pin ${item.pinned ? "pin-active" : ""}" id="pin-btn-${item.id}">
                ${item.pinned ? t("unpin_btn") : t("pin_btn")}
            </button>
            <button class="top-action-btn" onclick="duplicateNote('${item.id}')" title="Duplicate">⧉</button>
            <button class="top-action-btn" onclick="exportNote('${item.id}')" title="Export">↓</button>
            <button class="top-action-btn btn-delete" id="delete-btn-${item.id}" onmousedown="handleDeleteClick('${item.id}')">
                ${t("delete_btn")}
            </button>`;
        copyButtonHtml = `<button class="action-btn btn-copy" id="copy-btn-${item.id}">${t("copy_btn")}</button>`;
        previewHtml = type === "2"
            ? `<div class="markdown-preview" id="preview-${item.id}">${compileMarkdown(displayContent)}</div>`
            : `<pre class="raw-preview" id="preview-${item.id}">${escapeHtml(displayContent)}</pre>`;
    }

    const currentActiveKey = (item.encrypted && item.unlockedSession && item.activeKeyTemp) ? item.activeKeyTemp : "";
    const tagsHtml = (item.tags || []).map(tag =>
        `<span class="card-tag" onclick="removeTagFromNote('${item.id}','${escapeHtml(tag)}')" title="Remove tag">#${escapeHtml(tag)} ×</span>`
    ).join("");

    card.innerHTML = `
        <div class="card-header-row">
            ${titleHtml}
            <input type="text" class="card-title-edit-input" id="title-edit-${item.id}" placeholder="${t("card_placeholder_title")}" value="${escapeHtml(title)}" oninput="editStashTitle('${item.id}', this.value)" onblur="disableEditMode('${item.id}')">
            <div class="top-actions-group">${topActionsHtml}</div>
        </div>
        <div class="textarea-wrapper" id="wrapper-${item.id}">
            ${previewHtml}
            <textarea class="card-textarea" id="textarea-${item.id}" onblur="disableEditMode('${item.id}')" oninput="editStashContent('${item.id}', this.value)"></textarea>
            <div class="card-key-edit-container" id="key-edit-container-${item.id}" style="display:none;">
                <span class="card-key-edit-label">🔑 Key:</span>
                <input type="text" class="title-input secret-key-mask card-key-edit-input" id="key-edit-${item.id}" placeholder="No encryption" value="${escapeHtml(currentActiveKey)}" oninput="editStashKey('${item.id}', this.value)" onblur="disableEditMode('${item.id}')" autocomplete="off">
            </div>
        </div>
        ${tagsHtml || !isLocked ? `<div class="card-tags-row" id="tags-row-${item.id}">
            ${tagsHtml}
            ${!isLocked ? `<input type="text" class="tag-add-input" id="tag-input-${item.id}" placeholder="+ add tag" onkeydown="if(event.key==='Enter'||event.key===','){addTagToNote('${item.id}',this.value);this.value='';event.preventDefault();}">` : ""}
        </div>` : ""}
        <div class="card-footer">
            <div class="card-info">
                <span class="drag-handle" onmousedown="enableCardDrag('${item.id}')" onmouseup="disableCardDrag('${item.id}')">☰</span>
                <span id="char-${item.id}">${item.text.length} chars</span>
                <span class="word-count">${wordCount} words</span>
                <span style="color:var(--primary);font-weight:bold;">${textBytes} B</span>
            </div>
            <div class="card-actions">${copyButtonHtml}</div>
        </div>`;

    setTimeout(() => {
        const pinBtn = document.getElementById(`pin-btn-${item.id}`);
        if (pinBtn) pinBtn.onclick = () => {
            if (isLocked) showInlineError(item.id, "Unlock first!");
            else togglePin(item.id);
        };
        const copyBtn = document.getElementById(`copy-btn-${item.id}`);
        if (copyBtn) copyBtn.onclick = () => {
            if (isLocked) showInlineError(item.id, "Unlock first!");
            else copyText(item.id);
        };
        const wrapper = document.getElementById(`wrapper-${item.id}`);
        if (wrapper && !isLocked) {
            wrapper.onclick = (e) => {
                if (e.target.closest(".card-key-edit-container")) return;
                enableEditMode(item.id);
            };
        } else if (wrapper && isLocked) {
            wrapper.onclick = () => activateInlineDecryption(item.id);
        }
        const textarea = document.getElementById(`textarea-${item.id}`);
        if (textarea && !isLocked) textarea.value = item.unlockedSession ? item.decryptedContentTemp : text;
    }, 0);

    return card;
}


function enableEditMode(id) {
    const card = document.querySelector(`[data-id="${id}"]`);
    const item = stashItems.find(i => i.id === id);
    if (item && item.encrypted && !item.unlockedSession) return;
    const titleText = document.getElementById(`title-text-${id}`);
    const titleEdit = document.getElementById(`title-edit-${id}`);
    const preview = document.getElementById(`preview-${id}`);
    const textarea = document.getElementById(`textarea-${id}`);
    const keyContainer = document.getElementById(`key-edit-container-${id}`);
    if (!card || !textarea) return;
    if (textarea.style.display !== "block") {
        card.classList.add("card-editing");
        if (titleText && titleEdit) { titleText.style.display = "none"; titleEdit.style.display = "block"; }
        if (preview) preview.style.display = "none";
        textarea.style.display = "block";
        textarea.style.height = "auto";
        textarea.style.height = Math.max(textarea.scrollHeight, 64) + "px";
        textarea.style.maxHeight = textarea.style.height;
        if (keyContainer) keyContainer.style.display = "flex";
        textarea.focus();
    }
}

function disableEditMode(id) {
    setTimeout(() => {
        const card = document.querySelector(`[data-id="${id}"]`);
        const titleText = document.getElementById(`title-text-${id}`);
        const titleEdit = document.getElementById(`title-edit-${id}`);
        const preview = document.getElementById(`preview-${id}`);
        const textarea = document.getElementById(`textarea-${id}`);
        const keyEditInput = document.getElementById(`key-edit-${id}`);
        const keyContainer = document.getElementById(`key-edit-container-${id}`);
        if (!card || !textarea) return;
        if ([textarea, titleEdit, keyEditInput].includes(document.activeElement)) return;
        card.classList.remove("card-editing");
        if (titleText && titleEdit) { titleText.style.display = "block"; titleEdit.style.display = "none"; }
        textarea.scrollTop = 0;
        const item = stashItems.find(i => i.id === id);
        if (item && preview) {
            const { type, text } = parseStashText(item.text);
            const content = item.unlockedSession ? item.decryptedContentTemp : text;
            if (type === "2") preview.innerHTML = compileMarkdown(content);
            else preview.textContent = content;
            preview.scrollTop = 0;
            preview.style.display = "block";
        }
        textarea.style.display = "none";
        textarea.style.maxHeight = "";
        if (keyContainer) keyContainer.style.display = "none";
    }, 180);
}


async function editStashKey(id, newKey) {
    const item = stashItems.find(i => i.id === id);
    if (!item) return;
    const oldParsed = parseStashText(item.text);
    const typeSuffix = oldParsed.type ? `.${oldParsed.type}` : "";
    let content = item.unlockedSession ? item.decryptedContentTemp : oldParsed.text;
    if (newKey.trim()) {
        item.encrypted = true; item.unlockedSession = true;
        item.activeKeyTemp = newKey; item.decryptedContentTemp = content;
        const secured = await cryptEngine(content, newKey);
        item.text = (oldParsed.title || typeSuffix) ? `[${oldParsed.title}${typeSuffix}] ${secured}` : secured;
    } else {
        item.encrypted = false; item.unlockedSession = false;
        delete item.activeKeyTemp; delete item.decryptedContentTemp;
        item.text = (oldParsed.title || typeSuffix) ? `[${oldParsed.title}${typeSuffix}] ${content}` : content;
    }
    updateStatsOnCard(id, item.text);
    saveToStorage();
}

async function editStashTitle(id, newTitle) {
    const item = stashItems.find(i => i.id === id);
    if (!item) return;
    const old = parseStashText(item.text);
    const typeSuffix = old.type ? `.${old.type}` : "";
    let content = old.text;
    if (item.encrypted) {
        const keyInput = document.getElementById(`key-edit-${id}`);
        const activeKey = keyInput ? keyInput.value : item.activeKeyTemp;
        if (activeKey) {
            const plain = item.unlockedSession ? item.decryptedContentTemp : await decryptEngine(old.text, activeKey);
            content = await cryptEngine(plain || "", activeKey);
        }
    }
    item.text = (newTitle.trim() || typeSuffix) ? `[${newTitle.trim()}${typeSuffix}] ${content}` : content;
    const titleTextSpan = document.getElementById(`title-text-${id}`);
    if (titleTextSpan) {
        const typeLabel = TYPE_MAP[old.type] || "text";
        const badgeHtml = `<span class="card-badge badge-${typeLabel}">${typeLabel}</span>`;
        if (newTitle.trim()) {
            titleTextSpan.innerHTML = `${escapeHtml(newTitle.trim())} ${badgeHtml}`;
            titleTextSpan.classList.remove("no-title-placeholder");
        } else {
            titleTextSpan.innerHTML = `${t("untitled_note")} ${badgeHtml}`;
            titleTextSpan.classList.add("no-title-placeholder");
        }
    }
    updateStatsOnCard(id, item.text);
    saveToStorage();
}

async function editStashContent(id, newContent) {
    const item = stashItems.find(i => i.id === id);
    if (!item) return;
    const old = parseStashText(item.text);
    const typeSuffix = old.type ? `.${old.type}` : "";
    let processed = newContent;
    if (item.encrypted) {
        const keyInput = document.getElementById(`key-edit-${id}`);
        const activeKey = keyInput ? keyInput.value : item.activeKeyTemp;
        if (activeKey) {
            item.decryptedContentTemp = newContent; item.activeKeyTemp = activeKey;
            processed = await cryptEngine(newContent, activeKey);
        } else return;
    }
    item.text = (old.title || typeSuffix) ? `[${old.title}${typeSuffix}] ${processed}` : processed;
    updateStatsOnCard(id, item.text);
    saveToStorage();
}

function updateStatsOnCard(id, fullText) {
    const charSpan = document.getElementById(`char-${id}`);
    if (charSpan) {
        charSpan.textContent = `${fullText.length} chars`;
        const next = charSpan.nextElementSibling;
        if (next) next.textContent = `${getWordCount(fullText)} words`;
    }
}


function handleDeleteClick(id) {
    const btn = document.getElementById(`delete-btn-${id}`);
    if (btn.classList.contains("btn-delete-confirm")) {
        clearTimeout(deleteTimeouts[id]); delete deleteTimeouts[id];
        stashItems = stashItems.filter(i => i.id !== id);
        saveToStorage(); renderStash(); renderTagFilter();
    } else {
        btn.classList.add("btn-delete-confirm");
        btn.textContent = t("delete_confirm");
        deleteTimeouts[id] = setTimeout(() => {
            btn.classList.remove("btn-delete-confirm");
            btn.textContent = t("delete_btn");
        }, 3000);
    }
}

function copyText(id) {
    const item = stashItems.find(i => i.id === id);
    if (!item) return;
    const textToCopy = item.unlockedSession ? item.decryptedContentTemp : parseStashText(item.text).text;
    navigator.clipboard.writeText(textToCopy);
    const btn = document.getElementById(`copy-btn-${id}`);
    if (btn) {
        btn.textContent = t("copied_btn");
        setTimeout(() => btn.textContent = t("copy_btn"), 1500);
    }
}

function togglePin(id) {
    const item = stashItems.find(i => i.id === id);
    if (item) {
        item.pinned = !item.pinned;
        stashItems.sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1));
        saveToStorage(); renderStash();
    }
}


function activateInlineDecryption(id) {
    const label = document.getElementById(`lockLabel-${id}`);
    const form = document.getElementById(`decryptForm-${id}`);
    const err = document.getElementById(`decryptError-${id}`);
    const input = document.getElementById(`decryptKey-${id}`);
    if (label && form) {
        label.style.display = "none"; form.style.display = "flex";
        if (err) err.style.display = "none";
        if (input) {
            input.value = ""; input.focus();
            input.onkeydown = (e) => {
                if (e.key === "Enter") submitInlineDecryption(id);
                if (e.key === "Escape") cancelInlineDecryption(id);
            };
        }
    }
}

function cancelInlineDecryption(id) {
    const label = document.getElementById(`lockLabel-${id}`);
    const form = document.getElementById(`decryptForm-${id}`);
    if (label && form) { label.style.display = "flex"; form.style.display = "none"; }
}

function showInlineError(id, msg) {
    const err = document.getElementById(`decryptError-${id}`);
    if (err) { err.textContent = msg; err.style.display = "block"; setTimeout(() => err.style.display = "none", 3000); }
}

async function submitInlineDecryption(id) {
    const item = stashItems.find(i => i.id === id);
    if (!item || !item.encrypted) return;
    const input = document.getElementById(`decryptKey-${id}`);
    const err = document.getElementById(`decryptError-${id}`);
    if (!input) return;
    const key = input.value;
    const { text } = parseStashText(item.text);
    const decrypted = await decryptEngine(text, key);
    if (decrypted !== null) {
        item.unlockedSession = true; item.decryptedContentTemp = decrypted; item.activeKeyTemp = key;
        renderStash();
    } else {
        if (err) { err.textContent = "Incorrect key!"; err.style.display = "block"; }
        input.value = ""; input.focus();
    }
}


function updateInputStats() {
    const input = document.getElementById("mainInput");
    const stats = document.getElementById("mainStats");
    if (input && stats) {
        const text = input.value;
        stats.textContent = `${text.length} chars · ${getWordCount(text)} words · ${getByteSize(text)} B`;
    }
}


function insertMdWrap(before, after) {
    const ta = document.getElementById("mainInput");
    const start = ta.selectionStart, end = ta.selectionEnd;
    const selected = ta.value.substring(start, end);
    const newText = ta.value.substring(0, start) + before + selected + after + ta.value.substring(end);
    ta.value = newText;
    ta.selectionStart = start + before.length;
    ta.selectionEnd = end + before.length;
    ta.focus();
    updateInputStats();
}

function insertMdLine(prefix) {
    const ta = document.getElementById("mainInput");
    const start = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf("\n", start - 1) + 1;
    ta.value = ta.value.substring(0, lineStart) + prefix + ta.value.substring(lineStart);
    ta.selectionStart = ta.selectionEnd = start + prefix.length;
    ta.focus();
    updateInputStats();
}


function enableCardDrag(id) {
    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) { card.setAttribute("draggable", "true"); draggedCardId = id; }
}

function disableCardDrag(id) {
    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) { card.removeAttribute("draggable"); draggedCardId = null; }
}

function setupDragAndDrop() {
    document.querySelectorAll(".stash-card").forEach(card => {
        card.addEventListener("dragstart", (e) => {
            if (card.getAttribute("data-id") === draggedCardId) {
                card.classList.add("dragging");
                e.dataTransfer.effectAllowed = "move";
            } else e.preventDefault();
        });
        card.addEventListener("dragend", () => {
            card.classList.remove("dragging");
            card.removeAttribute("draggable");
            draggedCardId = null;
        });
    });
}

function allowDrop(e) {
    e.preventDefault();
    const container = e.currentTarget;
    const dragging = document.querySelector(".dragging");
    if (!dragging) return;
    if ((container.id === "pinnedList") !== dragging.classList.contains("pinned")) return;
    const after = getDragAfterElement(container, e.clientY);
    if (after == null) container.appendChild(dragging);
    else container.insertBefore(dragging, after);
}

function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll(".stash-card:not(.dragging)")];
    return els.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleDrop(e, isPinnedArea) {
    e.preventDefault();
    const container = e.currentTarget;
    const reorderedIds = [...container.querySelectorAll(".stash-card")].map(c => c.getAttribute("data-id"));
    const other = stashItems.filter(i => i.pinned !== isPinnedArea);
    const reordered = reorderedIds.map(id => stashItems.find(i => i.id === id));
    stashItems = isPinnedArea ? [...reordered, ...other] : [...other, ...reordered];
    saveToStorage(); renderStash();
}
