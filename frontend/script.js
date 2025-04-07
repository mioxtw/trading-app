// frontend/script.js

// --- 配置 ---
const BACKEND_API_URL = '/api'; // 相對路徑
let BACKEND_WS_URL = ''; // 將在 initializeApp 中設定

// --- DOM Elements ---
// ... (保持不變) ...
const chartContainer = document.getElementById('chart-container');
const fileInput = document.getElementById('fileInputControl');
const intervalButtons = document.querySelectorAll('.interval-btn');
const tooltipElement = document.getElementById('trade-tooltip');
const statusBar = document.getElementById('status-bar');
const backendModeSpan = document.getElementById('backend-mode');
const apiStatusSpan = document.getElementById('api-status');
const userStreamStatusSpan = document.getElementById('user-stream-status');
const tradeSymbolSpan = document.getElementById('trade-symbol');
const leverageInput = document.getElementById('leverage-input');
const setLeverageBtn = document.getElementById('set-leverage-btn');
const availableBalanceSpan = document.getElementById('available-balance');
const quantityInput = document.getElementById('quantity-input');
const reduceOnlyCheckbox = document.getElementById('reduce-only-checkbox');
const maxOrderSizeSpan = document.getElementById('max-order-size');
const marginRequiredSpan = document.getElementById('margin-required');
const buyLongBtn = document.getElementById('buy-long-btn');
const sellShortBtn = document.getElementById('sell-short-btn');
const positionCountSpan = document.getElementById('position-count');
const positionDetailsDiv = document.getElementById('position-details');
const quantityUnitSpan = quantityInput.nextElementSibling;
const closeAllBtn = document.getElementById('close-all-btn'); // 新增：全平倉按鈕
const closeHalfBtn = document.getElementById('close-half-btn'); // 新增：平一半按鈕
const positionActionsContainer = document.getElementById('position-actions-container'); // 新增：按鈕容器

// --- State Variables ---
// ... (保持不變) ...
let klineChart = null;
let currentSymbol = 'BTCUSDT';
let currentInterval = '1h';
let allTrades = [];
const TRADE_MARKER_GROUP_ID = 'tradeMarkers';
let backendWs = null;
let currentCandle = null;
let intervalMillis = getIntervalMillis(currentInterval);
let usdtBalance = 0;
let positionInfo = null; // Stores position risk data from backend
let currentMarkPrice = null;
let quantityPrecision = 3;
let pricePrecision = 2;
let currentLeverage = 10;


// --- Status Update Helper ---
// ... (保持不變) ...
function updateStatus(message, type = 'info') { console.log(`Status (${type}): ${message}`); if (statusBar) { statusBar.textContent = message; statusBar.classList.remove('status-info', 'status-success', 'status-error', 'status-warning'); statusBar.classList.add(`status-${type}`); } }

// --- Helper Functions ---
// ***** MODIFIED formatCurrency *****
function getIntervalMillis(interval) { const unit = interval.slice(-1).toLowerCase(); const value = parseInt(interval.slice(0, -1)); switch (unit) { case 'm': return value * 60 * 1000; case 'h': return value * 60 * 60 * 1000; case 'd': return value * 24 * 60 * 60 * 1000; default: return 60 * 60 * 1000; } }
function getKlineTimestamp(tradeTimestamp, intervalMs) { return tradeTimestamp - (tradeTimestamp % intervalMs); }
function formatCurrency(value, decimals = 2) {
    const num = parseFloat(value);
    // If value is invalid (NaN) or 0 (often means unset), display "未設定"
    // If 0 needs to be distinct from unset, check only for isNaN(num)
    return (isNaN(num) || num === 0) ? '未設定' : num.toFixed(decimals);
}
function formatNumber(value, decimals = 3) { const num = parseFloat(value); return isNaN(num) ? '-.---' : num.toFixed(decimals); }
// ***** END OF MODIFIED formatCurrency *****

// --- Update Trading Panel Symbol ---
// ... (保持不變) ...
function updateTradePanelSymbol() { tradeSymbolSpan.textContent = currentSymbol; if (quantityUnitSpan) { const baseAsset = currentSymbol.replace(/USDT$/, ''); quantityUnitSpan.textContent = baseAsset; } quantityInput.value = ''; updateCalculations(); fetchInitialData(); if (backendWs && backendWs.readyState === WebSocket.OPEN) { try { backendWs.send(JSON.stringify({ type: 'subscribeMarket', symbol: currentSymbol })); console.log(`前端請求訂閱市場數據: ${currentSymbol}`); } catch (e) { console.error("透過 WS 發送訂閱請求失敗:", e); } } else { console.warn("後端 WebSocket 未連接，無法發送訂閱請求。"); } }

// --- Backend API Interaction ---
// ... (保持不變) ...
async function fetchFromBackend(endpoint, options = {}) { const url = `${BACKEND_API_URL}${endpoint}`; console.log(`前端請求: ${options.method || 'GET'} ${url}`); try { const response = await fetch(url, options); const data = await response.json(); console.log(`後端回應 ${endpoint}: Status ${response.status}`, data); if (!response.ok || !data.success) { const errorMsg = data.message || `HTTP ${response.status}`; console.error(`後端 API 錯誤 (${endpoint}): ${errorMsg}`); updateStatus(`後端錯誤: ${errorMsg}`, 'error'); return null; } return data.data; } catch (error) { console.error(`前端 fetch 錯誤 (${endpoint}):`, error); updateStatus(`與後端通訊失敗: ${error.message}`, 'error'); if (apiStatusSpan) { apiStatusSpan.textContent = "通訊失敗"; apiStatusSpan.style.color = "red"; } return null; } }

// --- Fetch Initial Data from Backend ---
// ... (保持不變) ...
async function fetchInitialData() { updateStatus("正在從後端獲取初始數據...", 'info'); const [balanceData, positionData] = await Promise.all([ fetchFromBackend('/balance'), fetchFromBackend(`/position?symbol=${currentSymbol}`) ]); updateAccountPanel(balanceData, positionData); fetchAndSetCurrentLeverage(); }

