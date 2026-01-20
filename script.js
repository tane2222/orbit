// --- Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- Global Variables ---
let network, nodes, edges;
let firestore;
let auth;
// 検索直後にフォーカスしたいノードIDを一時保存する変数
let pendingFocusId = null;

let CONFIG = {
    openai: localStorage.getItem('openai_key') || '', 
    googleKey: localStorage.getItem('google_key') || '',
    googleCx: localStorage.getItem('google_cx') || '',
    firebase: JSON.parse(localStorage.getItem('firebase_config') || '{}')
};

// --- 1. Initialize Vis.js (Universe Graph) ---
function initGraph() {
    nodes = new vis.DataSet([]);
    edges = new vis.DataSet([]);

    const container = document.getElementById('network');
    if (!container) return;

    const data = { nodes: nodes, edges: edges };
    
    const options = {
        nodes: {
            shape: 'dot',
            font: { 
                size: 14, 
                color: '#ffffff', 
                face: 'Segoe UI',
                strokeWidth: 0
            },
            borderWidth: 2,
            shadow: { 
                enabled: true, 
                color: 'rgba(102, 252, 241, 0.5)', 
                size: 10 
            }
        },
        edges: {
            width: 1,
            color: { 
                color: 'rgba(102, 252, 241, 0.2)', 
                highlight: '#66fcf1' 
            },
            smooth: { 
                type: 'continuous',
                roundness: 0.5
            }
        },
        // ★修正: デザイン設定を元の「青・シアン基調」に戻しました
        groups: {
            // メインの知識ノード
            knowledge: {
                size: 30,
                color: { background: '#0b1c2c', border: '#66fcf1' },
                font: { size: 18, color: '#66fcf1' }
            },
            // 企業やツールのノード（ひし形）
            player: {
                size: 15,
                color: { background: '#1f2833', border: '#45a29e' },
                font: { size: 12, color: '#c5c6c7' },
                shape: 'diamond'
            },
            related: {
                size: 10,
                color: { background: '#333', border: '#888' },
                font: { size: 10, color: '#888' }
            }
        },
        // ★維持: 評価の良かった「ゆったりとした動き」の設定
        physics: {
            enabled: true,
            solver: 'forceAtlas2Based',
            forceAtlas2Based: {
                gravitationalConstant: -100, // 適度な反発
                centralGravity: 0.005,      // 緩やかな中心への引力
                springLength: 150,
                springConstant: 0.05,
                damping: 0.8                // 0.8にすることで水中のような抵抗を作り、爆発を防ぐ
            },
            maxVelocity: 30, // 速度制限
            minVelocity: 0.1,
            stabilization: {
                enabled: true,
                iterations: 200,
                updateInterval: 25
            }
        },
        interaction: { hover: true, tooltipDelay: 200, zoomView: true, dragView: true }
    };

    network = new vis.Network(container, data, options);

    // クリック時のイベント
    network.on("click", function (params) {
        if (params.nodes.length > 0) {
            network.focus(params.nodes[0], {
                scale: 1.2,
                animation: { duration: 1000, easingFunction: 'easeInOutQuad' }
            });
            
            const nodeId = params.nodes[0];
            const node = nodes.get(nodeId);
            if(node) showPanel(node);
        } else {
            closePanel();
        }
    });
}

// --- 2. Firebase & Data Sync ---
function initFirebase() {
    if (!CONFIG.firebase.apiKey) return;
    try {
        const app = initializeApp(CONFIG.firebase);
        firestore = getFirestore(app);
        auth = getAuth(app);
        
        logToConsole("Connecting to ORBIT Knowledge Base...", "system");
        
        signInAnonymously(auth)
            .then(() => {
                syncKnowledgeBase();
                syncMemos();
            })
            .catch((error) => { logToConsole("Auth Failed: " + error.message, "error"); });
    } catch (e) { logToConsole("Init Error: " + e.message, "error"); }
}

