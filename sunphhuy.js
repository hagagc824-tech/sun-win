const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

// --- Cấu hình & Khởi tạo ---
const API_URL = "https://famous-instruction-heavy-telephony.trycloudflare.com/api/tx";
const DATA_FILE = "collected_data/sunwin_tx.json";
const STATS_FILE = "database/stats.json";
const PREDICTIONS_FILE = "database/predictions.json";

// Các giới hạn
const MIN_DATA_FOR_PREDICTION = 1000; // Giảm xuống 1000
const MAX_PREDICTIONS = 100000;
const MAX_STORAGE = 1000000;

// Web server để keep alive
const PORT = process.env.PORT || 3000;

const vnNow = () => {
    const d = new Date();
    return new Date(d.getTime() + (7 * 60 * 60 * 1000)).toISOString();
};

let stats = {
    total: 0, correct: 0, wrong: 0,
    last_prediction: null,
    start_time: vnNow(),
    history: [],
    total_predictions_made: 0,
    prediction_started: false
};

let predictions_history = [];

class TX_LogicPen_V4 {
    constructor() {
        this.error_streak = 0;
        this.last_prediction = null;
        this.history = [];
        this.fibonacci_sequence = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
        this.golden_ratio = 1.618;
    }

    loadData(data) {
        this.history = [...data].sort((a, b) => (b.phien || 0) - (a.phien || 0));
    }

    _arr() {
        return this.history.map(s => 
            (s.ket_qua || '').toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI')
        );
    }

    _points() {
        return this.history
            .filter(s => s.tong !== undefined && s.tong !== null)
            .map(s => s.tong);
    }

