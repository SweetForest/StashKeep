const LOCAL_STORAGE_KEY = "local_stash_array";
const LOCAL_STORAGE_LIMIT_KEY = "local_stash_limit";
const LOCAL_LANG_KEY = "local_stash_lang";

let SUPPORTED_LANGUAGES = {}; 
let MAX_STORAGE_BYTES = 4096;
let stashItems = []; 
let deleteTimeouts = {}; 
let stashConfirmTimeout = null;
let pendingCleanCount = 0;
let draggedCardId = null; 
let currentLang = "en";
let translations = {}; 

const TYPE_MAP = {
    "": "text",
};

window.onload = async function() {
    detectAndSetStorageLimit(false);
    await initLanguageSystem(); 
    loadFromStorage();
    renderStash();
    updateStorageMonitor();
};

function getByteSize(str) {
    return new Blob([str]).size;
}

function detectAndSetStorageLimit(force = false) {
    const savedLimit = localStorage.getItem(LOCAL_STORAGE_LIMIT_KEY);
    if (savedLimit && !force) {
        MAX_STORAGE_BYTES = parseInt(savedLimit, 10);
        return;
    }

    const testKey = "__storage_capacity_test__";
    let min = 0;
    let max = 10 * 1024 * 1024;
    let detectedLimit = 0;

    localStorage.removeItem(testKey);

    while (min <= max) {
        let mid = Math.floor((min + max) / 2);
        let testString = "X".repeat(mid);
        try {
            localStorage.setItem(testKey, testString);
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
        if (!response.ok) throw new Error("Could not load language index");
        SUPPORTED_LANGUAGES = await response.json();
    } catch (e) {
        SUPPORTED_LANGUAGES = { "en": "English" };
    }

    renderLanguageSelector();

    const savedLang = localStorage.getItem(LOCAL_LANG_KEY);
    const browserLang = navigator.language.slice(0, 2);
    let targetLang = "en";
    
    if (savedLang && SUPPORTED_LANGUAGES[savedLang]) {
        targetLang = savedLang;
    } else if (SUPPORTED_LANGUAGES[browserLang]) {
        targetLang = browserLang;
    } else {
        const availableKeys = Object.keys(SUPPORTED_LANGUAGES);
        if (availableKeys.length > 0) {
            targetLang = availableKeys[0];
        }
    }
    
    await loadLanguage(targetLang);
}

function renderLanguageSelector() {
    const selector = document.getElementById("langSelector");
    if (!selector) return;
    
    selector.innerHTML = "";
    Object.keys(SUPPORTED_LANGUAGES).forEach(langCode => {
        const option = document.createElement("option");
        option.value = langCode;
        option.textContent = SUPPORTED_LANGUAGES[langCode];
        selector.appendChild(option);
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
    Object.keys(replacements).forEach(placeholder => {
        text = text.replace(`{${placeholder}}`, replacements[placeholder]);
    });
    return text;
}

function translateUI() {
    document.getElementById("subtext").textContent = t("subtitle");
    document.getElementById("labelStorage").textContent = t("storage_space");
    document.getElementById("mainInput").placeholder = t("input_placeholder");
    document.getElementById("mainTitle").placeholder = t("add_title_placeholder");
    document.getElementById("pinnedTitle").textContent = t("pinned_section");
    document.getElementById("notesTitle").textContent = t("notes_section");
    document.getElementById("emptyMessage").textContent = t("empty_state");
    const btnAdd = document.getElementById("btnAdd");
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
            });
        } catch(e) {
            stashItems = [];
        }
    }
}

function saveToStorage() {
    const cleanItems = stashItems.map(item => {
        const itemCopy = { ...item };
        delete itemCopy.unlockedSession;
        delete itemCopy.activeKeyTemp;
        delete itemCopy.decryptedContentTemp;
        return itemCopy;
    });

    const jsonString = JSON.stringify(cleanItems);
    try {
        if (getByteSize(jsonString) > MAX_STORAGE_BYTES) {
            throw new Error();
        }
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
        const itemCopy = { ...item };
        delete itemCopy.unlockedSession;
        delete itemCopy.activeKeyTemp;
        delete itemCopy.decryptedContentTemp;
        return itemCopy;
    });
    return getByteSize(JSON.stringify(cleanItems));
}

