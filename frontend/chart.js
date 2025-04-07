// frontend/chart.js

// --- DOM Elements (Chart related) ---
const chartContainer = document.getElementById('chart-container');
const fileInput = document.getElementById('fileInputControl'); // For trade marks
const intervalButtons = document.querySelectorAll('.interval-btn'); // For interval change
const tooltipElement = document.getElementById('trade-tooltip'); // For trade mark tooltip

// --- Chart State Variables (subset of original state) ---
// Assuming window.globalState is defined in the main script.js
// window.globalState.klineChart = null; // Managed within initChart
// window.globalState.allTrades = []; // Managed by parsing functions
const TRADE_MARKER_GROUP_ID = 'tradeMarkers';

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
        window.globalState.klineChart.createIndicator('MA', true, { id: 'candle_pane' });
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

        // Apply trade marks if they exist
        if (window.globalState.allTrades && window.globalState.allTrades.length > 0) {
            applyTradeMarks(window.globalState.allTrades);
        }
        // Trigger calculation update in trade module if needed
        if (typeof updateCalculations === 'function') {
             updateCalculations();
        }

    } else {
        window.globalState.klineChart.clearData();
        window.globalState.klineChart.removeOverlay({ groupId: TRADE_MARKER_GROUP_ID });
        updateStatus(`未獲取到 ${symbol} ${interval} K線數據。`, 'warning');
        window.globalState.currentCandle = null;
        window.globalState.currentMarkPrice = null;
        // Trigger calculation update in trade module if needed
         if (typeof updateCalculations === 'function') {
             updateCalculations();
        }
    }
}

// --- CSV/XLSX Parsing & Trade Marks ---
function parseCSV(file) {
    updateStatus(`正在解析 CSV 文件: ${file.name}...`);
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false, // Keep as strings initially
        complete: function(results) {
            console.log("CSV 解析完成:", results);
            if (results.errors.length > 0) {
                console.error("CSV 解析錯誤:", results.errors);
                updateStatus(`解析CSV出錯: ${results.errors[0].message}`, 'error');
                return;
            }
            if (results.data.length === 0) {
                updateStatus("CSV 文件為空", 'warning');
                return;
            }
            window.globalState.allTrades = results.data; // Store in global state
            updateStatus(`CSV 解析成功: ${window.globalState.allTrades.length} 筆`, 'success');
            if (window.globalState.klineChart) applyTradeMarks(window.globalState.allTrades);
        },
        error: function(error) {
            console.error("CSV 解析錯誤:", error);
            updateStatus(`解析CSV失敗: ${error.message}`, 'error');
        }
    });
}

function parseXLSX(file) {
    updateStatus(`正在解析 XLSX 文件: ${file.name}...`);
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = e.target.result;
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            // Convert dates during parsing if possible, or handle in applyTradeMarks
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { cellDates: true }); // Attempt to parse dates
            console.log("XLSX 解析完成:", jsonData);
            if (jsonData.length === 0) {
                updateStatus("XLSX 文件為空", 'warning');
                return;
            }
            window.globalState.allTrades = jsonData; // Store in global state
            updateStatus(`XLSX 解析成功: ${window.globalState.allTrades.length} 筆`, 'success');
            if (window.globalState.klineChart) applyTradeMarks(window.globalState.allTrades);
        } catch (error) {
            console.error("XLSX 解析錯誤:", error);
            updateStatus(`解析XLSX失敗: ${error.message}`, 'error');
        }
    };
    reader.onerror = function(ex) {
        console.error("讀取文件錯誤:", ex);
        updateStatus("讀取文件失敗", 'error');
    };
    reader.readAsArrayBuffer(file);
}

