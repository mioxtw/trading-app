// frontend/script.js (Main Entry Point)

// --- Global State ---
window.globalState = {
    currentSymbol: 'BTCUSDT',
    currentInterval: '1h',
    intervalMillis: 3600000, // Default to 1h
    backendWs: null,
    klineChart: null,
    // allTrades: [], // Removed: Was for historical trade markers (from file upload)
    // binanceTradeHistory: [], // For historical trades loaded from Binance API // <--- 移除舊的
    positionHistoryData: [], // <--- 新增：用於儲存倉位歷史數據
    positionInfo: null, // Current position data from backend
    usdtBalance: 0,
    currentLeverage: 10, // Default leverage
    currentMarkPrice: null, // Last known mark price
    currentCandle: null, // Last kline candle data
    // --- Precisions (Set defaults, might be updated from backend config later) ---
    quantityPrecision: 3, // Example for BTC
    pricePrecision: 2     // Example for USDT pairs
};

// --- Configuration ---
const BACKEND_API_URL = '/api'; // Relative API path

// --- DOM Elements (Commonly used across modules) ---
const statusBar = document.getElementById('status-bar');
// Other DOM elements are accessed within their respective modules (chart.js, market.js, trade.js)

// --- Shared Utility Functions ---
function updateStatus(message, type = 'info') {
    console.log(`Status (${type}): ${message}`);
    if (statusBar) {
        statusBar.textContent = message;
        // Remove previous status classes
        statusBar.classList.remove('status-info', 'status-success', 'status-error', 'status-warning');
        // Add current status class
        statusBar.classList.add(`status-${type}`);
    }
}

async function fetchFromBackend(endpoint, options = {}) {
    const url = `${BACKEND_API_URL}${endpoint}`;
    console.log(`前端請求: ${options.method || 'GET'} ${url}`);
    try {
        const response = await fetch(url, options);
        // Check if response is ok and content type is JSON before parsing
        if (!response.ok) {
             const errorText = await response.text(); // Get error text for better debugging
             console.error(`後端 API HTTP 錯誤 (${endpoint}): ${response.status} ${errorText}`);
             updateStatus(`後端錯誤: HTTP ${response.status}`, 'error');
             // Try to parse error message if backend returns JSON error object even on non-200 status
             try {
                 const errorJson = JSON.parse(errorText);
                 if (errorJson && errorJson.message) {
                     updateStatus(`後端錯誤: ${errorJson.message}`, 'error');
                 }
             } catch (parseError) {
                 // Ignore if error text is not JSON
             }
             return null; // Indicate failure clearly
        }
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            console.log(`後端回應 ${endpoint}: Status ${response.status}`, data);
            // Check for application-level success indicator from backend
            if (data.success === false) { // Handle cases where HTTP is 200 but operation failed
                 const errorMsg = data.message || `後端操作失敗`;
                 console.error(`後端 API 操作錯誤 (${endpoint}): ${errorMsg}`);
                 updateStatus(`後端錯誤: ${errorMsg}`, 'error');
                 return null; // Indicate failure
            }
            return data.data; // Return the actual data payload
        } else {
             // Handle non-JSON responses if necessary, or treat as error
             const textData = await response.text();
             console.warn(`後端回應非 JSON (${endpoint}): Status ${response.status}`, textData);
             // Depending on API design, this might be an error or expected for some endpoints
             // For now, treat as unexpected
             updateStatus(`後端回應格式錯誤`, 'error');
             return null; // Indicate failure
        }
    } catch (error) {
        console.error(`前端 fetch 錯誤 (${endpoint}):`, error);
        updateStatus(`與後端通訊失敗: ${error.message}`, 'error');
        // Update API status indicator if it exists (might be in market.js now)
        const apiStatusSpan = document.getElementById('api-status');
        if (apiStatusSpan) {
            apiStatusSpan.textContent = "通訊失敗";
            apiStatusSpan.style.color = "red";
        }
        return null; // Indicate failure
    }
}

// Helper to get interval milliseconds (used by chart.js and market.js)
function getIntervalMillis(interval) {
    const unit = interval.slice(-1).toLowerCase();
    const value = parseInt(interval.slice(0, -1));
    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 60 * 60 * 1000; // Default to 1h
    }
}

// --- Function to load initial position history --- // <--- 修改函數名和註釋
async function loadInitialPositionHistory() { // <--- 修改函數名
    console.log("嘗試載入初始倉位歷史紀錄..."); // <--- 修改日誌
    updateStatus("正在載入倉位歷史紀錄...", 'info'); // <--- 修改狀態

    // *** 修改 API 端點 ***
    const historyData = await fetchFromBackend('/position-history?symbol=' + window.globalState.currentSymbol); // 使用新端點，並傳遞 symbol

    // *** 修改儲存變數 ***
    window.globalState.positionHistoryData = historyData || []; // <--- 使用新的全局變數

    if (historyData && Array.isArray(historyData) && historyData.length > 0) {
        console.log(`從後端收到 ${window.globalState.positionHistoryData.length} 筆倉位歷史紀錄`); // <--- 修改日誌和變數
        // *** 修改調用的圖表函數名 ***
        if (typeof window.applyPositionHistoryMarks === 'function') { // <--- 調用新的圖表函數
            // Apply marks initially since checkbox is checked by default
            window.applyPositionHistoryMarks(window.globalState.positionHistoryData); // <--- 傳遞新的數據
            updateStatus("倉位歷史紀錄已載入", 'success'); // <--- 修改狀態
        } else {
            console.error("window.applyPositionHistoryMarks function not found (ensure it's exposed globally in chart.js)");
            updateStatus("無法在圖表上顯示倉位歷史", 'warning'); // <--- 修改狀態
        }
    } else if (historyData) { // Received response, but maybe empty array or non-array
         console.log("後端未返回有效的倉位歷史紀錄"); // <--- 修改日誌
         updateStatus("未找到倉位歷史紀錄", 'info'); // <--- 修改狀態
    } else { // fetchFromBackend returned null (error occurred)
        // Status already updated by fetchFromBackend
        console.error("獲取倉位歷史紀錄失敗"); // <--- 修改日誌
        // No need to update status again, fetchFromBackend handles errors
    }
}


