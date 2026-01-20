// --- Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
// Realtime DB (既存のグラフ用)
import { getDatabase, ref, set, onValue, remove, push, child, update } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
// Auth (共通)
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
// ★NEW: Firestore (新しい知識カード用)
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- Global Variables ---
let network, nodes, edges;
let db;         // Realtime Database (Graph)
let firestore;  // ★NEW: Firestore (Knowledge Cards)
let auth;
let CONFIG = {
    openai: localStorage.getItem('openai_key') || '',
    googleKey: localStorage.getItem('google_key') || '',
    googleCx: localStorage.getItem('google_cx') || '',
    firebase: JSON.parse(localStorage.getItem('firebase_config') || '{}')
};

// --- 1. Initialize Vis.js (Orbit Theme) ---
function initGraph() {
    nodes = new vis.DataSet([]);
    edges = new vis.DataSet([]);

    const container = document.getElementById('network');
    // コンテナがない場合はエラー回避（詳細ページなどでグラフを使わない場合のため）
    if (!container) return;

    const data = { nodes: nodes, edges: edges };
    
    // Orbit Theme Options
    const options = {
        nodes: {
            shape: 'dot',
            font: { size: 16, color: '#ffffff', face: 'Orbitron' },
            borderWidth: 0,
            shadow: {
                enabled: true,
                color: 'rgba(102, 252, 241, 0.7)',
                size: 15,
                x: 0, y: 0
            }
        },
        edges: {
            width: 2,
            color: {
                color: 'rgba(102, 252, 241, 0.4)',
                highlight: '#66fcf1',
                opacity: 0.8
            },
            shadow: {
                enabled: true,
                color: 'rgba(102, 252, 241, 0.5)',
                size: 5, x: 0, y: 0
            },
            smooth: {
                type: 'dynamic',
                forceDirection: 'none',
                roundness: 0.5
            }
        },
        groups: {
            core: {
                size: 50,
                color: { background: '#ffd700', highlight: { background:'#ffe44d', border:'#ffd700' } },
                shadow: { color: 'rgba(255, 215, 0, 0.9)', size: 40 },
                font: { size: 24, color: '#ffd700' }
            },
            result: {
                size: 25,
                color: { background: '#66fcf1', highlight: { background:'#99fff7', border:'#66fcf1' } },
                shadow: { color: 'rgba(102, 252, 241, 0.8)', size: 20 }
            },
            ai: {
                size: 15,
                color: { background: '#45a29e', highlight: { background:'#66fcf1', border:'#45a29e' } },
                shadow: { color: 'rgba(69, 162, 158, 0.8)', size: 15 }
            }
        },
        physics: {
            stabilization: false,
            barnesHut: {
                gravitationalConstant: -15000,
                centralGravity: 0.3,
                springLength: 150,
                springConstant: 0.02,
                damping: 0.09
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            hideEdgesOnDrag: true
        }
    };
    network = new vis.Network(container, data, options);

    // Interaction Events
    network.on("click", function (params) {
        if (params.nodes.length > 0) {
            const nodeData = nodes.get(params.nodes[0]);
            showPanel(nodeData);
            network.focus(params.nodes[0], {
                scale: 1.2,
                animation: { duration: 800, easingFunction: 'easeInOutQuad' }
            });
        } else {
            const infoPanel = document.getElementById('info-panel');
            if(infoPanel) infoPanel.classList.remove('active');
            network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' }});
        }
    });
}

// --- 2. Firebase Integration (Auth & DB & Firestore) ---
function initFirebase() {
    if (!CONFIG.firebase.apiKey) return;
    try {
        const app = initializeApp(CONFIG.firebase);
        db = getDatabase(app);        // Realtime Database
        firestore = getFirestore(app); // ★NEW: Firestore
        auth = getAuth(app);
        
        logToConsole("Initiating secure uplink to Firebase...", "system");
        
        signInAnonymously(auth)
            .then(() => {
                // --- A. Realtime DB Sync (Graph) ---
                const graphRef = ref(db, 'knowledge-graph');
                onValue(graphRef, (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        const newNodes = data.nodes ? Object.values(data.nodes) : [];
                        const newEdges = data.edges ? Object.values(data.edges) : [];
                        if(nodes) {
                            nodes.clear(); edges.clear(); nodes.add(newNodes); edges.add(newEdges);
                        }
                        logToConsole("Orbit graph database synchronized.", "system");
                    }
                }, (error) => { logToConsole("Graph Stream Error: " + error.message, "error"); });

                // --- B. Firestore Sync (Knowledge Cards) ---
                // ★NEW: 知識カードの同期を開始
                initKnowledgeListener();

            })
            .catch((error) => { logToConsole("Uplink Failed: " + error.message, "error"); });
    } catch (e) { logToConsole("Firebase Init Error: " + e.message, "error"); }
}

