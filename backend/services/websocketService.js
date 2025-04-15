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

// --- BEGIN ADDITION: Reconnection state variables ---
let marketReconnectAttempt = 0;
let marketReconnectTimer = null;
let marketStreamDisconnectTime = null; // 記錄市場流斷線時間
const MAX_RECONNECT_ATTEMPTS = 10; // 最大重試次數
const INITIAL_RECONNECT_DELAY = 5000; // 初始重連延遲 (5秒)
const MAX_RECONNECT_DELAY = 60000; // 最大重連延遲 (1分鐘)

let userReconnectAttempt = 0;
let userReconnectTimer = null;
// --- END ADDITION ---

// --- REMOVED: Old TP Half state (now handled by API route) ---
// const activeTpHalfTriggers = {};
// --- END REMOVED ---


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
                // --- REMOVED: Old TP Half WebSocket message handling ---
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

// --- BEGIN ADDITION: Reconnection handler ---
function scheduleReconnect(streamType, connectFunction, symbol = null) {
    let reconnectAttempt, reconnectTimer, maxDelay;

    if (streamType === 'market') {
        marketReconnectAttempt++;
        reconnectAttempt = marketReconnectAttempt;
        clearTimeout(marketReconnectTimer); // 清除之前的計時器
        maxDelay = MAX_RECONNECT_DELAY;
        console.log(`市場數據流 (${symbol || currentMarketSymbol}) 連接失敗/關閉，準備第 ${reconnectAttempt} 次重連...`);
    } else if (streamType === 'user') {
        userReconnectAttempt++;
        reconnectAttempt = userReconnectAttempt;
        clearTimeout(userReconnectTimer); // 清除之前的計時器
        maxDelay = MAX_RECONNECT_DELAY;
        console.log(`用戶數據流連接失敗/關閉，準備第 ${reconnectAttempt} 次重連...`);
    } else if (streamType === 'markPrice') {
        // 標記價格流已有自己的重連邏輯，但可以統一管理
        // 這裡暫不修改標記價格流的重連
        console.log("標記價格流觸發重連 (使用內建邏輯)");
        return; // 不使用通用重連器
    } else {
        console.error("未知的數據流類型:", streamType);
        return;
    }

    if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
        console.error(`${streamType === 'market' ? `市場數據流 (${symbol || currentMarketSymbol})` : '用戶數據流'} 重連次數過多 (${reconnectAttempt})，放棄重連。`);
        if (streamType === 'market') marketReconnectAttempt = 0; // 重置計數器
        if (streamType === 'user') userReconnectAttempt = 0; // 重置計數器
        broadcast({ type: 'error', message: `${streamType === 'market' ? '市場數據流' : '用戶數據流'} 無法重新連接，請檢查網絡或服務狀態。` });
        return;
    }

    // 指數退避延遲
    const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempt - 1), maxDelay);
    console.log(`將在 ${delay / 1000} 秒後嘗試重連 ${streamType} 流...`);

    const timer = setTimeout(() => {
        console.log(`正在嘗試重連 ${streamType} 流 (第 ${reconnectAttempt} 次)...`);
        if (streamType === 'market') {
            connectFunction(symbol || currentMarketSymbol); // 市場流需要 symbol
        } else {
            connectFunction(); // 用戶流不需要 symbol
        }
    }, delay);

    if (streamType === 'market') {
        marketReconnectTimer = timer;
    } else if (streamType === 'user') {
        userReconnectTimer = timer;
    }
}
// --- END ADDITION ---


