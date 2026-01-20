// --- Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- Global Variables ---
let network, nodes, edges;
let firestore;
let auth;
let CONFIG = {
    openai: localStorage.getItem('openai_key') || '', // Gemini Key
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
    
    // 宇宙テーマの設定
    const options = {
        nodes: {
            shape: 'dot',
            font: { size: 14, color: '#ffffff', face: 'Segoe UI' },
            borderWidth: 2,
            shadow: { enabled: true, color: 'rgba(102, 252, 241, 0.5)', size: 10 }
        },
        edges: {
            width: 1,
            color: { color: 'rgba(102, 252, 241, 0.2)', highlight: '#66fcf1' },
            smooth: { type: 'continuous' }
        },
        groups: {
            knowledge: {
                size: 30,
                color: { background: '#0b1c2c', border: '#66fcf1' },
                font: { size: 18, color: '#66fcf1' }
            },
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
        physics: {
            stabilization: false,
            barnesHut: {
                gravitationalConstant: -20000,
                centralGravity: 0.1,
                springLength: 120,
                springConstant: 0.04,
                damping: 0.09
            }
        },
        interaction: { hover: true, tooltipDelay: 200 }
    };

    network = new vis.Network(container, data, options);

    network.on("click", function (params) {
        if (params.nodes.length > 0) {
            network.focus(params.nodes[0], {
                scale: 1.2,
                animation: { duration: 800, easingFunction: 'easeInOutQuad' }
            });
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
        
        nodes.clear();
        edges.clear();

        snapshot.forEach((doc) => {
            const data = doc.data();
            const docId = doc.id;

            if(cardContainer) createCardElement(data, cardContainer);

            try {
                nodes.add({
                    id: docId,
                    label: data.word,
                    group: 'knowledge',
                    title: data.summary
                });

                if (data.key_players && Array.isArray(data.key_players)) {
                    data.key_players.forEach((player, index) => {
                        const playerId = `${docId}_p_${index}`;
                        const playerName = player.name || player;
                        
                        nodes.add({
                            id: playerId,
                            label: playerName,
                            group: 'player',
                            title: player.role || 'Key Player'
                        });
                        
                        edges.add({
                            from: docId,
                            to: playerId
                        });
                    });
                }
            } catch (e) {
                console.log("Graph update skip: Duplicate or error");
            }
        });
        
        logToConsole(`Visualizing ${snapshot.size} knowledge clusters.`, "system");
    });
}

// --- 3. AI Logic (Capture Analysis) ---
async function analyzeAndSave(word) {
    const apiKey = (CONFIG.openai || "").trim();
    if (!apiKey) throw new Error("API Key is missing.");

    const prompt = `
    You are an expert IT Analyst. Analyze the term "${word}".
    Output ONLY valid JSON:
    {
      "word": "${word}",
      "category": "Broad Category (e.g. Cloud, Dev, AI)",
      "summary": "Simple definition (Japanese, max 80 chars).",
      "analogy": "Real-world analogy (Japanese).",
      "key_players": [{"name": "Name", "role": "Role"}],
      "related_terms": ["Term1", "Term2", "Term3"]
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

// --- 4. DOM Elements & Event Listeners ---

function createCardElement(data, container) {
    const card = document.createElement('div');
    card.className = 'knowledge-card';
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
      <div class="card-footer">Recorded: ${dateStr}</div>
    `;
    container.appendChild(card);
}

// 知識の収集ボタン (Knowledge Capture)
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
            
            await addDoc(collection(firestore, "knowledge_base"), {
                ...aiResult,
                timestamp: serverTimestamp()
            });

            wordInput.value = "";
            statusMessage.textContent = "Data Secured.";
            logToConsole(`New constellation mapped: ${word}`, "system");

        } catch (e) {
            console.error(e);
            logToConsole("Error: " + e.message, "error");
            statusMessage.textContent = "Error!";
        } finally {
            captureBtn.disabled = false;
            captureBtn.innerHTML = 'EXPLORE'; // ボタンの文言を合わせました
            setTimeout(() => { statusMessage.textContent = ""; }, 3000);
        }
    });
}

