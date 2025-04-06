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
let positionInfo = null;
let currentMarkPrice = null;
let quantityPrecision = 3;
let pricePrecision = 2;
let currentLeverage = 10;


// --- Status Update Helper ---
// ... (保持不變) ...
function updateStatus(message, type = 'info') { console.log(`Status (${type}): ${message}`); if (statusBar) { statusBar.textContent = message; statusBar.classList.remove('status-info', 'status-success', 'status-error', 'status-warning'); statusBar.classList.add(`status-${type}`); } }

// --- Helper Functions ---
// ... (保持不變) ...
function getIntervalMillis(interval) { const unit = interval.slice(-1).toLowerCase(); const value = parseInt(interval.slice(0, -1)); switch (unit) { case 'm': return value * 60 * 1000; case 'h': return value * 60 * 60 * 1000; case 'd': return value * 24 * 60 * 60 * 1000; default: return 60 * 60 * 1000; } }
function getKlineTimestamp(tradeTimestamp, intervalMs) { return tradeTimestamp - (tradeTimestamp % intervalMs); }
function formatCurrency(value, decimals = 2) { const num = parseFloat(value); return isNaN(num) ? '-.--' : num.toFixed(decimals); }
function formatNumber(value, decimals = 3) { const num = parseFloat(value); return isNaN(num) ? '-.---' : num.toFixed(decimals); }

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
// ... (updateAccountPanel, fetchAndSetCurrentLeverage 保持不變) ...
function updateAccountPanel(balanceData, positionRiskData) { if (balanceData && Array.isArray(balanceData)) { const usdtAsset = balanceData.find(asset => asset.asset === 'USDT'); usdtBalance = usdtAsset ? parseFloat(usdtAsset.availableBalance) : 0; availableBalanceSpan.textContent = `${formatCurrency(usdtBalance)} USDT`; } else { usdtBalance = 0; availableBalanceSpan.textContent = "-.-- USDT"; } positionDetailsDiv.innerHTML = ''; let positionFound = false; if (positionRiskData && Array.isArray(positionRiskData)) { positionInfo = positionRiskData; const currentPosition = positionRiskData.find(p => p.symbol === currentSymbol && parseFloat(p.positionAmt) !== 0); if (currentPosition) { positionFound = true; positionCountSpan.textContent = '1'; const posAmt = parseFloat(currentPosition.positionAmt); const entryPrice = parseFloat(currentPosition.entryPrice); const markPrice = parseFloat(currentPosition.markPrice); const pnl = parseFloat(currentPosition.unRealizedProfit); const leverage = parseInt(currentPosition.leverage); const liqPrice = parseFloat(currentPosition.liquidationPrice); if (!isNaN(markPrice)) { currentMarkPrice = markPrice; } const marginUsed = Math.abs(posAmt * entryPrice / leverage); const pnlPercent = marginUsed > 0 ? (pnl / marginUsed) * 100 : 0; const estimatedMargin = parseFloat(currentPosition.isolatedWallet || currentPosition.initialMargin || marginUsed); positionDetailsDiv.innerHTML = ` <div class="panel-row"><label>持倉數量 (${quantityUnitSpan.textContent})</label><span class="value">${formatNumber(posAmt, quantityPrecision)}</span></div> <div class="panel-row"><label>開倉價格 (USDT)</label><span class="value">${formatCurrency(entryPrice, pricePrecision)}</span></div> <div class="panel-row"><label>標記價格 (USDT)</label><span class="value">${formatCurrency(markPrice, pricePrecision)}</span></div> <div class="panel-row"><label>未實現盈虧 (USDT)</label><span class="value position-pnl ${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)} (${pnl >= 0 ? '+' : ''}${formatCurrency(pnlPercent)}%)</span></div> <div class="panel-row"><label>預估強平價 (USDT)</label><span class="value">${formatCurrency(liqPrice, pricePrecision)}</span></div> <div class="panel-row"><label>保證金 (USDT)</label><span class="value">${formatCurrency(estimatedMargin)}</span></div> <div class="panel-row"><label>槓桿</label><span class="value">${leverage}x</span></div> `; } } if (!positionFound) { positionInfo = positionRiskData; positionCountSpan.textContent = '0'; positionDetailsDiv.innerHTML = '<div class="no-position">沒有持倉</div>'; } updateCalculations(); }
function fetchAndSetCurrentLeverage() { if (!positionInfo || !Array.isArray(positionInfo) || positionInfo.length === 0) { console.log("前端: 沒有持倉數據可用於設定槓桿顯示。"); return; } const currentSymbolPosition = positionInfo.find(p => p.symbol === currentSymbol); if (currentSymbolPosition && currentSymbolPosition.leverage) { const fetchedLeverage = parseInt(currentSymbolPosition.leverage); if (!isNaN(fetchedLeverage)) { currentLeverage = fetchedLeverage; leverageInput.value = currentLeverage; console.log(`前端: ${currentSymbol} 的當前槓桿更新為 ${currentLeverage}x`); updateCalculations(); } } else { console.warn(`前端: 在持倉數據中找不到 ${currentSymbol} 的槓桿資訊。`); } }