function syncKnowledgeBase() {
    const cardContainer = document.getElementById('cardContainer');
    if (!firestore) return;

    const q = query(collection(firestore, "knowledge_base"), orderBy("timestamp", "desc"));
    
    onSnapshot(q, (snapshot) => {
        if(cardContainer) cardContainer.innerHTML = "";
        
        const existingIds = nodes.getIds();
        const newIds = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const docId = docSnap.id;
            newIds.push(docId);

            if(cardContainer) createCardElement(data, docId, cardContainer);

            if (!existingIds.includes(docId)) {
                try {
                    // 新規ノードは画面中央付近に配置（遠くからの飛来防止）
                    nodes.add({
                        id: docId,
                        label: data.word,
                        group: 'knowledge',
                        title: data.summary,
                        x: (Math.random() - 0.5) * 50, 
                        y: (Math.random() - 0.5) * 50
                    });

                    if (data.key_players && Array.isArray(data.key_players)) {
                        data.key_players.forEach((player, index) => {
                            const playerId = `${docId}_p_${index}`;
                            const playerName = player.name || player;
                            newIds.push(playerId);

                            nodes.add({
                                id: playerId,
                                label: playerName,
                                group: 'player',
                                title: player.role || 'Key Player',
                                x: (Math.random() - 0.5) * 50,
                                y: (Math.random() - 0.5) * 50
                            });
                            
                            edges.add({
                                from: docId,
                                to: playerId
                            });
                        });
                    }
                } catch (e) {
                    console.log("Node add skip");
                }
            }
        });
        
        // 削除同期
        const idsToRemove = existingIds.filter(id => !newIds.includes(id));
        if(idsToRemove.length > 0) {
            nodes.remove(idsToRemove);
        }

        logToConsole(`Visualizing ${snapshot.size} knowledge clusters.`, "system");

        // 検索直後の自動フォーカス
        if (pendingFocusId && nodes.get(pendingFocusId)) {
            setTimeout(() => {
                network.focus(pendingFocusId, {
                    scale: 1.5,
                    offset: {x: 0, y: 0},
                    animation: {
                        duration: 1500,
                        easingFunction: 'easeInOutCubic'
                    }
                });
                pendingFocusId = null;
            }, 500);
        }
    });
}

function syncMemos() {
    const memoContainer = document.getElementById('memoContainer');
    if (!firestore || !memoContainer) return;

    const q = query(collection(firestore, "memos"), orderBy("timestamp", "desc"));

    onSnapshot(q, (snapshot) => {
        memoContainer.innerHTML = "";
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const div = document.createElement('div');
            div.className = 'memo-item';
            div.innerHTML = `
                <span>${data.text}</span>
                <div class="memo-actions">
                    <i class="fas fa-search" onclick="analyzeFromMemo('${data.text}', '${docSnap.id}')" title="Explore"></i>
                    <i class="fas fa-trash" onclick="deleteMemo('${docSnap.id}')" title="Delete"></i>
                </div>
            `;
            memoContainer.appendChild(div);
        });
    });
}

// --- 3. AI Logic ---
async function analyzeAndSave(word) {
    const apiKey = (CONFIG.openai || "").trim();
    if (!apiKey) throw new Error("API Key is missing.");

    const prompt = `
    You are an expert IT Analyst. Analyze the term "${word}".
    Output ONLY valid JSON:
    {
      "word": "${word}",
      "category": "Category",
      "summary": "Simple definition (Japanese, max 80 chars).",
      "analogy": "Real-world analogy (Japanese).",
      "key_players": [{"name": "Name", "role": "Role"}],
      "related_terms": ["Term1", "Term2"]
    }
    Respond in Japanese.
    `;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const json = await res.json();
    if (json.error) throw new Error(json.error.message);

    let rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(rawText);
}

async function getDetailedSummary(word) {
    const apiKey = (CONFIG.openai || "").trim();
    if (!apiKey) return "API Key missing.";

    const prompt = `
    Explain the term "${word}" in detail for an IT professional.
    Structure:
    1. Detailed Definition
    2. Historical Background
    3. Pros & Cons
    4. Use Cases
    Respond in Japanese. Output plain text.
    `;
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text || "No details found.";
}

// --- 4. DOM Elements ---

function createCardElement(data, docId, container) {
    const card = document.createElement('div');
    card.className = 'knowledge-card';
    card.onclick = (e) => {
        if(e.target.tagName === 'BUTTON' || e.target.tagName === 'I') return;
        network.focus(docId, { scale: 1.2, animation: { duration: 1000 } });
        showPanel({ label: data.word, title: data.summary, group: 'knowledge' });
    };
    card.style.cursor = "pointer";

    const dateStr = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleDateString() : 'Just now';

    let playersHtml = '';
    if (data.key_players && Array.isArray(data.key_players)) {
        playersHtml = data.key_players.map(p => 
            `<span style="font-size:0.7em; background:rgba(69, 162, 158, 0.2); color:#66fcf1; padding:2px 6px; margin-right:4px; border-radius:3px; border:1px solid rgba(69, 162, 158, 0.5);">${p.name || p}</span>`
        ).join('');
    }

    card.innerHTML = `
      <div class="card-header">
        <h3 class="card-title">${data.word}</h3>
        <span class="card-category">${data.category || 'General'}</span>
      </div>
      <div class="card-summary">${data.summary}</div>
      ${data.analogy ? `<div style="font-size:0.8rem; color:#888; margin-bottom:10px; padding:8px; background:rgba(0,0,0,0.2); border-radius:5px;"><i class="fas fa-lightbulb" style="color:#ffd700;"></i> ${data.analogy}</div>` : ''}
      <div style="margin-bottom:10px;">${playersHtml}</div>
      <div class="card-actions">
         <button class="card-btn" onclick="openDetail('${data.word}')"><i class="fas fa-book-open"></i> 詳細</button>
         <button class="card-btn delete" onclick="deleteCard('${docId}', '${data.word}')"><i class="fas fa-trash"></i> 削除</button>
      </div>
      <div class="card-footer">Recorded: ${dateStr}</div>
    `;
    container.appendChild(card);
}

