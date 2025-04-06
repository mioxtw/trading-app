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

async function getPositionRisk(symbol = null) {
    const params = symbol ? { symbol } : {};
    return makeRequest('/fapi/v2/positionRisk', 'GET', params, false); // 私有接口, GET
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


module.exports = {
    getKlineData,
    getAccountBalance,
    getPositionRisk,
    setLeverage,
    placeOrder,
    getListenKey,
    keepAliveListenKey,
};