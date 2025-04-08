// frontend/trade.js

// --- DOM Elements (Trade Panel related) ---
const tradeSymbolSpan = document.getElementById('trade-symbol');
const leverageInput = document.getElementById('leverage-input');
const setLeverageBtn = document.getElementById('set-leverage-btn');
const availableBalanceSpan = document.getElementById('available-balance');
const quantityInput = document.getElementById('quantity-input');
const quantitySlider = document.getElementById('quantity-slider'); // 新增：獲取拉桿元素
const quantityPercentageSpan = document.getElementById('quantity-percentage'); // 新增：獲取百分比顯示元素
const reduceOnlyCheckbox = document.getElementById('reduce-only-checkbox');
const maxOrderSizeSpan = document.getElementById('max-order-size');
const marginRequiredSpan = document.getElementById('margin-required');
const takeProfitInput = document.getElementById('take-profit-input'); // 新增
const stopLossInput = document.getElementById('stop-loss-input');   // 新增
const buyLongBtn = document.getElementById('buy-long-btn');
const sellShortBtn = document.getElementById('sell-short-btn');
const positionCountSpan = document.getElementById('position-count');
const positionDetailsDiv = document.getElementById('position-details');
const quantityUnitSpan = quantityInput ? quantityInput.nextElementSibling : null; // Handle potential null
const closeAllBtn = document.getElementById('close-all-btn');
const closeHalfBtn = document.getElementById('close-half-btn');
const positionActionsContainer = document.getElementById('position-actions-container');

// --- Trade State Variables (subset of original state) ---
// Assuming window.globalState is defined in the main script.js
// window.globalState.usdtBalance = 0; // Managed here
// window.globalState.positionInfo = null; // Managed here
// window.globalState.currentLeverage = 10; // Managed here

// --- Helper Functions (Trade related) ---
// Ensure formatCurrency and formatNumber are available globally or defined here
function formatCurrency(value, decimals = 2) {
    // Ensure globalState and pricePrecision are available
    const prec = window.globalState?.pricePrecision ?? decimals;
    const num = parseFloat(value);
    // 恢復原始邏輯：0 或 NaN 都顯示 '未設定'
    return (isNaN(num) || num === 0) ? '未設定' : num.toFixed(prec);
}
function formatNumber(value, decimals = 3) {
    // Ensure globalState and quantityPrecision are available
    const prec = window.globalState?.quantityPrecision ?? decimals;
    const num = parseFloat(value);
    return isNaN(num) ? '-.---' : num.toFixed(prec);
}


// --- Backend API Interaction (Consider moving fetchFromBackend to a shared utility module) ---
// Assuming fetchFromBackend is available globally for now
// async function fetchFromBackend(endpoint, options = {}) { ... }

// --- Fetch Initial Data from Backend ---
async function fetchInitialData() {
    // Ensure updateStatus and fetchFromBackend are available
    if (typeof updateStatus !== 'function' || typeof fetchFromBackend !== 'function') {
        console.error("Required functions (updateStatus, fetchFromBackend) not available.");
        return;
    }
     if (!window.globalState) {
        console.error("Global state not initialized before fetching initial data.");
        return;
    }
    updateStatus("正在從後端獲取初始數據...", 'info');
    const [balanceData, positionData] = await Promise.all([
        fetchFromBackend('/balance'),
        fetchFromBackend(`/position?symbol=${window.globalState.currentSymbol}`)
    ]);
    updateAccountPanel(balanceData, positionData);
    fetchAndSetCurrentLeverage(); // Fetch leverage after position data is available
}