function updateStorageMonitor() {
    const currentBytes = calculateCurrentBytes();
    const percentage = Math.min(((currentBytes / MAX_STORAGE_BYTES) * 100), 100).toFixed(1);
    const storageText = document.getElementById('storageText');
    const progressBar = document.getElementById('progressBar');
    if (storageText && progressBar) {
        storageText.textContent = `${currentBytes.toLocaleString()} / ${MAX_STORAGE_BYTES.toLocaleString()} Bytes (${percentage}%)`;
        progressBar.style.width = `${percentage}%`;
        progressBar.className = "progress-bar";
        if (percentage > 90) {
            progressBar.classList.add('danger');
        } else if (percentage > 70) {
            progressBar.classList.add('warning');
        }
    }
}

function parseStashText(rawText) {
    let title = "";
    let type = ""; 
    let text = rawText;
    if (rawText.startsWith('[')) {
        const closingIndex = rawText.indexOf(']');
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

function compileMarkdown(markdownText) {
    let html = escapeHtml(markdownText);
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    html = html.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');
    html = html.split('\n').map(line => {
        if (!line.trim()) return '';
        if (line.startsWith('<h') || line.startsWith('<li>')) return line;
        return `<p>${line}</p>`;
    }).join('');
    return html;
}

async function getKeyMaterial(password) {
    const enc = new TextEncoder();
    return window.crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );
}

async function deriveKey(password, salt) {
    const keyMaterial = await getKeyMaterial(password);
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

async function cryptEngine(text, password) {
    if (!password) return text;
    try {
        const enc = new TextEncoder();
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt);
        const encodedText = enc.encode("SECURE|" + text);

        const encryptedContent = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encodedText
        );

        const outBuffer = new Uint8Array(salt.byteLength + iv.byteLength + encryptedContent.byteLength);
        outBuffer.set(salt, 0);
        outBuffer.set(iv, salt.byteLength);
        outBuffer.set(new Uint8Array(encryptedContent), salt.byteLength + iv.byteLength);

        return btoa(String.fromCharCode.apply(null, outBuffer));
    } catch (e) {
        return "";
    }
}

