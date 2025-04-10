// backend/services/websocketService.js
const WebSocket = require('ws');
const config = require('../config');
const binanceService = require('./binanceService');

let marketWs = null;
let userWs = null;
let backendWss = null;
let currentMarketSymbol = 'BTCUSDT'; // Renamed for clarity
let markPriceWs = null; // WebSocket for mark price stream
let listenKey = null;
let listenKeyInterval = null;

const { wsBaseUrl } = config.binance;

// 初始化後端 WebSocket 伺服器 (依附於 HTTP 伺服器)
// ***** MODIFIED console.log *****
function initBackendWss(serverInstance) {
    backendWss = new WebSocket.Server({ server: serverInstance }); // 依附於 HTTP 伺服器

    // 修改日誌以反映實際情況
    // 需要在 serverInstance 開始監聽後才能獲取地址信息，
    // 但通常在 server.js 中打印監聽端口就足夠了。
    // 這裡可以先打印一個提示信息。
    console.log(`後端 WebSocket 服務正在設定以依附於 HTTP 伺服器...`);

    backendWss.on('listening', () => { // 'listening' 事件可能不會觸發，因為依附於外部 server
         // 嘗試獲取地址 (可能在依附模式下不可靠)
        try {
            const address = backendWss.address();
             console.log(`後端 WebSocket 服務已依附並在端口 ${address?.port} 監聽 (與 HTTP 相同)`);
        } catch (e) {
             console.log(`後端 WebSocket 服務已依附於 HTTP 伺服器 (端口應與 HTTP 相同)`);
        }
    });


    backendWss.on('connection', (wsClient) => {
        console.log('前端 WebSocket 客戶端已連接');

        // --- BEGIN ADDITION: Send current user stream status to new client ---
        try {
            const userStreamStatus = (userWs && userWs.readyState === WebSocket.OPEN) ? 'connected' : 'disconnected';
            wsClient.send(JSON.stringify({
                type: 'status',
                context: 'userStream',
                status: userStreamStatus
            }));
            console.log(`已發送初始 userStream 狀態 '${userStreamStatus}' 給新客戶端。`);
        } catch (sendError) {
            console.error("向新客戶端發送初始 userStream 狀態時出錯:", sendError);
        }
        // --- END ADDITION ---

        wsClient.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('收到來自前端的 WS 訊息:', data);
                if (data.type === 'subscribeMarket' && data.symbol) {
                    connectMarketStream(data.symbol);
                }
            } catch (e) { console.error("解析前端 WS 訊息錯誤:", e); }
        });
        wsClient.on('close', () => console.log('前端 WebSocket 客戶端已斷開'));
        wsClient.on('error', (error) => console.error('前端 WebSocket 客戶端錯誤:', error));

        // 連接成功後發送配置
        if (config) {
            wsClient.send(JSON.stringify({ type: 'config', apiMode: config.apiMode }));
        }
    });

     backendWss.on('error', (error) => {
        // 監聽伺服器本身的錯誤
        console.error(`後端 WebSocket 伺服器錯誤:`, error);
     });
}
// ***** END OF MODIFIED console.log *****


// 廣播訊息給所有連接的前端客戶端
function broadcast(data) {
    if (!backendWss) return;
    const message = JSON.stringify(data);
    backendWss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// --- 連接幣安市場數據 WebSocket ---
function connectMarketStream(symbol) {
    // ... (此函數不變) ...
    if (marketWs && marketWs.readyState === WebSocket.OPEN && currentSymbol === symbol) { console.log(`市場數據流 (${symbol}) 已連接`); return; }
    if (marketWs) { console.log(`正在斷開舊的市場數據流 (${currentSymbol})...`); marketWs.terminate(); marketWs = null; }
    currentMarketSymbol = symbol.toUpperCase(); // Use renamed variable
    const streamUrl = `${wsBaseUrl}/ws/${currentMarketSymbol.toLowerCase()}@aggTrade`;
    console.log(`正在連接幣安市場數據流: ${streamUrl}`);
    marketWs = new WebSocket(streamUrl);
    marketWs.on('open', () => console.log(`幣安市場數據流 (${currentMarketSymbol}) 已連接`));
    marketWs.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            // Add symbol info to the broadcasted message for frontend filtering
            broadcast({ type: 'marketUpdate', symbol: currentMarketSymbol, stream: message.e, data: message });
        } catch (e) { console.error('處理市場數據錯誤:', e); }
    });
    marketWs.on('error', (error) => console.error(`幣安市場數據流 (${currentMarketSymbol}) 錯誤:`, error));
    marketWs.on('close', (code, reason) => { console.log(`幣安市場數據流 (${currentMarketSymbol}) 已關閉: ${code} ${reason}`); marketWs = null; });
}

