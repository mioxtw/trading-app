// backend/services/binanceService.js
const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

const { apiKey, apiSecret, restBaseUrl } = config.binance;

// 產生簽名 (此函數不變)
function generateSignature(queryString) {
    if (!apiSecret) return '';
    try {
        return crypto.createHmac('sha256', apiSecret)
                     .update(queryString)
                     .digest('hex');
    } catch (error) {
        console.error("簽名生成錯誤:", error);
        return '';
    }
}

// 通用請求函數 (修正 POST/PUT/DELETE 簽名邏輯)
// ***** MODIFIED makeRequest function *****
async function makeRequest(endpoint, method = 'GET', params = {}, isPublic = false) { // 預設回 GET
    const timestamp = Date.now();
    let requestUrl = `${restBaseUrl}${endpoint}`;
    let requestDataString = ''; // 用於簽名和請求體 (for POST/PUT/DELETE)
    const headers = {};
    let finalParams = params; // 用於 GET 的查詢字串或 POST 的請求體

    if (!isPublic) {
        // --- 私有請求邏輯 ---
        if (!apiKey || !apiSecret) {
            console.error("錯誤：私有請求缺少 API Key 或 Secret。");
            throw new Error("API 金鑰未設定");
        }
        headers['X-MBX-APIKEY'] = apiKey;

        // 將 timestamp 加入到要處理的參數中
        finalParams = { ...params, timestamp };
        requestDataString = new URLSearchParams(finalParams).toString(); // 序列化所有參數 (包括 timestamp)

        const signature = generateSignature(requestDataString); // 對序列化後的完整參數字串簽名
        if (!signature) {
            throw new Error("簽名生成失敗");
        }

        if (method === 'GET' || method === 'DELETE') {
            // 對於 GET/DELETE，將所有參數和簽名附加到 URL
            requestUrl += `?${requestDataString}&signature=${signature}`;
            finalParams = undefined; // GET/DELETE 沒有請求體
            console.log(`後端請求: ${method} ${endpoint}?${requestDataString}&signature=...`);
        } else { // POST, PUT
            // 對於 POST/PUT，簽名附加到序列化數據末尾，作為請求體
            requestDataString += `&signature=${signature}`;
            finalParams = requestDataString; // 請求體是完整的字串
            headers['Content-Type'] = 'application/x-www-form-urlencoded'; // 需要設定 Content-Type
            console.log(`後端請求: ${method} ${endpoint} (數據/簽名在請求體)`);
        }

    } else {
        // --- 公開請求邏輯 ---
        const queryString = new URLSearchParams(params).toString();
        if (queryString) {
            requestUrl += `?${queryString}`;
        }
        finalParams = undefined; // 公開請求通常沒有請求體 (GET)
        console.log(`後端請求: ${method} ${requestUrl}`);
    }


    try {
        const response = await axios({
            method: method,
            url: requestUrl,
            headers: headers,
            data: finalParams // 對於 POST/PUT 是 requestDataString，對於 GET/DELETE 是 undefined
        });
        console.log(`後端回應 ${endpoint}: ${response.status}`);
        return response.data;
    } catch (error) {
        console.error(`幣安 API 請求錯誤 (${endpoint}):`, error.response?.status, error.response?.data || error.message);
        throw {
            status: error.response?.status || 500,
            binanceError: error.response?.data || null,
            message: error.message
        };
    }
}
// ***** END OF MODIFIED makeRequest function *****


// --- 具體功能函數 (使用修改後的 makeRequest) ---

async function getKlineData(symbol, interval, limit = 500) {
    return makeRequest('/fapi/v1/klines', 'GET', { symbol, interval, limit }, true); // 公開接口
}

async function getAccountBalance() {
    return makeRequest('/fapi/v2/balance', 'GET', {}, false); // 私有接口, GET
}