    // --- THUẬT TOÁN CŨ (GIỮ NGUYÊN 100%) ---
    cauSap(arr) {
        if (arr.length < 2) return null;
        let length = 1;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] === arr[0]) length++;
            else break;
        }
        if (length >= 2 && length <= 5) {
            return { pred: arr[0], conf: 72, type: "Đu Bệt", reason: `Bệt ${length} phiên` };
        }
        if (length >= 6) {
            return { pred: arr[0] === "TAI" ? "XIU" : "TAI", conf: 80, type: "Bẻ Bệt Rồng", reason: `Bệt dài ${length} → hồi` };
        }
        return null;
    }

    cauNoi(arr) {
        if (arr.length < 5) return null;
        for (let i = 0; i < 4; i++) {
            if (arr[i] === arr[i + 1]) return null;
        }
        return { pred: arr[0] === "TAI" ? "XIU" : "TAI", conf: 82, type: "Cầu Nối 1-1", reason: "Nhịp 1-1 ổn định" };
    }

    cauDoi(arr) {
        if (arr.length < 4) return null;
        if (arr[0] === arr[1] && arr[2] === arr[3] && arr[0] !== arr[2]) {
            return { pred: arr[2], conf: 78, type: "Cầu 2-2", reason: "AABB → B" };
        }
        if (arr.length >= 6 && arr[0] === arr[1] && arr[1] === arr[2] && 
            arr[3] === arr[4] && arr[4] === arr[5] && arr[0] !== arr[3]) {
            return { pred: arr[3], conf: 80, type: "Cầu 3-3", reason: "AAABBB → B" };
        }
        return null;
    }

    cauGay(arr) {
        if (arr.length >= 5 && arr[0] === arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[3] === arr[4]) {
            return { pred: arr[3], conf: 74, type: "Gãy 3-2", reason: "AAABB → B" };
        }
        if (arr.length >= 5 && arr[0] === arr[1] && arr[1] !== arr[2] && arr[2] === arr[3] && arr[3] === arr[4]) {
            return { pred: arr[2], conf: 74, type: "Gãy 2-3", reason: "AABBB → B" };
        }
        if (arr.length >= 4 && arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
            return { pred: arr[1], conf: 72, type: "Gãy 1-2-1", reason: "ABBA → B" };
        }
        return null;
    }

    phatHienMauLap(arr) {
        if (arr.length < 6) return null;
        for (let len = 2; len <= 4; len++) {
            let pattern = arr.slice(0, len);
            for (let i = len; i < arr.length - len; i++) {
                let sub = arr.slice(i, i + len);
                if (JSON.stringify(sub) === JSON.stringify(pattern) && arr[i - 1]) {
                    return { pred: arr[i - 1], conf: 88, type: "Mẫu Lặp", reason: `Mẫu "${pattern.join(',')}"` };
                }
            }
        }
        return null;
    }

    duDoanVi() {
        const points = this._points();
        if (points.length < 5) return null;
        const last = points[0], prev = points[1];
        const slice = points.slice(0, 5);
        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;

        if (last >= 15) return { pred: "XIU", conf: 75, type: "Vị cực đại", reason: `Điểm ${last} → hồi Xỉu` };
        if (last <= 5) return { pred: "TAI", conf: 75, type: "Vị cực tiểu", reason: `Điểm ${last} → hồi Tài` };
        if (avg > 11 && last > prev) return { pred: "XIU", conf: 68, type: "Vị bão hòa", reason: "Đà tăng chạm ngưỡng" };
        if (avg < 10 && last < prev) return { pred: "TAI", conf: 68, type: "Vị cạn kiệt", reason: "Đà giảm chạm đáy" };
        if (avg >= 11 && last >= 11 && last <= 13) return { pred: "TAI", conf: 65, type: "Vị ổn định", reason: "Duy trì Tài nhẹ" };
        if (avg <= 9 && last >= 7 && last <= 9) return { pred: "XIU", conf: 65, type: "Vị ổn định", reason: "Duy trì Xỉu nhẹ" };
        return null;
    }

    // --- THUẬT TOÁN MỚI (THÊM 100%) ---
    fibonacciPrediction(arr) {
        if (arr.length < this.fibonacci_sequence.length) return null;
        
        const results = arr.slice(0, 12).map(r => r === "TAI" ? 1 : 0);
        let fib_sum = 0;
        let weight_sum = 0;
        
        for (let i = 0; i < Math.min(12, results.length); i++) {
            const weight = this.fibonacci_sequence[i];
            fib_sum += results[i] * weight;
            weight_sum += weight;
        }
        
        const threshold = weight_sum * 0.5;
        const pred = fib_sum > threshold ? "TAI" : "XIU";
        const conf = Math.round((Math.abs(fib_sum - threshold) / threshold) * 40 + 55);
        
        return {
            pred: pred,
            conf: Math.min(92, conf),
            type: "Fibonacci",
            reason: `Tổng Fibonacci: ${fib_sum}/${threshold}`
        };
    }
    
    goldenRatioPrediction(arr) {
        if (arr.length < 10) return null;
        
        const recent = arr.slice(0, 10);
        const tai_count = recent.filter(r => r === "TAI").length;
        const xiu_count = recent.filter(r => r === "XIU").length;
        
        const ratio = tai_count / (tai_count + xiu_count);
        const golden_diff = Math.abs(ratio - (1 / this.golden_ratio));
        
        if (golden_diff < 0.1) {
            const pred = tai_count > xiu_count ? "XIU" : "TAI";
            const conf = Math.round((1 - golden_diff) * 70 + 25);
            return {
                pred: pred,
                conf: Math.min(90, conf),
                type: "Golden Ratio",
                reason: `Tỷ lệ vàng: ${(ratio * 100).toFixed(1)}%`
            };
        }
        return null;
    }
    
    markovChainPrediction(arr) {
        if (arr.length < 50) return null;
        
        let transitions = { TAI: { TAI: 0, XIU: 0 }, XIU: { TAI: 0, XIU: 0 } };
        
        for (let i = 0; i < arr.length - 1; i++) {
            const current = arr[i];
            const next = arr[i + 1];
            if (current && next) {
                transitions[current][next] = (transitions[current][next] || 0) + 1;
            }
        }
        
        const last = arr[0];
        if (!last || !transitions[last]) return null;
        
        const total = transitions[last].TAI + transitions[last].XIU;
        if (total < 10) return null;
        
        const prob_tai = transitions[last].TAI / total;
        const prob_xiu = transitions[last].XIU / total;
        
        if (Math.abs(prob_tai - prob_xiu) > 0.15) {
            const pred = prob_tai > prob_xiu ? "TAI" : "XIU";
            const conf = Math.round(Math.abs(prob_tai - prob_xiu) * 80 + 15);
            return {
                pred: pred,
                conf: Math.min(88, conf),
                type: "Markov Chain",
                reason: `P(${last}→TAI)=${(prob_tai*100).toFixed(1)}%`
            };
        }
        return null;
    }
    
    weightedMovingAverage(arr) {
        if (arr.length < 15) return null;
        
        const results = arr.slice(0, 15).map(r => r === "TAI" ? 1 : 0);
        let weighted_sum = 0;
        let total_weight = 0;
        
        for (let i = 0; i < results.length; i++) {
            const weight = 1 / (i + 1);
            weighted_sum += results[i] * weight;
            total_weight += weight;
        }
        
        const avg = weighted_sum / total_weight;
        const threshold = 0.5;
        
        if (Math.abs(avg - threshold) > 0.08) {
            const pred = avg > threshold ? "TAI" : "XIU";
            const conf = Math.round(Math.abs(avg - threshold) * 120 + 30);
            return {
                pred: pred,
                conf: Math.min(85, conf),
                type: "Weighted MA",
                reason: `WMA: ${(avg*100).toFixed(1)}%`
            };
        }
        return null;
    }
    
    mlSimplePrediction(arr, points) {
        if (arr.length < 20 || points.length < 20) return null;
        
        let score = 0;
        let total_factors = 0;
        
        const recent5 = arr.slice(0, 5);
        const tai_5 = recent5.filter(r => r === "TAI").length;
        const xiu_5 = 5 - tai_5;
        if (tai_5 >= 4) { score += 2; total_factors++; }
        if (xiu_5 >= 4) { score -= 2; total_factors++; }
        
        const recent_points = points.slice(0, 5);
        const avg_points = recent_points.reduce((a, b) => a + b, 0) / recent_points.length;
        if (avg_points > 12) { score -= 1; total_factors++; }
        if (avg_points < 9) { score += 1; total_factors++; }
        
        const variance = recent_points.reduce((a, b) => a + Math.pow(b - avg_points, 2), 0) / recent_points.length;
        if (variance < 5) {
            const last = arr[0];
            if (last === "TAI") score += 1;
            else score -= 1;
            total_factors++;
        }
        
        if (arr.length >= 6) {
            if (arr[0] === arr[1] && arr[2] === arr[3] && arr[4] === arr[5] && 
                arr[0] !== arr[2] && arr[2] !== arr[4]) {
                const pred = arr[5] === "TAI" ? "XIU" : "TAI";
                return {
                    pred: pred,
                    conf: 76,
                    type: "ML Pattern",
                    reason: "Phát hiện mẫu AABBCC"
                };
            }
        }
        
        if (Math.abs(score) >= 2) {
            const pred = score > 0 ? "TAI" : "XIU";
            const conf = Math.round(Math.abs(score) * 20 + 55);
            return {
                pred: pred,
                conf: Math.min(84, conf),
                type: "ML Ensemble",
                reason: `Điểm ML: ${score}`
            };
        }
        return null;
    }
    
    waveAnalysis(arr) {
        if (arr.length < 8) return null;
        
        let up_waves = 0, down_waves = 0;
        let current_wave = 0;
        
        for (let i = 1; i < Math.min(12, arr.length); i++) {
            if (arr[i-1] === arr[i]) {
                current_wave++;
            } else {
                if (current_wave > 0) {
                    if (arr[i-1] === "TAI") up_waves++;
                    else down_waves++;
                    current_wave = 0;
                }
            }
        }
        
        if (up_waves + down_waves >= 3) {
            if (up_waves > down_waves && up_waves >= 3) {
                return { pred: "XIU", conf: 73, type: "Wave", reason: `Sóng lên ${up_waves} → hồi` };
            }
            if (down_waves > up_waves && down_waves >= 3) {
                return { pred: "TAI", conf: 73, type: "Wave", reason: `Sóng xuống ${down_waves} → hồi` };
            }
        }
        return null;
    }

    tongHopDuDoan() {
        const arr = this._arr();
        const points = this._points();
        if (arr.length < 2) return null;
        
        const old_results = [
            this.phatHienMauLap(arr),
            this.cauNoi(arr),
            this.cauDoi(arr),
            this.cauGay(arr),
            this.cauSap(arr),
            this.duDoanVi()
        ];
        
        const new_results = [
            this.fibonacciPrediction(arr),
            this.goldenRatioPrediction(arr),
            this.markovChainPrediction(arr),
            this.weightedMovingAverage(arr),
            this.mlSimplePrediction(arr, points),
            this.waveAnalysis(arr)
        ];
        
        let all_results = old_results.concat(new_results);
        all_results = all_results.filter(r => r !== null);
        
        if (all_results.length === 0) {
            return { pred: arr[0], conf: 55, type: "Theo", reason: "Bám phiên cuối" };
        }
        
        let votes = { TAI: 0, XIU: 0 };
        let total_conf = 0;
        
        for (const result of all_results) {
            const weight = result.conf / 100;
            votes[result.pred] = (votes[result.pred] || 0) + weight;
            total_conf += result.conf;
        }
        
        const pred = votes.TAI >= votes.XIU ? "TAI" : "XIU";
        const avg_conf = Math.round(total_conf / all_results.length);
        const boost = Math.abs(votes.TAI - votes.XIU) * 30;
        const final_conf = Math.min(95, avg_conf + boost);
        
        const best_result = all_results.reduce((a, b) => a.conf > b.conf ? a : b);
        
        return {
            pred: pred,
            conf: Math.round(final_conf),
            type: `${best_result.type} + ${all_results.length-1} alg`,
            reason: `${best_result.reason} | Đồng thuận: ${Math.round(Math.max(votes.TAI, votes.XIU) / (votes.TAI + votes.XIU) * 100)}%`
        };
    }

    apDungDaoChieu(p) {
        if (!p || this.history.length < 1) return p;
        const currentResult = this._arr()[0];
        if (this.error_streak >= 2 && this.last_prediction && this.last_prediction !== currentResult) {
            return {
                ...p,
                pred: p.pred === "TAI" ? "XIU" : "TAI",
                conf: Math.min(92, p.conf + 10),
                reason: `🔄 Đảo: ${p.reason}`
            };
        }
        return p;
    }

    predict(data) {
        this.loadData(data);
        let result = this.tongHopDuDoan();
        if (result) result = this.apDungDaoChieu(result);
        else result = { pred: this._arr()[0] || "TAI", conf: 50, type: "Theo", reason: "Không đủ dữ liệu" };
        
        this.last_prediction = result.pred;
        return result;
    }

    updateStatus(actual) {
        if (this.last_prediction) {
            const a = actual.toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI');
            if (this.last_prediction === a) this.error_streak = 0;
            else this.error_streak++;
        }
    }
}

