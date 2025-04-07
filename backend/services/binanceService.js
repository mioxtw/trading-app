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
        console.log(`正在獲取 ${symbol} 的倉位風險...`);
        const positionRiskData = await makeRequest('/fapi/v2/positionRisk', 'GET', positionParams, false);
        console.log(`獲取到 ${symbol} 倉位數據: ${positionRiskData?.length} 條`);

        // 如果沒有倉位數據，直接返回
        if (!positionRiskData || !Array.isArray(positionRiskData)) {
            return positionRiskData || [];
        }

        let openOrdersData = []; // 初始化為空陣列
        try {
            console.log(`正在獲取 ${symbol} 的掛單信息...`);
            openOrdersData = await makeRequest('/fapi/v1/openOrders', 'GET', openOrderParams, false);
            console.log(`獲取到 ${symbol} 掛單數據: ${openOrdersData?.length} 條`);
        } catch (orderError) {
            console.warn(`獲取 ${symbol} 的掛單信息失敗 (將繼續處理倉位數據):`, orderError.message);
            // 不拋出錯誤，允許繼續處理倉位數據，但止盈止損價將為 '0'
        }

        // 處理倉位數據，查找並合併止盈止損價格
        const processedPositions = positionRiskData.map(position => {
            const posAmt = parseFloat(position.positionAmt);
            let foundTP = false;
            let foundSL = false;

            // 確保 openOrdersData 是陣列才進行查找
            if (posAmt !== 0 && Array.isArray(openOrdersData)) {
                const closeSide = posAmt > 0 ? 'SELL' : 'BUY';

                const takeProfitOrder = openOrdersData.find(order =>
                    order.symbol === position.symbol &&
                    order.side === closeSide &&
                    order.type === 'TAKE_PROFIT_MARKET' &&
                    order.closePosition === true // 幣安 TP/SL API 創建的訂單此欄位為 true
                );

                const stopLossOrder = openOrdersData.find(order =>
                    order.symbol === position.symbol &&
                    order.side === closeSide &&
                    order.type === 'STOP_MARKET' &&
                    order.closePosition === true // 同上
                );

                if (takeProfitOrder && takeProfitOrder.stopPrice) {
                    position.takeProfitPrice = takeProfitOrder.stopPrice;
                    foundTP = true;
                }
                if (stopLossOrder && stopLossOrder.stopPrice) {
                    position.stopLossPrice = stopLossOrder.stopPrice;
                    foundSL = true;
                }
            }

            // 如果未找到，確保欄位存在且為 '0'
            if (!foundTP) position.takeProfitPrice = '0';
            if (!foundSL) position.stopLossPrice = '0';

            return position;
        });

        console.log(`處理後的 ${symbol} 倉位數據 (TP: ${processedPositions.find(p=>p.symbol===symbol)?.takeProfitPrice}, SL: ${processedPositions.find(p=>p.symbol===symbol)?.stopLossPrice})`);
        return processedPositions;

    } catch (error) {
        // 這個 catch 主要捕捉獲取 positionRisk 失敗的錯誤
        console.error(`獲取 ${symbol} 倉位風險時出錯:`, error);
        throw error; // 仍然拋出獲取倉位本身的錯誤
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

        // --- 實際取消邏輯 ---
        try {
            console.log(`正在獲取 ${symbol} 的未結訂單以查找要取消的 ${type.toUpperCase()} 訂單...`);
            const openOrders = await makeRequest('/fapi/v1/openOrders', 'GET', { symbol }, false);

            if (!Array.isArray(openOrders)) {
                console.warn(`無法獲取 ${symbol} 的未結訂單，或返回格式不正確。`);
                // 即使找不到訂單，也可能認為取消“成功”（因為沒有訂單需要取消）
                return { success: true, message: `未找到 ${symbol} 的未結訂單可供取消`, symbol: symbol, type: type };
            }

            // 確定要查找的訂單類型和方向
            // 需要獲取當前倉位來確定平倉方向
            let targetOrderType = null;
            let targetSide = null;
            try {
                const positionRisk = await getPositionRisk(symbol); // 複用現有函數獲取倉位信息
                const currentPosition = positionRisk.find(p => p.symbol === symbol && parseFloat(p.positionAmt) !== 0);
                if (currentPosition) {
                    const posAmt = parseFloat(currentPosition.positionAmt);
                    if (posAmt > 0) { // Long
                        targetSide = 'SELL';
                        targetOrderType = (type === 'tp') ? 'TAKE_PROFIT_MARKET' : 'STOP_MARKET';
                    } else if (posAmt < 0) { // Short
                        targetSide = 'BUY';
                        targetOrderType = (type === 'tp') ? 'TAKE_PROFIT_MARKET' : 'STOP_MARKET';
                    }
                }
            } catch (posError) {
                console.error(`取消訂單前獲取倉位信息失敗: ${posError.message}`);
                // 如果無法獲取倉位，可能無法準確判斷要取消哪個訂單，這裡選擇繼續嘗試查找（可能不夠精確）
            }

            if (!targetOrderType || !targetSide) {
                 console.warn(`無法確定 ${symbol} 的持倉方向，無法精確查找要取消的 ${type.toUpperCase()} 訂單。將嘗試查找所有同類型訂單。`);
                 // 如果沒有倉位，理論上也不應該有對應的 TP/SL 單，但還是查找一下
                 targetOrderType = (type === 'tp') ? 'TAKE_PROFIT_MARKET' : 'STOP_MARKET';
            }

            // 查找目標訂單
            const targetOrder = openOrders.find(order =>
                order.symbol === symbol &&
                order.type === targetOrderType &&
                (targetSide ? order.side === targetSide : true) && // 如果能確定方向，則匹配方向
                order.closePosition === true // 確保是平倉單 (幣安 TP/SL API 創建的訂單此欄位為 true)
                // 注意：這裡沒有匹配價格，因為用戶可能修改過價格但類型和方向不變
            );

            if (targetOrder && targetOrder.orderId) {
                console.log(`找到要取消的 ${type.toUpperCase()} 訂單: ID ${targetOrder.orderId}`);
                // 發送取消請求
                const cancelResult = await makeRequest('/fapi/v1/order', 'DELETE', { symbol, orderId: targetOrder.orderId }, false);
                console.log(`幣安取消訂單 API 回應:`, cancelResult);
                // 假設取消成功，幣安會返回被取消的訂單信息
                return { success: true, message: `成功取消 ${type.toUpperCase()} 訂單 (ID: ${targetOrder.orderId})`, data: cancelResult };
            } else {
                console.log(`未找到需要取消的活動 ${type.toUpperCase()} 訂單 for ${symbol}`);
                // 沒有找到訂單也視為成功，因為目標狀態（沒有該訂單）已達成
                return { success: true, message: `未找到活動的 ${type.toUpperCase()} 訂單可供取消`, symbol: symbol, type: type };
            }
        } catch (error) {
            console.error(`取消 ${symbol} 的 ${type.toUpperCase()} 訂單時出錯:`, error);
            // 將錯誤信息傳遞給前端
            throw {
                status: error.status || 500,
                binanceError: error.binanceError || null,
                message: `取消 ${type.toUpperCase()} 訂單失敗: ${error.message}`
            };
        }

    } else {
        throw new Error(`未知的條件訂單操作: ${action}`);
    }
}

// 新增：獲取用戶歷史成交紀錄
async function getTradeHistory(symbol, limit = 500) {
    console.log(`正在獲取 ${symbol} 的歷史成交紀錄 (limit: ${limit})...`);
    const params = {
        symbol: symbol,
        limit: Math.min(limit, 1000) // 幣安限制最大 1000
    };
    // /fapi/v1/userTrades 是私有 GET 請求
    return makeRequest('/fapi/v1/userTrades', 'GET', params, false);
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
    getTradeHistory, // <--- 導出 getTradeHistory
};