// --- Update UI Elements ---
function updateAccountPanel(balanceData, positionRiskData) {
     if (!window.globalState) {
        console.error("Global state not initialized in updateAccountPanel.");
        return;
    }
    console.log("後端返回的原始倉位數據 (positionRiskData):", JSON.stringify(positionRiskData, null, 2));

    // Update Available Balance
    if (balanceData && Array.isArray(balanceData)) {
        const usdtAsset = balanceData.find(asset => asset.asset === 'USDT');
        window.globalState.usdtBalance = usdtAsset ? parseFloat(usdtAsset.availableBalance) : 0;
        if (availableBalanceSpan) {
            availableBalanceSpan.textContent = `${formatNumber(window.globalState.usdtBalance, window.globalState.pricePrecision)} USDT`;
        }
    } else {
        window.globalState.usdtBalance = 0;
        if (availableBalanceSpan) {
            availableBalanceSpan.textContent = "-.-- USDT";
        }
    }

    // Update Position Details
    if (positionDetailsDiv) positionDetailsDiv.innerHTML = ''; // Clear previous details
    let positionFound = false;

    if (positionRiskData && Array.isArray(positionRiskData)) {
        window.globalState.positionInfo = positionRiskData; // Store latest position info globally
        const currentPosition = positionRiskData.find(p => p.symbol === window.globalState.currentSymbol && parseFloat(p.positionAmt) !== 0);

        if (currentPosition) {
            positionFound = true;
            if (positionCountSpan) positionCountSpan.textContent = '1';

            const posAmt = parseFloat(currentPosition.positionAmt);
            const entryPrice = parseFloat(currentPosition.entryPrice);
            const markPrice = parseFloat(currentPosition.markPrice); // Use mark price from position data
            const pnl = parseFloat(currentPosition.unRealizedProfit);
            const leverage = parseInt(currentPosition.leverage);
            const liqPrice = parseFloat(currentPosition.liquidationPrice);
            const takeProfitPrice = currentPosition.takeProfitPrice; // May be "0.0000" or actual price
            const stopLossPrice = currentPosition.stopLossPrice;   // May be "0.0000" or actual price

            // Update global mark price if available from position data
            if (!isNaN(markPrice)) {
                window.globalState.currentMarkPrice = markPrice;
            }

            // Calculate margin (use isolatedWallet or initialMargin if available and valid)
            let estimatedMargin = parseFloat(currentPosition.isolatedWallet);
            if (isNaN(estimatedMargin) || estimatedMargin <= 0) {
                estimatedMargin = parseFloat(currentPosition.initialMargin);
                if (isNaN(estimatedMargin) || estimatedMargin <= 0) {
                    // Fallback calculation (might be less accurate for isolated margin)
                    estimatedMargin = Math.abs(posAmt * entryPrice / leverage);
                }
            }
             console.log(`保證金計算 - estimatedMargin (最終): ${estimatedMargin}`);

            const pnlPercent = estimatedMargin > 0 ? (pnl / estimatedMargin) * 100 : 0; // Use estimatedMargin for PNL %


            if (positionDetailsDiv) {
                positionDetailsDiv.innerHTML = `
                    <div class="panel-row"><label>持倉數量 (${quantityUnitSpan?.textContent || '?'})</label><span class="value">${formatNumber(posAmt, window.globalState.quantityPrecision)}</span></div>
                    <div class="panel-row"><label>開倉價格 (USDT)</label><span class="value">${formatCurrency(entryPrice, window.globalState.pricePrecision)}</span></div>
                    <div class="panel-row"><label>標記價格 (USDT)</label><span class="value">${formatCurrency(markPrice, window.globalState.pricePrecision)}</span></div>
                    <div class="panel-row"><label>未實現盈虧 (USDT)</label><span class="pnl-container"><span id="realtime-pnl-value" class="value position-pnl ${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}</span> (<span id="realtime-pnl-percent" class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${formatCurrency(pnlPercent)}%</span>)</span></div>
                    <div class="panel-row"><label>預估強平價 (USDT)</label><span class="value">${formatCurrency(liqPrice, window.globalState.pricePrecision)}</span></div>
                    <div class="panel-row"><label>保證金 (USDT)</label><span class="value">${formatCurrency(estimatedMargin)}</span></div>
                    <div class="panel-row"><label>槓桿</label><span class="value">${leverage}x</span></div>
                    <div class="panel-row">
                        <label>止盈價 (USDT)</label>
                        ${createPnlInfoHtml(takeProfitPrice, entryPrice, posAmt, estimatedMargin)} <span class="value editable-price"
                              data-type="tp"
                              data-symbol="${currentPosition.symbol}"
                              data-entry-price="${entryPrice}"
                              data-pos-amt="${posAmt}"
                              data-margin="${estimatedMargin}"
                              data-leverage="${leverage}">${formatCurrency(takeProfitPrice, window.globalState.pricePrecision)}</span>
                    </div>
                    <div class="panel-row">
                        <label>止損價 (USDT)</label>
                        ${createPnlInfoHtml(stopLossPrice, entryPrice, posAmt, estimatedMargin)} <span class="value editable-price"
                              data-type="sl"
                              data-symbol="${currentPosition.symbol}"
                              data-entry-price="${entryPrice}"
                              data-pos-amt="${posAmt}"
                              data-margin="${estimatedMargin}"
                              data-leverage="${leverage}">${formatCurrency(stopLossPrice, window.globalState.pricePrecision)}</span>
                    </div>
                `;
                // *** 新增：更新圖表上的持倉線 ***
                const positionSide = posAmt > 0 ? 'long' : 'short';
                // *** 更新圖表上的持倉線 ***
                // 移除重複宣告，positionSide 已在上方定義
                if (typeof window.updatePositionLine === 'function') {
                    window.updatePositionLine(entryPrice, positionSide);
                }
                // *** 新增：更新圖表上的止盈止損線 ***
                if (typeof window.updateTpSlLines === 'function') {
                    const tp = currentPosition.takeProfitPrice;
                    const sl = currentPosition.stopLossPrice;
                    console.log(`[trade.js] updateAccountPanel: 找到持倉，準備更新 TP/SL 線。 TP=${tp}, SL=${sl}`); // <--- 加入日誌
                    window.updateTpSlLines(tp, sl);
                }
                // ******************************
            }
        }
    }

    // Control visibility of action buttons
    if (positionActionsContainer) {
        positionActionsContainer.style.display = positionFound ? 'flex' : 'none';
    }

    if (!positionFound) {
        // Still store position data even if no active position (might contain leverage info)
        window.globalState.positionInfo = positionRiskData;
        if (positionCountSpan) positionCountSpan.textContent = '0';
        if (positionDetailsDiv) positionDetailsDiv.innerHTML = '<div class="no-position">沒有持倉</div>';
        // *** 新增：清除圖表上的持倉線 ***
        // *** 清除圖表上的持倉線 ***
        if (typeof window.updatePositionLine === 'function') {
            window.updatePositionLine(null, null);
        }
        // *** 新增：清除圖表上的止盈止損線 ***
        if (typeof window.updateTpSlLines === 'function') {
            window.updateTpSlLines(null, null);
        }
        // ******************************
    }

    updateCalculations(); // Update margin/max size calculations
}