const predictor = new TX_LogicPen_V4();

// --- HÀM LƯU DỮ LIỆU ---
function loadHistory() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const content = fs.readFileSync(DATA_FILE, 'utf-8');
            const data = JSON.parse(content);
            return data.history || [];
        }
    } catch (e) {
        console.error(`Lỗi đọc file: ${e.message}`);
    }
    return [];
}

function saveHistory(history) {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const limitedHistory = history.slice(-MAX_STORAGE);
    
    fs.writeFileSync(DATA_FILE, JSON.stringify({ 
        history: limitedHistory,
        total_sessions: limitedHistory.length,
        max_storage: MAX_STORAGE,
        last_updated: vnNow()
    }, null, 2));
    
    console.log(`💾 Đã lưu ${limitedHistory.length}/${MAX_STORAGE} phiên dữ liệu`);
}

function saveStatsFile() {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify({
        ...stats,
        total_predictions_made: stats.total_predictions_made,
        max_predictions: MAX_PREDICTIONS,
        min_data_required: MIN_DATA_FOR_PREDICTION,
        max_storage: MAX_STORAGE,
        prediction_started: stats.prediction_started,
        last_updated: vnNow()
    }, null, 2));
}

function loadPredictions() {
    try {
        if (fs.existsSync(PREDICTIONS_FILE)) {
            const content = fs.readFileSync(PREDICTIONS_FILE, 'utf-8');
            const data = JSON.parse(content);
            return data.predictions || [];
        }
    } catch (e) {
        console.error(`Lỗi đọc file dự đoán: ${e.message}`);
    }
    return [];
}