// --- 5. Chat Assistant Logic (Context-Aware RAG) ---

async function getRecentContext() {
    if (!nodes) return "";

    // nodesがまだDataSetとして機能していない場合は空を返す
    try {
        if (nodes.length === 0 && typeof nodes.get !== 'function') return "";
    } catch(e) { return ""; }

    // Vis.jsのnodesデータセットから、保存済みの知識（summary）を抽出
    const contextData = nodes.get({
        filter: function (item) {
            return item.group === 'knowledge'; // メインの知識ノードのみ
        }
    });

    if (contextData.length === 0) return "";

    // 最新順（簡易的に配列の最後から取得）
    // テキストに整形
    const contextText = contextData.slice(-15).reverse().map(item => {
        return `- 【${item.label}】: ${item.title || "概要なし"}`;
    }).join("\n");

    return contextText;
}

// メッセージ表示ヘルパー
function appendMessage(text, type) {
    const history = document.getElementById('chat-history');
    if (!history) return;

    const div = document.createElement('div');
    div.className = `chat-msg ${type}`;
    div.innerHTML = text.replace(/\n/g, '<br>');
    
    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
}

// ログ出力をチャットシステムに統合
window.logToConsole = function(text, type = "system") {
    const msgType = (type === 'ai' || type === 'error') ? 'system' : type;
    appendMessage(`>> ${text}`, msgType);
}

// コンテキストを考慮したチャット送信処理
window.sendChat = async function() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    // 1. ユーザーのメッセージを表示
    appendMessage(text, 'user');
    input.value = '';

    const apiKey = (CONFIG.openai || "").trim();
    if (!apiKey) {
        appendMessage("Error: API Key is missing in Settings.", "system");
        return;
    }

    // 2. ローディング表示
    const loadingId = 'loading-' + Date.now();
    const history = document.getElementById('chat-history');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-msg ai';
    loadingDiv.id = loadingId;
    loadingDiv.innerHTML = '<i class="fas fa-ellipsis-h fa-fade"></i> Connecting dots...';
    history.appendChild(loadingDiv);
    history.scrollTop = history.scrollHeight;

    try {
        // ★ 過去の知識を取得
        const context = await getRecentContext();
        
        console.log("Injecting Context:", context); // デバッグ用

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        
        // ★ プロンプト
        const prompt = `
        You are "Orbit Assistant", an expert IT consultant.
        
        The user has recently researched the following topics (Most recent first):
        === RECENT SEARCH HISTORY ===
        ${context || "No search history available yet."}
        =============================

        [INSTRUCTION]:
        Answer the user's question in Japanese based on the history above if applicable.
        If the user asks "what did I look up?" or "tell me about the last one", refer to the list above.
        
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

        const loader = document.getElementById(loadingId);
        if(loader) loader.remove();
        appendMessage(aiResponse, 'ai');

    } catch (e) {
        const loader = document.getElementById(loadingId);
        if(loader) loader.remove();
        appendMessage("Error: " + e.message, "system");
    }
}

// --- 6. Helper & Event Listeners ---

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

// Helper: パネル操作
window.closePanel = function() { 
    const p = document.getElementById('info-panel');
    if(p) p.classList.remove('active'); 
    if(network) network.unselectAll(); 
}

// Helper: ノード削除
window.deleteNode = function() {
    // 簡易実装: DB削除は未実装のため、画面から消してパネルを閉じるのみ
    window.closePanel();
}

// スタートアップ実行
initGraph();
initFirebase();

// Enterキーでの送信サポート (検索窓)
const searchInputField = document.getElementById('wordInput');
if(searchInputField) {
    searchInputField.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') document.getElementById('searchBtn').click();
    });
}

// Enterキーでの送信サポート (チャット窓)
const chatInputField = document.getElementById('chatInput');
if(chatInputField) {
    chatInputField.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') window.sendChat();
    });
}