// 修改 getPositionRisk 以包含掛單中的止盈止損價格
async function getPositionRisk(symbol = null) {
    if (!symbol) {
        // 如果沒有指定 symbol，可以選擇返回所有倉位（不含掛單資訊）或拋出錯誤
        // 這裡選擇返回原始 positionRisk 數據
        console.warn("getPositionRisk 未指定 symbol，將不查詢掛單信息。");
        return makeRequest('/fapi/v2/positionRisk', 'GET', {}, false);
    }

    const positionParams = { symbol };
    const openOrderParams = { symbol };

    try {
        console.log(`正在獲取 ${symbol} 的倉位風險和掛單信息...`);
        // 並行獲取倉位風險和掛單數據
        const [positionRiskData, openOrdersData] = await Promise.all([
            makeRequest('/fapi/v2/positionRisk', 'GET', positionParams, false),
            makeRequest('/fapi/v1/openOrders', 'GET', openOrderParams, false)
        ]);

        console.log(`獲取到 ${symbol} 倉位數據: ${positionRiskData?.length} 條`);
        console.log(`獲取到 ${symbol} 掛單數據: ${openOrdersData?.length} 條`);

        // 如果沒有倉位數據，直接返回空陣列或原始數據
        if (!positionRiskData || !Array.isArray(positionRiskData)) {
            return positionRiskData || [];
        }

        // 處理倉位數據，查找並合併止盈止損價格
        const processedPositions = positionRiskData.map(position => {
            const posAmt = parseFloat(position.positionAmt);

            // 只處理有實際持倉的數據
            if (posAmt !== 0 && Array.isArray(openOrdersData)) {
                const closeSide = posAmt > 0 ? 'SELL' : 'BUY'; // 確定平倉方向

                // 查找對應的止盈單 (TAKE_PROFIT_MARKET)
                const takeProfitOrder = openOrdersData.find(order =>
                    order.symbol === position.symbol &&
                    order.side === closeSide &&
                    order.type === 'TAKE_PROFIT_MARKET' &&
                    order.reduceOnly === true // 確保是減倉單 (雖然我們之前設了 false，但這裡查找時還是加上以防萬一)
                    // 可以增加更多條件，例如數量匹配 Math.abs(posAmt)
                );

                // 查找對應的止損單 (STOP_MARKET)
                const stopLossOrder = openOrdersData.find(order =>
                    order.symbol === position.symbol &&
                    order.side === closeSide &&
                    order.type === 'STOP_MARKET' &&
                    order.reduceOnly === true // 同上
                );

                // 將找到的價格添加到倉位對象中
                if (takeProfitOrder && takeProfitOrder.stopPrice) {
                    position.takeProfitPrice = takeProfitOrder.stopPrice;
                    console.log(`找到 ${symbol} 止盈單: ${takeProfitOrder.orderId}, 價格: ${position.takeProfitPrice}`);
                } else {
                     position.takeProfitPrice = '0'; // 或 null，表示未找到
                }
                if (stopLossOrder && stopLossOrder.stopPrice) {
                    position.stopLossPrice = stopLossOrder.stopPrice;
                     console.log(`找到 ${symbol} 止損單: ${stopLossOrder.orderId}, 價格: ${position.stopLossPrice}`);
                } else {
                     position.stopLossPrice = '0'; // 或 null，表示未找到
                }
            } else {
                 // 沒有持倉或沒有掛單數據，確保價格欄位存在但為 0 或 null
                 position.takeProfitPrice = '0';
                 position.stopLossPrice = '0';
            }
            return position;
        });

        console.log(`處理後的 ${symbol} 倉位數據:`, processedPositions.find(p=>p.symbol===symbol)); // Debug log
        return processedPositions;

    } catch (error) {
        console.error(`獲取 ${symbol} 倉位及掛單信息時出錯:`, error);
        // 根據需要決定是拋出錯誤還是返回部分數據或空數據
        // 這裡選擇拋出錯誤，讓上層處理
        throw error;
    }
}

async function setLeverage(symbol, leverage) {
    // 設置槓桿是 POST，參數在請求體中 (根據新 makeRequest)
    return makeRequest('/fapi/v1/leverage', 'POST', { symbol, leverage }, false);
}

async function placeOrder(orderParams) {
    // 下單是 POST，參數在請求體中
    return makeRequest('/fapi/v1/order', 'POST', orderParams, false);
}

async function getListenKey() {
    // 獲取 Listen Key 是 POST
    return makeRequest('/fapi/v1/listenKey', 'POST', {}, false);
}