function fetchAndSetCurrentLeverage() {
     if (!window.globalState) {
        console.error("Global state not initialized in fetchAndSetCurrentLeverage.");
        return;
    }
    const positionInfo = window.globalState.positionInfo;
    if (!positionInfo || !Array.isArray(positionInfo) || positionInfo.length === 0) {
        console.log("前端: 沒有持倉數據可用於設定槓桿顯示。");
        // Optionally set a default leverage display if needed
        // if (leverageInput) leverageInput.value = window.globalState.currentLeverage;
        return;
    }
    const currentSymbolPosition = positionInfo.find(p => p.symbol === window.globalState.currentSymbol);
    if (currentSymbolPosition && currentSymbolPosition.leverage) {
        const fetchedLeverage = parseInt(currentSymbolPosition.leverage);
        if (!isNaN(fetchedLeverage)) {
            window.globalState.currentLeverage = fetchedLeverage;
            if (leverageInput) leverageInput.value = window.globalState.currentLeverage;
            console.log(`前端: ${window.globalState.currentSymbol} 的當前槓桿更新為 ${window.globalState.currentLeverage}x`);
            updateCalculations(); // Recalculate based on fetched leverage
        }
    } else {
        console.warn(`前端: 在持倉數據中找不到 ${window.globalState.currentSymbol} 的槓桿資訊。使用預設值 ${window.globalState.currentLeverage}x`);
        // Keep existing leverage value in input and global state
         if (leverageInput) leverageInput.value = window.globalState.currentLeverage;
         updateCalculations();
    }
}

// --- Actions Triggered by UI ---
async function handleChangeLeverage() {
    if (!leverageInput || !window.globalState) return;
    const newLeverage = parseInt(leverageInput.value);
    if (isNaN(newLeverage) || newLeverage < 1 || newLeverage > 125) {
        updateStatus("無效的槓桿值 (1-125)", "warning");
        fetchAndSetCurrentLeverage(); // Reset to actual current leverage
        return;
    }
    updateStatus(`正在請求後端設定 ${window.globalState.currentSymbol} 槓桿為 ${newLeverage}x...`, "info");
    const result = await fetchFromBackend('/leverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: window.globalState.currentSymbol, leverage: newLeverage })
    });
    if (result) {
        updateStatus(`${window.globalState.currentSymbol} 槓桿已成功設定為 ${result.leverage}x`, "success");
        window.globalState.currentLeverage = parseInt(result.leverage); // Update global state
        if (leverageInput) leverageInput.value = window.globalState.currentLeverage;
        // Re-fetch data to ensure UI consistency after leverage change (optional, WS update might suffice)
        fetchInitialData();
    } else {
        updateStatus("設定槓桿失敗", "error");
        fetchAndSetCurrentLeverage(); // Reset to actual current leverage on failure
    }
}

async function placeMarketOrder(side) {
    if (!quantityInput || !reduceOnlyCheckbox || !window.globalState) return;
    const quantity = parseFloat(quantityInput.value);
    if (isNaN(quantity) || quantity <= 0) {
        updateStatus("請輸入有效的訂單數量", "warning");
        return;
    }
    const formattedQuantity = quantity.toFixed(window.globalState.quantityPrecision);
    // Strict precision check
    if (Math.abs(parseFloat(formattedQuantity) - quantity) > (1 / Math.pow(10, window.globalState.quantityPrecision + 1)) ) {
        updateStatus(`數量精度不符，請使用 ${window.globalState.quantityPrecision} 位小數 (e.g., ${formattedQuantity})`, "warning");
        quantityInput.value = formattedQuantity; // Correct the input value
        return;
    }

    const reduceOnly = reduceOnlyCheckbox.checked;
    const orderParams = {
        symbol: window.globalState.currentSymbol,
        side: side,
        type: 'MARKET',
        quantity: formattedQuantity
    };
    if (reduceOnly) {
        orderParams.reduceOnly = 'true';
    }

    updateStatus(`正在請求後端提交 ${side === 'BUY' ? '買入' : '賣出'} 市價單...`, "info");
    const result = await fetchFromBackend('/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderParams)
    });

    if (result && result.orderId) {
        updateStatus(`後端回報訂單提交成功 (ID: ${result.orderId}, Status: ${result.status})`, "success");
        quantityInput.value = ''; // Clear quantity input on success
        reduceOnlyCheckbox.checked = false; // Uncheck reduceOnly

        // --- 新增：下單成功後嘗試設定止盈止損 ---
        const tpPriceStr = takeProfitInput?.value.trim();
        const slPriceStr = stopLossInput?.value.trim();
        const tpPrice = parseFloat(tpPriceStr);
        const slPrice = parseFloat(slPriceStr);

        // 延遲一點時間確保倉位資訊已更新 (或等待 WebSocket 更新後再觸發)
        // 這裡先用簡單的 setTimeout，更好的方式是監聽倉位更新事件
        setTimeout(async () => {
            // 重新獲取最新的倉位資訊，確保有 entryPrice 和 posAmt
            // 注意：這裡假設 fetchInitialData 會更新 globalState.positionInfo
            // 並且 setStopOrder 能從 globalState 或參數獲取必要資訊
            // 為了簡化，這裡直接嘗試調用，setStopOrder 內部需要能處理倉位不存在的情況
            const currentSymbol = window.globalState?.currentSymbol;
            if (!currentSymbol) return;

            if (!isNaN(tpPrice) && tpPrice > 0) {
                console.log(`嘗試為新訂單設定止盈: ${tpPrice}`);
                await setStopOrder(currentSymbol, 'tp', tpPrice.toFixed(window.globalState.pricePrecision));
                if (takeProfitInput) takeProfitInput.value = ''; // 清空輸入
            }
            if (!isNaN(slPrice) && slPrice > 0) {
                console.log(`嘗試為新訂單設定止損: ${slPrice}`);
                await setStopOrder(currentSymbol, 'sl', slPrice.toFixed(window.globalState.pricePrecision));
                if (stopLossInput) stopLossInput.value = ''; // 清空輸入
            }
        }, 1500); // 延遲 1.5 秒等待後端和 WS 更新
        // -----------------------------------------

    } else {
        updateStatus("下單請求失敗", "error");
        // Optionally provide more details if available in the error response
    }
}