// --- Actions Triggered by UI ---
// ... (handleChangeLeverage, placeMarketOrder, updateCalculations 保持不變) ...
async function handleChangeLeverage() { const newLeverage = parseInt(leverageInput.value); if (isNaN(newLeverage) || newLeverage < 1 || newLeverage > 125) { updateStatus("無效的槓桿值 (1-125)", "warning"); fetchAndSetCurrentLeverage(); return; } updateStatus(`正在請求後端設定 ${currentSymbol} 槓桿為 ${newLeverage}x...`, "info"); const result = await fetchFromBackend('/leverage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: currentSymbol, leverage: newLeverage }) }); if (result) { updateStatus(`${currentSymbol} 槓桿已成功設定為 ${result.leverage}x`, "success"); currentLeverage = parseInt(result.leverage); leverageInput.value = currentLeverage; fetchInitialData(); } else { updateStatus("設定槓桿失敗", "error"); fetchAndSetCurrentLeverage(); } }
async function placeMarketOrder(side) { const quantity = parseFloat(quantityInput.value); if (isNaN(quantity) || quantity <= 0) { updateStatus("請輸入有效的訂單數量", "warning"); return; } const formattedQuantity = quantity.toFixed(quantityPrecision); if (Math.abs(parseFloat(formattedQuantity) - quantity) > 1e-9 ) { updateStatus(`數量精度不符，請使用 ${quantityPrecision} 位小數 (e.g., ${formattedQuantity})`, "warning"); quantityInput.value = formattedQuantity; return; } const reduceOnly = reduceOnlyCheckbox.checked; const orderParams = { symbol: currentSymbol, side: side, type: 'MARKET', quantity: formattedQuantity }; if (reduceOnly) { orderParams.reduceOnly = 'true'; } updateStatus(`正在請求後端提交 ${side === 'BUY' ? '買入' : '賣出'} 市價單...`, "info"); const result = await fetchFromBackend('/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderParams) }); if (result && result.orderId) { updateStatus(`後端回報訂單提交成功 (ID: ${result.orderId}, Status: ${result.status})`, "success"); quantityInput.value = ''; reduceOnlyCheckbox.checked = false; } else { updateStatus("下單請求失敗", "error"); } }
function updateCalculations() { const quantity = parseFloat(quantityInput.value) || 0; const leverage = parseInt(leverageInput.value) || currentLeverage || 1; const price = currentMarkPrice || currentCandle?.close || 0; let requiredMargin = 0; if (quantity > 0 && price > 0 && leverage > 0) { requiredMargin = (quantity * price) / leverage; } marginRequiredSpan.textContent = `${formatCurrency(requiredMargin)} USDT`; let maxOrderSize = 0; if (usdtBalance > 0 && price > 0 && leverage > 0) { maxOrderSize = (usdtBalance * 0.95 * leverage) / price; } maxOrderSizeSpan.textContent = `${formatNumber(maxOrderSize, quantityPrecision)} ${quantityUnitSpan.textContent || '...'}`; }


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

function handleBackendWsMessage(message) { /* ... (保持不變) ... */ if (!message || !message.type) return; switch (message.type) { case 'marketUpdate': if (message.stream === 'aggTrade' && message.data?.s === currentSymbol) { handleTickData(message.data); } break; case 'userUpdate': console.log("用戶數據更新:", message.event, message.data); if (userStreamStatusSpan) { userStreamStatusSpan.textContent = "已連接"; userStreamStatusSpan.style.color = "green"; } console.log("偵測到用戶數據事件，從後端重新獲取數據..."); fetchInitialData(); break; case 'error': console.error("收到來自後端的錯誤訊息:", message.message); updateStatus(`後端錯誤: ${message.message}`, 'error'); if (message.message.includes("用戶數據")) { if (userStreamStatusSpan) { userStreamStatusSpan.textContent = "錯誤"; userStreamStatusSpan.style.color = "red"; } } break; case 'status': console.log("後端狀態:", message.context, message.status, message.message); if (message.context === 'userStream' && userStreamStatusSpan) { userStreamStatusSpan.textContent = message.status === 'connected' ? '已連接' : (message.status === 'disconnected' ? '已斷開' : '未知'); userStreamStatusSpan.style.color = message.status === 'connected' ? 'green' : (message.status === 'error' ? 'red' : 'orange'); } break; case 'config': if (backendModeSpan && message.apiMode) { backendModeSpan.textContent = message.apiMode.toUpperCase(); } break; default: console.log("收到未知的後端 WS 訊息類型:", message.type); } }
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