async function decryptEngine(base64Text, password) {
    if (!password) return base64Text;
    try {
        const binaryString = atob(base64Text);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const salt = bytes.slice(0, 16);
        const iv = bytes.slice(16, 28);
        const encryptedData = bytes.slice(28);

        const key = await deriveKey(password, salt);
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encryptedData
        );

        const dec = new TextDecoder();
        const decryptedText = dec.decode(decryptedBuffer);

        if (decryptedText.startsWith("SECURE|")) {
            return decryptedText.substring(7);
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function handleStashClick() {
    const input = document.getElementById('mainInput');
    const titleInput = document.getElementById('mainTitle');
    const typeSelect = document.getElementById('mainType');
    const keyInput = document.getElementById('mainKey');
    const rawText = input.value;
    const titleText = titleInput.value.trim();
    const selectedType = typeSelect.value; 
    const secretKey = keyInput.value;
    if (!rawText.trim()) return;
    const btn = document.getElementById('btnAdd');
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
        time: new Date().toLocaleDateString('en-US'),
        encrypted: secretKey ? true : false
    };
    let tempStash = [newItem, ...stashItems];
    let tempBytes = getByteSize(JSON.stringify(tempStash));
    if (tempBytes > MAX_STORAGE_BYTES) {
        if (!btn.classList.contains('btn-add-warn')) {
            let bytesFreed = 0;
            pendingCleanCount = 0;
            for (let i = stashItems.length - 1; i >= 0; i--) {
                if (!stashItems[i].pinned) {
                    bytesFreed += getByteSize(JSON.stringify(stashItems[i]));
                    pendingCleanCount++;
                    if ((tempBytes - bytesFreed) <= MAX_STORAGE_BYTES) {
                        break;
                    }
                }
            }
            if ((tempBytes - bytesFreed) > MAX_STORAGE_BYTES) {
                return;
            }
            btn.classList.add('btn-add-warn');
            btn.textContent = t("stash_button_warn", { count: pendingCleanCount });
            stashConfirmTimeout = setTimeout(() => {
                resetStashButton();
            }, 4000);
            return;
        } else {
            clearTimeout(stashConfirmTimeout);
            let removed = 0;
            for (let i = stashItems.length - 1; i >= 0; i--) {
                if (removed >= pendingCleanCount) break;
                if (!stashItems[i].pinned) {
                    stashItems.splice(i, 1);
                    removed++;
                }
            }
        }
    }
    stashItems.unshift(newItem); 
    if (saveToStorage()) {
        input.value = "";
        titleInput.value = ""; 
        typeSelect.value = ""; 
        keyInput.value = "";
        updateInputStats();
        renderStash();
    } else {
        stashItems.shift(); 
    }
    resetStashButton();
}

function resetStashButton() {
    const btn = document.getElementById('btnAdd');
    if (btn) {
        btn.className = "btn-add";
        btn.textContent = t("stash_button");
        pendingCleanCount = 0;
    }
}

function renderStash() {
    const pinnedList = document.getElementById('pinnedList');
    const notesList = document.getElementById('notesList');
    const pinnedTitle = document.getElementById('pinnedTitle');
    const notesTitle = document.getElementById('notesTitle');
    const emptyMessage = document.getElementById('emptyMessage');
    if (!pinnedList || !notesList) return;
    pinnedList.innerHTML = "";
    notesList.innerHTML = "";
    let hasPinned = false;
    let hasNotes = false;
    const pinnedItems = stashItems.filter(item => item.pinned);
    const normalItems = stashItems.filter(item => !item.pinned);
    pinnedItems.forEach((item) => {
        const card = createCardElement(item);
        pinnedList.appendChild(card);
        hasPinned = true;
    });
    normalItems.forEach((item) => {
        const card = createCardElement(item);
        notesList.appendChild(card);
        hasNotes = true;
    });
    if (pinnedTitle) pinnedTitle.style.display = hasPinned ? 'block' : 'none';
    if (notesTitle) notesTitle.style.display = hasNotes && hasPinned ? 'block' : 'none';
    if (emptyMessage) emptyMessage.style.display = (hasPinned || hasNotes) ? 'none' : 'block';
    setupDragAndDrop();
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function createCardElement(item) {
    const card = document.createElement('div');
    const isCurrentlyLocked = item.encrypted && !item.unlockedSession;
    
    card.className = `stash-card ${item.pinned ? 'pinned' : ''} ${isCurrentlyLocked ? 'is-encrypted' : ''}`;
    card.setAttribute('data-id', item.id);
    const textBytes = getByteSize(item.text);
    const { title, type, text } = parseStashText(item.text);
    const typeLabel = TYPE_MAP[type] || "text";
    const badgeHtml = `<span class="card-badge">${typeLabel}</span>`;
    
    const titleHtml = title 
        ? `<div class="card-title-text" id="title-text-${item.id}">${escapeHtml(title)} ${badgeHtml}</div>` 
        : `<div class="card-title-text no-title-placeholder" id="title-text-${item.id}">${t("untitled_note")} ${badgeHtml}</div>`;
    
    let previewElementHtml = "";
    let topActionsHtml = "";  
    let copyButtonHtml = "";  

    if (isCurrentlyLocked) {
        topActionsHtml = `
            <button class="top-action-btn btn-pin ${item.pinned ? 'pin-active' : ''}" id="pin-btn-${item.id}">
                ${item.pinned ? t("unpin_btn") : t("pin_btn")}
            </button>
        `;

        copyButtonHtml = "";

        previewElementHtml = `
            <div class="markdown-preview encrypted-placeholder" id="preview-${item.id}" style="background: #0d0d0f; color: var(--warning); display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 110px; border: 1px dashed var(--warning); border-radius: 6px; padding: 12px; cursor: pointer; user-select: none; transition: border-color 0.2s;">
                <div id="lockLabel-${item.id}" style="font-weight: bold; font-family: monospace; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                    🔒 CLICK TO UNLOCK CONTENT
                </div>
                <div id="decryptForm-${item.id}" style="display: none; width: 100%; max-width: 280px; flex-direction: column; gap: 8px; margin: 4px 0;" onclick="event.stopPropagation()">
                    <div style="display: flex; gap: 6px; width: 100%;">
                        <input type="text" id="decryptKey-${item.id}" class="title-input secret-key-mask" placeholder="Enter key..." style="flex: 1; text-align: center; height: 32px; font-size: 0.85rem; border: 1px solid var(--warning); border-radius: 4px; padding: 0 8px; background: rgba(255,255,255,0.05); color: #fff;" autocomplete="off">
                        <button class="top-action-btn" onclick="submitInlineDecryption('${item.id}')" style="background-color: var(--warning); color: #000; font-weight: bold; height: 32px; padding: 0 12px; border-radius: 4px; border: none; cursor: pointer;">Unlock</button>
                        <button class="top-action-btn" onclick="cancelInlineDecryption('${item.id}')" style="background-color: rgba(255,255,255,0.1); color: var(--text-color); height: 32px; padding: 0 10px; border-radius: 4px; border: 1px solid var(--border); cursor: pointer;">Cancel</button>
                    </div>
                </div>
                <div id="decryptError-${item.id}" style="display: none; color: var(--danger); font-size: 0.75rem; margin-top: 4px; font-weight: bold;">Incorrect key! Please try again.</div>
            </div>`;
    } else {
        topActionsHtml = `
            <button class="top-action-btn btn-pin ${item.pinned ? 'pin-active' : ''}" id="pin-btn-${item.id}">
                ${item.pinned ? t("unpin_btn") : t("pin_btn")}
            </button>
            <button class="top-action-btn btn-delete" id="delete-btn-${item.id}" onmousedown="handleDeleteClick('${item.id}')">
                ${t("delete_btn")}
            </button>
        `;

        copyButtonHtml = `
            <button class="action-btn btn-copy" id="copy-btn-${item.id}">${t("copy_btn")}</button>
        `;

        const displayContent = item.unlockedSession ? item.decryptedContentTemp : text;

        if (type === "2") {
            previewElementHtml = `<div class="markdown-preview" id="preview-${item.id}">${compileMarkdown(displayContent)}</div>`;
        } else {
            previewElementHtml = `<pre class="raw-preview" id="preview-${item.id}">${escapeHtml(displayContent)}</pre>`;
        }
    }
    
    const currentActiveKey = (item.encrypted && item.unlockedSession && item.activeKeyTemp) ? item.activeKeyTemp : "";

    card.innerHTML = `
        <div class="card-header-row">
            ${titleHtml}
            <input type="text" class="card-title-edit-input" id="title-edit-${item.id}" placeholder="${t("card_placeholder_title")}" value="${escapeHtml(title)}" oninput="editStashTitle('${item.id}', this.value)" onblur="disableEditMode('${item.id}')">
            <div class="top-actions-group">
                ${topActionsHtml}
            </div>
        </div>
        <div class="textarea-wrapper" id="wrapper-${item.id}">
            ${previewElementHtml}
            <textarea class="card-textarea" id="textarea-${item.id}" onblur="disableEditMode('${item.id}')" oninput="editStashContent('${item.id}', this.value)"></textarea>
            
            <div class="card-key-edit-container" id="key-edit-container-${item.id}" style="display: none;">
                <span class="card-key-edit-label">🔑 Secret Key (Optional):</span>
                <input type="text" class="title-input secret-key-mask card-key-edit-input" id="key-edit-${item.id}" placeholder="No encryption (Plain text)" value="${escapeHtml(currentActiveKey)}" oninput="editStashKey('${item.id}', this.value)" onblur="disableEditMode('${item.id}')" autocomplete="off">
            </div>
        </div>
        <div class="card-footer">
            <div class="card-info">
                <span class="drag-handle" onmousedown="enableCardDrag('${item.id}')" onmouseup="disableCardDrag('${item.id}')">☰</span>
                <span id="char-${item.id}">${t("char_counter", { count: item.text.length })}</span>
                <span style="color: var(--primary); font-weight: bold;">(${textBytes} Bytes)</span>
            </div>
            <div class="card-actions">
                ${copyButtonHtml}
            </div>
        </div>
    `;

    setTimeout(() => {
        const pinBtn = document.getElementById(`pin-btn-${item.id}`);
        if (pinBtn) {
            pinBtn.onclick = () => {
                if (isCurrentlyLocked) {
                    showInlineError(item.id, "Please unlock this note first!");
                } else {
                    togglePin(item.id);
                }
            };
        }

        const copyBtn = document.getElementById(`copy-btn-${item.id}`);
        if (copyBtn) {
            copyBtn.onclick = () => {
                if (isCurrentlyLocked) {
                    showInlineError(item.id, "Please unlock this note first!");
                } else {
                    copyText(item.id);
                }
            };
        }

        const wrapper = document.getElementById(`wrapper-${item.id}`);
        if (wrapper && !isCurrentlyLocked) {
            wrapper.onclick = (e) => {
                if (e.target.closest(`.card-key-edit-container`)) return;
                enableEditMode(item.id);
            };
        } else if (wrapper && isCurrentlyLocked) {
            wrapper.onclick = () => activateInlineDecryption(item.id);
        }

        const textarea = document.getElementById(`textarea-${item.id}`);
        if (textarea && !isCurrentlyLocked) {
            textarea.value = item.unlockedSession ? item.decryptedContentTemp : text;
        }
    }, 0);

    return card;
}

function activateInlineDecryption(id) {
    const label = document.getElementById(`lockLabel-${id}`);
    const form = document.getElementById(`decryptForm-${id}`);
    const err = document.getElementById(`decryptError-${id}`);
    const input = document.getElementById(`decryptKey-${id}`);
    if (label && form) {
        label.style.display = "none";
        form.style.display = "flex";
        if (err) err.style.display = "none";
        if (input) {
            input.value = "";
            input.focus();
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
    const err = document.getElementById(`decryptError-${id}`);
    if (label && form) {
        label.style.display = "flex";
        form.style.display = "none";
        if (err) err.style.display = "none";
    }
}

function showInlineError(id, msg) {
    const err = document.getElementById(`decryptError-${id}`);
    if (err) {
        err.textContent = msg;
        err.style.display = "block";
        setTimeout(() => {
            err.style.display = "none";
        }, 3000);
    }
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
        item.unlockedSession = true; 
        item.decryptedContentTemp = decrypted; 
        item.activeKeyTemp = key; 
        
        renderStash(); 
    } else {
        if (err) {
            err.textContent = "Incorrect key! Please try again.";
            err.style.display = "block";
        }
        input.value = "";
        input.focus();
        
        const formContainer = document.getElementById(`preview-${id}`);
        if (formContainer) {
            formContainer.style.borderColor = "var(--danger)";
            setTimeout(() => {
                formContainer.style.borderColor = "var(--warning)";
            }, 1000);
        }
    }
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
    if (textarea.style.display !== 'block') {
        card.classList.add('card-editing');
        if (titleText && titleEdit) {
            titleText.style.display = 'none';
            titleEdit.style.display = 'block';
        }
        if (preview) {
            preview.style.display = 'none';
        }
        textarea.style.display = 'block';
        textarea.style.height = 'auto';
        const initialHeight = Math.max(textarea.scrollHeight, 64);
        textarea.style.height = initialHeight + 'px';
        textarea.style.maxHeight = initialHeight + 'px';
        
        if (keyContainer) {
            keyContainer.style.display = 'flex'; 
        }
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
        
        if (document.activeElement === textarea || 
            document.activeElement === titleEdit || 
            document.activeElement === keyEditInput) {
            return; 
        }
        
        card.classList.remove('card-editing');
        if (titleText && titleEdit) {
            titleText.style.display = 'block';
            titleEdit.style.display = 'none';
        }
        textarea.scrollTop = 0;
        const item = stashItems.find(i => i.id === id);
        if (item && preview) {
            const { type, text } = parseStashText(item.text);
            const displayContent = item.unlockedSession ? item.decryptedContentTemp : text;
            if (type === "2") {
                preview.innerHTML = compileMarkdown(displayContent);
            } else {
                preview.textContent = displayContent;
            }
            preview.scrollTop = 0;
            preview.style.display = 'block';
        }
        textarea.style.display = 'none';
        textarea.style.maxHeight = '';
        if (keyContainer) {
            keyContainer.style.display = 'none'; 
        }
    }, 180);
}

function enableCardDrag(id) {
    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) {
        card.setAttribute('draggable', 'true');
        draggedCardId = id;
    }
}

function disableCardDrag(id) {
    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) {
        card.removeAttribute('draggable');
        draggedCardId = null;
    }
}