function updateCalculations() {
    if (!quantityInput || !leverageInput || !marginRequiredSpan || !maxOrderSizeSpan || !quantityUnitSpan || !window.globalState) return;

    const quantity = parseFloat(quantityInput.value) || 0;
    // Use global leverage state as the source of truth, fallback to input if needed
    const leverage = window.globalState.currentLeverage || parseInt(leverageInput.value) || 1;
    const price = window.globalState.currentMarkPrice || window.globalState.currentCandle?.close || 0; // Use global mark price

    let requiredMargin = 0;
    if (quantity > 0 && price > 0 && leverage > 0) {
        requiredMargin = (quantity * price) / leverage;
    }
    marginRequiredSpan.textContent = `${formatCurrency(requiredMargin, window.globalState.pricePrecision)} USDT`;

    let maxOrderSize = 0;
    // Use global balance state
    if (window.globalState.usdtBalance > 0 && price > 0 && leverage > 0) {
        // Consider a buffer (e.g., 95%) for available balance
        maxOrderSize = (window.globalState.usdtBalance * 0.95 * leverage) / price;
    }
    maxOrderSizeSpan.textContent = `${formatNumber(maxOrderSize, window.globalState.quantityPrecision)} ${quantityUnitSpan?.textContent || '...'}`;
    // 新增：當最大可開數量更新時，也可能需要更新拉桿狀態（如果數量輸入框有值）
    updateSliderFromQuantity(); // 調用反向更新函數
}

// --- 新增/恢復：更新交易面板上的交易對符號並觸發訂閱 ---
function updateTradePanelSymbol() {
    if (!tradeSymbolSpan || !window.globalState) {
        console.error("無法更新交易面板符號：缺少元素或全局狀態。");
        return;
    }
    const currentSymbol = window.globalState.currentSymbol;
    tradeSymbolSpan.textContent = currentSymbol;

    // 更新數量輸入框旁邊的單位 (例如 BTC)
    if (quantityUnitSpan && currentSymbol.endsWith('USDT')) {
        const baseAsset = currentSymbol.replace('USDT', '');
        quantityUnitSpan.textContent = baseAsset;
    }

    // 觸發市場數據訂閱 (在 market.js 中定義)
    if (typeof subscribeToMarket === 'function') {
        console.log(`[trade.js] updateTradePanelSymbol: 觸發訂閱 ${currentSymbol}`);
        subscribeToMarket(currentSymbol);
    } else {
        console.error("[trade.js] updateTradePanelSymbol: subscribeToMarket 函數未找到！");
    }
}

// --- Handle Close Position ---
async function handleClosePosition(closeFraction) {
     if (!window.globalState) {
        console.error("Global state not initialized in handleClosePosition.");
        return;
    }
    const positionInfo = window.globalState.positionInfo;
    if (!positionInfo || !Array.isArray(positionInfo)) {
        updateStatus("無法獲取持倉信息", "warning");
        return;
    }
    const currentPosition = positionInfo.find(p => p.symbol === window.globalState.currentSymbol && parseFloat(p.positionAmt) !== 0);

    if (!currentPosition) {
        updateStatus("當前沒有持倉", "info");
        return;
    }

    const posAmt = parseFloat(currentPosition.positionAmt);
    const side = posAmt > 0 ? 'SELL' : 'BUY'; // Determine closing side
    let quantityToClose = Math.abs(posAmt) * closeFraction;

    // Ensure quantity precision matches requirements
    const formattedQuantity = quantityToClose.toFixed(window.globalState.quantityPrecision);
    if (parseFloat(formattedQuantity) <= 0) {
         updateStatus("計算出的平倉數量過小或為零", "warning");
         return;
    }

    const actionText = closeFraction === 1 ? '全平倉' : `平倉 ${closeFraction * 100}%`;
    updateStatus(`正在請求後端 ${actionText} (${side} ${formattedQuantity})...`, "info");

    const orderParams = {
        symbol: window.globalState.currentSymbol,
        side: side,
        type: 'MARKET',
        quantity: formattedQuantity,
        reduceOnly: 'true' // Ensure it's a reduce-only order
    };

    const result = await fetchFromBackend('/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderParams)
    });

    if (result && result.orderId) {
        updateStatus(`後端回報 ${actionText} 訂單提交成功 (ID: ${result.orderId}, Status: ${result.status})`, "success");
        // UI update will happen via WebSocket userUpdate
    } else {
        updateStatus(`${actionText} 請求失敗`, "error");
    }
}

// --- Helper Function for PNL Info ---
function createPnlInfoHtml(targetPrice, entryPrice, posAmt, margin) {
    // Ensure targetPrice is a valid number greater than 0 for calculation
    const priceNum = parseFloat(targetPrice);
    if (isNaN(priceNum) || priceNum <= 0 || isNaN(entryPrice) || isNaN(posAmt) || posAmt === 0 || isNaN(margin) || margin <= 0) {
        return ''; // Cannot calculate if price is invalid, 0, or other data is missing
    }

    // Basic logical validation (simplified for display context)
    // We calculate PNL regardless of whether it's a "valid" TP/SL relative to entry,
    // as the display should reflect the PNL *at that price*.
    // The actual order placement logic handles the strict validation.

    const profitAmount = (priceNum - entryPrice) * posAmt;
    const pnlPercent = (profitAmount / margin) * 100;

    // Use formatCurrency for consistency, handling potential NaN/0 from calculation itself if needed
    const formattedAmount = `${profitAmount >= 0 ? '+' : ''}${formatCurrency(profitAmount)}`;
    const formattedPercent = `${pnlPercent >= 0 ? '+' : ''}${formatCurrency(pnlPercent)}%`; // Use formatCurrency for percentage too
    const pnlClass = profitAmount >= 0 ? 'positive' : 'negative';

    // Add a specific class for easier selection/removal
    return ` <span class="price-pnl-info static-pnl-info ${pnlClass}">(${formattedAmount} / ${formattedPercent})</span>`;
}