function savePredictions(predictions) {
    const dir = path.dirname(PREDICTIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // Giới hạn lưu 500 dự đoán gần nhất
    const limitedPredictions = predictions.slice(-500);
    
    fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify({
        predictions: limitedPredictions,
        total: limitedPredictions.length,
        last_updated: vnNow()
    }, null, 2));
}

function autoVerify(history) {
    if (stats.last_prediction && history.length > 0) {
        const lp = stats.last_prediction;
        const latest = history[history.length - 1];
        
        if (latest.phien === lp.phien) {
            const actual = latest.ket_qua || '';
            if (actual) {
                stats.total++;
                const a = actual.toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI');
                const p = lp.prediction.toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI');
                const ok = p === a;

                if (ok) stats.correct++;
                else stats.wrong++;

                predictor.updateStatus(actual);
                stats.history.push({
                    phien: latest.phien,
                    prediction: lp.prediction,
                    actual: actual,
                    confidence: lp.confidence,
                    correct: ok,
                    timestamp: vnNow()
                });

                if (stats.history.length > 500) stats.history = stats.history.slice(-500);
                
                const acc = ((stats.correct / Math.max(stats.total, 1)) * 100).toFixed(1);
                console.log(`🔍 VERIFY #${latest.phien}: ${ok ? '✅ ĐÚNG' : '❌ SAI'} | Tỷ lệ: ${acc}% (${stats.correct}/${stats.total})`);
                
                stats.last_prediction = null;
                saveStatsFile();
            }
        }
    }
}