function setupDragAndDrop() {
    const cards = document.querySelectorAll('.stash-card');
    cards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            if (card.getAttribute('data-id') === draggedCardId) {
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            } else {
                e.preventDefault();
            }
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            card.removeAttribute('draggable');
            draggedCardId = null;
        });
    });
}

function allowDrop(e) {
    e.preventDefault();
    const container = e.currentTarget;
    const draggingCard = document.querySelector('.dragging');
    if (!draggingCard) return;
    const targetIsPinnedGroup = container.id === "pinnedList";
    const draggingIsPinned = draggingCard.classList.contains('pinned');
    if (targetIsPinnedGroup !== draggingIsPinned) return;
    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement == null) {
        container.appendChild(draggingCard);
    } else {
        container.insertBefore(draggingCard, afterElement);
    }
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.stash-card:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleDrop(e, isPinnedArea) {
    e.preventDefault();
    const container = e.currentTarget;
    const reorderedIds = [...container.querySelectorAll('.stash-card')].map(card => card.getAttribute('data-id'));
    const otherItems = stashItems.filter(item => item.pinned !== isPinnedArea);
    const rearrangedCurrentItems = reorderedIds.map(id => stashItems.find(item => item.id === id));
    if (isPinnedArea) {
        stashItems = [...rearrangedCurrentItems, ...otherItems];
    } else {
        stashItems = [...otherItems, ...rearrangedCurrentItems];
    }
    saveToStorage();
    renderStash();
}