// --- Update UI Elements ---
// ***** MODIFIED updateAccountPanel to add data attributes *****
function updateAccountPanel(balanceData, positionRiskData) {
    console.log("後端返回的原始倉位數據 (positionRiskData):", JSON.stringify(positionRiskData, null, 2)); // 打印原始數據
    if (balanceData && Array.isArray(balanceData)) {
        const usdtAsset = balanceData.find(asset => asset.asset === 'USDT');
        usdtBalance = usdtAsset ? parseFloat(usdtAsset.availableBalance) : 0;
        // Use formatNumber for balance to avoid showing '未設定' for 0 balance
        availableBalanceSpan.textContent = `${formatNumber(usdtBalance, pricePrecision)} USDT`;
    } else {
        usdtBalance = 0;
        availableBalanceSpan.textContent = "-.-- USDT"; // Keep default placeholder if data missing
    }

    positionDetailsDiv.innerHTML = '';
    let positionFound = false;

    if (positionRiskData && Array.isArray(positionRiskData)) {
        positionInfo = positionRiskData; // Store the latest position info globally
        const currentPosition = positionRiskData.find(p => p.symbol === currentSymbol && parseFloat(p.positionAmt) !== 0);

        if (currentPosition) {
            positionFound = true;
            positionCountSpan.textContent = '1';
            const posAmt = parseFloat(currentPosition.positionAmt);
            const entryPrice = parseFloat(currentPosition.entryPrice);
            const markPrice = parseFloat(currentPosition.markPrice);
            const pnl = parseFloat(currentPosition.unRealizedProfit);
            const leverage = parseInt(currentPosition.leverage);
            const liqPrice = parseFloat(currentPosition.liquidationPrice);

            if (!isNaN(markPrice)) {
                currentMarkPrice = markPrice;
            }

            const marginUsed = Math.abs(posAmt * entryPrice / leverage);
            const pnlPercent = marginUsed > 0 ? (pnl / marginUsed) * 100 : 0;
            // 打印用於計算保證金的原始值
            console.log(`保證金計算 - posAmt: ${posAmt}, entryPrice: ${entryPrice}, leverage: ${leverage}`);
            console.log(`保證金計算 - isolatedWallet: ${currentPosition.isolatedWallet}, initialMargin: ${currentPosition.initialMargin}`);
            console.log(`保證金計算 - marginUsed (計算前): ${marginUsed}`);

            // 修改 estimatedMargin 計算邏輯，正確處理 "0" 的情況
            let estimatedMargin = parseFloat(currentPosition.isolatedWallet);
            if (isNaN(estimatedMargin) || estimatedMargin <= 0) { // 如果 isolatedWallet 無效或為 0
                estimatedMargin = parseFloat(currentPosition.initialMargin); // 嘗試 initialMargin
                if (isNaN(estimatedMargin) || estimatedMargin <= 0) { // 如果 initialMargin 也無效或為 0
                    estimatedMargin = marginUsed; // 最後回退到計算出的 marginUsed
                }
            }

            // 打印最終計算出的保證金值
            console.log(`保證金計算 - estimatedMargin (最終): ${estimatedMargin}`);

            // Get TP/SL prices (will be undefined if not present in backend data)
            const takeProfitPrice = currentPosition.takeProfitPrice;
            const stopLossPrice = currentPosition.stopLossPrice;

            positionDetailsDiv.innerHTML = `
                <div class="panel-row"><label>持倉數量 (${quantityUnitSpan.textContent || '?'})</label><span class="value">${formatNumber(posAmt, quantityPrecision)}</span></div>
                <div class="panel-row"><label>開倉價格 (USDT)</label><span class="value">${formatCurrency(entryPrice, pricePrecision)}</span></div>
                <div class="panel-row"><label>標記價格 (USDT)</label><span class="value">${formatCurrency(markPrice, pricePrecision)}</span></div>
                <div class="panel-row"><label>未實現盈虧 (USDT)</label><span class="value position-pnl ${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)} (${pnl >= 0 ? '+' : ''}${formatCurrency(pnlPercent)}%)</span></div>
                <div class="panel-row"><label>預估強平價 (USDT)</label><span class="value">${formatCurrency(liqPrice, pricePrecision)}</span></div>
                <div class="panel-row"><label>保證金 (USDT)</label><span class="value">${formatCurrency(estimatedMargin)}</span></div>
                <div class="panel-row"><label>槓桿</label><span class="value">${leverage}x</span></div>
                <!-- Add TP/SL rows with data attributes -->
                <div class="panel-row">
                    <label>止盈價 (USDT)</label>
                    <span class="value editable-price"
                          data-type="tp"
                          data-symbol="${currentPosition.symbol}"
                          data-entry-price="${entryPrice}"
                          data-pos-amt="${posAmt}">
                          ${formatCurrency(takeProfitPrice, pricePrecision)}
                    </span>
                </div>
                <div class="panel-row">
                    <label>止損價 (USDT)</label>
                    <span class="value editable-price"
                          data-type="sl"
                          data-symbol="${currentPosition.symbol}"
                          data-entry-price="${entryPrice}"
                          data-pos-amt="${posAmt}">
                          ${formatCurrency(stopLossPrice, pricePrecision)}
                    </span>
                </div>
            `;
        }
    }

    // 控制按鈕容器的顯示/隱藏
    if (positionActionsContainer) {
        positionActionsContainer.style.display = positionFound ? 'flex' : 'none';
    }

    if (!positionFound) {
        positionInfo = positionRiskData; // Store even if no current position (for leverage info)
        positionCountSpan.textContent = '0';
        positionDetailsDiv.innerHTML = '<div class="no-position">沒有持倉</div>';
    }

    updateCalculations();
}
// ***** END OF MODIFIED updateAccountPanel *****