function makePrediction(history) {
    if (history.length < 5) {
        return {
            error: true,
            message: "Chưa đủ dữ liệu để dự đoán (cần ít nhất 5 phiên)"
        };
    }
    
    if (history.length < MIN_DATA_FOR_PREDICTION) {
        return {
            error: true,
            message: `Chưa đủ ${MIN_DATA_FOR_PREDICTION} phiên dữ liệu (hiện có ${history.length} phiên)`,
            data_sessions: history.length,
            required: MIN_DATA_FOR_PREDICTION
        };
    }
    
    try {
        const r = predictor.predict(history);
        const cur = history[history.length - 1];
        let ph = cur.phien || 0;
        if (typeof ph === 'string') {
            const cleaned = ph.replace('#', '');
            ph = !isNaN(cleaned) ? parseInt(cleaned) : 0;
        }
        
        const nextPhien = ph + 1;
        
        // Lưu dự đoán vào lịch sử
        const prediction_record = {
            phien: nextPhien,
            prediction: r.pred,
            confidence: r.conf,
            algorithm: r.type,
            reason: r.reason,
            current_phien: cur.phien,
            current_result: cur.ket_qua,
            current_tong: cur.tong,
            xuc_xac: [cur.xuc_xac_1, cur.xuc_xac_2, cur.xuc_xac_3],
            timestamp: vnNow()
        };
        
        predictions_history.push(prediction_record);
        savePredictions(predictions_history);
        
        // Cập nhật stats
        stats.total_predictions_made++;
        stats.last_prediction = {
            phien: nextPhien,
            prediction: r.pred,
            confidence: r.conf
        };
        saveStatsFile();
        
        return {
            success: true,
            prediction: r.pred,
            confidence: r.conf,
            algorithm: r.type,
            reason: r.reason,
            current_phien: cur.phien,
            current_result: cur.ket_qua,
            current_tong: cur.tong,
            xuc_xac: [cur.xuc_xac_1, cur.xuc_xac_2, cur.xuc_xac_3],
            next_phien: nextPhien,
            total_predictions: stats.total_predictions_made,
            data_sessions: history.length,
            id: "@tranhoang2286",
            timestamp: vnNow()
        };
    } catch (e) {
        return {
            error: true,
            message: `Lỗi dự đoán: ${e.message}`
        };
    }
}