function applyTradeMarks(tradesData) {
    if (!window.globalState.klineChart) return;

    const relevantTrades = tradesData.map(row => {
        // Find keys robustly
        const dateKey = Object.keys(row).find(key => key.toLowerCase().includes('date') || key.toLowerCase().includes('time'));
        const sideKey = Object.keys(row).find(key => key.toLowerCase() === 'side');
        const priceKey = Object.keys(row).find(key => key.toLowerCase() === 'price');
        const symbolKey = Object.keys(row).find(key => key.toLowerCase() === 'symbol');
        const qtyKey = Object.keys(row).find(key => ['quantity', 'filled', 'qty', '成交數量'].some(k => key.toLowerCase().includes(k)));


        if (!dateKey || !sideKey || !priceKey || !symbolKey || !qtyKey ||
            row[dateKey] === undefined || row[sideKey] === undefined || row[priceKey] === undefined || row[symbolKey] === undefined || row[qtyKey] === undefined) {
             console.warn("跳過缺少必要欄位的交易紀錄:", row);
            return null;
        }

        // Symbol check
        if (String(row[symbolKey]).toUpperCase().trim() !== window.globalState.currentSymbol.toUpperCase()) {
            return null; // Skip trades for other symbols
        }

        // Date parsing
        let timestamp;
        const dateValue = row[dateKey];
        if (dateValue instanceof Date) {
            timestamp = dateValue.getTime(); // Already a Date object from XLSX parsing
        } else if (typeof dateValue === 'number' && dateValue > 10000 && dateValue < 60000) { // Excel date serial number
            try {
                // Excel epoch starts Dec 30, 1899 for compatibility reasons
                const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                timestamp = excelEpoch.getTime() + dateValue * 86400000; // Add days in milliseconds
            } catch (dateError) {
                console.warn(`無法解析 Excel 日期數字: ${dateValue}`, row);
                timestamp = NaN;
            }
        } else { // Attempt string parsing (assuming UTC or ISO format)
             let dateStr = String(dateValue).trim();
             // Add 'Z' if no timezone specified, assuming UTC
             if (!dateStr.includes('Z') && !dateStr.match(/[+-]\d{2}:?\d{2}$/)) {
                 dateStr = dateStr.replace(' ', 'T') + 'Z';
             }
             timestamp = Date.parse(dateStr);
        }

        if (isNaN(timestamp)) {
            console.warn(`跳過無效日期: ${row[dateKey]}`, row);
            return null;
        }

        // Price parsing
        const price = parseFloat(String(row[priceKey]).replace(/,/g, '')); // Handle potential commas
        if (isNaN(price)) {
            console.warn(`跳過無效價格: ${row[priceKey]}`, row);
            return null;
        }

        // Side parsing
        const side = String(row[sideKey]).toUpperCase().trim();
        if (side !== 'BUY' && side !== 'SELL') {
             console.warn(`跳過無效方向: ${row[sideKey]}`, row);
            return null;
        }

         // Quantity parsing
        const quantity = parseFloat(String(row[qtyKey]).replace(/,/g, ''));
        if (isNaN(quantity)) {
            console.warn(`跳過無效數量: ${row[qtyKey]}`, row);
            return null;
        }


        return {
            timestamp: timestamp,
            price: price,
            side: side,
            quantity: quantity, // Include quantity for potential future use in tooltip
            originalTrade: row // Keep original for tooltip
        };
    }).filter(trade => trade !== null);

    updateStatus(`正在應用 ${relevantTrades.length} 個歷史交易標記...`);
    window.globalState.klineChart.removeOverlay({ groupId: TRADE_MARKER_GROUP_ID });

    if (relevantTrades.length === 0) {
        updateStatus(`沒有找到 ${window.globalState.currentSymbol} 的歷史交易。`, 'info');
        return;
    }

    const overlayData = relevantTrades.map(trade => ({
        name: 'tradeMarker',
        groupId: TRADE_MARKER_GROUP_ID,
        points: [{ timestamp: trade.timestamp, value: trade.price }],
        lock: true,
        extendData: { // Data passed to overlay callbacks
             side: trade.side,
             quantity: trade.quantity,
             originalTrade: trade.originalTrade,
             timestamp: trade.timestamp // Pass timestamp for tooltip
        }
    }));

    if (overlayData.length > 0) {
        try {
            window.globalState.klineChart.createOverlay(overlayData);
            updateStatus(`已應用 ${overlayData.length} 個歷史交易標記。`, 'success');
        } catch (e) {
            console.error("創建標記錯誤:", e);
            updateStatus("創建交易標記失敗", "error");
        }
    }
}