function fetchAndSetCurrentLeverage() { if (!positionInfo || !Array.isArray(positionInfo) || positionInfo.length === 0) { console.log("前端: 沒有持倉數據可用於設定槓桿顯示。"); return; } const currentSymbolPosition = positionInfo.find(p => p.symbol === currentSymbol); if (currentSymbolPosition && currentSymbolPosition.leverage) { const fetchedLeverage = parseInt(currentSymbolPosition.leverage); if (!isNaN(fetchedLeverage)) { currentLeverage = fetchedLeverage; leverageInput.value = currentLeverage; console.log(`前端: ${currentSymbol} 的當前槓桿更新為 ${currentLeverage}x`); updateCalculations(); } } else { console.warn(`前端: 在持倉數據中找不到 ${currentSymbol} 的槓桿資訊。`); } }

// --- Actions Triggered by UI ---
// ... (handleChangeLeverage, placeMarketOrder, updateCalculations 保持不變) ...
async function handleChangeLeverage() { const newLeverage = parseInt(leverageInput.value); if (isNaN(newLeverage) || newLeverage < 1 || newLeverage > 125) { updateStatus("無效的槓桿值 (1-125)", "warning"); fetchAndSetCurrentLeverage(); return; } updateStatus(`正在請求後端設定 ${currentSymbol} 槓桿為 ${newLeverage}x...`, "info"); const result = await fetchFromBackend('/leverage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: currentSymbol, leverage: newLeverage }) }); if (result) { updateStatus(`${currentSymbol} 槓桿已成功設定為 ${result.leverage}x`, "success"); currentLeverage = parseInt(result.leverage); leverageInput.value = currentLeverage; fetchInitialData(); } else { updateStatus("設定槓桿失敗", "error"); fetchAndSetCurrentLeverage(); } }
async function placeMarketOrder(side) { const quantity = parseFloat(quantityInput.value); if (isNaN(quantity) || quantity <= 0) { updateStatus("請輸入有效的訂單數量", "warning"); return; } const formattedQuantity = quantity.toFixed(quantityPrecision); if (Math.abs(parseFloat(formattedQuantity) - quantity) > 1e-9 ) { updateStatus(`數量精度不符，請使用 ${quantityPrecision} 位小數 (e.g., ${formattedQuantity})`, "warning"); quantityInput.value = formattedQuantity; return; } const reduceOnly = reduceOnlyCheckbox.checked; const orderParams = { symbol: currentSymbol, side: side, type: 'MARKET', quantity: formattedQuantity }; if (reduceOnly) { orderParams.reduceOnly = 'true'; } updateStatus(`正在請求後端提交 ${side === 'BUY' ? '買入' : '賣出'} 市價單...`, "info"); const result = await fetchFromBackend('/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderParams) }); if (result && result.orderId) { updateStatus(`後端回報訂單提交成功 (ID: ${result.orderId}, Status: ${result.status})`, "success"); quantityInput.value = ''; reduceOnlyCheckbox.checked = false; } else { updateStatus("下單請求失敗", "error"); } }
function updateCalculations() { const quantity = parseFloat(quantityInput.value) || 0; const leverage = parseInt(leverageInput.value) || currentLeverage || 1; const price = currentMarkPrice || currentCandle?.close || 0; let requiredMargin = 0; if (quantity > 0 && price > 0 && leverage > 0) { requiredMargin = (quantity * price) / leverage; } marginRequiredSpan.textContent = `${formatCurrency(requiredMargin)} USDT`; let maxOrderSize = 0; if (usdtBalance > 0 && price > 0 && leverage > 0) { maxOrderSize = (usdtBalance * 0.95 * leverage) / price; } maxOrderSizeSpan.textContent = `${formatNumber(maxOrderSize, quantityPrecision)} ${quantityUnitSpan.textContent || '...'}`; }

// --- 新增：處理平倉操作 ---
async function handleClosePosition(closeFraction) {
    if (!positionInfo || !Array.isArray(positionInfo)) {
        updateStatus("無法獲取持倉信息", "warning");
        return;
    }
    const currentPosition = positionInfo.find(p => p.symbol === currentSymbol && parseFloat(p.positionAmt) !== 0);

    if (!currentPosition) {
        updateStatus("當前沒有持倉", "info");
        return;
    }

    const posAmt = parseFloat(currentPosition.positionAmt);
    const side = posAmt > 0 ? 'SELL' : 'BUY'; // 多單賣出平倉，空單買入平倉
    let quantityToClose = Math.abs(posAmt) * closeFraction;

    // 確保數量精度符合要求
    const formattedQuantity = quantityToClose.toFixed(quantityPrecision);
    if (parseFloat(formattedQuantity) <= 0) {
         updateStatus("計算出的平倉數量過小或為零", "warning");
         return;
    }

    const actionText = closeFraction === 1 ? '全平倉' : `平倉 ${closeFraction * 100}%`;
    updateStatus(`正在請求後端 ${actionText} (${side} ${formattedQuantity})...`, "info");

    const orderParams = {
        symbol: currentSymbol,
        side: side,
        type: 'MARKET',
        quantity: formattedQuantity,
        reduceOnly: 'true' // 確保是只減倉訂單
    };

    const result = await fetchFromBackend('/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderParams)
    });

    if (result && result.orderId) {
        updateStatus(`後端回報 ${actionText} 訂單提交成功 (ID: ${result.orderId}, Status: ${result.status})`, "success");
        // 成功後通常不需要做什麼，等待 WebSocket 更新 UI
    } else {
        updateStatus(`${actionText} 請求失敗`, "error");
    }
}


// --- Chart Initialization and Data Loading ---
// ... (initChart, fetchAndApplyKlineData 保持不變) ...
function initChart() { if (klineChart) { try { klinecharts.dispose(chartContainer); } catch (e) { console.error("圖表銷毀錯誤:", e); } klineChart = null; } updateStatus("正在初始化圖表..."); try { klineChart = klinecharts.init(chartContainer, { styles: { candle: { tooltip: { labels: ["時間:", "開:", "收:", "高:", "低:", "量:"] } } }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: 'zh-CN' }); if (!klineChart) { throw new Error("klinecharts.init 返回了 null 或 undefined"); } klineChart.createIndicator('Candle'); klineChart.createIndicator('VOL', false, { id: 'pane_vol' }); klineChart.createIndicator('MA', true, { id: 'candle_pane' }); console.log(`圖表已初始化，klinecharts 版本 v${klinecharts.version()}`); if(tradeSymbolSpan) tradeSymbolSpan.textContent = currentSymbol; if (quantityUnitSpan) { quantityUnitSpan.textContent = currentSymbol.replace(/USDT$/, ''); } fetchAndApplyKlineData(currentSymbol, currentInterval); } catch(error) { console.error("圖表初始化失敗:", error); updateStatus(`圖表初始化失敗: ${error.message}`, 'error'); if(chartContainer) chartContainer.innerHTML = '<p style="text-align:center; padding: 20px; color: red;">圖表加載失敗，請檢查控制台錯誤。</p>'; } }
async function fetchAndApplyKlineData(symbol, interval) { if (!klineChart) { console.error("圖表未初始化"); return; } currentCandle = null; currentMarkPrice = null; updateStatus(`正在從後端獲取 ${symbol} ${interval} K線數據...`); const klineData = await fetchFromBackend(`/kline?symbol=${symbol}&interval=${interval}&limit=1000`); if (klineData && Array.isArray(klineData) && klineData.length > 0) { const chartData = klineData.map(k => ({ timestamp: parseInt(k[0]), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) })); klineChart.applyNewData(chartData); console.log(`已將 ${chartData.length} 條K線數據應用到圖表。`); currentCandle = { ...chartData[chartData.length - 1] }; currentMarkPrice = currentCandle.close; updateCalculations(); updateStatus(`K線數據加載完成。`, 'success'); if (allTrades.length > 0) { applyTradeMarks(allTrades); } } else { klineChart.clearData(); klineChart.removeOverlay({ groupId: TRADE_MARKER_GROUP_ID }); updateStatus(`未獲取到 ${symbol} ${interval} K線數據。`, 'warning'); currentCandle = null; currentMarkPrice = null; updateCalculations(); } }

// --- WebSocket Handling (Connecting to Backend WS) ---
// ***** MODIFIED connectBackendWebSocket to use window.location.host *****
function connectBackendWebSocket() {
    if (backendWs && (backendWs.readyState === WebSocket.OPEN || backendWs.readyState === WebSocket.CONNECTING)) { console.log("已連接到後端 WebSocket 或正在連接。"); return; }
    // Deriving the WS URL based on the current page's location (host and assuming the same port as HTTP)
    // Use ws:// for http:// and wss:// for https://
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    BACKEND_WS_URL = `${wsProtocol}//${window.location.host}`; // Automatically uses the correct host and port

    if (!BACKEND_WS_URL) { console.error("無法確定後端 WebSocket URL，無法連接。"); updateStatus("WebSocket URL 確定失敗", "error"); return; }

    updateStatus("正在連接後端 WebSocket...", 'info'); console.log(`正在連接: ${BACKEND_WS_URL}`);
    try { backendWs = new WebSocket(BACKEND_WS_URL); } catch (error) { console.error("創建後端 WebSocket 連接失敗:", error); updateStatus("無法創建 WebSocket 連接", "error"); if (apiStatusSpan) { apiStatusSpan.textContent = "連接失敗"; apiStatusSpan.style.color = "red"; } return; }

    backendWs.onopen = () => { console.log("已成功連接到後端 WebSocket。"); updateStatus("後端 WebSocket 已連接", 'success'); if (apiStatusSpan) { apiStatusSpan.textContent = "已連接"; apiStatusSpan.style.color = "green"; } fetchInitialData(); updateTradePanelSymbol(); };
    backendWs.onmessage = (event) => { try { const message = JSON.parse(event.data); handleBackendWsMessage(message); } catch (error) { console.error("解析後端 WS 訊息錯誤:", error, event.data); } };
    backendWs.onerror = (error) => { console.error("後端 WebSocket 錯誤:", error); updateStatus("後端 WebSocket 連接錯誤", 'error'); if (apiStatusSpan) { apiStatusSpan.textContent = "連接錯誤"; apiStatusSpan.style.color = "red"; } if (userStreamStatusSpan) { userStreamStatusSpan.textContent = "錯誤"; userStreamStatusSpan.style.color = "red"; } };
    backendWs.onclose = (event) => { console.log("與後端 WebSocket 的連接已關閉:", event.code, event.reason); if (backendWs === event.target) backendWs = null; updateStatus("後端 WebSocket 已斷開", 'warning'); if (apiStatusSpan) { apiStatusSpan.textContent = "已斷開"; apiStatusSpan.style.color = "orange"; } if (userStreamStatusSpan) { userStreamStatusSpan.textContent = "已斷開"; userStreamStatusSpan.style.color = "orange"; } setTimeout(connectBackendWebSocket, 5000); };
}
// ***** END OF MODIFIED connectBackendWebSocket *****

function handleBackendWsMessage(message) {
    if (!message || !message.type) return;
    console.log("收到後端 WS 訊息:", message); // Log all messages for debugging

    switch (message.type) {
        case 'marketUpdate':
            if (message.stream === 'aggTrade' && message.data?.s === currentSymbol) {
                handleTickData(message.data);
            }
            break;
        case 'userUpdate':
            console.log("用戶數據更新:", message.event, message.data);
            if (userStreamStatusSpan) {
                userStreamStatusSpan.textContent = "已連接";
                userStreamStatusSpan.style.color = "green";
            }
            // 任何用戶數據更新（包括訂單成交、資金變化等）都觸發數據刷新
            console.log("偵測到用戶數據事件，從後端重新獲取數據...");
            fetchInitialData();
            break;
        case 'conditionalOrderUpdate': // *** 新增處理條件訂單更新 ***
            console.log(`收到條件訂單更新 (${message.action} ${message.orderType} for ${message.symbol})，重新獲取數據...`);
            updateStatus(`後端回報 ${message.symbol} ${message.orderType.toUpperCase()} ${message.action === 'create' ? '設定' : '取消'} 操作已發送。正在刷新...`, 'info');
            // 重新獲取帳戶和持倉數據以更新 UI
            fetchInitialData();
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
        case 'status':
            console.log("後端狀態:", message.context, message.status, message.message);
            if (message.context === 'userStream' && userStreamStatusSpan) {
                userStreamStatusSpan.textContent = message.status === 'connected' ? '已連接' : (message.status === 'disconnected' ? '已斷開' : '未知');
                userStreamStatusSpan.style.color = message.status === 'connected' ? 'green' : (message.status === 'error' ? 'red' : 'orange');
            }
            break;
        case 'config':
            if (backendModeSpan && message.apiMode) {
                backendModeSpan.textContent = message.apiMode.toUpperCase();
            }
            break;
        default:
            console.log("收到未知的後端 WS 訊息類型:", message.type);
    }
}
function handleTickData(tick) { /* ... (保持不變) ... */ if (!klineChart) return; const tickTime = parseInt(tick.T); const tickPrice = parseFloat(tick.p); const tickVolume = parseFloat(tick.q); if (isNaN(tickTime) || isNaN(tickPrice) || isNaN(tickVolume)) { return; } currentMarkPrice = tickPrice; if (currentCandle) { const klineTimestamp = getKlineTimestamp(tickTime, intervalMillis); if (klineTimestamp > currentCandle.timestamp) { klineChart.updateData({ ...currentCandle }); currentCandle = { timestamp: klineTimestamp, open: tickPrice, high: tickPrice, low: tickPrice, close: tickPrice, volume: tickVolume }; klineChart.updateData({ ...currentCandle }); } else if (klineTimestamp === currentCandle.timestamp) { currentCandle.high = Math.max(currentCandle.high, tickPrice); currentCandle.low = Math.min(currentCandle.low, tickPrice); currentCandle.close = tickPrice; currentCandle.volume += tickVolume; klineChart.updateData({ ...currentCandle }); } } else { console.warn("收到 Tick 但 currentCandle 為空"); } updateCalculations(); }

// --- CSV/XLSX Parsing & Trade Marks ---
// ... (parseCSV, parseXLSX, applyTradeMarks 保持不變) ...
function parseCSV(file) { updateStatus(`正在解析 CSV 文件: ${file.name}...`); Papa.parse(file, { header: true, skipEmptyLines: true, dynamicTyping: false, complete: function(results) { console.log("CSV 解析完成:", results); if (results.errors.length > 0) { console.error("CSV 解析錯誤:", results.errors); updateStatus(`解析CSV出錯: ${results.errors[0].message}`, 'error'); return; } if (results.data.length === 0) { updateStatus("CSV 文件為空", 'warning'); return; } allTrades = results.data; updateStatus(`CSV 解析成功: ${allTrades.length} 筆`, 'success'); if (klineChart) applyTradeMarks(allTrades); }, error: function(error) { console.error("CSV 解析錯誤:", error); updateStatus(`解析CSV失敗: ${error.message}`, 'error'); } }); }
function parseXLSX(file) { updateStatus(`正在解析 XLSX 文件: ${file.name}...`); const reader = new FileReader(); reader.onload = function(e) { try { const data = e.target.result; const workbook = XLSX.read(data, { type: 'array' }); const firstSheetName = workbook.SheetNames[0]; const worksheet = workbook.Sheets[firstSheetName]; const jsonData = XLSX.utils.sheet_to_json(worksheet); console.log("XLSX 解析完成:", jsonData); if (jsonData.length === 0) { updateStatus("XLSX 文件為空", 'warning'); return; } allTrades = jsonData; updateStatus(`XLSX 解析成功: ${allTrades.length} 筆`, 'success'); if (klineChart) applyTradeMarks(allTrades); } catch (error) { console.error("XLSX 解析錯誤:", error); updateStatus(`解析XLSX失敗: ${error.message}`, 'error'); } }; reader.onerror = function(ex) { console.error("讀取文件錯誤:", ex); updateStatus("讀取文件失敗", 'error'); }; reader.readAsArrayBuffer(file); }
function applyTradeMarks(tradesData) { if (!klineChart) return; const relevantTrades = tradesData.map(row => { const dateKey = Object.keys(row).find(key => key.includes('Date(UTC)') || key.toLowerCase().includes('time')); const sideKey = Object.keys(row).find(key => key.toLowerCase() === 'side'); const priceKey = Object.keys(row).find(key => key.toLowerCase() === 'price'); const symbolKey = Object.keys(row).find(key => key.toLowerCase() === 'symbol'); if (!dateKey || !sideKey || !priceKey || !symbolKey || row[dateKey] === undefined || row[sideKey] === undefined || row[priceKey] === undefined || row[symbolKey] === undefined) { return null; } if (String(row[symbolKey]).toUpperCase().trim() !== currentSymbol.toUpperCase()) { return null; } let timestamp; if (typeof row[dateKey] === 'number' && row[dateKey] > 10000 && row[dateKey] < 60000) { try { const excelEpoch = new Date(1899, 11, 30); const date = new Date(excelEpoch.getTime() + row[dateKey] * 86400000); const utcMs = date.getTime() - (date.getTimezoneOffset() * 60000); timestamp = utcMs; } catch (dateError) { timestamp = NaN; } } else { timestamp = new Date(String(row[dateKey]).trim().replace(' ', 'T') + 'Z').getTime(); } if (isNaN(timestamp)) { console.warn(`跳過無效日期: ${row[dateKey]}`, row); return null; } const price = parseFloat(row[priceKey]); if (isNaN(price)) { console.warn(`跳過無效價格: ${row[priceKey]}`, row); return null; } const side = String(row[sideKey]).toUpperCase().trim(); if (side !== 'BUY' && side !== 'SELL') { return null; } return { timestamp: timestamp, price: price, side: side, originalTrade: row }; }).filter(trade => trade !== null); updateStatus(`正在應用 ${relevantTrades.length} 個歷史交易標記...`); klineChart.removeOverlay({ groupId: TRADE_MARKER_GROUP_ID }); if (relevantTrades.length === 0) { updateStatus(`沒有找到 ${currentSymbol} 的歷史交易。`, 'info'); return; } const overlayData = relevantTrades.map(trade => ({ name: 'tradeMarker', groupId: TRADE_MARKER_GROUP_ID, points: [{ timestamp: trade.timestamp, value: trade.price }], lock: true, extendData: { side: trade.side, originalTrade: trade.originalTrade } })); if (overlayData.length > 0) { try { klineChart.createOverlay(overlayData); updateStatus(`已應用 ${overlayData.length} 個歷史交易標記。`, 'success'); } catch (e) { console.error("創建標記錯誤:", e); updateStatus("創建交易標記失敗", "error"); } } }

// --- Custom Overlay Definition ---
// ... (保持不變) ...
klinecharts.registerOverlay({ name: 'tradeMarker', totalStep: 1, lock: true, needDefaultPointFigure: false, styles: { polygon: (overlay) => { const SelectedState = klinecharts.OverlayState?.Selected ?? 'selected'; if (overlay.state === SelectedState) { return { style: 'fill', color: 'transparent', borderColor: 'transparent', borderSize: 0 }; } return {}; }, circle: (overlay) => { const SelectedState = klinecharts.OverlayState?.Selected ?? 'selected'; if (overlay.state === SelectedState) { return { style: 'fill', color: 'transparent', borderColor: 'transparent', borderSize: 0 }; } return {}; }, rect: (overlay) => { const SelectedState = klinecharts.OverlayState?.Selected ?? 'selected'; if (overlay.state === SelectedState) { return { style: 'fill', color: 'transparent', borderColor: 'transparent', borderSize: 0 }; } return {}; } }, createPointFigures: ({ overlay, coordinates, barSpace }) => { if (coordinates.length === 0 || !coordinates[0]) { return []; } const point = coordinates[0]; const side = overlay.extendData?.side; if (!side) return []; const triangleHeight = 8; const triangleBaseHalf = 4; const barH = barSpace.bar * 0.5; const offset = barH + triangleHeight * 0.7; let color; let points; if (side === 'BUY') { color = '#26a69a'; const yBase = point.y + offset; const yTip = yBase - triangleHeight; points = [ { x: point.x, y: yTip }, { x: point.x - triangleBaseHalf, y: yBase }, { x: point.x + triangleBaseHalf, y: yBase } ]; } else if (side === 'SELL') { color = '#ef5350'; const yBase = point.y - offset; const yTip = yBase + triangleHeight; points = [ { x: point.x, y: yTip }, { x: point.x - triangleBaseHalf, y: yBase }, { x: point.x + triangleBaseHalf, y: yBase } ]; } else { return []; } return [{ type: 'polygon', attrs: { coordinates: points }, styles: { style: 'fill', color: color, } }]; }, onMouseEnter: (event) => { if (tooltipElement && event.overlay?.extendData?.originalTrade) { const trade = event.overlay.extendData.originalTrade; const dateKey = Object.keys(trade).find(key => key.includes('Date(UTC)') || key.toLowerCase().includes('time')); let tooltipContent = `時間: ${trade[dateKey] || 'N/A'}\n`; tooltipContent += `方向: ${trade.Side || trade.side || 'N/A'}\n`; tooltipContent += `價格: ${trade.Price || trade.price || 'N/A'}\n`; tooltipContent += `數量: ${trade.Quantity || trade.Filled || trade.qty || 'N/A'}\n`; tooltipElement.innerHTML = tooltipContent; tooltipElement.style.display = 'block'; const offsetX = 15; const offsetY = 10; const chartRect = chartContainer.getBoundingClientRect(); let left = event.pointerCoordinate.x + offsetX + chartRect.left + window.scrollX; let top = event.pointerCoordinate.y + offsetY + chartRect.top + window.scrollY; const tooltipRect = tooltipElement.getBoundingClientRect(); if (left + tooltipRect.width > window.innerWidth) { left = event.pointerCoordinate.x - tooltipRect.width - offsetX + chartRect.left + window.scrollX; } if (top + tooltipRect.height > window.innerHeight) { top = event.pointerCoordinate.y - tooltipRect.height - offsetY + chartRect.top + window.scrollY; } if (left < 0) left = 5 + window.scrollX; if (top < 0) top = 5 + window.scrollY; tooltipElement.style.left = `${left}px`; tooltipElement.style.top = `${top}px`; } }, onMouseLeave: (event) => { if (tooltipElement) { tooltipElement.style.display = 'none'; } } });

// --- Event Listeners ---
// ... (保持不變) ...
fileInput.addEventListener('change', (event) => { const file = event.target.files[0]; if (file) { updateStatus(`已選擇文件: ${file.name}，準備處理...`); const fileName = file.name.toLowerCase(); allTrades = []; if(klineChart) klineChart.removeOverlay({ groupId: TRADE_MARKER_GROUP_ID }); if (fileName.endsWith('.csv')) { parseCSV(file); } else if (fileName.endsWith('.xlsx')) { parseXLSX(file); } else { updateStatus("不支援的文件類型", 'error'); } } event.target.value = null; });
intervalButtons.forEach(button => { button.addEventListener('click', () => { intervalButtons.forEach(btn => btn.classList.remove('active')); button.classList.add('active'); const newInterval = button.getAttribute('data-interval'); if (newInterval !== currentInterval) { currentInterval = newInterval; intervalMillis = getIntervalMillis(currentInterval); updateStatus(`正在切換時間間隔至 ${currentInterval}...`); if(klineChart) fetchAndApplyKlineData(currentSymbol, currentInterval); } }); });
setLeverageBtn.addEventListener('click', handleChangeLeverage);
leverageInput.addEventListener('change', updateCalculations);
quantityInput.addEventListener('input', updateCalculations);
buyLongBtn.addEventListener('click', () => placeMarketOrder('BUY'));
sellShortBtn.addEventListener('click', () => placeMarketOrder('SELL'));
// 新增：平倉按鈕事件監聽器 (修正重複)
if (closeAllBtn) closeAllBtn.addEventListener('click', () => handleClosePosition(1)); // 1 表示 100%
if (closeHalfBtn) closeHalfBtn.addEventListener('click', () => handleClosePosition(0.5)); // 0.5 表示 50%


// --- Initialization Function ---
// ***** MODIFIED initializeApp to derive WS URL *****
async function initializeApp() {
    console.log("正在初始化應用...");
    updateStatus("正在獲取後端設定...", 'info');

    // 1. 獲取後端設定 (config 端點現在不是必須的，除非要傳遞 mode 等信息)
    // 如果不需要從 /api/config 獲取端口，可以註解掉或移除
    // const configData = await fetchFromBackend('/config');
    let configData = { websocketPort: null, apiMode: '未知'}; // 假設預設
    try {
        const fetchedConfig = await fetchFromBackend('/config');
        if (fetchedConfig) configData = fetchedConfig;
    } catch(e){ console.warn("獲取 /api/config 失敗 (可能未使用)");}


    // 2. 設定 WebSocket URL (使用與 HTTP 相同的 host 和 port)
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    BACKEND_WS_URL = `${wsProtocol}//${window.location.host}`; // 自動使用瀏覽器訪問的 host 和 port
    console.log(`後端 WebSocket URL 設定為 (與 HTTP 相同): ${BACKEND_WS_URL}`);
    if (backendModeSpan && configData.apiMode) { backendModeSpan.textContent = configData.apiMode.toUpperCase(); }


    // 3. 初始化圖表
    initChart(); // 會觸發 K 線載入

    // 4. 連接後端 WebSocket
    connectBackendWebSocket(); // 會觸發初始數據獲取

}
// ***** END OF MODIFIED initializeApp *****


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("前端 DOM 已載入");
    initializeApp(); // 調用新的初始化函數
});

