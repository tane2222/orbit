// --- Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase, ref, set, onValue, remove, push, child, update } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

// --- Global Variables ---
let network, nodes, edges;
let db, auth;
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
            document.getElementById('info-panel').classList.remove('active');
            network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' }});
        }
    });
}

// --- 2. Firebase Integration (Auth & DB) ---
function initFirebase() {
    if (!CONFIG.firebase.apiKey) return;
    try {
        const app = initializeApp(CONFIG.firebase);
        db = getDatabase(app);
        auth = getAuth(app);
        logToConsole("Initiating secure uplink to Firebase...", "system");
        signInAnonymously(auth)
            .then(() => {
                const graphRef = ref(db, 'knowledge-graph');
                onValue(graphRef, (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        const newNodes = data.nodes ? Object.values(data.nodes) : [];
                        const newEdges = data.edges ? Object.values(data.edges) : [];
                        nodes.clear(); edges.clear(); nodes.add(newNodes); edges.add(newEdges);
                        logToConsole("Orbit database synchronized (Secure).", "system");
                    }
                }, (error) => { logToConsole("Data Stream Error: " + error.message, "error"); });
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
    nodes.add(centerNode);
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
    nodes.update(centerNode);
    nodes.add(newNodes);
    edges.add(newEdges);
    if (db) saveToDB();
    logToConsole("New stellar system mapped.", "system");
    network.focus(centerId, { scale: 1.0, animation: { duration: 1000 } });
}

// --- Helper Functions (Attached to Window for HTML calls) ---
window.showPanel = function(node) {
    document.getElementById('panel-title').innerText = node.label;
    document.getElementById('panel-desc').innerText = node.description || "No data available.";
    let html = `<span class="tag">${node.group.toUpperCase()} CLASS</span>`;
    if (node.url) html += `<br><a href="${node.url}" target="_blank" style="color:#66fcf1; text-decoration: none;"><i class="fas fa-rocket"></i> Open Source Link</a>`;
    document.getElementById('panel-tags').innerHTML = html;
    document.getElementById('info-panel').classList.add('active');
    window.currentNodeId = node.id;
}
window.closePanel = function() { document.getElementById('info-panel').classList.remove('active'); network.unselectAll(); }
window.deleteNode = function() {
    if (window.currentNodeId) {
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
document.getElementById('search-btn').addEventListener('click', triggerSearch);
document.getElementById('search-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') triggerSearch(); });
initGraph();
initFirebase();