// --- 連接幣安市場數據 WebSocket (加入重連和 K 線補齊) ---
function connectMarketStream(symbol) {
    // ... (此函數不變) ...
    const targetSymbol = symbol.toUpperCase();
    if (marketWs && marketWs.readyState === WebSocket.OPEN && currentMarketSymbol === targetSymbol) {
        console.log(`市場數據流 (${targetSymbol}) 已連接`);
        return;
    }
    if (marketWs) {
        console.log(`正在斷開舊的市場數據流 (${currentMarketSymbol})...`);
        // 清理舊的監聽器，防止內存洩漏和重複觸發
        marketWs.removeAllListeners();
        marketWs.terminate();
        marketWs = null;
    }

    currentMarketSymbol = targetSymbol; // 更新當前 symbol
    const streamUrl = `${wsBaseUrl}/ws/${currentMarketSymbol.toLowerCase()}@aggTrade`; // 保持 aggTrade 流
    console.log(`正在連接幣安市場數據流: ${streamUrl}`);
    marketWs = new WebSocket(streamUrl);

    marketWs.on('open', async () => {
        console.log(`幣安市場數據流 (${currentMarketSymbol}) 已連接`);
        marketReconnectAttempt = 0; // 連接成功，重置重試計數器
        clearTimeout(marketReconnectTimer); // 清除重連計時器

        // --- BEGIN ADDITION: K 線補齊邏輯 ---
        if (marketStreamDisconnectTime) {
            const reconnectTime = Date.now();
            console.log(`市場數據流重新連接，正在嘗試補齊從 ${new Date(marketStreamDisconnectTime).toISOString()} 到 ${new Date(reconnectTime).toISOString()} 的 1 分鐘 K 線...`);
            try {
                // 使用修改後的 getKlineData，傳入 startTime 和 endTime
                const missingKlines = await binanceService.getKlineData(currentMarketSymbol, '1m', marketStreamDisconnectTime, reconnectTime);
                if (missingKlines && missingKlines.length > 0) {
                    console.log(`成功獲取 ${missingKlines.length} 根遺失的 K 線數據，正在廣播...`);
                    // 格式化 K 線數據以便前端使用 (假設前端需要特定格式)
                    const formattedKlines = missingKlines.map(k => ({
                        time: k[0], // Open time
                        open: parseFloat(k[1]),
                        high: parseFloat(k[2]),
                        low: parseFloat(k[3]),
                        close: parseFloat(k[4]),
                        volume: parseFloat(k[5]),
                        closeTime: k[6], // Close time
                        // 添加 symbol 和 interval 信息
                        symbol: currentMarketSymbol,
                        interval: '1m'
                    }));
                    broadcast({ type: 'historicalKlines', symbol: currentMarketSymbol, interval: '1m', data: formattedKlines });
                } else {
                    console.log("斷線期間沒有新的 K 線數據。");
                }
            } catch (error) {
                console.error(`補齊 K 線數據時出錯 (${currentMarketSymbol}, 1m):`, error);
                broadcast({ type: 'error', message: `補齊 ${currentMarketSymbol} K 線數據失敗: ${error.message || '未知錯誤'}` });
            } finally {
                marketStreamDisconnectTime = null; // 清除斷線時間標記
            }
        }
        // --- END ADDITION ---
    });
    marketWs.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            // Add symbol info to the broadcasted message for frontend filtering
            broadcast({ type: 'marketUpdate', symbol: currentMarketSymbol, stream: message.e, data: message });
        } catch (e) { console.error('處理市場數據錯誤:', e); }
    });
    marketWs.on('error', (error) => {
        console.error(`幣安市場數據流 (${currentMarketSymbol}) 錯誤:`, error.message);
        if (marketWs && marketWs.readyState !== WebSocket.OPEN && marketWs.readyState !== WebSocket.CONNECTING) {
            marketStreamDisconnectTime = Date.now(); // 記錄斷線時間
            marketWs = null; // 確保 ws 實例被清理
            scheduleReconnect('market', connectMarketStream, currentMarketSymbol);
        }
    });
    marketWs.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'No reason provided';
        console.log(`幣安市場數據流 (${currentMarketSymbol}) 已關閉: Code ${code}, Reason: ${reasonStr}`);
        // 只有在非正常關閉或未處於重連過程中時才觸發重連
        if (marketWs && code !== 1000) { // 1000 是正常關閉代碼
             marketStreamDisconnectTime = Date.now(); // 記錄斷線時間
             marketWs = null; // 確保 ws 實例被清理
             scheduleReconnect('market', connectMarketStream, currentMarketSymbol);
        } else {
            marketWs = null; // 確保 ws 實例被清理
        }
    });
}

