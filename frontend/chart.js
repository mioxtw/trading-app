// frontend/chart.js

// --- DOM Elements (Chart related) ---
const chartContainer = document.getElementById('chart-container');
// fileInput element removed from HTML
const intervalButtons = document.querySelectorAll('.interval-btn'); // For interval change
const tooltipElement = document.getElementById('trade-tooltip'); // For trade mark tooltip

// --- Chart State Variables (subset of original state) ---
// Assuming window.globalState is defined in the main script.js
// window.globalState.klineChart = null; // Managed within initChart
// Removed state and constants related to file upload trade markers

// --- 新增倉位歷史標記 Group ID ---
const POSITION_HISTORY_GROUP_ID = 'positionHistoryMarkers';

// --- Helper Functions (Chart related) ---
function getKlineTimestamp(tradeTimestamp, intervalMs) {
    // Ensure globalState or pass intervalMillis if needed
    return tradeTimestamp - (tradeTimestamp % (window.globalState?.intervalMillis || intervalMs));
}

// --- Chart Initialization and Data Loading ---
function initChart() {
    if (window.globalState.klineChart) {
        try {
            klinecharts.dispose(chartContainer);
        } catch (e) {
            console.error("圖表銷毀錯誤:", e);
        }
        window.globalState.klineChart = null;
    }
    // Ensure updateStatus is available globally or passed as an argument
    if (typeof updateStatus !== 'function') {
        console.error("updateStatus function is not available globally.");
        return;
    }
    updateStatus("正在初始化圖表...");
    try {
        window.globalState.klineChart = klinecharts.init(chartContainer, {
            styles: {
                candle: {
                    tooltip: { labels: ["時間:", "開:", "收:", "高:", "低:", "量:"] }
                }
            },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: 'zh-CN'
        });
        if (!window.globalState.klineChart) {
            throw new Error("klinecharts.init 返回了 null 或 undefined");
        }
        window.globalState.klineChart.createIndicator('Candle');
        window.globalState.klineChart.createIndicator('VOL', false, { id: 'pane_vol' });
        console.log(`圖表已初始化，klinecharts 版本 v${klinecharts.version()}`);

        // Initial data load triggered from main script after chart init
        // fetchAndApplyKlineData(window.globalState.currentSymbol, window.globalState.currentInterval);

    } catch(error) {
        console.error("圖表初始化失敗:", error);
        updateStatus(`圖表初始化失敗: ${error.message}`, 'error');
        if(chartContainer) chartContainer.innerHTML = '<p style="text-align:center; padding: 20px; color: red;">圖表加載失敗，請檢查控制台錯誤。</p>';
    }
}

