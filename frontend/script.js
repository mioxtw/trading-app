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

// --- Function to load and render position history ---
async function loadAndRenderPositionHistory() {
    const symbol = window.globalState.currentSymbol;
    console.log(`嘗試載入 ${symbol} 的倉位歷史紀錄...`);
    updateStatus(`正在載入 ${symbol} 倉位歷史紀錄...`, 'info');

    const historyContainer = document.getElementById('position-history-table-container');
    if (historyContainer) {
        historyContainer.innerHTML = '<p>正在加載歷史紀錄...</p>'; // Show loading message
    }

    const historyData = await fetchFromBackend(`/position-history?symbol=${symbol}`);

    window.globalState.positionHistoryData = historyData || []; // Store data globally

    if (historyData) { // fetchFromBackend succeeded (might be empty array)
        renderPositionHistory(window.globalState.positionHistoryData); // Render the data (or empty state)
        updateStatus(`${symbol} 倉位歷史紀錄已載入`, 'success');
        // Optional: Apply chart markers if needed and function exists
        if (typeof window.applyPositionHistoryMarks === 'function') {
             const showHistoryCheckbox = document.getElementById('showHistoryCheckbox');
             if (showHistoryCheckbox && showHistoryCheckbox.checked) {
                 window.applyPositionHistoryMarks(window.globalState.positionHistoryData);
             }
        }
    } else { // fetchFromBackend returned null (error occurred)
        if (historyContainer) {
            historyContainer.innerHTML = '<p style="color: red;">加載歷史紀錄失敗。</p>';
        }
        // Status already updated by fetchFromBackend
        console.error(`獲取 ${symbol} 倉位歷史紀錄失敗`);
    }
}

// --- Function to render position history table ---
function renderPositionHistory(historyData) {
    const container = document.getElementById('position-history-table-container');
    if (!container) {
        console.error("找不到 #position-history-table-container 元素");
        return;
    }

    container.innerHTML = ''; // Clear previous content

    if (!Array.isArray(historyData) || historyData.length === 0) {
        container.innerHTML = '<p>沒有倉位歷史紀錄。</p>';
        return;
    }

    // Create table structure
    const table = document.createElement('table');
    table.className = 'position-history-table'; // Add class for styling

    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>方向</th>
            <th>數量</th>
            <th>開倉均價</th>
            <th>平倉均價</th>
            <th>開倉時間</th>
            <th>平倉時間</th>
            <th>持倉時長</th>
            <th>實現盈虧</th>
            <th>手續費</th>
            <th>淨盈虧</th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    historyData.forEach(pos => {
        const tr = document.createElement('tr');

        const openTime = new Date(pos.openTime).toLocaleString();
        const closeTime = new Date(pos.closeTime).toLocaleString();

        // Calculate duration
        let durationStr = '-';
        if (pos.durationMs > 0) {
            const seconds = Math.floor(pos.durationMs / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            if (days > 0) durationStr = `${days}天 ${hours % 24}時`;
            else if (hours > 0) durationStr = `${hours}時 ${minutes % 60}分`;
            else if (minutes > 0) durationStr = `${minutes}分 ${seconds % 60}秒`;
            else durationStr = `${seconds}秒`;
        }

        const pnl = parseFloat(pos.pnl); // Net PNL
        const realizedPnl = parseFloat(pos.realizedPnl); // PNL before commission
        const commission = parseFloat(pos.commission);
        const pnlClass = pnl >= 0 ? 'positive' : 'negative';
        const sideClass = pos.openSide === 'BUY' ? 'buy' : 'sell';

        tr.innerHTML = `
            <td class="side-${sideClass}">${pos.openSide === 'BUY' ? '做多' : '做空'}</td>
            <td>${formatNumber(pos.quantity, window.globalState.quantityPrecision)}</td>
            <td>${formatCurrency(pos.avgOpenPrice, window.globalState.pricePrecision)}</td>
            <td>${formatCurrency(pos.avgClosePrice, window.globalState.pricePrecision)}</td>
            <td class="time">${openTime}</td>
            <td class="time">${closeTime}</td>
            <td class="duration">${durationStr}</td>
            <td>${formatCurrency(realizedPnl)}</td>
            <td>${formatCurrency(commission)} (${pos.commissionAsset})</td>
            <td class="pnl-${pnlClass}">${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}</td>
        `;
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
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
         // updateTradePanelSymbol(); // Moved to market.js WebSocket onopen handler
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
    initializeApp().then(() => {
        const showHistoryCheckbox = document.getElementById('showHistoryCheckbox');
        const historyContainer = document.getElementById('position-history-container');

        // Initial load if checkbox is checked
        if (showHistoryCheckbox && showHistoryCheckbox.checked) {
            if (historyContainer) historyContainer.style.display = 'block';
            // Use setTimeout to ensure chart and other modules are fully ready
            setTimeout(loadAndRenderPositionHistory, 500);
        } else if (historyContainer) {
            historyContainer.style.display = 'none'; // Hide if unchecked initially
        }

        // Add change listener for the checkbox
        if (showHistoryCheckbox && historyContainer) {
            showHistoryCheckbox.addEventListener('change', (event) => {
                const isChecked = event.target.checked;
                historyContainer.style.display = isChecked ? 'block' : 'none';

                if (isChecked) {
                    console.log("Checkbox checked: Showing position history container.");
                    // Load data only if it hasn't been loaded yet or needs refresh
                    // Simple check: load if the container was previously empty or showing error/loading
                    const needsLoad = !window.globalState.positionHistoryData || window.globalState.positionHistoryData.length === 0 || historyContainer.querySelector('p');
                    if (needsLoad) {
                         console.log("Loading position history data...");
                         loadAndRenderPositionHistory(); // Load and render
                    } else {
                         console.log("Position history data already loaded.");
                         // Optional: Re-apply chart markers if needed
                         if (typeof window.applyPositionHistoryMarks === 'function') {
                             window.applyPositionHistoryMarks(window.globalState.positionHistoryData);
                         }
                    }
                } else {
                    console.log("Checkbox unchecked: Hiding position history container.");
                    // Optional: Remove chart markers if needed
                    if (typeof window.removePositionHistoryMarks === 'function') {
                        window.removePositionHistoryMarks();
                    }
                }
            });
        } else {
            if (!showHistoryCheckbox) console.warn("找不到 #showHistoryCheckbox 元素");
            if (!historyContainer) console.warn("找不到 #position-history-container 元素");
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