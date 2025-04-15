// frontend/market.js

// --- DOM Elements (Market/Status related) ---
const apiStatusSpan = document.getElementById('api-status');
const userStreamStatusSpan = document.getElementById('user-stream-status');
const backendModeSpan = document.getElementById('backend-mode'); // If needed for status display

// --- WebSocket State ---
// Assuming window.globalState is defined in the main script.js
// window.globalState.backendWs = null; // Managed here

// --- WebSocket Handling (Connecting to Backend WS) ---
function connectBackendWebSocket() {
    // Ensure globalState exists
    if (typeof window.globalState === 'undefined') {
        console.error("Global state is not initialized before connecting WebSocket.");
        return;
    }
     // Ensure updateStatus is available
    if (typeof updateStatus !== 'function') {
        console.error("updateStatus function is not available globally.");
        return; // Or provide a default console log
    }


    if (window.globalState.backendWs && (window.globalState.backendWs.readyState === WebSocket.OPEN || window.globalState.backendWs.readyState === WebSocket.CONNECTING)) {
        console.log("已連接到後端 WebSocket 或正在連接。");
        return;
    }

    // Derive WS URL from window location (assuming same host/port as HTTP)
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const backendWsUrl = `${wsProtocol}//${window.location.host}`;
    console.log(`後端 WebSocket URL 設定為: ${backendWsUrl}`);

    if (!backendWsUrl) {
        console.error("無法確定後端 WebSocket URL，無法連接。");
        updateStatus("WebSocket URL 確定失敗", "error");
        return;
    }

    updateStatus("正在連接後端 WebSocket...", 'info');
    console.log(`正在連接: ${backendWsUrl}`);
    try {
        window.globalState.backendWs = new WebSocket(backendWsUrl);
    } catch (error) {
        console.error("創建後端 WebSocket 連接失敗:", error);
        updateStatus("無法創建 WebSocket 連接", "error");
        if (apiStatusSpan) { apiStatusSpan.textContent = "連接失敗"; apiStatusSpan.style.color = "red"; }
        return;
    }

    window.globalState.backendWs.onopen = () => {
        console.log("已成功連接到後端 WebSocket。");
        updateStatus("後端 WebSocket 已連接", 'success');
        if (apiStatusSpan) { apiStatusSpan.textContent = "已連接"; apiStatusSpan.style.color = "green"; }

        // Trigger initial data fetch and symbol update from trade.js and main script
        if (typeof fetchInitialData === 'function') fetchInitialData();
        // updateTradePanelSymbol should trigger the market subscription via subscribeToMarket
        if (typeof updateTradePanelSymbol === 'function') updateTradePanelSymbol();

        // Subscribe to the current symbol's market data (redundant if updateTradePanelSymbol calls it)
        // subscribeToMarket(window.globalState.currentSymbol);
    };

    window.globalState.backendWs.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleBackendWsMessage(message);
        } catch (error) {
            console.error("解析後端 WS 訊息錯誤:", error, event.data);
        }
    };

    window.globalState.backendWs.onerror = (error) => {
        console.error("後端 WebSocket 錯誤:", error);
        updateStatus("後端 WebSocket 連接錯誤", 'error');
        if (apiStatusSpan) { apiStatusSpan.textContent = "連接錯誤"; apiStatusSpan.style.color = "red"; }
        if (userStreamStatusSpan) { userStreamStatusSpan.textContent = "錯誤"; userStreamStatusSpan.style.color = "red"; }
    };

    window.globalState.backendWs.onclose = (event) => {
        console.log("與後端 WebSocket 的連接已關閉:", event.code, event.reason);
        // Check if the closed WS is the one we stored
        if (window.globalState.backendWs === event.target) {
             window.globalState.backendWs = null;
        }
        updateStatus("後端 WebSocket 已斷開", 'warning');
        if (apiStatusSpan) { apiStatusSpan.textContent = "已斷開"; apiStatusSpan.style.color = "orange"; }
        if (userStreamStatusSpan) { userStreamStatusSpan.textContent = "已斷開"; userStreamStatusSpan.style.color = "orange"; }
        // Attempt to reconnect after a delay
        setTimeout(connectBackendWebSocket, 5000);
    };
}

// Function to send subscription message
function subscribeToMarket(symbol) {
     if (window.globalState.backendWs && window.globalState.backendWs.readyState === WebSocket.OPEN) {
        try {
            window.globalState.backendWs.send(JSON.stringify({ type: 'subscribeMarket', symbol: symbol }));
            console.log(`前端請求訂閱市場數據: ${symbol}`);
        } catch (e) {
            console.error("透過 WS 發送訂閱請求失敗:", e);
        }
    } else {
        console.warn("後端 WebSocket 未連接，無法發送訂閱請求。");
    }
}