async function fetchAndApplyKlineData(symbol, interval) {
    if (!window.globalState.klineChart) {
        console.error("圖表未初始化");
        return;
    }
    window.globalState.currentCandle = null; // Reset candle state
    window.globalState.currentMarkPrice = null; // Reset mark price
    updateStatus(`正在從後端獲取 ${symbol} ${interval} K線數據...`);

    // Assumes fetchFromBackend is available globally
    if (typeof fetchFromBackend !== 'function') {
        console.error("fetchFromBackend function is not available globally.");
        updateStatus("後端通訊功能缺失", "error");
        return;
    }
    const klineData = await fetchFromBackend(`/kline?symbol=${symbol}&interval=${interval}&limit=1000`);

    if (klineData && Array.isArray(klineData) && klineData.length > 0) {
        const chartData = klineData.map(k => ({
            timestamp: parseInt(k[0]),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));
        window.globalState.klineChart.applyNewData(chartData);
        console.log(`已將 ${chartData.length} 條K線數據應用到圖表。`);

        // Update global state for current candle and mark price
        window.globalState.currentCandle = { ...chartData[chartData.length - 1] };
        window.globalState.currentMarkPrice = window.globalState.currentCandle.close;

        updateStatus(`K線數據加載完成。`, 'success');

        // Apply position history marks if checkbox is checked and data exists
        const checkbox = document.getElementById('showHistoryCheckbox');
        if (checkbox && checkbox.checked && window.globalState.positionHistoryData && window.globalState.positionHistoryData.length > 0) {
            applyPositionHistoryMarks(window.globalState.positionHistoryData);
        }
        // Trigger calculation update in trade module if needed
        if (typeof updateCalculations === 'function') {
             updateCalculations();
        }

    } else {
        window.globalState.klineChart.clearData();
        window.globalState.klineChart.removeOverlay({ groupId: POSITION_HISTORY_GROUP_ID }); // 清除倉位歷史標記
        updateStatus(`未獲取到 ${symbol} ${interval} K線數據。`, 'warning');
        window.globalState.currentCandle = null;
        window.globalState.currentMarkPrice = null;
        // Trigger calculation update in trade module if needed
         if (typeof updateCalculations === 'function') {
             updateCalculations();
        }
    }
}

// Removed functions related to CSV/XLSX parsing and old trade markers

// Removed registration for the old 'tradeMarker' overlay

// --- 新增：註冊 positionHistoryMarker Overlay ---
if (typeof klinecharts !== 'undefined') {
    klinecharts.registerOverlay({
        name: 'positionHistoryMarker',
        totalStep: 2, // 需要兩個點：開倉和平倉
        lock: true,
        needDefaultPointFigure: false, // 我們自定義繪圖
        needDefaultXAxisFigure: false,
        needDefaultYAxisFigure: false,
        styles: { // 禁用默認選擇樣式
             polygon: { style: 'fill', color: 'transparent', borderColor: 'transparent', borderSize: 0 },
             circle: { style: 'fill', color: 'transparent', borderColor: 'transparent', borderSize: 0 },
             rect: { style: 'fill', color: 'transparent', borderColor: 'transparent', borderSize: 0 }
        },
        // 繪製開倉箭頭、平倉箭頭和連接線
        createPointFigures: ({ overlay, coordinates, barSpace }) => {
            if (coordinates.length < 2 || !coordinates[0] || !coordinates[1]) { return []; }
            const figures = [];
            const openPoint = coordinates[0];
            const closePoint = coordinates[1];
            const data = overlay.extendData; // { openSide, pnl, quantity, avgOpenPrice, avgClosePrice, openTime, closeTime, durationMs, commission }

            if (!data || !data.openSide) return [];

            const arrowHeight = 8;
            const arrowBaseHalf = 4;
            const barH = barSpace.bar * 0.5; // 半個 bar 寬度用於偏移
            // const offset = barH + arrowHeight * 0.7; // 價格點的偏移量 // 移除三角形相關

            // 1. 繪製開倉箭頭 (已根據用戶回饋移除)
            // let openArrowColor = data.openSide === 'BUY' ? '#FFD700' : '#2196F3';
            // let openArrowPoints;
            // if (data.openSide === 'BUY') { ... } else { ... }
            // figures.push({ type: 'polygon', attrs: { coordinates: openArrowPoints }, styles: { style: 'fill', color: openArrowColor } });

            // 2. 繪製平倉箭頭 (已根據用戶回饋移除)
            // let closeArrowColor = data.openSide === 'BUY' ? '#2196F3' : '#FFD700';
            // let closeArrowPoints;
            // if (data.openSide === 'BUY') { ... } else { ... }
            // figures.push({ type: 'polygon', attrs: { coordinates: closeArrowPoints }, styles: { style: 'fill', color: closeArrowColor } });

            // 3. 只繪製連接線
            const pnl = parseFloat(data.pnl);
            const lineColor = isNaN(pnl) ? '#888888' : (pnl >= 0 ? '#26a69a' : '#ef5350'); // 綠色盈利，紅色虧損，灰色未知
            figures.push({
                type: 'line',
                attrs: { coordinates: [{ x: openPoint.x, y: openPoint.y }, { x: closePoint.x, y: closePoint.y }] },
                styles: { style: 'dashed', color: lineColor, size: 1 }
            });

            return figures;
        },
        // Tooltip 處理 (當滑鼠懸停在任何繪製的圖形上時觸發)
        onMouseEnter: (event) => {
             if (tooltipElement && event.overlay?.extendData) {
                const data = event.overlay.extendData;
                const pnl = parseFloat(data.pnl);
                const commission = parseFloat(data.commission);
                const durationSec = data.durationMs ? (data.durationMs / 1000).toFixed(1) : 'N/A';

                let tooltipContent = `方向: ${data.openSide === 'BUY' ? '多單' : '空單'}\n`;
                tooltipContent += `數量: ${formatNumber(data.quantity, window.globalState?.quantityPrecision ?? 3)}\n`;
                tooltipContent += `開倉價: ${formatCurrency(data.avgOpenPrice, window.globalState?.pricePrecision ?? 2)}\n`;
                tooltipContent += `平倉價: ${formatCurrency(data.avgClosePrice, window.globalState?.pricePrecision ?? 2)}\n`;
                tooltipContent += `開倉時間: ${data.openTime ? new Date(data.openTime).toLocaleString() : 'N/A'}\n`;
                tooltipContent += `平倉時間: ${data.closeTime ? new Date(data.closeTime).toLocaleString() : 'N/A'}\n`;
                tooltipContent += `持倉時長: ${durationSec} 秒\n`;
                tooltipContent += `手續費: ${formatCurrency(commission, 8)} ${data.commissionAsset || ''}\n`; // 顯示更多小數位
                tooltipContent += `盈虧: <span class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}</span>\n`;

                tooltipElement.innerHTML = tooltipContent.replace(/\n/g, '<br>');
                tooltipElement.style.display = 'block';

                // 定位 Tooltip (與 tradeMarker 邏輯相同)
                const offsetX = 15;
                const offsetY = 10;
                const chartRect = chartContainer.getBoundingClientRect();
                let left = event.pointerCoordinate.x + offsetX + chartRect.left + window.scrollX;
                let top = event.pointerCoordinate.y + offsetY + chartRect.top + window.scrollY;
                const tooltipRect = tooltipElement.getBoundingClientRect();
                if (left + tooltipRect.width > window.innerWidth) {
                    left = event.pointerCoordinate.x - tooltipRect.width - offsetX + chartRect.left + window.scrollX;
                }
                if (top + tooltipRect.height > window.innerHeight) {
                    top = event.pointerCoordinate.y - tooltipRect.height - offsetY + chartRect.top + window.scrollY;
                }
                if (left < window.scrollX) left = window.scrollX + 5;
                if (top < window.scrollY) top = window.scrollY + 5;
                tooltipElement.style.left = `${left}px`;
                tooltipElement.style.top = `${top}px`;
            }
        },
        onMouseLeave: (event) => {
            if (tooltipElement) {
                tooltipElement.style.display = 'none';
            }
        }
    });
} else {
    console.error("klinecharts library is not loaded before chart.js");
}


// --- 新增：應用倉位歷史標記 ---
function applyPositionHistoryMarks(positionHistoryData) {
    if (!window.globalState || !window.globalState.klineChart) {
        console.warn("圖表未初始化，無法應用倉位歷史標記。");
        return;
    }
    if (!Array.isArray(positionHistoryData)) {
        console.warn("無效的倉位歷史數據格式。");
        return;
    }

    const chart = window.globalState.klineChart;
    updateStatus(`正在應用 ${positionHistoryData.length} 筆倉位歷史標記...`);
    chart.removeOverlay({ groupId: POSITION_HISTORY_GROUP_ID }); // 先清除舊的

    if (positionHistoryData.length === 0) {
        updateStatus("沒有倉位歷史數據可供顯示。", 'info');
        return;
    }

    const overlayData = positionHistoryData.map(pos => {
        // 確保時間和價格有效
        const openTime = parseInt(pos.openTime);
        const closeTime = parseInt(pos.closeTime);
        const openPrice = parseFloat(pos.avgOpenPrice);
        const closePrice = parseFloat(pos.avgClosePrice);

        if (isNaN(openTime) || isNaN(closeTime) || isNaN(openPrice) || isNaN(closePrice) || openPrice <= 0 || closePrice <= 0) {
            console.warn("跳過無效的倉位歷史數據:", pos);
            return null;
        }

        return {
            name: 'positionHistoryMarker',
            groupId: POSITION_HISTORY_GROUP_ID,
            points: [
                { timestamp: openTime, value: openPrice }, // 開倉點
                { timestamp: closeTime, value: closePrice } // 平倉點
            ],
            lock: true,
            extendData: { // 傳遞給 overlay 回調的數據
                openSide: pos.openSide, // 'BUY' or 'SELL'
                pnl: pos.pnl,
                quantity: pos.quantity,
                avgOpenPrice: openPrice,
                avgClosePrice: closePrice,
                openTime: openTime,
                closeTime: closeTime,
                durationMs: pos.durationMs,
                commission: pos.commission,
                commissionAsset: pos.commissionAsset
                // 可以添加更多需要的數據
            }
        };
    }).filter(data => data !== null); // 過濾掉無效數據

    if (overlayData.length > 0) {
        try {
            chart.createOverlay(overlayData);
            updateStatus(`已應用 ${overlayData.length} 筆倉位歷史標記。`, 'success');
        } catch (e) {
            console.error("創建倉位歷史標記 Overlay 失敗:", e);
            updateStatus("創建倉位歷史標記失敗", "error");
        }
    } else {
         updateStatus("沒有有效的倉位歷史數據可供顯示。", 'info');
    }
}
// 將新函數掛載到 window
window.applyPositionHistoryMarks = applyPositionHistoryMarks;

// --- 新增：移除倉位歷史標記 ---
function removePositionHistoryMarks() {
    if (window.globalState && window.globalState.klineChart) {
        console.log("Removing position history marks overlay...");
        window.globalState.klineChart.removeOverlay({ groupId: POSITION_HISTORY_GROUP_ID });
        updateStatus("倉位歷史標記已隱藏", 'info');
    } else {
        console.warn("Chart not initialized, cannot remove position history marks.");
    }
}
// 將新函數掛載到 window
window.removePositionHistoryMarks = removePositionHistoryMarks;


// Removed event listener for the file input element

if (intervalButtons) {
    intervalButtons.forEach(button => {
        button.addEventListener('click', () => {
            intervalButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            const newInterval = button.getAttribute('data-interval');
            if (newInterval !== window.globalState.currentInterval) {
                window.globalState.currentInterval = newInterval;
                // Update global intervalMillis if other modules need it
                window.globalState.intervalMillis = getIntervalMillis(window.globalState.currentInterval);
                updateStatus(`正在切換時間間隔至 ${window.globalState.currentInterval}...`);
                if(window.globalState.klineChart) {
                    // Trigger data fetch which is now in this module
                    fetchAndApplyKlineData(window.globalState.currentSymbol, window.globalState.currentInterval).then(() => {
                        // *** 數據加載後重新應用倉位歷史標記 ***
                        const checkbox = document.getElementById('showHistoryCheckbox');
                        if (checkbox && checkbox.checked && window.globalState.positionHistoryData) {
                             applyPositionHistoryMarks(window.globalState.positionHistoryData);
                        }
                    });
                }
                 // Potentially notify market.js if it needs to resubscribe or adjust based on interval
                 // if (typeof handleIntervalChange === 'function') handleIntervalChange(newInterval);
            }
        });
    });
}

console.log("chart.js loaded");

// --- 持倉線繪製 ---
const POSITION_LINE_OVERLAY_ID = 'positionEntryLine';
const TAKE_PROFIT_LINE_ID = 'takeProfitLine';
const STOP_LOSS_LINE_ID = 'stopLossLine';

function updatePositionLine(entryPrice, positionSide) {
    if (!window.globalState || !window.globalState.klineChart) {
        console.warn("圖表尚未初始化，無法更新持倉線。");
        return;
    }

    const chart = window.globalState.klineChart;

    // 清除舊的持倉線 (如果存在)
    // 使用 removeOverlay(id) 而不是 groupId
    chart.removeOverlay(POSITION_LINE_OVERLAY_ID);

    // 如果沒有有效的進場價或持倉方向，則不繪製新線
    const price = parseFloat(entryPrice);
    if (isNaN(price) || price <= 0 || !positionSide) {
        console.log("清除持倉線。");
        return;
    }

    console.log(`繪製/更新持倉線: 價格 ${price}`); // 不再需要方向來決定顏色

    const lineColor = '#2196F3'; // *** 改為藍色 ***

    try {
        chart.createOverlay({
            id: POSITION_LINE_OVERLAY_ID, // 使用 ID 來唯一標識
            name: 'priceLine',
            lock: true, // 鎖定線條，不可拖動
            points: [{ value: price }], // 設定價格線的值
            styles: {
                line: {
                    style: 'dashed', // 虛線樣式
                    color: lineColor,
                    size: 1
                },
                text: { // 自訂價格標籤樣式
                    color: '#FFFFFF', // 白色文字
                    borderColor: lineColor, // 邊框顏色同線條
                    backgroundColor: lineColor, // 背景顏色同線條
                    size: 10, // 字體大小
                    family: 'Helvetica Neue', // 字體
                    marginLeft: 5, // 標籤左邊距
                    marginTop: 2, // 標籤上邊距
                    paddingLeft: 4, // 內邊距
                    paddingTop: 2,
                    paddingRight: 4,
                    paddingBottom: 2
                }
            }
        });
    } catch (e) {
        console.error("創建持倉線 Overlay 失敗:", e);
    }
}

// 將函數掛載到 window 使其全局可用
window.updatePositionLine = updatePositionLine;

// --- 止盈止損線繪製 ---
function updateTpSlLines(tpPriceStr, slPriceStr) {
    if (!window.globalState || !window.globalState.klineChart) {
        console.warn("圖表尚未初始化，無法更新止盈止損線。");
        return;
    }
    const chart = window.globalState.klineChart;
    const tpPrice = parseFloat(tpPriceStr);
    const slPrice = parseFloat(slPriceStr);

    // --- 處理止盈線 ---
    chart.removeOverlay(TAKE_PROFIT_LINE_ID); // 先移除舊線
    if (!isNaN(tpPrice) && tpPrice > 0) {
        console.log(`繪製/更新止盈線: 價格 ${tpPrice}`);
        try {
            chart.createOverlay({
                id: TAKE_PROFIT_LINE_ID,
                name: 'priceLine',
                lock: true,
                points: [{ value: tpPrice }],
                styles: {
                    line: { style: 'dotted', color: '#26a69a', size: 1 }, // *** 改為綠色點線 ***
                    text: {
                        color: '#FFFFFF',
                        borderColor: '#26a69a', // *** 改為綠色 ***
                        backgroundColor: '#26a69a', // *** 改為綠色 ***
                        size: 10, family: 'Helvetica Neue',
                        marginLeft: 5, marginTop: 2,
                        paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2
                    }
                }
            });
        } catch (e) { console.error("創建止盈線 Overlay 失敗:", e); }
    } else {
        console.log("清除止盈線。");
    }

    // --- 處理止損線 ---
    chart.removeOverlay(STOP_LOSS_LINE_ID); // 先移除舊線
    if (!isNaN(slPrice) && slPrice > 0) {
        console.log(`繪製/更新止損線: 價格 ${slPrice}`);
        try {
            chart.createOverlay({
                id: STOP_LOSS_LINE_ID,
                name: 'priceLine',
                lock: true,
                points: [{ value: slPrice }],
                styles: {
                    line: { style: 'dotted', color: '#ef5350', size: 1 }, // *** 改為紅色點線 ***
                    text: {
                        color: '#FFFFFF',
                        borderColor: '#ef5350', // *** 改為紅色 ***
                        backgroundColor: '#ef5350', // *** 改為紅色 ***
                        size: 10, family: 'Helvetica Neue',
                        marginLeft: 5, marginTop: 2,
                        paddingLeft: 4, paddingTop: 2, paddingRight: 4, paddingBottom: 2
                    }
                }
            });
        } catch (e) { console.error("創建止損線 Overlay 失敗:", e); }
    } else {
         console.log("清除止損線。");
    }
}

// 將新函數掛載到 window
window.updateTpSlLines = updateTpSlLines;

// --- 確保 formatNumber 和 formatCurrency 可用 ---
// 如果它們沒有在 script.js 中全局定義，需要在此處定義或從 trade.js 導入/複製
function formatCurrency(value, decimals = 2) {
    const prec = window.globalState?.pricePrecision ?? decimals;
    const num = parseFloat(value);
    return (isNaN(num) || num === 0) ? '未設定' : num.toFixed(prec);
}
function formatNumber(value, decimals = 3) {
    const prec = window.globalState?.quantityPrecision ?? decimals;
    const num = parseFloat(value);
    return isNaN(num) ? '-.---' : num.toFixed(prec);
}