// --- Cleanup ---
window.addEventListener('beforeunload', () => {
    console.log("前端頁面卸載，關閉 WebSocket...");
    if (backendWs && backendWs.readyState === WebSocket.OPEN) {
        backendWs.close();
    }
});


// --- Event Listeners and Handlers for Editable Prices ---
positionDetailsDiv.addEventListener('click', (event) => {
    // 只處理直接點擊 .editable-price 的情況
    if (event.target.classList.contains('editable-price')) {
        // 如果已經存在輸入框，則不重複創建
        if (event.target.parentNode.querySelector('.editable-price-input')) {
            return;
        }
        makePriceEditable(event.target);
    }
});

// ***** MODIFIED makePriceEditable to read data attributes *****
function makePriceEditable(spanElement) {
    const currentPriceText = spanElement.textContent;
    const type = spanElement.dataset.type; // 'tp' or 'sl'
    const symbol = spanElement.dataset.symbol;
    // Read entry price and position amount from data attributes
    const entryPrice = parseFloat(spanElement.dataset.entryPrice);
    const posAmt = parseFloat(spanElement.dataset.posAmt);

    // 創建 input 元素
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'editable-price-input'; // 添加 class 以便樣式化
    // 嘗試從文本解析數字，如果失敗或為 "未設定"，則留空
    const currentPriceNum = parseFloat(currentPriceText); // NaN if currentPriceText is '未設定'
    input.value = (isNaN(currentPriceNum) || currentPriceNum === 0) ? '' : currentPriceNum.toFixed(pricePrecision);
    input.step = (1 / Math.pow(10, pricePrecision)).toFixed(pricePrecision); // 根據精度設定 step
    input.style.width = '80px'; // 簡單設定寬度
    input.placeholder = "輸入價格";

    // 替換 span 為 input
    spanElement.style.display = 'none'; // 隱藏 span
    // 插入到 span 之後，而不是替換，以便取消時恢復
    spanElement.parentNode.insertBefore(input, spanElement.nextSibling);
    input.focus(); // 自動聚焦
    input.select(); // 全選內容

    // ***** MODIFIED handleInputComplete for validation *****
    const handleInputComplete = async (eventTrigger) => {
        // 移除事件監聽器，避免重複觸發
        input.removeEventListener('blur', handleBlur);
        input.removeEventListener('keydown', handleKeydown);

        const newPriceStr = input.value.trim();
        input.remove(); // 移除 input
        spanElement.style.display = ''; // 顯示 span

        // 檢查價格是否有效且已更改
        const newPriceNum = parseFloat(newPriceStr);
        const oldPriceNum = parseFloat(currentPriceText); // NaN if '未設定'

        // 如果價格無效 (<0)、或未改變 (考慮精度)，則恢復原狀
        // 注意: 允許設置為 0 或清空來取消 TP/SL
        // Handle change from '未設定' (isNaN(oldPriceNum))
        const priceChanged = isNaN(oldPriceNum) ? !isNaN(newPriceNum) : Math.abs(newPriceNum - oldPriceNum) >= (1 / Math.pow(10, pricePrecision + 1));
        const isValidPriceFormat = !isNaN(newPriceNum) && newPriceNum >= 0; // 允許 0
        const isEmptyInput = newPriceStr === '';

        // 如果輸入非空，但格式無效或價格未變，則恢復
        if (!isEmptyInput && (!isValidPriceFormat || !priceChanged)) {
             spanElement.textContent = currentPriceText; // 恢復原樣
             console.log(`價格未改變或格式無效 (${newPriceStr})，取消設定。`);
             return;
        }

        // 如果輸入為空 或 數字為 0，則視為取消 (發送 0 到後端)
        const priceToSend = (isEmptyInput || newPriceNum === 0) ? 0 : newPriceNum;

        // --- 開始價格邏輯驗證 (僅在設定價格時，取消時 priceToSend 為 0) ---
        if (priceToSend !== 0 && !isNaN(entryPrice) && !isNaN(posAmt) && posAmt !== 0) {
            let validationError = null;
            if (posAmt > 0) { // 多頭
                if (type === 'tp' && priceToSend <= entryPrice) {
                    validationError = "多單止盈價必須高於開倉價";
                } else if (type === 'sl' && priceToSend >= entryPrice) {
                    validationError = "多單止損價必須低於開倉價";
                }
            } else { // 空頭 (posAmt < 0)
                if (type === 'tp' && priceToSend >= entryPrice) {
                    validationError = "空單止盈價必須低於開倉價";
                } else if (type === 'sl' && priceToSend <= entryPrice) {
                    validationError = "空單止損價必須高於開倉價";
                }
            }

            if (validationError) {
                updateStatus(validationError, 'warning');
                spanElement.textContent = currentPriceText; // 恢復原樣
                console.log(`價格邏輯驗證失敗: ${validationError}`);
                return; // 驗證失敗，不繼續
            }
        }
        // --- 結束價格邏輯驗證 ---


        // 如果是取消操作，但原價已經是 "未設定" 或 0，則不發送請求
        if (priceToSend === 0 && (isNaN(oldPriceNum) || oldPriceNum === 0)) {
            spanElement.textContent = formatCurrency(0, pricePrecision); // 恢復為 "未設定"
            console.log(`無需取消，原價格已為 0 或未設定。`);
            return;
        }

        // 如果價格未變 (包括從 0 變 0)，也不發送請求
        // Check if both are NaN (e.g., was '未設定', input is invalid -> NaN)
        if (isNaN(priceToSend) && isNaN(oldPriceNum)) {
             spanElement.textContent = currentPriceText; // Restore '未設定'
             console.log(`價格未改變 (仍為無效)，無需設定。`);
             return;
        }
        // Check if they are numerically the same
        if (priceToSend === oldPriceNum && !isEmptyInput) { // Ensure not triggered by empty input resulting in 0 === 0
             spanElement.textContent = currentPriceText;
             console.log(`價格未改變 (${priceToSend})，無需設定。`);
             return;
        }


        const formattedDisplayPrice = formatCurrency(priceToSend, pricePrecision);
        spanElement.textContent = formattedDisplayPrice; // 先樂觀更新顯示

        const actionText = priceToSend === 0 ? '取消' : '設定';
        updateStatus(`正在${actionText} ${symbol} ${type.toUpperCase()} 價格為 ${formattedDisplayPrice}...`, 'info'); // Use formatted price

        // *** 調用後端 API ***
        const success = await setStopOrder(symbol, type, priceToSend.toFixed(pricePrecision));

        if (success) {
            updateStatus(`${symbol} ${type.toUpperCase()} 價格已${actionText}${priceToSend === 0 ? '' : '為 ' + formattedDisplayPrice}`, 'success');
            // 成功後，後端應通過 WebSocket 推送更新，前端的 updateAccountPanel 會處理
            // fetchInitialData(); // Consider fetching data again if WS update is not immediate
        } else {
            updateStatus(`${actionText} ${symbol} ${type.toUpperCase()} 價格失敗，恢復原價`, 'error');
            spanElement.textContent = currentPriceText; // 設定失敗，恢復原價
        }
    };
    // ***** END OF MODIFIED handleInputComplete *****

    // 分開處理 blur 和 keydown
    const handleBlur = () => {
        // 延遲處理 blur，以允許點擊其他元素（如果需要）
        // 同時檢查 relatedTarget 是否是輸入框本身或其父元素內的元素，避免誤觸發
        setTimeout(() => {
             // 檢查 input 是否還在 DOM 中，如果已被移除（例如通過 Esc），則不處理
             if (!document.body.contains(input)) return;
             handleInputComplete('blur');
        }, 150); // 稍微增加延遲
    };
    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // 阻止表單提交（如果有的話）
            handleInputComplete('enter');
        } else if (e.key === 'Escape') {
            // 按 Esc 取消
            input.removeEventListener('blur', handleBlur); // 移除監聽器
            input.removeEventListener('keydown', handleKeydown);
            input.remove();
            spanElement.style.display = '';
            spanElement.textContent = currentPriceText;
            console.log("用戶取消設定。");
        }
    };

    // 添加事件監聽器
    input.addEventListener('blur', handleBlur);
    input.addEventListener('keydown', handleKeydown);
}
// ***** END OF MODIFIED makePriceEditable *****