// --- BEGIN ADDITION: Generic function to send WS messages ---
window.sendMessageToBackend = function(messageObject) {
    if (window.globalState && window.globalState.backendWs && window.globalState.backendWs.readyState === WebSocket.OPEN) {
        try {
            const messageString = JSON.stringify(messageObject);
            console.log(`[WS Send] Sending message:`, messageObject);
            window.globalState.backendWs.send(messageString);
            return true; // Indicate success
        } catch (e) {
            console.error("透過 WS 發送訊息失敗:", e, messageObject);
            updateStatus("無法發送請求到後端 (序列化錯誤)", "error");
            return false; // Indicate failure
        }
    } else {
        console.warn("後端 WebSocket 未連接，無法發送訊息:", messageObject);
        updateStatus("後端 WebSocket 未連接", "warning");
        return false; // Indicate failure
    }
}
// --- END ADDITION ---


function handleBackendWsMessage(message) {
    if (!message || !message.type) return;
    // 只記錄非 markPriceUpdate 和 marketUpdate 的訊息，以減少控制台噪音
    if (message.type !== 'markPriceUpdate' && message.type !== 'marketUpdate') {
        console.log("收到後端 WS 訊息:", message);
    }

    switch (message.type) {
        case 'marketUpdate':
            // Check if the update is for the currently viewed symbol
            if (message.stream === 'aggTrade' && message.data?.s === window.globalState.currentSymbol) {
                handleTickData(message.data); // Pass to tick handler
            }
            // Add handling for other market streams if needed (e.g., depth, kline)
            break;
        case 'userUpdate':
            console.log("用戶數據更新:", message.event, message.data);
            if (userStreamStatusSpan) {
                userStreamStatusSpan.textContent = "已連接";
                userStreamStatusSpan.style.color = "green";
            }
            // Trigger data refresh in trade.js
            console.log("偵測到用戶數據事件，從後端重新獲取數據...");
            if (typeof fetchInitialData === 'function') {
                fetchInitialData(); // This implicitly refreshes orders too
            } else {
                 console.error("fetchInitialData function not found for user update.");
            }
            break;
        case 'conditionalOrderUpdate': // Handle TP/SL updates
            console.log(`收到條件訂單更新 (${message.action} ${message.orderType} for ${message.symbol})，刷新訂單列表...`);
            updateStatus(`後端回報 ${message.symbol} ${message.orderType.toUpperCase()} ${message.action === 'create' ? '設定' : '取消'} 操作已發送。正在刷新...`, 'info');
            // Only refresh orders list
            if (typeof fetchAndRenderOpenOrders === 'function') {
                fetchAndRenderOpenOrders();
            } else {
                console.warn("fetchAndRenderOpenOrders function not found for conditional order update refresh.");
            }
            break;
        case 'error':
            console.error("收到來自後端的錯誤訊息:", message.message);
            updateStatus(`後端錯誤: ${message.message}`, 'error');
            if (message.message.includes("用戶數據")) {
                if (userStreamStatusSpan) {
                    userStreamStatusSpan.textContent = "錯誤";
                    userStreamStatusSpan.style.color = "red";
                }
            }
            break;
        case 'status': // General status updates from backend
            console.log("後端狀態:", message.context, message.status, message.message);
            if (message.context === 'userStream' && userStreamStatusSpan) {
                userStreamStatusSpan.textContent = message.status === 'connected' ? '已連接' : (message.status === 'disconnected' ? '已斷開' : '未知');
                userStreamStatusSpan.style.color = message.status === 'connected' ? 'green' : (message.status === 'error' ? 'red' : 'orange');
            }
            // Handle other status contexts if needed
            break;
        case 'config': // Backend config info (like API mode)
            if (backendModeSpan && message.apiMode) {
                backendModeSpan.textContent = message.apiMode.toUpperCase();
            }
            break;
       case 'markPriceUpdate':
           // Handle mark price updates from the backend
           if (message.data && message.data.s === window.globalState.currentSymbol) {
               const markPrice = parseFloat(message.data.p);
                if (!isNaN(markPrice)) {
                    // Update global state immediately
                    window.globalState.currentMarkPrice = markPrice;
                    // Call the function in trade.js to update UI (PNL and Mark Price display)
                    if (typeof updateRealtimePnl === 'function') {
                        updateRealtimePnl(markPrice);
                    } else {
                        console.warn("updateRealtimePnl function not found for mark price update.");
                    }
                    // Also trigger general calculations update in trade.js
                    if (typeof updateCalculations === 'function') {
                        updateCalculations();
                    }
                } else {
                    console.warn("收到無效的標記價格數據:", message.data);
                }
            }
           break;
       // --- BEGIN ADDITION: Handle Take Profit Half messages ---
       case 'tpHalfSet':
           console.log(`[TP Half] 後端確認設定: ${message.symbol} at ${message.price}`);
           updateStatus(`${message.symbol} 止盈平半觸發器已設定於 ${message.price}`, 'success');
           // Refresh open orders list
           if (typeof fetchAndRenderOpenOrders === 'function') {
               fetchAndRenderOpenOrders();
           } else {
               console.warn("fetchAndRenderOpenOrders function not found for tpHalfSet refresh.");
           }
            break;
      case 'tpHalfCancelled':
          console.log(`[TP Half] 後端確認取消: ${message.symbol}`);
          updateStatus(`${message.symbol} 止盈平半觸發器已取消`, 'success');
          // Refresh open orders list
          if (typeof fetchAndRenderOpenOrders === 'function') {
              fetchAndRenderOpenOrders();
          } else {
              console.warn("fetchAndRenderOpenOrders function not found for tpHalfCancelled refresh.");
          }
            break;
        case 'tpHalfExecuted':
            console.log(`[TP Half] 後端回報執行: ${message.symbol} at ${message.executedPrice}, closed ${message.closedQuantity}`);
            updateStatus(`${message.symbol} 止盈平半已觸發 @ ${message.executedPrice}，平倉 ${message.closedQuantity}`, 'success');
            // Refresh account data (which includes orders)
            if (typeof fetchInitialData === 'function') {
                console.log("[TP Half] 觸發執行後，重新獲取賬戶數據...");
                fetchInitialData();
            } else {
                console.error("fetchInitialData function not found after TP Half execution.");
            }
            break;
      // --- END ADDITION ---
      // *** ADDED: Handle orderCancelled message from backend ***
      case 'orderCancelled':
          console.log(`[WS] 後端確認訂單取消: ${message.symbol} ID: ${message.orderId}`);
          updateStatus(`訂單 ${message.orderId} 已取消`, 'success');
          // Refresh account data (which includes orders)
          if (typeof fetchInitialData === 'function') {
              fetchInitialData();
          } else {
              console.error("fetchInitialData function not found for orderCancelled refresh.");
          }
          break;
        // *** END ADDED ***
        default:
            console.log("收到未知的後端 WS 訊息類型:", message.type);
    }
}