// --- Initialization Function ---
async function initializeApp() {
    console.log("正在初始化應用 (主入口)...");
    updateStatus("正在初始化...", 'info');

    // 1. Initialize Chart (from chart.js)
    if (typeof initChart === 'function') {
        initChart(); // This should initialize window.globalState.klineChart
    } else {
        console.error("initChart function not found. Ensure chart.js is loaded before script.js");
        updateStatus("圖表模組加載失敗", "error");
        return; // Stop initialization if chart module failed
    }

     // 2. Fetch Initial Klines (from chart.js) - after chart is initialized
     if (typeof fetchAndApplyKlineData === 'function' && window.globalState.klineChart) {
         await fetchAndApplyKlineData(window.globalState.currentSymbol, window.globalState.currentInterval);
     } else {
         console.error("fetchAndApplyKlineData function not found or chart not initialized.");
     }


    // 3. Connect WebSocket (from market.js)
    if (typeof connectBackendWebSocket === 'function') {
        connectBackendWebSocket(); // This will trigger initial data fetch via WS 'open' event
    } else {
        console.error("connectBackendWebSocket function not found. Ensure market.js is loaded before script.js");
        updateStatus("市場模組加載失敗", "error");
    }

    // 4. Attach Trade Panel Event Listeners (from trade.js)
    if (typeof attachTradeEventListeners === 'function') {
        attachTradeEventListeners();
    } else {
        console.error("attachTradeEventListeners function not found. Ensure trade.js is loaded before script.js");
    }

    // 5. Initial update for trade panel symbol (from trade.js - might be redundant if WS connect triggers it)
    // This function also triggers the initial market subscription in market.js via WS connect
     if (typeof updateTradePanelSymbol === 'function') {
         updateTradePanelSymbol();
     } else {
         console.error("updateTradePanelSymbol function not found. Ensure trade.js is loaded before script.js");
     }


    console.log("應用初始化完成。");
    updateStatus("就緒", "success"); // Indicate readiness
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("前端 DOM 已載入");
    // Ensure all modules are loaded before initializing
    // The script tags in HTML ensure the order
    initializeApp().then(() => { // Wait for initializeApp to potentially finish async ops
        // Load initial history data (since checkbox is checked by default)
        // Use setTimeout to ensure chart and other modules are fully ready
        setTimeout(loadInitialPositionHistory, 500); // <--- 調用新的加載函數

        // Add change listener for the checkbox
        const showHistoryCheckbox = document.getElementById('showHistoryCheckbox');
        const showHistoryLabel = document.querySelector('label[for="showHistoryCheckbox"]'); // 獲取 label
        // *** 修改 Checkbox Label (確保文字正確) ***
        if (showHistoryLabel) {
            // 使用 textContent 來獲取並修改文字節點
            let labelTextNode = null;
            for (const node of showHistoryLabel.childNodes) {
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                    labelTextNode = node;
                    break;
                }
            }
            if (labelTextNode) {
                labelTextNode.textContent = ' 顯示倉位歷史紀錄'; // 確保文字是倉位歷史
            } else {
                 console.warn("無法精確修改歷史紀錄 checkbox 的 label 文字");
            }
        }


        if (showHistoryCheckbox) {
            showHistoryCheckbox.addEventListener('change', (event) => {
                if (event.target.checked) {
                    // Show markers using stored data
                    // *** 修改調用的圖表函數名 ***
                    if (typeof window.applyPositionHistoryMarks === 'function') { // <--- 調用新的圖表函數
                        console.log("Checkbox checked: Applying position history marks...");
                        window.applyPositionHistoryMarks(window.globalState.positionHistoryData); // <--- 傳遞新的數據
                    } else {
                        console.error("window.applyPositionHistoryMarks function not found.");
                    }
                } else {
                    // Hide markers
                    // *** 修改調用的圖表函數名 ***
                    if (typeof window.removePositionHistoryMarks === 'function') { // <--- 調用新的圖表函數
                         console.log("Checkbox unchecked: Removing position history marks...");
                        window.removePositionHistoryMarks();
                    } else {
                        console.error("window.removePositionHistoryMarks function not found.");
                    }
                }
            });
        } else {
            console.warn("找不到 #showHistoryCheckbox 元素");
        }
    });
});

// --- Cleanup ---
window.addEventListener('beforeunload', () => {
    console.log("前端頁面卸載，關閉 WebSocket...");
    if (window.globalState.backendWs && window.globalState.backendWs.readyState === WebSocket.OPEN) {
        window.globalState.backendWs.close();
    }
    // Dispose chart if necessary
    if (window.globalState.klineChart) {
         try {
             // Ensure klinecharts library is available
             if (typeof klinecharts !== 'undefined') {
                klinecharts.dispose(window.globalState.klineChart); // Pass the chart instance directly
                console.log("圖表已銷毀。");
             } else {
                 console.warn("klinecharts library not available during unload.");
             }
         } catch(e) {
             console.error("銷毀圖表時出錯:", e);
         }
    }
});

console.log("script.js (main) loaded");