function togglePin(id) {
    const item = stashItems.find(i => i.id === id);
    if (item) {
        item.pinned = !item.pinned;
        stashItems.sort((a, b) => {
            if (a.pinned === b.pinned) return 0;
            return a.pinned ? -1 : 1;
        });
        saveToStorage();
        renderStash();
    }
}

async function editStashKey(id, newKey) {
    const item = stashItems.find(i => i.id === id);
    if (item) {
        const oldTextParsed = parseStashText(item.text);
        const typeSuffix = oldTextParsed.type ? `.${oldTextParsed.type}` : "";
        
        let contentToProcess = item.unlockedSession ? item.decryptedContentTemp : oldTextParsed.text;
        
        if (newKey.trim()) {
            item.encrypted = true;
            item.unlockedSession = true; 
            item.activeKeyTemp = newKey; 
            item.decryptedContentTemp = contentToProcess; 
            
            const securedContent = await cryptEngine(contentToProcess, newKey);
            
            if (oldTextParsed.title || typeSuffix) {
                item.text = `[${oldTextParsed.title}${typeSuffix}] ${securedContent}`;
            } else {
                item.text = securedContent;
            }
        } else {
            item.encrypted = false;
            item.unlockedSession = false;
            delete item.activeKeyTemp;
            delete item.decryptedContentTemp;
            
            if (oldTextParsed.title || typeSuffix) {
                item.text = `[${oldTextParsed.title}${typeSuffix}] ${contentToProcess}`;
            } else {
                item.text = contentToProcess;
            }
        }
        
        updateStatsOnCard(id, item.text);
        saveToStorage();
    }
}