// --- TẠO WEB SERVER VỚI API ---
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // API dự đoán chính
    if (pathname === '/api/lonsun/tx' && req.method === 'GET') {
        const history = loadHistory();
        const result = makePrediction(history);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
        return;
    }
    
    // API lấy lịch sử dự đoán
    if (pathname === '/api/lonsun/history' && req.method === 'GET') {
        const limit = parseInt(parsedUrl.query.limit) || 50;
        const predictions = loadPredictions();
        const recent = predictions.slice(-limit);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            total: predictions.length,
            predictions: recent,
            id: "@tranhoang2286"
        }, null, 2));
        return;
    }
    
    // API lấy thống kê
    if (pathname === '/api/lonsun/stats' && req.method === 'GET') {
        const history = loadHistory();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            data_sessions: history.length,
            min_required: MIN_DATA_FOR_PREDICTION,
            predictions_made: stats.total_predictions_made,
            max_predictions: MAX_PREDICTIONS,
            accuracy: stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(2) + '%' : '0%',
            correct: stats.correct,
            wrong: stats.wrong,
            total_verified: stats.total,
            id: "@tranhoang2286",
            timestamp: vnNow()
        }, null, 2));
        return;
    }
    
    // Trang chủ - health check
    if (pathname === '/') {
        const history = loadHistory();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'running',
            service: 'SUNWIN TX Collector',
            version: '2.0.0',
            predictions_made: stats.total_predictions_made || 0,
            accuracy: stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(2) + '%' : '0%',
            data_sessions: history.length,
            min_required: MIN_DATA_FOR_PREDICTION,
            api_endpoints: [
                '/api/lonsun/tx - Dự đoán phiên tiếp theo',
                '/api/lonsun/history - Lịch sử dự đoán',
                '/api/lonsun/stats - Thống kê'
            ],
            id: '@tranhoang2286',
            timestamp: vnNow()
        }, null, 2));
        return;
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        error: true,
        message: 'Endpoint not found',
        available: ['/api/lonsun/tx', '/api/lonsun/history', '/api/lonsun/stats']
    }, null, 2));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📊 API Endpoints:`);
    console.log(`   GET /api/lonsun/tx - Dự đoán`);
    console.log(`   GET /api/lonsun/history - Lịch sử dự đoán`);
    console.log(`   GET /api/lonsun/stats - Thống kê`);
});

function safeInt(v, d = 0) {
    const parsed = parseInt(v);
    return isNaN(parsed) ? d : parsed;
}

// --- COLLECTOR CHẠY NỀN ---
async function collect() {
    console.log("🚀 SUNWIN TX COLLECTOR - KHỞI ĐỘNG");
    console.log("═══════════════════════════════════════════");
    console.log(`📊 Yêu cầu dữ liệu tối thiểu: ${MIN_DATA_FOR_PREDICTION.toLocaleString()} phiên`);
    console.log(`🎯 Giới hạn dự đoán: ${MAX_PREDICTIONS.toLocaleString()} phiên`);
    console.log(`💾 Giới hạn lưu trữ: ${MAX_STORAGE.toLocaleString()} phiên`);
    console.log(`🧠 Thuật toán: 6 thuật toán cũ + 6 thuật toán mới`);
    console.log(`👤 ID: @tranhoang2286`);
    console.log(`🌐 API: http://0.0.0.0:${PORT}/api/lonsun/tx`);
    console.log("═══════════════════════════════════════════\n");
    
    // Tải dữ liệu
    let history = loadHistory();
    predictions_history = loadPredictions();
    
    console.log(`📚 Đã tải ${history.length.toLocaleString()} phiên dữ liệu hiện có`);
    console.log(`📚 Đã tải ${predictions_history.length} dự đoán đã lưu`);
    
    try {
        if (fs.existsSync(STATS_FILE)) {
            const savedStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
            stats = { ...stats, ...savedStats };
            console.log(`📈 Đã dự đoán ${stats.total_predictions_made.toLocaleString()}/${MAX_PREDICTIONS.toLocaleString()} phiên`);
            console.log(`📊 Tỷ lệ đúng: ${((stats.correct/Math.max(stats.total,1))*100).toFixed(1)}% (${stats.correct}/${stats.total})\n`);
        }
    } catch (e) {}
    
    // Vòng lặp thu thập dữ liệu
    while (true) {
        try {
            const response = await axios.get(API_URL, { timeout: 15000 });
            if (response.status === 200) {
                let apiData = [];
                if (Array.isArray(response.data)) {
                    apiData = response.data;
                } else if (response.data.data && Array.isArray(response.data.data)) {
                    apiData = response.data.data;
                } else if (response.data.ket_qua) {
                    apiData = [response.data];
                }
                
                if (apiData.length > 0) {
                    let existing = new Set(history.map(h => h.phien));
                    let newSessions = [];

                    for (const item of apiData) {
                        const ph = safeInt(item.phien || item.Phien);
                        if (ph <= 0 || existing.has(ph)) continue;

                        const newItem = {
                            phien: ph,
                            ket_qua: String(item.ket_qua || item.Ket_qua || ""),
                            tong: safeInt(item.tong || item.Tong),
                            xuc_xac_1: safeInt(item.xuc_xac_1 || item.Xuc_xac_1),
                            xuc_xac_2: safeInt(item.xuc_xac_2 || item.Xuc_xac_2),
                            xuc_xac_3: safeInt(item.xuc_xac_3 || item.Xuc_xac_3)
                        };
                        
                        history.push(newItem);
                        existing.add(ph);
                        newSessions.push(newItem);
                    }

                    if (newSessions.length > 0) {
                        if (history.length > MAX_STORAGE) {
                            history = history.slice(-MAX_STORAGE);
                        }
                        
                        history.sort((a, b) => a.phien - b.phien);
                        saveHistory(history);
                        
                        const latest = history[history.length - 1];
                        console.log(`🎲 KQ #${latest.phien}: ${latest.ket_qua} | [${latest.xuc_xac_1},${latest.xuc_xac_2},${latest.xuc_xac_3}] = ${latest.tong} | Tổng: ${history.length}`);
                        
                        autoVerify(history);
                    }
                }
            }
        } catch (e) {
            console.error(`❌ Lỗi collector: ${e.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

process.on('SIGINT', () => {
    console.log("\n🛑 Đang dừng chương trình...");
    saveStatsFile();
    savePredictions(predictions_history);
    console.log("✅ Đã lưu thống kê và dự đoán!");
    process.exit();
});

// Chạy chương trình
collect().catch(console.error);
