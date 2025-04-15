
// backend/routes/api.js
const express = require('express');
const router = express.Router();
const binanceService = require('../services/binanceService');
const { broadcast } = require('../services/websocketService'); // <--- 導入 broadcast
const websocketService = require('../services/websocketService'); // 保留原始導入以供其他地方使用 (例如 connect-user-stream)
const config = require('../config'); // <--- 引入 config

// 處理異步函數的錯誤中間件
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(err => {
        console.error("路由處理錯誤:", err);
        const status = err.status || 500;
        const message = err.binanceError?.msg || err.message || '內部伺服器錯誤';
        res.status(status).json({ success: false, message: message, code: err.binanceError?.code });
    });
};

// --- API 端點 ---

// 新增：提供前端設定的端點
router.get('/config', (req, res) => {
    console.log("請求 /api/config"); // Debug Log
    res.json({
        success: true,
        data: {
            websocketPort: config.websocketPort, // 從 config 讀取
            apiMode: config.apiMode
            // 可以加入其他前端需要的設定
        }
    });
});

// 獲取 K 線數據
router.get('/kline', asyncHandler(async (req, res) => {
    const { symbol, interval } = req.query; // 移除 limit
    if (!symbol || !interval) {
        return res.status(400).json({ success: false, message: '缺少 symbol 或 interval 參數' });
    }
    // 調用修改後的服務函數，該函數內部處理獲取大量數據
    const data = await binanceService.getKlineData(symbol, interval);
    res.json({ success: true, data });
}));

// 獲取帳戶餘額
router.get('/balance', asyncHandler(async (req, res) => {
    const data = await binanceService.getAccountBalance();
    res.json({ success: true, data });
}));

// 獲取持倉風險
router.get('/position', asyncHandler(async (req, res) => {
    const { symbol } = req.query;
    const data = await binanceService.getPositionRisk(symbol);
    res.json({ success: true, data });
}));

// 新增：獲取歷史成交紀錄
router.get('/trades/history', asyncHandler(async (req, res) => {
    const { symbol, limit } = req.query; // 可以選擇性地添加 limit
    if (!symbol) {
        return res.status(400).json({ success: false, message: '缺少 symbol 參數' });
    }
    // 假設 binanceService 中會有 getTradeHistory 函數
    const data = await binanceService.getTradeHistory(symbol, limit || 500); // 預設 limit 為 500
    res.json({ success: true, data });
}));

// 新增：獲取倉位歷史紀錄
router.get('/position-history', asyncHandler(async (req, res) => {
    const { symbol } = req.query; // 只接收 symbol
    if (!symbol) {
        return res.status(400).json({ success: false, message: '缺少 symbol 參數' });
    }
    // 調用已修改的 service 函數，該函數內部處理時間範圍
    const data = await binanceService.getPositionHistory(symbol);
    res.json({ success: true, data });
}));

// 設定槓桿
router.post('/leverage', asyncHandler(async (req, res) => {
    const { symbol, leverage } = req.body;
    if (!symbol || leverage === undefined) {
        return res.status(400).json({ success: false, message: '缺少 symbol 或 leverage 參數' });
    }
    const leverageNum = parseInt(leverage);
     if (isNaN(leverageNum) || leverageNum < 1) {
         return res.status(400).json({ success: false, message: '無效的 leverage 參數' });
     }
    const data = await binanceService.setLeverage(symbol, leverageNum);
    res.json({ success: true, data });
}));

// 下單
router.post('/order', asyncHandler(async (req, res) => {
    const orderParams = req.body;
    if (!orderParams.symbol || !orderParams.side || !orderParams.type || !orderParams.quantity) {
         return res.status(400).json({ success: false, message: '缺少必要的訂單參數' });
    }
    const data = await binanceService.placeOrder(orderParams);
    res.json({ success: true, data });
}));

// 觸發用戶數據流連接
router.post('/connect-user-stream', asyncHandler(async (req, res) => {
     console.log("收到連接用戶數據流請求...");
     await websocketService.connectUserDataStream();
     res.json({ success: true, message: "已嘗試連接用戶數據流" });
}));