async function editStashTitle(id, newTitle) {
    const item = stashItems.find(i => i.id === id);
    if (item) {
        const oldTextParsed = parseStashText(item.text);
        const titleTextSpan = document.getElementById(`title-text-${id}`);
        const typeSuffix = oldTextParsed.type ? `.${oldTextParsed.type}` : "";
        
        let currentRawContent = oldTextParsed.text;
        if (item.encrypted) {
            const keyInput = document.getElementById(`key-edit-${id}`);
            const activeKey = keyInput ? keyInput.value : item.activeKeyTemp;
            
            if (activeKey) {
                const plainContent = item.unlockedSession ? item.decryptedContentTemp : await decryptEngine(oldTextParsed.text, activeKey);
                currentRawContent = await cryptEngine(plainContent || "", activeKey);
            }
        }

        if (newTitle.trim() || typeSuffix) {
            item.text = `[${newTitle.trim()}${typeSuffix}] ${currentRawContent}`;
        } else {
            item.text = currentRawContent;
        }
        
        if (titleTextSpan) {
            const typeLabel = TYPE_MAP[oldTextParsed.type] || "text";
            const badgeHtml = `<span class="card-badge">${typeLabel}</span>`;
            if (newTitle.trim()) {
                titleTextSpan.innerHTML = `${escapeHtml(newTitle.trim())} ${badgeHtml}`;
                titleTextSpan.classList.remove('no-title-placeholder');
            } else {
                titleTextSpan.innerHTML = `${t("untitled_note")} ${badgeHtml}`;
                titleTextSpan.classList.add('no-title-placeholder');
            }
        }
        updateStatsOnCard(id, item.text);
        saveToStorage();
    }
}