// --- API Call for Setting Stop Orders ---
async function setStopOrder(symbol, type, price) {
    const endpoint = '/stop-order';
    const method = 'POST';
    let body = {};

    const priceNum = parseFloat(price);
    if (isNaN(priceNum)) {
        console.error(`無效的價格傳遞給 setStopOrder: ${price}`);
        return false;
    }

    // 根據類型構建請求體
    if (type === 'tp') {
        body = {
            symbol: symbol,
            takeProfitPrice: priceNum.toFixed(pricePrecision), // 發送格式化的價格
            // stopLossPrice: null // 可選：如果 API 支持同時設置，則需要傳遞現有的 SL 或 null
        };
        // 如果 price 為 0，表示取消
        if (priceNum === 0) {
            body.cancelTakeProfit = true;
            delete body.takeProfitPrice; // 取消時不發送價格
        }
    } else if (type === 'sl') {
        body = {
            symbol: symbol,
            stopLossPrice: priceNum.toFixed(pricePrecision), // 發送格式化的價格
            // takeProfitPrice: null // 可選
        };
        // 如果 price 為 0，表示取消
        if (priceNum === 0) {
            body.cancelStopLoss = true;
            delete body.stopLossPrice; // 取消時不發送價格
        }
    } else {
        console.error(`未知的止損/止盈類型: ${type}`);
        return false;
    }

    // 發送請求到後端
    try {
        const result = await fetchFromBackend(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        // 後端應返回 { success: true } 或類似結構表示成功
        // 這裡假設 fetchFromBackend 在失敗時返回 null
        return result !== null;
    } catch (error) {
        console.error(`設定 ${type.toUpperCase()} 訂單時出錯:`, error);
        return false;
    }
}