// --- Tick Data Handling ---
function handleTickData(tick) {
    // Ensure chart object exists in global state
    if (!window.globalState || !window.globalState.klineChart) {
         // console.warn("KlineChart not ready for tick data yet.");
         return;
    }

    const tickTime = parseInt(tick.T);
    const tickPrice = parseFloat(tick.p);
    const tickVolume = parseFloat(tick.q);

    if (isNaN(tickTime) || isNaN(tickPrice) || isNaN(tickVolume)) {
        console.warn("收到無效的 Tick 數據:", tick);
        return;
    }

    // Removed: Do not update global mark price or PNL from tick data (aggTrade).
    // This should be handled by the markPriceUpdate message.

    // Update the current candle on the chart
    const currentCandle = window.globalState.currentCandle;
    const intervalMillis = window.globalState.intervalMillis; // Get interval from global state

    // Ensure getKlineTimestamp is available (might be in chart.js)
    if (typeof getKlineTimestamp !== 'function') {
        console.error("getKlineTimestamp function not available.");
        return;
    }


    if (currentCandle && intervalMillis) {
        const klineTimestamp = getKlineTimestamp(tickTime, intervalMillis);

        if (klineTimestamp > currentCandle.timestamp) {
            // Finalize the previous candle
            window.globalState.klineChart.updateData({ ...currentCandle });
            // Start a new candle
            window.globalState.currentCandle = {
                timestamp: klineTimestamp,
                open: tickPrice,
                high: tickPrice,
                low: tickPrice,
                close: tickPrice,
                volume: tickVolume
            };
            // Apply the new (incomplete) candle to the chart
            window.globalState.klineChart.updateData({ ...window.globalState.currentCandle });
        } else if (klineTimestamp === currentCandle.timestamp) {
            // Update the current candle
            currentCandle.high = Math.max(currentCandle.high, tickPrice);
            currentCandle.low = Math.min(currentCandle.low, tickPrice);
            currentCandle.close = tickPrice;
            currentCandle.volume += tickVolume;
            // Update the chart with the latest candle data
            window.globalState.klineChart.updateData({ ...currentCandle });
        }
        // else: Tick belongs to an older candle, ignore for live update
    } else {
        // console.warn("收到 Tick 但 currentCandle 或 intervalMillis 未就緒");
        // It's normal to receive ticks before the first kline is fully loaded
    }

    // Trigger calculation update in trade.js
    if (typeof updateCalculations === 'function') {
        updateCalculations();
    } else {
        // console.warn("updateCalculations function not found for tick update.");
    }
}

// --- Cleanup ---
// Moved to main script.js to ensure it runs on page unload

console.log("market.js loaded");