async function editStashContent(id, newContent) {
    const item = stashItems.find(i => i.id === id);
    if (item) {
        const oldTextParsed = parseStashText(item.text);
        const typeSuffix = oldTextParsed.type ? `.${oldTextParsed.type}` : "";
        
        let processedContent = newContent;
        
        if (item.encrypted) {
            const keyInput = document.getElementById(`key-edit-${id}`);
            const activeKey = keyInput ? keyInput.value : item.activeKeyTemp;
            
            if (activeKey) {
                item.decryptedContentTemp = newContent;
                item.activeKeyTemp = activeKey;
                processedContent = await cryptEngine(newContent, activeKey);
            } else {
                return;
            }
        }

        if (oldTextParsed.title || typeSuffix) {
            item.text = `[${oldTextParsed.title}${typeSuffix}] ${processedContent}`;
        } else {
            item.text = processedContent;
        }
        
        updateStatsOnCard(id, item.text);
        saveToStorage();
    }
}

function updateStatsOnCard(id, fullText) {
    const textBytes = getByteSize(fullText);
    const charSpan = document.getElementById(`char-${id}`);
    if (charSpan) {
        charSpan.textContent = t("char_counter", { count: fullText.length });
        charSpan.nextElementSibling.textContent = `(${textBytes} Bytes)`;
    }
}

function handleDeleteClick(id) {
    const btn = document.getElementById(`delete-btn-${id}`);
    if (btn.classList.contains('btn-delete-confirm')) {
        clearTimeout(deleteTimeouts[id]);
        delete deleteTimeouts[id];
        stashItems = stashItems.filter(i => i.id !== id);
        saveToStorage();
        renderStash();
    } else {
        btn.classList.add('btn-delete-confirm');
        btn.textContent = t("delete_confirm");
        deleteTimeouts[id] = setTimeout(() => {
            btn.classList.remove('btn-delete-confirm');
            btn.textContent = t("delete_btn");
        }, 3000);
    }
}

function copyText(id) {
    const item = stashItems.find(i => i.id === id);
    if (!item) return;
    
    let textToCopy = "";
    if (item.unlockedSession) {
        textToCopy = item.decryptedContentTemp; 
    } else {
        const { text } = parseStashText(item.text);
        textToCopy = text;
    }
    
    navigator.clipboard.writeText(textToCopy);
    const originalBtn = document.getElementById(`copy-btn-${id}`);
    if (originalBtn) {
        originalBtn.textContent = t("copied_btn");
        setTimeout(() => {
            originalBtn.textContent = t("copy_btn");
        }, 1500);
    }
}

function updateInputStats() {
    const inputElement = document.getElementById('mainInput');
    const mainStatsElement = document.getElementById('mainStats');
    if (inputElement && mainStatsElement) {
        const text = inputElement.value;
        const bytes = getByteSize(text);
        mainStatsElement.textContent = t("char_counter", { count: text.length }) + ` (${bytes} Bytes)`;
    }
}