// --- 連接幣安用戶數據 WebSocket ---
async function connectUserDataStream() {
    // 加入重連邏輯
    if (userWs && userWs.readyState === WebSocket.OPEN) {
        console.log("用戶數據流已連接");
        return;
    }
    if (userWs) {
        console.log("正在斷開舊的用戶數據流...");
        clearInterval(listenKeyInterval);
        listenKeyInterval = null; // 清除 interval ID
        listenKey = null; // 清除舊 key
        // 清理舊的監聽器
        userWs.removeAllListeners();
        userWs.terminate();
        userWs = null;
    }
    try {
        console.log("正在獲取新的 Listen Key...");
        const keyData = await binanceService.getListenKey();
        if (!keyData || !keyData.listenKey) {
            console.error("無法獲取 Listen Key");
            broadcast({ type: 'error', message: '無法連接用戶數據流 (獲取密鑰失敗)' });
            // 獲取 key 失敗也應該觸發重連
            scheduleReconnect('user', connectUserDataStream);
            return;
        }
        listenKey = keyData.listenKey; console.log("Listen Key 已獲取");
        const streamUrl = `${wsBaseUrl}/ws/${listenKey}`; console.log(`正在連接幣安用戶數據流...`); userWs = new WebSocket(streamUrl);
        userWs.on('open', () => {
            console.log('幣安用戶數據流已連接');
            userReconnectAttempt = 0; // 連接成功，重置重試計數器
            clearTimeout(userReconnectTimer); // 清除重連計時器
            broadcast({ type: 'status', context: 'userStream', status: 'connected' });
            // 清除可能存在的舊 interval
            clearInterval(listenKeyInterval);
            listenKeyInterval = setInterval(async () => {
                if (listenKey) {
                    try {
                        console.log("正在發送用戶數據流 Keep Alive...");
                        await binanceService.keepAliveListenKey(listenKey);
                        console.log("用戶數據流 Keep Alive 發送成功。");
                    } catch (keepAliveError) {
                        console.error("用戶數據流 Keep Alive 失敗:", keepAliveError.message || keepAliveError);
                        // Keep Alive 失敗可能意味著 key 失效或網絡問題，可以考慮觸發重連
                        // 但更常見的是 listenKey 過期事件，所以這裡只打印錯誤
                    }
                } else {
                    console.warn("Listen Key 為空，無法發送 Keep Alive，清除 Interval。");
                    clearInterval(listenKeyInterval);
                    listenKeyInterval = null;
                    // Key 為空通常意味著連接已斷開或即將斷開，可能需要重連
                    if (userWs && userWs.readyState !== WebSocket.OPEN) {
                         scheduleReconnect('user', connectUserDataStream);
                    }
                }
            }, 30 * 60 * 1000); // 30 分鐘
            // 連接成功後立即發送一次 Keep Alive
            if (listenKey) {
                binanceService.keepAliveListenKey(listenKey).catch(err => console.error("首次 Keep Alive 失敗:", err.message));
            }
        });
        userWs.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                broadcast({ type: 'userUpdate', event: message.e, data: message });
                // 處理 listenKey 過期事件
                if (message.e === 'listenKeyExpired') {
                    console.warn("Listen Key 已過期，將立即嘗試重新連接用戶數據流...");
                    clearInterval(listenKeyInterval);
                    listenKeyInterval = null;
                    listenKey = null;
                    if (userWs) {
                        userWs.removeAllListeners(); // 清理監聽器
                        userWs.terminate(); // 關閉舊連接
                    }
                    userWs = null;
                    // 立即嘗試重連，不使用 scheduleReconnect 的延遲
                    connectUserDataStream();
                }
            } catch (e) {
                console.error('處理用戶數據錯誤:', e);
            }
        });
        userWs.on('error', (error) => {
            console.error('幣安用戶數據流錯誤:', error.message);
            broadcast({ type: 'error', message: `用戶數據流連接錯誤: ${error.message}` });
            if (userWs && userWs.readyState !== WebSocket.OPEN && userWs.readyState !== WebSocket.CONNECTING) {
                clearInterval(listenKeyInterval);
                listenKeyInterval = null;
                listenKey = null;
                userWs = null; // 確保 ws 實例被清理
                scheduleReconnect('user', connectUserDataStream);
            }
        });
        userWs.on('close', (code, reason) => {
            const reasonStr = reason ? reason.toString() : 'No reason provided';
            console.log(`幣安用戶數據流已關閉: Code ${code}, Reason: ${reasonStr}`);
            clearInterval(listenKeyInterval);
            listenKeyInterval = null;
            listenKey = null;
            // 只有在非正常關閉或未處於重連過程中時才觸發重連
            if (userWs && code !== 1000) { // 1000 是正常關閉代碼
                 userWs = null; // 確保 ws 實例被清理
                 scheduleReconnect('user', connectUserDataStream);
            } else {
                userWs = null; // 確保 ws 實例被清理
            }
            // 無論如何，關閉時都廣播狀態
            broadcast({ type: 'status', context: 'userStream', status: 'disconnected' });
        });
    } catch (error) {
        console.error("連接用戶數據流初始嘗試失敗:", error.message || error);
        broadcast({ type: 'error', message: `無法連接用戶數據流: ${error.message || '未知錯誤'}` });
        // 初始連接失敗也應該觸發重連
        scheduleReconnect('user', connectUserDataStream);
    }
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
            // --- REMOVED: Old TP Half trigger check from mark price stream ---
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

// --- REMOVED: Old TP Half trigger function and related code ---


module.exports = {
    initBackendWss,
    broadcast,
    connectMarketStream,
    connectUserDataStream,
    connectMarkPriceStream, // Export the new function
};