// --- Custom Overlay Definition ---
// Needs to be registered once, typically in the main script or chart script
// Ensure klinecharts is available globally
if (typeof klinecharts !== 'undefined') {
    klinecharts.registerOverlay({
        name: 'tradeMarker',
        totalStep: 1,
        lock: true,
        needDefaultPointFigure: false, // We draw our own figure
        styles: { // Disable default selection highlighting
            polygon: { style: 'fill', color: 'transparent', borderColor: 'transparent', borderSize: 0 },
            circle: { style: 'fill', color: 'transparent', borderColor: 'transparent', borderSize: 0 },
            rect: { style: 'fill', color: 'transparent', borderColor: 'transparent', borderSize: 0 }
        },
        // Draw the triangle marker
        createPointFigures: ({ overlay, coordinates, barSpace }) => {
            if (coordinates.length === 0 || !coordinates[0]) { return []; }
            const point = coordinates[0];
            const side = overlay.extendData?.side;
            if (!side) return [];

            const triangleHeight = 8;
            const triangleBaseHalf = 4;
            const barH = barSpace.bar * 0.5; // Half bar width for centering offset
            const offset = barH + triangleHeight * 0.7; // Offset from price point

            let color;
            let points;

            if (side === 'BUY') {
                color = '#26a69a'; // Green for buy
                const yBase = point.y + offset; // Below the price point
                const yTip = yBase - triangleHeight;
                points = [
                    { x: point.x, y: yTip }, // Top point
                    { x: point.x - triangleBaseHalf, y: yBase }, // Bottom left
                    { x: point.x + triangleBaseHalf, y: yBase }  // Bottom right
                ];
            } else if (side === 'SELL') {
                color = '#ef5350'; // Red for sell
                const yBase = point.y - offset; // Above the price point
                const yTip = yBase + triangleHeight;
                points = [
                    { x: point.x, y: yTip }, // Bottom point
                    { x: point.x - triangleBaseHalf, y: yBase }, // Top left
                    { x: point.x + triangleBaseHalf, y: yBase }  // Top right
                ];
            } else {
                return []; // Unknown side
            }

            return [{
                type: 'polygon',
                attrs: { coordinates: points },
                styles: { style: 'fill', color: color }
            }];
        },
        // Tooltip handling
        onMouseEnter: (event) => {
            if (tooltipElement && event.overlay?.extendData) {
                const data = event.overlay.extendData;
                const trade = data.originalTrade; // Original row data
                const dateKey = Object.keys(trade).find(key => key.toLowerCase().includes('date') || key.toLowerCase().includes('time'));

                // Format timestamp from extendData
                let formattedTime = 'N/A';
                if (data.timestamp) {
                     try {
                         formattedTime = new Date(data.timestamp).toLocaleString(); // Use local time format
                     } catch (e) { console.warn("Error formatting timestamp for tooltip:", data.timestamp); }
                }

                let tooltipContent = `時間: ${formattedTime}\n`;
                tooltipContent += `方向: ${data.side || 'N/A'}\n`;
                tooltipContent += `價格: ${trade.Price || trade.price || 'N/A'}\n`; // Access original price string if needed
                tooltipContent += `數量: ${data.quantity || 'N/A'}\n`; // Use parsed quantity

                tooltipElement.innerHTML = tooltipContent.replace(/\n/g, '<br>'); // Use <br> for HTML
                tooltipElement.style.display = 'block';

                // Position tooltip near cursor
                const offsetX = 15;
                const offsetY = 10;
                const chartRect = chartContainer.getBoundingClientRect();
                let left = event.pointerCoordinate.x + offsetX + chartRect.left + window.scrollX;
                let top = event.pointerCoordinate.y + offsetY + chartRect.top + window.scrollY;

                // Adjust if tooltip goes off-screen
                const tooltipRect = tooltipElement.getBoundingClientRect();
                // Check right boundary BEFORE checking left, as adjusting left might fix right
                if (left + tooltipRect.width > window.innerWidth) {
                    left = event.pointerCoordinate.x - tooltipRect.width - offsetX + chartRect.left + window.scrollX;
                }
                 // Check bottom boundary BEFORE checking top
                if (top + tooltipRect.height > window.innerHeight) {
                    top = event.pointerCoordinate.y - tooltipRect.height - offsetY + chartRect.top + window.scrollY;
                }
                // Check left boundary
                if (left < window.scrollX) { // Use window.scrollX for absolute positioning
                     left = window.scrollX + 5;
                }
                 // Check top boundary
                if (top < window.scrollY) { // Use window.scrollY
                     top = window.scrollY + 5;
                }


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


// --- Event Listeners (Chart related) ---
if (fileInput) {
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            updateStatus(`已選擇文件: ${file.name}，準備處理...`);
            const fileName = file.name.toLowerCase();
            window.globalState.allTrades = []; // Clear previous trades
            if(window.globalState.klineChart) window.globalState.klineChart.removeOverlay({ groupId: TRADE_MARKER_GROUP_ID });

            if (fileName.endsWith('.csv')) {
                parseCSV(file);
            } else if (fileName.endsWith('.xlsx')) {
                parseXLSX(file);
            } else {
                updateStatus("不支援的文件類型", 'error');
            }
        }
        event.target.value = null; // Reset file input
    });
}

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
                    fetchAndApplyKlineData(window.globalState.currentSymbol, window.globalState.currentInterval);
                }
                 // Potentially notify market.js if it needs to resubscribe or adjust based on interval
                 // if (typeof handleIntervalChange === 'function') handleIntervalChange(newInterval);
            }
        });
    });
}

console.log("chart.js loaded");