window.deleteCard = async function(docId, word) {
    if(!confirm(`"${word}" を削除しますか？`)) return;
    try {
        await deleteDoc(doc(firestore, "knowledge_base", docId));
        logToConsole(`Deleted: ${word}`, "system");
    } catch(e) {
        logToConsole("Delete Error: " + e.message, "error");
    }
}

window.openDetail = async function(word) {
    const modal = document.getElementById('detail-modal');
    const body = document.getElementById('detail-body');
    const title = document.getElementById('detail-title');
    title.innerText = `Analyzing: ${word}`;
    body.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Generating report...';
    modal.style.display = 'flex';
    try {
        const text = await getDetailedSummary(word);
        body.innerHTML = text.replace(/\n/g, '<br>');
    } catch(e) { body.innerText = "Error fetching details."; }
}
window.closeDetailModal = function() {
    document.getElementById('detail-modal').style.display = 'none';
}

function showPanel(node) {
    const panelTitle = document.getElementById('panel-title');
    const panelDesc = document.getElementById('panel-desc');
    const panelControls = document.querySelector('#info-panel .controls');

    if(!panelTitle) return;
    panelTitle.innerText = node.label;
    panelDesc.innerText = node.title || "No data.";
    document.getElementById('info-panel').classList.add('active');

    let html = `<button class="action-btn" onclick="closePanel()">Close</button>`;
    if(node.group !== 'knowledge') {
        html = `<button class="action-btn" style="background:var(--accent-cyan); color:black;" onclick="investigateNode('${node.label}')"><i class="fas fa-search-plus"></i> 調査</button>` + html;
    }
    panelControls.innerHTML = html;
}

window.investigateNode = function(word) {
    document.getElementById('wordInput').value = word;
    document.getElementById('searchBtn').click();
    closePanel();
}

window.addMemo = async function() {
    const input = document.getElementById('memoInput');
    const text = input.value.trim();
    if(!text || !firestore) return;
    try {
        await addDoc(collection(firestore, "memos"), { text: text, timestamp: serverTimestamp() });
        input.value = "";
    } catch(e) { console.error(e); }
}
window.analyzeFromMemo = function(text, docId) {
    document.getElementById('wordInput').value = text;
    document.getElementById('searchBtn').click();
    deleteMemo(docId);
}
window.deleteMemo = async function(docId) {
    try { await deleteDoc(doc(firestore, "memos", docId)); } catch(e) { console.error(e); }
}
const addMemoBtn = document.getElementById('addMemoBtn');
if(addMemoBtn) addMemoBtn.addEventListener('click', window.addMemo);

// --- Main Search Event ---
const captureBtn = document.getElementById('searchBtn');
if (captureBtn) {
    captureBtn.addEventListener('click', async () => {
        const wordInput = document.getElementById('wordInput');
        const statusMessage = document.getElementById('statusMessage');
        const word = wordInput.value;
        
        if (!word) return;
        if (!firestore) {
            logToConsole("Database not ready.", "error");
            return;
        }

        statusMessage.textContent = "AI Agent Surveying...";
        captureBtn.disabled = true;
        captureBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
        logToConsole(`Initiating deep scan for: "${word}"`, "ai");

        try {
            const aiResult = await analyzeAndSave(word);
            
            const docRef = await addDoc(collection(firestore, "knowledge_base"), {
                ...aiResult,
                timestamp: serverTimestamp()
            });

            pendingFocusId = docRef.id;

            wordInput.value = "";
            statusMessage.textContent = "Data Secured.";
            logToConsole(`New constellation mapped: ${word}`, "system");

        } catch (e) {
            console.error(e);
            logToConsole("Error: " + e.message, "error");
            statusMessage.textContent = "Error!";
        } finally {
            captureBtn.disabled = false;
            captureBtn.innerHTML = 'EXPLORE';
            setTimeout(() => { statusMessage.textContent = ""; }, 3000);
        }
    });
}