// --- Editable Prices (TP/SL) ---
function makePriceEditable(spanElement) {
    if (!spanElement || !spanElement.parentNode || !window.globalState) return;

    // Prevent creating multiple inputs
    if (spanElement.parentNode.querySelector('.editable-price-input')) {
        return;
    }

    const currentPriceText = spanElement.textContent.trim();
    const type = spanElement.dataset.type; // 'tp' or 'sl'
    const symbol = spanElement.dataset.symbol;
    const entryPrice = parseFloat(spanElement.dataset.entryPrice);
    const posAmt = parseFloat(spanElement.dataset.posAmt);
    const margin = parseFloat(spanElement.dataset.margin); // 從 data 屬性獲取保證金
    // const leverage = parseInt(spanElement.dataset.leverage); // 槓桿暫時不用，因為保證金已提供

    // Create info span element (for PNL display)
    const infoSpan = document.createElement('span');
    // Add a class to distinguish temporary info span from static one
    infoSpan.className = 'editable-price-info temporary-pnl-info';
    infoSpan.style.marginRight = '5px'; // Add some space
    infoSpan.style.fontSize = '0.9em';
    infoSpan.style.color = '#888'; // Lighter color

    // Create input element
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'editable-price-input';
    const currentPriceNum = parseFloat(currentPriceText.replace(/,/g, '')); // Handle potential commas
    input.value = (isNaN(currentPriceNum) || currentPriceNum === 0) ? '' : currentPriceNum.toFixed(window.globalState.pricePrecision);
    input.step = (1 / Math.pow(10, window.globalState.pricePrecision)).toFixed(window.globalState.pricePrecision);
    input.style.width = '80px';
    input.placeholder = "輸入價格";

    // Hide original span and any static PNL info before it
    spanElement.style.display = 'none';
    const staticPnlInfo = spanElement.previousElementSibling;
    if (staticPnlInfo && staticPnlInfo.classList.contains('static-pnl-info')) {
        staticPnlInfo.style.display = 'none';
    }

    // Insert temporary infoSpan and input before the hidden original span
    // infoSpan goes first, then input, both before the original spanElement
    spanElement.parentNode.insertBefore(infoSpan, spanElement);
    spanElement.parentNode.insertBefore(input, infoSpan.nextSibling); // Input goes *after* the temporary info span
    input.focus();
    input.select();

    // --- Function to calculate and display PNL ---
    const updatePnlInfo = () => {
        const newPriceStr = input.value.trim();
        const newPriceNum = parseFloat(newPriceStr);
        infoSpan.textContent = ''; // Clear previous info

        if (isNaN(newPriceNum) || newPriceNum <= 0 || isNaN(entryPrice) || isNaN(posAmt) || posAmt === 0 || isNaN(margin) || margin <= 0) {
            return; // Not enough data or invalid input
        }

        // Basic logical validation (same as in handleInputComplete)
        let validationError = null;
        if (posAmt > 0) { // Long
            if (type === 'tp' && newPriceNum <= entryPrice) validationError = "低於開倉";
            else if (type === 'sl' && newPriceNum >= entryPrice) validationError = "高於開倉";
        } else { // Short
            if (type === 'tp' && newPriceNum >= entryPrice) validationError = "高於開倉";
            else if (type === 'sl' && newPriceNum <= entryPrice) validationError = "低於開倉";
        }

        if (validationError) {
            infoSpan.textContent = `(${validationError})`;
            infoSpan.style.color = 'orange';
            return;
        }

        const profitAmount = (newPriceNum - entryPrice) * posAmt;
        const pnlPercent = (profitAmount / margin) * 100;

        const formattedAmount = `${profitAmount >= 0 ? '+' : ''}${formatCurrency(profitAmount)}`;
        const formattedPercent = `${pnlPercent >= 0 ? '+' : ''}${formatCurrency(pnlPercent)}%`;

        infoSpan.textContent = `(${formattedAmount} / ${formattedPercent})`;
        infoSpan.style.color = profitAmount >= 0 ? 'var(--profit-color)' : 'var(--loss-color)';
    };

    // Initial PNL calculation for the current value (if any)
    updatePnlInfo();

    // Add input event listener
    input.addEventListener('input', updatePnlInfo);

    // --- Input Event Handlers ---
    const handleInputComplete = async (eventTrigger) => {
        // Remove listeners to prevent multiple triggers
        input.removeEventListener('blur', handleBlur);
        input.removeEventListener('keydown', handleKeydown);
        input.removeEventListener('input', updatePnlInfo); // Remove input listener

        const newPriceStr = input.value.trim();
        // Remove temporary infoSpan and input
        const tempInfoSpan = input.previousElementSibling; // infoSpan is before input
        if (tempInfoSpan && tempInfoSpan.classList.contains('temporary-pnl-info')) {
             if (document.body.contains(tempInfoSpan)) tempInfoSpan.remove();
        }
        if (document.body.contains(input)) { // Remove input
             input.remove();
        }

        // Make original span visible again
        if (document.body.contains(spanElement)) {
            spanElement.style.display = '';
        }
        // Make original static PNL (if exists and was hidden) visible again
        // It will be removed/updated in the next step if necessary.
        const originalStaticPnl = spanElement.previousElementSibling;
        if (originalStaticPnl && originalStaticPnl.classList.contains('static-pnl-info')) {
             originalStaticPnl.style.display = '';
        }


        const newPriceNum = parseFloat(newPriceStr);
        const oldPriceNum = parseFloat(currentPriceText.replace(/,/g, '')); // NaN if '未設定'

        // --- Validation ---
        const priceChanged = isNaN(oldPriceNum) ? !isNaN(newPriceNum) : Math.abs(newPriceNum - oldPriceNum) >= (1 / Math.pow(10, window.globalState.pricePrecision + 1));
        const isValidPriceFormat = !isNaN(newPriceNum) && newPriceNum >= 0; // Allow 0 for cancellation
        const isEmptyInput = newPriceStr === '';

        // If input is not empty, but format is invalid or price hasn't changed significantly, revert.
        if (!isEmptyInput && (!isValidPriceFormat || !priceChanged)) {
            if (document.body.contains(spanElement)) spanElement.textContent = currentPriceText; // Revert display
            console.log(`價格未改變或格式無效 (${newPriceStr})，取消設定。`);
            return;
        }

        // Treat empty input or 0 as cancellation
        const priceToSend = (isEmptyInput || newPriceNum === 0) ? 0 : newPriceNum;

        // --- Logical Price Validation (only if setting a price, not cancelling) ---
        if (priceToSend !== 0 && !isNaN(entryPrice) && !isNaN(posAmt) && posAmt !== 0) {
            let validationError = null;
            if (posAmt > 0) { // Long position
                if (type === 'tp' && priceToSend <= entryPrice) validationError = "多單止盈價必須高於開倉價";
                else if (type === 'sl' && priceToSend >= entryPrice) validationError = "多單止損價必須低於開倉價";
            } else { // Short position (posAmt < 0)
                if (type === 'tp' && priceToSend >= entryPrice) validationError = "空單止盈價必須低於開倉價";
                else if (type === 'sl' && priceToSend <= entryPrice) validationError = "空單止損價必須高於開倉價";
            }

            if (validationError) {
                updateStatus(validationError, 'warning');
                 if (document.body.contains(spanElement)) spanElement.textContent = currentPriceText; // Revert display
                console.log(`價格邏輯驗證失敗: ${validationError}`);
                return;
            }
        }

        // --- Avoid redundant API calls ---
        // If cancelling (priceToSend is 0), but original was already 0 or '未設定'
        if (priceToSend === 0 && (isNaN(oldPriceNum) || oldPriceNum === 0)) {
             if (document.body.contains(spanElement)) spanElement.textContent = formatCurrency(0, window.globalState.pricePrecision); // Show '未設定'
            console.log(`無需取消，原價格已為 0 或未設定。`);
            return;
        }
        // If price hasn't effectively changed (handles NaN case and numeric equality)
        if ((isNaN(priceToSend) && isNaN(oldPriceNum)) || (priceToSend === oldPriceNum && !isEmptyInput)) {
             if (document.body.contains(spanElement)) spanElement.textContent = currentPriceText; // Revert display
             console.log(`價格未改變 (${priceToSend})，無需設定。`);
             return;
        }

        // --- Remove potential old static PNL info *before* the span ---
        const existingStaticPnlInfo = spanElement.previousElementSibling;
        if (existingStaticPnlInfo && existingStaticPnlInfo.classList.contains('static-pnl-info')) {
            if (document.body.contains(existingStaticPnlInfo)) existingStaticPnlInfo.remove();
        }

        // --- API Call ---
        const actionText = priceToSend === 0 ? '取消' : '設定';
        const displayPriceForStatus = formatCurrency(priceToSend, window.globalState.pricePrecision); // Use formatted for status message
        updateStatus(`正在${actionText} ${symbol} ${type.toUpperCase()} 價格${priceToSend === 0 ? '' : '為 ' + displayPriceForStatus}...`, 'info');

        const success = await setStopOrder(symbol, type, priceToSend.toFixed(window.globalState.pricePrecision));

        // --- Final UI Update ---
        if (document.body.contains(spanElement)) { // Check if span still exists
            if (success) {
                const finalDisplayPrice = formatCurrency(priceToSend, window.globalState.pricePrecision);
                spanElement.textContent = finalDisplayPrice; // Update main price display

                // Add the new static PNL info span *before* the price span if setting a price (priceToSend > 0)
                const pnlHtml = createPnlInfoHtml(priceToSend, entryPrice, posAmt, margin);
                if (pnlHtml) { // Only insert if calculation was possible
                     spanElement.insertAdjacentHTML('beforebegin', pnlHtml);
                }

                updateStatus(`${symbol} ${type.toUpperCase()} 價格已${actionText}${priceToSend === 0 ? '' : '為 ' + finalDisplayPrice}`, 'success');
            } else {
                // Revert on failure: Set price text back
                spanElement.textContent = currentPriceText;
                // Re-add original static PNL info *before* the price span if it existed and was valid
                const originalPriceNum = parseFloat(currentPriceText.replace(/,/g, ''));
                const originalPnlHtml = createPnlInfoHtml(originalPriceNum, entryPrice, posAmt, margin);
                 if (originalPnlHtml) {
                    spanElement.insertAdjacentHTML('beforebegin', originalPnlHtml);
                 }
                updateStatus(`${actionText} ${symbol} ${type.toUpperCase()} 價格失敗，恢復原價`, 'error');
            }
        } else {
             console.warn("Editable price span no longer exists in DOM after API call.");
        }
    };

    const handleBlur = () => {
        // Use setTimeout to allow click events on other elements before blur processing
        setTimeout(() => {
            // Check if input is still in DOM (might have been removed by Esc)
            if (!document.body.contains(input)) return;
            handleInputComplete('blur');
        }, 150); // Delay might need adjustment
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleInputComplete('enter');
        } else if (e.key === 'Escape') {
            // Cancel edit
            input.removeEventListener('blur', handleBlur);
            input.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('input', updatePnlInfo); // Remove input listener

            // Remove temporary infoSpan and input
            const tempInfoSpan = input.previousElementSibling; // infoSpan is before input
             if (tempInfoSpan && tempInfoSpan.classList.contains('temporary-pnl-info')) {
                 if (document.body.contains(tempInfoSpan)) tempInfoSpan.remove();
            }
            if (document.body.contains(input)) {
                 input.remove();
            }

            // Restore original display
            if (document.body.contains(spanElement)) {
                 spanElement.style.display = ''; // Show price span
                 spanElement.textContent = currentPriceText; // Revert price text

                 // Show original static PNL info if it existed (before the price span)
                 const staticPnlInfo = spanElement.previousElementSibling;
                 if (staticPnlInfo && staticPnlInfo.classList.contains('static-pnl-info')) {
                    staticPnlInfo.style.display = ''; // Make sure it's visible again
                 }
            }
            console.log("用戶取消設定。");
        }
    };

    // Add listeners
    input.addEventListener('blur', handleBlur);
    input.addEventListener('keydown', handleKeydown);
}