// --- 修改：處理條件訂單 (止盈/止損/止盈平半) ---
// 狀態存儲 (臨時方案，理想情況下應使用數據庫或緩存)
const tpHalfOrderIds = {}; // { "symbol": orderId }
router.post('/conditional-order', asyncHandler(async (req, res) => {
    const params = req.body;
    console.log("收到條件訂單請求:", params); // Debug Log

    // 基本驗證 (更詳細的驗證應在 service 層)
    if (!params.symbol || !params.action || !params.type) {
        return res.status(400).json({ success: false, message: '缺少必要的條件訂單參數 (symbol, action, type)' });
    }
    // --- MODIFIED VALIDATION: Only check side/orderType for tp/sl ---
    if (params.action === 'create' && params.type !== 'tphalf' && (!params.price || !params.side || !params.orderType)) {
         return res.status(400).json({ success: false, message: '創建 TP/SL 訂單時缺少參數 (price, side, orderType)' });
    }
    // --- END MODIFIED VALIDATION ---
     if (params.action === 'cancel' && !params.type) {
         return res.status(400).json({ success: false, message: '取消訂單時缺少 type 參數' });
     }
     // 添加對 tphalf 的驗證
     if (params.type === 'tphalf' && params.action === 'create' && !params.price) {
          return res.status(400).json({ success: false, message: '創建止盈平半訂單時缺少 price 參數' });
     }


    // 調用 binanceService 處理訂單
    let data = null;
    let broadcastMessage = null;

    if (params.type === 'tp' || params.type === 'sl') {
        // --- 處理標準 TP/SL ---
        data = await binanceService.placeOrCancelConditionalOrder(params);
        if (data) {
            broadcastMessage = {
                type: 'conditionalOrderUpdate',
                action: params.action,
                orderType: params.type,
                symbol: params.symbol,
                binanceResponse: data
            };
        }
    } else if (params.type === 'tphalf') {
        // --- 處理 TP Half ---
        const { symbol, action, price } = params;
        const priceNum = parseFloat(price);

        if (action === 'create') {
            if (isNaN(priceNum) || priceNum <= 0) {
                throw new Error("無效的止盈平半觸發價格");
            }

            // 1. 獲取當前倉位信息
            const positionRisk = await binanceService.getPositionRisk(symbol);
            const currentPosition = positionRisk.find(p => p.symbol === symbol && parseFloat(p.positionAmt) !== 0);
            if (!currentPosition) {
                throw new Error(`無法設定止盈平半：未找到 ${symbol} 的有效持倉`);
            }
            const positionAmt = parseFloat(currentPosition.positionAmt);
            const positionSide = positionAmt > 0 ? 'BUY' : 'SELL';
            const closeSide = positionSide === 'BUY' ? 'SELL' : 'BUY';

            // 2. 計算一半數量 (需要處理精度)
            // TODO: 實現從 exchangeInfo 獲取精度和最小數量
            const quantityToClose = Math.abs(positionAmt) / 2;
            const minOrderQty = 0.001; // Placeholder
            if (quantityToClose < minOrderQty) {
                throw new Error(`計算出的平倉數量 ${quantityToClose} 過小`);
            }
            const quantityPrecision = symbol.includes('BTC') ? 3 : 2; // Placeholder
            const formattedQuantity = quantityToClose.toFixed(quantityPrecision);
            if (parseFloat(formattedQuantity) < minOrderQty) {
                 throw new Error(`格式化後的平倉數量 ${formattedQuantity} 過小`);
            }

            // 3. 取消舊的 TP Half 訂單 (如果存在)
            const existingOrderId = tpHalfOrderIds[symbol];
            if (existingOrderId) {
                try {
                    console.log(`[TP Half API] 正在取消舊的 TP Half 訂單: ${existingOrderId}`);
                    await binanceService.cancelOrder(symbol, existingOrderId);
                    delete tpHalfOrderIds[symbol]; // 從存儲中移除
                } catch (cancelError) {
                    // 如果取消失敗 (例如訂單已成交或不存在)，記錄警告但繼續
                    console.warn(`[TP Half API] 取消舊訂單 ${existingOrderId} 失敗 (可能已執行或不存在):`, cancelError.message);
                    delete tpHalfOrderIds[symbol]; // 仍然移除，因為它不再有效
                }
            }

            // 4. 下新的 TP Half 訂單
            const orderParams = {
                symbol: symbol,
                side: closeSide,
                type: 'TAKE_PROFIT_MARKET',
                quantity: formattedQuantity,
                stopPrice: priceNum.toFixed(config.binance.pricePrecision || 2), // 使用配置或預設精度
                reduceOnly: 'true',
                timeInForce: 'GTE_GTC' // Good Till Expire or Cancel
            };
            console.log(`[TP Half API] 準備下新的 TP Half 訂單:`, orderParams);
            data = await binanceService.placeOrder(orderParams);

            // 5. 存儲新的 Order ID
            if (data && data.orderId) {
                tpHalfOrderIds[symbol] = data.orderId;
                console.log(`[TP Half API] 新的 TP Half 訂單已創建，ID: ${data.orderId}`);
                broadcastMessage = {
                    type: 'tpHalfSet', // 使用前端能識別的消息類型
                    symbol: symbol,
                    price: priceNum,
                    side: positionSide, // 廣播倉位方向
                    orderId: data.orderId // 可以選擇性廣播 orderId
                };
            } else {
                 console.error("[TP Half API] 下單成功但未返回 orderId:", data);
                 // 可能需要處理這種情況
            }

        } else if (action === 'cancel') {
            const existingOrderId = tpHalfOrderIds[symbol];
            if (existingOrderId) {
                console.log(`[TP Half API] 正在取消 TP Half 訂單: ${existingOrderId}`);
                try {
                    data = await binanceService.cancelOrder(symbol, existingOrderId);
                    delete tpHalfOrderIds[symbol]; // 從存儲中移除
                    console.log(`[TP Half API] 訂單 ${existingOrderId} 已取消。`);
                    broadcastMessage = {
                        type: 'tpHalfCancelled', // 使用前端能識別的消息類型
                        symbol: symbol
                    };
                } catch (cancelError) {
                    console.error(`[TP Half API] 取消訂單 ${existingOrderId} 失敗:`, cancelError.message);
                    // 如果取消失敗，可能訂單已不存在，也應從存儲中移除
                    delete tpHalfOrderIds[symbol];
                    throw cancelError; // 將錯誤拋出給 asyncHandler 處理
                }
            } else {
                console.log(`[TP Half API] 無需取消 ${symbol} 的 TP Half 訂單 (未找到記錄)。`);
                // 即使未找到也認為操作 "成功" (目標狀態達成)
                data = { message: "No active TP Half order found to cancel." };
                broadcastMessage = {
                    type: 'tpHalfCancelled',
                    symbol: symbol
                };
            }
        } else {
            throw new Error(`未知的止盈平半操作: ${action}`);
        }
    } else {
        throw new Error(`未知的條件訂單類型: ${params.type}`);
    }

    // 廣播消息 (如果有的話)
    if (broadcastMessage) {
        broadcast(broadcastMessage);
    }

    res.json({ success: true, data }); // 將 API 調用結果返回給前端
}));

// --- 新增：獲取未結訂單 ---
router.get('/open-orders', asyncHandler(async (req, res) => {
    const { symbol } = req.query;
    if (!symbol) {
        return res.status(400).json({ success: false, message: '缺少 symbol 參數' });
    }
    const data = await binanceService.getOpenOrders(symbol);
    res.json({ success: true, data });
}));

// --- 新增：取消訂單 ---
router.delete('/cancel-order', asyncHandler(async (req, res) => {
    const { symbol, orderId } = req.body; // 從請求體獲取參數
    if (!symbol || !orderId) {
        return res.status(400).json({ success: false, message: '缺少 symbol 或 orderId 參數' });
    }
    const data = await binanceService.cancelOrder(symbol, orderId);
    // 廣播訂單取消事件 (可選)
    broadcast({
        type: 'orderCancelled', // 自定義事件類型
        symbol: symbol,
        orderId: orderId,
        binanceResponse: data
    });
    res.json({ success: true, data });
}));

module.exports = router;