// --- 連接幣安用戶數據 WebSocket ---
async function connectUserDataStream() {
    // ... (此函數不變) ...
    if (userWs && userWs.readyState === WebSocket.OPEN) { console.log("用戶數據流已連接"); return; }
    if (userWs) { console.log("正在斷開舊的用戶數據流..."); clearInterval(listenKeyInterval); userWs.terminate(); userWs = null; }
    try {
        console.log("正在獲取新的 Listen Key...");
        const keyData = await binanceService.getListenKey();
        if (!keyData || !keyData.listenKey) { console.error("無法獲取 Listen Key"); broadcast({ type: 'error', message: '無法連接用戶數據流 (獲取密鑰失敗)' }); return; }
        listenKey = keyData.listenKey; console.log("Listen Key 已獲取");
        const streamUrl = `${wsBaseUrl}/ws/${listenKey}`; console.log(`正在連接幣安用戶數據流...`); userWs = new WebSocket(streamUrl);
        userWs.on('open', () => { console.log('幣安用戶數據流已連接'); broadcast({ type: 'status', context: 'userStream', status: 'connected' }); clearInterval(listenKeyInterval); listenKeyInterval = setInterval(async () => { if (listenKey) { await binanceService.keepAliveListenKey(listenKey); } else { console.warn("Listen Key 為空，無法發送 Keep Alive"); clearInterval(listenKeyInterval); } }, 30 * 60 * 1000); binanceService.keepAliveListenKey(listenKey); });
        userWs.on('message', (data) => { try { const message = JSON.parse(data.toString()); broadcast({ type: 'userUpdate', event: message.e, data: message }); if (message.e === 'listenKeyExpired') { console.warn("Listen Key 已過期，正在嘗試重新獲取..."); listenKey = null; clearInterval(listenKeyInterval); userWs.terminate(); userWs = null; setTimeout(connectUserDataStream, 1000); } } catch (e) { console.error('處理用戶數據錯誤:', e); } });
        userWs.on('error', (error) => { console.error('幣安用戶數據流錯誤:', error); broadcast({ type: 'error', message: '用戶數據流連接錯誤' }); });
        userWs.on('close', (code, reason) => { console.log(`幣安用戶數據流已關閉: ${code} ${reason}`); clearInterval(listenKeyInterval); userWs = null; });
    } catch (error) { console.error("連接用戶數據流失敗:", error); broadcast({ type: 'error', message: '無法連接用戶數據流' }); }
}

// --- 連接幣安標記價格 WebSocket (所有交易對) ---
function connectMarkPriceStream() {
    if (markPriceWs && markPriceWs.readyState === WebSocket.OPEN) {
        console.log("標記價格流 (!markPrice@arr@1s) 已連接");
        return;
    }
    if (markPriceWs) {
        console.log("正在斷開舊的標記價格流...");
        markPriceWs.terminate();
        markPriceWs = null;
    }

    const streamUrl = `${wsBaseUrl}/ws/!markPrice@arr@1s`; // Stream for all symbols, updates every second
    console.log(`正在連接幣安標記價格流: ${streamUrl}`);
    markPriceWs = new WebSocket(streamUrl);

    markPriceWs.on('open', () => console.log(`幣安標記價格流 (!markPrice@arr@1s) 已連接`));

    markPriceWs.on('message', (data) => {
        try {
            const messages = JSON.parse(data.toString());
            // The stream sends an array of mark price updates
            if (Array.isArray(messages)) {
                // Broadcast each update individually or batch them if needed
                // Broadcasting individually might be simpler for the frontend
                messages.forEach(message => {
                    if (message.e === 'markPriceUpdate') {
                        broadcast({ type: 'markPriceUpdate', data: message });
                    }
                });
            }
        } catch (e) {
            console.error('處理標記價格數據錯誤:', e);
        }
    });

    markPriceWs.on('error', (error) => {
        console.error(`幣安標記價格流 (!markPrice@arr@1s) 錯誤:`, error);
        // Implement reconnection logic if needed
        markPriceWs = null;
        setTimeout(connectMarkPriceStream, 5000); // Attempt to reconnect after 5 seconds
    });

    markPriceWs.on('close', (code, reason) => {
        console.log(`幣安標記價格流 (!markPrice@arr@1s) 已關閉: ${code} ${reason}`);
        markPriceWs = null;
        // Implement reconnection logic if needed
        setTimeout(connectMarkPriceStream, 5000); // Attempt to reconnect after 5 seconds
    });
}

module.exports = {
    initBackendWss,
    broadcast,
    connectMarketStream,
    connectUserDataStream,
    connectMarkPriceStream, // Export the new function
};