// --- Set Conditional Order (TP/SL) ---
// This function now handles both setting and cancelling TP/SL via the correct endpoint
async function setStopOrder(symbol, type, price) { // Function name kept for compatibility
     if (!window.globalState) {
        console.error("Global state not initialized in setStopOrder.");
        return false;
    }
    const endpoint = '/conditional-order'; // <-- ***修正端點***
    const method = 'POST';

    const priceNum = parseFloat(price);
    if (isNaN(priceNum)) {
        console.error(`無效的價格傳遞給 setStopOrder: ${price}`);
        return false;
    }

    const action = priceNum === 0 ? 'cancel' : 'create';

    // --- 確定訂單方向 (side) 和訂單類型 (orderType) ---
    const positionInfo = window.globalState.positionInfo;
    let side = null;
    let orderType = null; // STOP_MARKET or TAKE_PROFIT_MARKET
    let positionAmt = 0;

    if (positionInfo && Array.isArray(positionInfo)) {
        const currentPosition = positionInfo.find(p => p.symbol === symbol && parseFloat(p.positionAmt) !== 0);
        if (currentPosition) {
            positionAmt = parseFloat(currentPosition.positionAmt);
            if (positionAmt > 0) { // Long position
                side = 'SELL';
                orderType = (type === 'tp') ? 'TAKE_PROFIT_MARKET' : 'STOP_MARKET';
            } else if (positionAmt < 0) { // Short position
                side = 'BUY';
                orderType = (type === 'tp') ? 'TAKE_PROFIT_MARKET' : 'STOP_MARKET';
            }
        }
    }

    if (action === 'create' && !side) {
        console.warn(`無法設定 ${type.toUpperCase()}，因為沒有找到 ${symbol} 的持倉或持倉數量為零。`);
        updateStatus(`無法設定 ${type.toUpperCase()}：無有效持倉`, 'warning');
        return false;
    }

    // --- 構建請求體 (符合 /conditional-order 的預期) ---
    let success = true; // Assume success initially

    // *** 如果是創建新價格 (非取消)，先嘗試取消同類型的現有訂單 ***
    if (action === 'create') {
        console.log(`嘗試取消現有的 ${symbol} ${type.toUpperCase()} 訂單...`);
        const cancelRequestBody = {
            symbol: symbol,
            action: 'cancel',
            type: type
        };
        try {
            // 發送取消請求，但不強制要求成功才能繼續 (幣安可能在沒有訂單時返回錯誤，這沒關係)
            await fetchFromBackend(endpoint, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cancelRequestBody)
            });
            console.log(`取消請求已發送 (無論是否成功)。`);
        } catch (cancelError) {
            console.error(`嘗試取消現有 ${type.toUpperCase()} 訂單時出錯 (忽略):`, cancelError);
            // 不阻止繼續創建新訂單
        }
    }

    // --- 構建創建或取消請求體 ---
    const requestBody = {
        symbol: symbol,
        action: action, // 'create' or 'cancel'
        type: type,     // 'tp' or 'sl'
    };

    if (action === 'create') {
        requestBody.price = priceNum.toFixed(window.globalState.pricePrecision);
        requestBody.side = side;
        requestBody.orderType = orderType;
    } else { // action === 'cancel'
        console.log(`請求取消 ${symbol} 的 ${type.toUpperCase()} 訂單。`);
    }

    console.log(`發送 ${action} 請求到 ${endpoint}:`, JSON.stringify(requestBody));

    // Send request to backend
    // --- 發送最終的創建或取消請求 ---
    try {
        const result = await fetchFromBackend(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        success = result !== null; // 更新成功狀態
    } catch (error) {
        console.error(`設定 ${type.toUpperCase()} 訂單時出錯:`, error);
        return false;
    }

    return success; // 返回最終操作的成功狀態
}