async function keepAliveListenKey(listenKey) {
    // Keep Alive 是 PUT，listenKey 在請求體中
    return makeRequest('/fapi/v1/listenKey', 'PUT', { listenKey }, false);
}

// 新增：處理條件訂單 (止盈/止損) 的創建或取消
async function placeOrCancelConditionalOrder(params) {
    console.log("Binance Service: 處理條件訂單請求:", params);
    const { symbol, action, type, price, side, orderType, quantity, reduceOnly } = params;

    if (action === 'create') {
        // --- 創建/修改止盈止損訂單 ---
        // 驗證必要的創建參數
        // 驗證必要的創建參數 (移除 quantity 檢查)
        if (!symbol || !price || !side || !orderType) {
            throw new Error("創建條件訂單缺少必要參數 (symbol, price, side, orderType)");
        }
        const priceNum = parseFloat(price);
        if (isNaN(priceNum) || priceNum <= 0) {
             throw new Error("無效的觸發價格");
        }

        // 構建幣安 API 參數
        const binanceParams = {
            symbol: symbol,
            side: side, // 'BUY' 或 'SELL' (平倉方向)
            type: orderType, // 'STOP_MARKET' 或 'TAKE_PROFIT_MARKET'
            // quantity: quantity, // 移除 quantity，由 closePosition=true 處理
            stopPrice: price, // 觸發價格 (對於 STOP_MARKET 和 TAKE_PROFIT_MARKET)
            closePosition: 'true', // 使用 closePosition=true 自動平倉
            // reduceOnly: 'true', // 移除 reduceOnly，由 closePosition=true 隱含
            timeInForce: 'GTE_GTC', // 保留訂單有效期設置
            // timeInForce: 'GTC', // 可選：根據需要設定訂單有效時間
            // workingType: 'MARK_PRICE', // 可選：觸發價格類型，預設通常是合約價格
        };

        console.log("準備發送創建訂單請求到幣安:", binanceParams);

        // **重要**: 調用幣安下單 API 端點 `/fapi/v1/order` (POST)
        // 您需要使用 makeRequest 函數來發送請求
        return makeRequest('/fapi/v1/order', 'POST', binanceParams, false);

    } else if (action === 'cancel') {
        // --- 取消止盈止損訂單 ---
        if (!symbol || !type) {
            throw new Error("取消條件訂單缺少必要參數 (symbol, type)");
        }

        console.log(`準備取消 ${symbol} 的 ${type.toUpperCase()} 訂單`);

        // **重要**: 取消條件訂單比較複雜，幣安沒有直接按類型取消的 API
        // 您需要：
        // 1. 調用 `/fapi/v1/openOrders` (GET) 獲取該 symbol 的所有掛單。
        // 2. 在返回的訂單列表中，根據訂單類型 (`type` 為 'STOP_MARKET' 或 'TAKE_PROFIT_MARKET') 和可能的觸發價格 (`stopPrice`) 來識別您想要取消的訂單。
        //    - 注意：可能有多個同類型的掛單，您需要更精確的邏輯來識別（例如，只取消與當前倉位方向相反的平倉單）。
        // 3. 獲取目標訂單的 `orderId` 或 `origClientOrderId`。
        // 4. 調用 `/fapi/v1/order` (DELETE) 並傳遞 `symbol` 和 `orderId` 或 `origClientOrderId` 來取消特定訂單。
        //    - 例如: return makeRequest('/fapi/v1/order', 'DELETE', { symbol, orderId: targetOrderId }, false);

        // --- 佔位符返回 ---
        console.warn("警告: 實際的幣安取消訂單 API 調用邏輯已被註解掉");
        return { success: true, message: "[模擬] 取消訂單成功", symbol: symbol, type: type };
        // --- 佔位符結束 ---

    } else {
        throw new Error(`未知的條件訂單操作: ${action}`);
    }
}


module.exports = {
    getKlineData,
    getAccountBalance,
    getPositionRisk,
    setLeverage,
    placeOrder,
    getListenKey,
    keepAliveListenKey,
    placeOrCancelConditionalOrder, // 導出新函數
};