function saveToDB() {
    if (!db || !auth.currentUser) return;
    const nodesObj = {}; const edgesObj = {};
    nodes.forEach(n => nodesObj[n.id] = n);
    edges.forEach(e => edgesObj[e.id] = e);
    set(ref(db, 'knowledge-graph'), { nodes: nodesObj, edges: edgesObj })
        .catch(e => logToConsole("Data Save Failed: " + e.message, "error"));
}

// --- 3. Web Search & AI (Gemini) ---
async function performWebSearch(query) {
    if (!CONFIG.googleKey || !CONFIG.googleCx) { logToConsole("Missing Google comms keys.", "error"); return null; }
    logToConsole(`Scanning deep web for: "${query}"...`, "ai");
    const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.googleKey}&cx=${CONFIG.googleCx}&q=${encodeURIComponent(query)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return data.items || [];
    } catch (e) { return []; }
}

async function getAISummary(topic, searchResults) {
    const apiKey = (CONFIG.openai || "").trim(); 
    if (!apiKey) return "AI API Key missing. Cannot analyze.";
    logToConsole(`Gemini AI analyzing data constellation for "${topic}"...`, "ai");
    const context = searchResults.slice(0, 3).map(item => `- ${item.title}: ${item.snippet}`).join("\n");
    const prompt = `Topic: ${topic}\nContext:\n${context}\nTask: Summarize the relationship between these concepts and the topic in Japanese. Be concise and insightful for a knowledge graph perspective (max 120 words). Format as plain text.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const json = await res.json();
        if(json.error) throw new Error(json.error.message);
        return json.candidates?.[0]?.content?.parts?.[0]?.text || "No suitable data found.";
    } catch (e) { logToConsole("AI Analysis Error: " + e.message, "error"); return "AI analysis failed."; }
}

async function triggerSearch() {
    const input = document.getElementById('search-input');
    const term = input.value;
    if (!term) return;
    input.value = "";

    const centerId = `star_${Date.now()}`;
    const centerNode = { id: centerId, label: term, group: 'core', description: 'Initiating stellar scan...', x: 0, y: 0 };
    if(nodes) nodes.add(centerNode);
    if (db) saveToDB();

    const results = await performWebSearch(term);
    if (!results) return;

    const newNodes = [];
    const newEdges = [];
    results.slice(0, 4).forEach((item, index) => {
        const childId = `${centerId}_planet_${index}`;
        newNodes.push({ id: childId, label: item.title.length > 12 ? item.title.substring(0, 12)+"..." : item.title, group: 'result', title: item.title, description: item.snippet, url: item.link });
        newEdges.push({ id: `${centerId}_orbit_${index}`, from: centerId, to: childId });
    });
    const summary = await getAISummary(term, results);
    centerNode.description = summary;
    if(nodes) {
        nodes.update(centerNode);
        nodes.add(newNodes);
        edges.add(newEdges);
    }
    if (db) saveToDB();
    logToConsole("New stellar system mapped.", "system");
    if(network) network.focus(centerId, { scale: 1.0, animation: { duration: 1000 } });
}

// --- 4. Smart Capture Logic (★NEW FEATURE) ---

// カード表示のリスナー開始
// --- 4. Smart Capture Logic (AI Integration) ---

// カード表示のリスナー（ここは変更なし）
function initKnowledgeListener() {
    const cardContainer = document.getElementById('cardContainer');
    if (!cardContainer || !firestore) return;

    const q = query(collection(firestore, "knowledge_base"), orderBy("timestamp", "desc"));
    
    onSnapshot(q, (snapshot) => {
        cardContainer.innerHTML = "";
        snapshot.forEach((doc) => {
            const data = doc.data();
            createCardElement(data, cardContainer);
        });
        logToConsole(`Synced ${snapshot.size} knowledge cards.`, "system");
    });
}

// 知識カードDOM作成（内容をリッチにするために少し変更）
function createCardElement(data, container) {
    const card = document.createElement('div');
    card.className = 'knowledge-card';
    const dateStr = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleDateString() : 'Just now';

    // 配列データ（主なプレイヤーなど）をタグ表示用に変換
    let playersHtml = '';
    if (data.key_players && Array.isArray(data.key_players)) {
        playersHtml = data.key_players.map(p => 
            `<span style="font-size:0.7em; background:#333; color:#ccc; padding:2px 5px; margin-right:4px; border-radius:3px;">${p.name || p}</span>`
        ).join('');
    }

    card.innerHTML = `
      <div class="card-header">
        <h3 class="card-title">${data.word}</h3>
        <span class="card-category">${data.category || 'General'}</span>
      </div>
      <div class="card-summary">
        ${data.summary}
      </div>
      ${data.analogy ? `<div style="font-size:0.8rem; color:#888; margin-bottom:8px;"><i>💡例え: ${data.analogy}</i></div>` : ''}
      <div style="margin-bottom:10px;">${playersHtml}</div>
      <div class="card-footer">
        Recorded: ${dateStr}
      </div>
    `;
    container.appendChild(card);
}

// ★AI分析＆保存を行うメイン関数
async function analyzeAndSave(word) {
    const apiKey = (CONFIG.openai || "").trim(); // 設定画面の「AI API Key」を使用
    if (!apiKey) throw new Error("API Key is missing. Please check settings.");

    // AIへの指示書（プロンプト）
    const prompt = `
    You are an expert IT Industry Analyst. 
    Analyze the term "${word}".
    Output ONLY a valid JSON object (no markdown, no code blocks) with the following structure:
    {
      "word": "${word}",
      "category": "Identify the specific IT field (e.g., Development, Security, Cloud)",
      "summary": "A concise explanation for a beginner (max 100 characters) in Japanese.",
      "analogy": "A simple real-world analogy in Japanese.",
      "key_players": [{"name": "Company/Tool Name", "role": "Brief role"}],
      "difficulty": 1 to 5
    }
    Respond in Japanese.
    `;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    // API呼び出し
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const json = await res.json();
    if (json.error) throw new Error(json.error.message);

    // AIの返答からテキストを取り出す
    let rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    
    // Markdownのコードブロック記号が入っていたら削除してJSON化する
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    const aiData = JSON.parse(rawText);
    return aiData;
}

// 保存ボタンのイベントリスナー（本番AI接続版）
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

        // UIをローディング状態にする
        statusMessage.textContent = "AIエージェントが業界分析中...";
        captureBtn.disabled = true;
        captureBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
        logToConsole(`Agent deployed to analyze sector: "${word}"...`, "ai");

        try {
            // 1. AIに分析させる
            const aiResult = await analyzeAndSave(word);
            
            // 2. Firestoreに保存する
            await addDoc(collection(firestore, "knowledge_base"), {
                ...aiResult, // AIのデータを展開
                timestamp: serverTimestamp()
            });

            // 成功時の処理
            wordInput.value = "";
            statusMessage.textContent = "分析完了・保存しました";
            logToConsole(`Intel acquired for "${word}".`, "system");

        } catch (e) {
            console.error(e);
            logToConsole("Mission Failed: " + e.message, "error");
            statusMessage.textContent = "エラー: " + e.message;
        } finally {
            // ボタンを元に戻す
            captureBtn.disabled = false;
            captureBtn.innerHTML = '解析・保存';
            setTimeout(() => { statusMessage.textContent = ""; }, 5000);
        }
    });
}


// --- Helper Functions (Attached to Window) ---
window.showPanel = function(node) {
    const panelTitle = document.getElementById('panel-title');
    if(!panelTitle) return; // エラー回避

    panelTitle.innerText = node.label;
    document.getElementById('panel-desc').innerText = node.description || "No data available.";
    let html = `<span class="tag">${(node.group || 'unknown').toUpperCase()} CLASS</span>`;
    if (node.url) html += `<br><a href="${node.url}" target="_blank" style="color:#66fcf1; text-decoration: none;"><i class="fas fa-rocket"></i> Open Source Link</a>`;
    document.getElementById('panel-tags').innerHTML = html;
    document.getElementById('info-panel').classList.add('active');
    window.currentNodeId = node.id;
}
window.closePanel = function() { 
    const p = document.getElementById('info-panel');
    if(p) p.classList.remove('active'); 
    if(network) network.unselectAll(); 
}
window.deleteNode = function() {
    if (window.currentNodeId && nodes) {
        const relatedEdges = network.getConnectedEdges(window.currentNodeId);
        nodes.remove(window.currentNodeId);
        edges.remove(relatedEdges);
        closePanel();
        if (db) saveToDB();
        logToConsole("Celestial body removed from orbit.", "system");
    }
}
window.logToConsole = function(text, type = "ai") {
    const consoleBody = document.getElementById('console-logs');
    if(!consoleBody) return;

    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.innerText = `>> ${text}`;
    consoleBody.appendChild(div);
    consoleBody.scrollTop = consoleBody.scrollHeight;
}
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
    catch(e) { alert("Firebase Config JSON malformed!"); return; }
    localStorage.setItem('openai_key', CONFIG.openai);
    localStorage.setItem('google_key', CONFIG.googleKey);
    localStorage.setItem('google_cx', CONFIG.googleCx);
    localStorage.setItem('firebase_config', JSON.stringify(CONFIG.firebase));
    toggleSettings();
    logToConsole("System configuration updated. Rebooting orbit...", "system");
    setTimeout(() => location.reload(), 1000);
}

// --- Start Up ---
const mainSearchBtn = document.getElementById('search-btn');
if(mainSearchBtn) mainSearchBtn.addEventListener('click', triggerSearch);

const mainSearchInput = document.getElementById('search-input');
if(mainSearchInput) mainSearchInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') triggerSearch(); });

initGraph();
initFirebase();