// --- Chat & Context ---
async function getRecentContext() {
    if (!nodes) return "";
    try { if (nodes.length === 0 && typeof nodes.get !== 'function') return ""; } catch(e) { return ""; }
    const contextData = nodes.get({ filter: function (item) { return item.group === 'knowledge'; } });
    if (contextData.length === 0) return "";
    return contextData.slice(-15).reverse().map(item => `- 【${item.label}】: ${item.title || "概要なし"}`).join("\n");
}

function appendMessage(text, type) {
    const history = document.getElementById('chat-history');
    if (!history) return;
    const div = document.createElement('div');
    div.className = `chat-msg ${type}`;
    div.innerHTML = text.replace(/\n/g, '<br>');
    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
}

window.logToConsole = function(text, type = "system") {
    const msgType = (type === 'ai' || type === 'error') ? 'system' : type;
    appendMessage(`>> ${text}`, msgType);
}

window.sendChat = async function() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    appendMessage(text, 'user');
    input.value = '';

    const apiKey = (CONFIG.openai || "").trim();
    if (!apiKey) {
        appendMessage("Error: API Key is missing.", "system");
        return;
    }

    const loadingId = 'loading-' + Date.now();
    const history = document.getElementById('chat-history');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-msg ai';
    loadingDiv.id = loadingId;
    loadingDiv.innerHTML = '<i class="fas fa-ellipsis-h fa-fade"></i> Connecting dots...';
    history.appendChild(loadingDiv);
    history.scrollTop = history.scrollHeight;

    try {
        const context = await getRecentContext();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const prompt = `
        You are "Orbit Assistant", an expert IT consultant.
        The user has recently researched the following topics (Most recent first):
        === RECENT SEARCH HISTORY ===
        ${context || "No search history available yet."}
        =============================
        [INSTRUCTION]:
        Answer the user's question in Japanese based on the history above if applicable.
        [USER QUESTION]:
        ${text}
        `;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const json = await res.json();
        const aiResponse = json.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't process that.";
        document.getElementById(loadingId).remove();
        appendMessage(aiResponse, 'ai');
    } catch (e) {
        document.getElementById(loadingId).remove();
        appendMessage("Error: " + e.message, "system");
    }
}

// --- Helpers ---
window.toggleSettings = function() {
    const modal = document.getElementById('settings-modal');
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    if(modal.style.display === 'flex'){
        document.getElementById('openai-key').value = CONFIG.openai;
        document.getElementById('google-key').value = CONFIG.googleKey;
        document.getElementById('google-cx').value = CONFIG.googleCx;
        document.getElementById('firebase-config').value = JSON.stringify(CONFIG.firebase, null, 2);
    }
}
window.saveSettings = function() {
    CONFIG.openai = document.getElementById('openai-key').value.trim();
    CONFIG.googleKey = document.getElementById('google-key').value.trim();
    CONFIG.googleCx = document.getElementById('google-cx').value.trim();
    try { const fbValue = document.getElementById('firebase-config').value.trim(); CONFIG.firebase = fbValue ? JSON.parse(fbValue) : {}; } 
    catch(e) { alert("Invalid JSON"); return; }
    localStorage.setItem('openai_key', CONFIG.openai);
    localStorage.setItem('google_key', CONFIG.googleKey);
    localStorage.setItem('google_cx', CONFIG.googleCx);
    localStorage.setItem('firebase_config', JSON.stringify(CONFIG.firebase));
    toggleSettings();
    location.reload();
}
window.closePanel = function() { 
    const p = document.getElementById('info-panel');
    if(p) p.classList.remove('active'); 
    if(network) network.unselectAll(); 
}
window.deleteNode = function() { window.closePanel(); }

initGraph();
initFirebase();

const searchInputField = document.getElementById('wordInput');
if(searchInputField) searchInputField.addEventListener('keypress', (e) => { if(e.key === 'Enter') document.getElementById('searchBtn').click(); });
const chatInputField = document.getElementById('chatInput');
if(chatInputField) chatInputField.addEventListener('keypress', (e) => { if(e.key === 'Enter') window.sendChat(); });
const memoInputField = document.getElementById('memoInput');
if(memoInputField) memoInputField.addEventListener('keypress', (e) => { if(e.key === 'Enter') window.addMemo(); });