// --- Event Listeners (Trade related) ---
// These will be attached in the main script.js after DOM is loaded
function attachTradeEventListeners() {
    if (setLeverageBtn) setLeverageBtn.addEventListener('click', handleChangeLeverage);
    if (leverageInput) leverageInput.addEventListener('change', updateCalculations); // Update calc on change
    if (quantityInput) {
        quantityInput.addEventListener('input', () => {
            // 檢查輸入值是否小於 0
            const currentValue = parseFloat(quantityInput.value);
            if (isNaN(currentValue) || currentValue < 0) {
                quantityInput.value = '0'; // 如果是負數或無效，重置為 0
            }
            // 反向更新拉桿
            updateSliderFromQuantity();
            // 觸發保證金等計算更新
            updateCalculations();
        });
    }
    // 新增：為拉桿添加事件監聽器
    // 為拉桿添加事件監聽器
    if (quantitySlider && quantityInput && maxOrderSizeSpan && quantityPercentageSpan) {
        quantitySlider.addEventListener('input', () => {
            const percentage = parseInt(quantitySlider.value);
            // 無論如何都先更新百分比顯示
            quantityPercentageSpan.textContent = `${percentage}%`;

            // 從 maxOrderSizeSpan 獲取最大可開數量文本
            const maxSizeText = maxOrderSizeSpan.textContent || '0';
            // 解析出數值部分
            const maxSizeMatch = maxSizeText.match(/^(-?\d+(\.\d+)?)/);
            // 如果解析成功，則使用解析值，否則設為 0
            const maxSize = maxSizeMatch ? parseFloat(maxSizeMatch[1]) : 0;

            // 只有在 maxSize 大於 0 時才計算和更新數量
            if (maxSize > 0 && window.globalState?.quantityPrecision !== undefined) {
                const calculatedQuantity = (maxSize * percentage) / 100;
                // 恢復使用 formatNumber，確保顯示符合精度要求
                quantityInput.value = formatNumber(calculatedQuantity, window.globalState.quantityPrecision);
            } else {
                // 如果最大可開為 0 或無效，數量輸入框設為 0 (格式化後)
                quantityInput.value = formatNumber(0, window.globalState?.quantityPrecision ?? 3);
            }
            // 觸發保證金等計算更新
            updateCalculations();
        });
    } else {
         console.error("Could not attach slider listener - one or more required elements are missing.");
    }
    if (buyLongBtn) buyLongBtn.addEventListener('click', () => placeMarketOrder('BUY'));
    if (sellShortBtn) sellShortBtn.addEventListener('click', () => placeMarketOrder('SELL'));
    if (closeAllBtn) closeAllBtn.addEventListener('click', () => handleClosePosition(1));
    if (closeHalfBtn) closeHalfBtn.addEventListener('click', () => handleClosePosition(0.5));
    // Click listener for editable prices
    if (positionDetailsDiv) {
        positionDetailsDiv.addEventListener('click', (event) => {
            if (event.target.classList.contains('editable-price')) {
                makePriceEditable(event.target);
            }
        });
    }
}

// --- Realtime PNL Update ---
function updateRealtimePnl(markPrice) {
    if (!window.globalState || !window.globalState.positionInfo || !window.globalState.currentSymbol) {
        return; // Not ready or no position info
    }

    const positionInfo = window.globalState.positionInfo;
    const currentPosition = positionInfo.find(p => p.symbol === window.globalState.currentSymbol && parseFloat(p.positionAmt) !== 0);

    const pnlValueSpan = document.getElementById('realtime-pnl-value');
    const pnlPercentSpan = document.getElementById('realtime-pnl-percent');

    if (!currentPosition || !pnlValueSpan || !pnlPercentSpan) {
        // If no position or elements not found, ensure display is cleared or default
        // (updateAccountPanel handles the initial 'no position' state)
        return;
    }

    const posAmt = parseFloat(currentPosition.positionAmt);
    const entryPrice = parseFloat(currentPosition.entryPrice);
    // Recalculate margin based on stored data (consistent with updateAccountPanel)
    let estimatedMargin = parseFloat(currentPosition.isolatedWallet);
    if (isNaN(estimatedMargin) || estimatedMargin <= 0) {
        estimatedMargin = parseFloat(currentPosition.initialMargin);
        if (isNaN(estimatedMargin) || estimatedMargin <= 0) {
            const leverage = parseInt(currentPosition.leverage) || window.globalState.currentLeverage || 1;
            estimatedMargin = Math.abs(posAmt * entryPrice / leverage);
        }
    }


    if (isNaN(posAmt) || isNaN(entryPrice) || isNaN(markPrice) || markPrice <= 0 || isNaN(estimatedMargin)) {
        console.warn("Cannot update realtime PNL due to invalid data:", { posAmt, entryPrice, markPrice, estimatedMargin });
        return; // Invalid data for calculation
    }

    const pnl = (markPrice - entryPrice) * posAmt;
    const pnlPercent = estimatedMargin > 0 ? (pnl / estimatedMargin) * 100 : 0;

    // Update PNL value display
    pnlValueSpan.textContent = `${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}`;
    pnlValueSpan.className = `value position-pnl ${pnl >= 0 ? 'positive' : 'negative'}`; // Update class for color

    // Update PNL percentage display
    pnlPercentSpan.textContent = `${pnlPercent >= 0 ? '+' : ''}${formatCurrency(pnlPercent)}%`;
    pnlPercentSpan.className = `${pnl >= 0 ? 'positive' : 'negative'}`; // Update class for color
}

// --- 新增：反向更新拉桿的輔助函數 ---
function updateSliderFromQuantity() {
    if (!quantityInput || !quantitySlider || !maxOrderSizeSpan || !quantityPercentageSpan || !window.globalState) return;

    const currentQuantityText = quantityInput.value;
    const currentQuantity = parseFloat(currentQuantityText);

    // 從 maxOrderSizeSpan 獲取最大可開數量文本
    const maxSizeText = maxOrderSizeSpan.textContent || '0';
    const maxSizeMatch = maxSizeText.match(/^(-?\d+(\.\d+)?)/);
    const maxSize = maxSizeMatch ? parseFloat(maxSizeMatch[1]) : 0;

    if (isNaN(currentQuantity) || currentQuantity < 0) {
        // 如果輸入無效或為負數，將拉桿重置為 0
        quantitySlider.value = 0;
        quantityPercentageSpan.textContent = '0%';
        return;
    }

    if (maxSize > 0) {
        let percentage = (currentQuantity / maxSize) * 100;
        // 限制百分比在 0 到 100 之間
        percentage = Math.max(0, Math.min(100, percentage));
        quantitySlider.value = Math.round(percentage); // 拉桿通常是整數
        quantityPercentageSpan.textContent = `${Math.round(percentage)}%`;
    } else {
        // 如果最大可開為 0 或無效，拉桿也重置為 0
        quantitySlider.value = 0;
        quantityPercentageSpan.textContent = '0%';
    }
}


console.log("trade.js loaded");