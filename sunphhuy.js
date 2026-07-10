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
const DELETION_LOG_FILE = "database/deletion_log.json";

// Các giới hạn
const MIN_DATA_FOR_PREDICTION = 5;
const MAX_PREDICTIONS = 100000;
const MAX_STORAGE = 1000000;
const DELETION_INTERVAL = 6 * 60 * 60 * 1000; // 6 giờ

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
    prediction_started: false,
    total_deleted: 0,
    last_deletion: null
};

let predictions_history = [];

// ============================================================
// 1. THUẬT TOÁN XÓA RANDOM NÂNG CẤP
// ============================================================
class RandomDeletionAlgorithm {
    constructor() {
        this.deletion_history = [];
        this.last_deletion_time = null;
        this.deletion_count = 0;
        this.max_deletions_per_hour = 100;
        this.smart_threshold = 0.7;
        this.total_deleted_sessions = 0;
        this.deletion_patterns = {
            duplicates: 0,
            outliers: 0,
            low_quality: 0,
            old_data: 0,
            clusters: 0
        };
    }

    // 1. Phân tích dữ liệu để xác định dữ liệu cần xóa thông minh
    analyzeDataForDeletion(data) {
        if (!data || data.length === 0) {
            return { should_delete: false, reason: 'Không có dữ liệu' };
        }

        const analysis = {
            total_records: data.length,
            duplicate_patterns: this.findDuplicatePatterns(data),
            outlier_scores: this.calculateOutlierScores(data),
            temporal_clusters: this.findTemporalClusters(data),
            quality_scores: this.calculateQualityScores(data),
            deletion_candidates: [],
            data_health_score: 0
        };

        // Xác định ứng viên xóa dựa trên nhiều tiêu chí
        analysis.deletion_candidates = this.identifyDeletionCandidates(data, analysis);
        
        // Tính điểm sức khỏe dữ liệu
        analysis.data_health_score = this.calculateDataHealthScore(analysis);
        
        return analysis;
    }

    // 2. Tìm pattern trùng lặp thông minh
    findDuplicatePatterns(data) {
        const patterns = {};
        const duplicates = [];
        
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            const key = this.generatePatternKey(item);
            
            if (patterns[key]) {
                patterns[key].push(i);
            } else {
                patterns[key] = [i];
            }
        }

        for (const [key, indices] of Object.entries(patterns)) {
            if (indices.length > 1) {
                duplicates.push({
                    pattern: key,
                    indices: indices,
                    count: indices.length,
                    keep_index: this.findBestQualityIndex(indices, data)
                });
            }
        }

        return duplicates;
    }

    // 3. Tính điểm chất lượng cho từng bản ghi
    calculateQualityScores(data) {
        return data.map((item, index) => {
            let score = 0;
            
            const completeness = this.checkCompleteness(item);
            score += completeness * 0.3;

            const validity = this.checkValidity(item);
            score += validity * 0.3;

            const recency = this.checkRecency(item, index, data.length);
            score += recency * 0.2;

            const reliability = this.checkReliability(item);
            score += reliability * 0.2;

            return {
                index,
                score,
                completeness,
                validity,
                recency,
                reliability,
                phien: item.phien,
                ket_qua: item.ket_qua
            };
        });
    }

    // 4. Phát hiện cụm thời gian để xóa theo nhóm
    findTemporalClusters(data) {
        const clusters = [];
        let current_cluster = [];
        const time_threshold = 5;

        for (let i = 1; i < data.length; i++) {
            const gap = Math.abs(data[i].phien - data[i-1].phien);
            
            if (gap <= time_threshold) {
                if (current_cluster.length === 0) {
                    current_cluster.push(i-1);
                }
                current_cluster.push(i);
            } else {
                if (current_cluster.length > 0) {
                    clusters.push({
                        indices: current_cluster,
                        size: current_cluster.length,
                        start_phien: data[current_cluster[0]].phien,
                        end_phien: data[current_cluster[current_cluster.length-1]].phien
                    });
                    current_cluster = [];
                }
            }
        }

        return clusters;
    }

    // 5. Tính điểm outlier cho từng bản ghi
    calculateOutlierScores(data) {
        const scores = [];
        const values = data.map(item => item.tong || 0);
        
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);
        
        for (let i = 0; i < data.length; i++) {
            const value = data[i].tong || 0;
            const z_score = Math.abs((value - mean) / (std || 1));
            scores.push({
                index: i,
                z_score: z_score,
                is_outlier: z_score > 2.5,
                value: value,
                phien: data[i].phien
            });
        }
        
        return scores;
    }

    // 6. Xác định ứng viên xóa thông minh
    identifyDeletionCandidates(data, analysis) {
        const candidates = [];
        
        // Đánh dấu các bản ghi chất lượng thấp
        analysis.quality_scores.forEach((q, index) => {
            if (q.score < 0.3) {
                candidates.push({
                    index: index,
                    reason: 'Chất lượng thấp',
                    score: q.score,
                    priority: 5,
                    phien: data[index].phien
                });
                this.deletion_patterns.low_quality++;
            }
        });

        // Đánh dấu các bản ghi trùng lặp
        analysis.duplicate_patterns.forEach(dup => {
            dup.indices.forEach(idx => {
                if (idx !== dup.keep_index) {
                    candidates.push({
                        index: idx,
                        reason: 'Trùng lặp',
                        priority: 4,
                        phien: data[idx].phien
                    });
                    this.deletion_patterns.duplicates++;
                }
            });
        });

        // Đánh dấu outlier
        analysis.outlier_scores.forEach(out => {
            if (out.is_outlier && out.z_score > 3) {
                candidates.push({
                    index: out.index,
                    reason: 'Outlier cực đoan',
                    priority: 3,
                    z_score: out.z_score,
                    phien: out.phien
                });
                this.deletion_patterns.outliers++;
            }
        });

        // Đánh dấu các bản ghi cũ trong cluster lớn
        analysis.temporal_clusters.forEach(cluster => {
            if (cluster.size > 20) {
                const to_remove = Math.floor(cluster.size * 0.3);
                for (let i = 0; i < to_remove; i++) {
                    candidates.push({
                        index: cluster.indices[i],
                        reason: 'Cluster cũ',
                        priority: 2,
                        phien: data[cluster.indices[i]].phien
                    });
                    this.deletion_patterns.clusters++;
                }
            }
        });

        const unique_candidates = this.removeDuplicateCandidates(candidates);
        unique_candidates.sort((a, b) => a.priority - b.priority);

        return unique_candidates;
    }

    // 7. Thực hiện xóa thông minh
    smartDeletion(data, target_remove_count = null) {
        const analysis = this.analyzeDataForDeletion(data);
        
        if (analysis.deletion_candidates.length === 0) {
            return {
                deleted: [],
                kept: data,
                message: 'Không có dữ liệu cần xóa',
                deleted_count: 0,
                kept_count: data.length
            };
        }

        let remove_count = target_remove_count || Math.min(
            analysis.deletion_candidates.length,
            Math.floor(data.length * 0.1)
        );

        // Không xóa quá 50% dữ liệu
        if (remove_count > data.length * 0.5) {
            remove_count = Math.floor(data.length * 0.5);
        }

        const indices_to_delete = analysis.deletion_candidates
            .slice(0, remove_count)
            .map(c => c.index);

        const kept_data = data.filter((_, index) => !indices_to_delete.includes(index));
        const deleted_data = data.filter((_, index) => indices_to_delete.includes(index));

        // Cập nhật thống kê
        this.deletion_history.push({
            timestamp: vnNow(),
            deleted_count: deleted_data.length,
            kept_count: kept_data.length,
            reasons: analysis.deletion_candidates.slice(0, remove_count).map(c => c.reason),
            patterns: { ...this.deletion_patterns }
        });

        this.deletion_count += deleted_data.length;
        this.total_deleted_sessions += deleted_data.length;
        this.last_deletion_time = vnNow();

        // Reset patterns
        this.deletion_patterns = {
            duplicates: 0,
            outliers: 0,
            low_quality: 0,
            old_data: 0,
            clusters: 0
        };

        return {
            deleted: deleted_data,
            kept: kept_data,
            deleted_count: deleted_data.length,
            kept_count: kept_data.length,
            analysis: analysis,
            summary: {
                total_deleted: this.total_deleted_sessions,
                last_deletion: this.last_deletion_time,
                deletion_rate: (this.total_deleted_sessions / data.length * 100).toFixed(2) + '%'
            },
            message: `Đã xóa ${deleted_data.length} bản ghi, giữ lại ${kept_data.length} bản ghi`
        };
    }

    // 8. Xóa theo chiến lược thích ứng
    adaptiveDeletion(data, strategy = 'balanced') {
        const strategies = {
            aggressive: 0.2,
            balanced: 0.1,
            conservative: 0.05
        };

        const remove_ratio = strategies[strategy] || strategies.balanced;
        const remove_count = Math.floor(data.length * remove_ratio);

        return this.smartDeletion(data, remove_count);
    }

    // 9. Xóa theo chu kỳ
    cyclicDeletion(data, interval_days = 7) {
        const now = new Date();
        const cutoff = new Date(now.getTime() - interval_days * 24 * 60 * 60 * 1000);
        
        const old_data = data.filter(item => {
            const item_date = new Date(item.timestamp || item.last_updated || vnNow());
            return item_date < cutoff;
        });

        if (old_data.length === 0) {
            return {
                deleted: [],
                kept: data,
                message: 'Không có dữ liệu cũ hơn ' + interval_days + ' ngày',
                deleted_count: 0,
                kept_count: data.length
            };
        }

        const to_delete = old_data.slice(0, Math.floor(old_data.length * 0.5));
        const kept_data = data.filter(item => !to_delete.includes(item));

        this.deletion_patterns.old_data += to_delete.length;

        return {
            deleted: to_delete,
            kept: kept_data,
            deleted_count: to_delete.length,
            kept_count: kept_data.length,
            message: `Đã xóa ${to_delete.length} bản ghi cũ hơn ${interval_days} ngày`
        };
    }

    // 10. Xóa ngẫu nhiên có kiểm soát
    controlledRandomDeletion(data, percentage = 5) {
        if (data.length === 0 || percentage <= 0) {
            return {
                deleted: [],
                kept: data,
                message: 'Không có dữ liệu hoặc percentage không hợp lệ'
            };
        }

        const shuffled = [...data];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const delete_count = Math.floor(data.length * (percentage / 100));
        const to_delete = shuffled.slice(0, delete_count);
        const kept_data = data.filter(item => !to_delete.includes(item));

        return {
            deleted: to_delete,
            kept: kept_data,
            deleted_count: to_delete.length,
            kept_count: kept_data.length,
            message: `Đã xóa ngẫu nhiên ${delete_count} bản ghi (${percentage}%)`
        };
    }

    // 11. Xóa dựa trên độ tuổi dữ liệu
    ageBasedDeletion(data, max_age_phien = 100) {
        const current_max = Math.max(...data.map(d => d.phien || 0));
        const cutoff_phien = current_max - max_age_phien;

        const old_data = data.filter(item => (item.phien || 0) < cutoff_phien);
        const kept_data = data.filter(item => (item.phien || 0) >= cutoff_phien);

        if (old_data.length === 0) {
            return {
                deleted: [],
                kept: data,
                message: 'Không có dữ liệu cũ hơn ' + max_age_phien + ' phiên'
            };
        }

        return {
            deleted: old_data,
            kept: kept_data,
            deleted_count: old_data.length,
            kept_count: kept_data.length,
            message: `Đã xóa ${old_data.length} bản ghi cũ hơn ${max_age_phien} phiên`
        };
    }

    // Helper methods
    generatePatternKey(item) {
        return `${item.ket_qua || ''}_${item.tong || 0}_${item.xuc_xac_1 || 0}_${item.xuc_xac_2 || 0}_${item.xuc_xac_3 || 0}`;
    }

    findBestQualityIndex(indices, data) {
        let best_index = indices[0];
        let best_score = -1;

        indices.forEach(idx => {
            const score = this.calculateSingleQualityScore(data[idx]);
            if (score > best_score) {
                best_score = score;
                best_index = idx;
            }
        });

        return best_index;
    }

    calculateSingleQualityScore(item) {
        let score = 0;
        const fields = ['phien', 'ket_qua', 'tong', 'xuc_xac_1', 'xuc_xac_2', 'xuc_xac_3'];
        const completeness = fields.filter(f => item[f] !== undefined && item[f] !== null && item[f] !== '').length / fields.length;
        score += completeness * 0.4;

        const isValid = (item.tong || 0) >= 3 && (item.tong || 0) <= 18;
        score += isValid ? 0.3 : 0;

        const diceValid = [1,2,3].every(i => {
            const val = item[`xuc_xac_${i}`];
            return val >= 1 && val <= 6;
        });
        score += diceValid ? 0.3 : 0;

        return score;
    }

    checkCompleteness(item) {
        const fields = ['phien', 'ket_qua', 'tong', 'xuc_xac_1', 'xuc_xac_2', 'xuc_xac_3'];
        const filled = fields.filter(f => item[f] !== undefined && item[f] !== null && item[f] !== '').length;
        return filled / fields.length;
    }

    checkValidity(item) {
        if (item.tong < 3 || item.tong > 18) return 0;
        if (item.xuc_xac_1 < 1 || item.xuc_xac_1 > 6) return 0;
        if (item.xuc_xac_2 < 1 || item.xuc_xac_2 > 6) return 0;
        if (item.xuc_xac_3 < 1 || item.xuc_xac_3 > 6) return 0;
        if (item.xuc_xac_1 + item.xuc_xac_2 + item.xuc_xac_3 !== item.tong) return 0.5;
        return 1;
    }

    checkRecency(item, index, total) {
        const recency = 1 - (index / total);
        return Math.max(0, recency);
    }

    checkReliability(item) {
        let score = 0;
        if (item.source === 'official') score += 0.3;
        if (item.verified) score += 0.3;
        if (item.confidence && item.confidence > 0.8) score += 0.4;
        return Math.min(1, score + 0.3);
    }

    removeDuplicateCandidates(candidates) {
        const seen = new Set();
        return candidates.filter(c => {
            if (seen.has(c.index)) return false;
            seen.add(c.index);
            return true;
        });
    }

    calculateDataHealthScore(analysis) {
        let score = 100;
        
        // Trừ điểm cho các vấn đề
        score -= analysis.duplicate_patterns.length * 2;
        score -= analysis.outlier_scores.filter(o => o.is_outlier).length * 1.5;
        score -= analysis.quality_scores.filter(q => q.score < 0.5).length * 1;
        
        // Đảm bảo score trong khoảng 0-100
        return Math.max(0, Math.min(100, score));
    }

    getDeletionStats() {
        return {
            total_deletions: this.total_deleted_sessions,
            last_deletion: this.last_deletion_time,
            history: this.deletion_history.slice(-10),
            average_deletion_rate: this.deletion_history.length > 0 
                ? (this.deletion_history.reduce((sum, h) => sum + h.deleted_count, 0) / this.deletion_history.length)
                : 0,
            patterns: this.deletion_patterns
        };
    }

    // 12. Xóa thông minh tổng hợp
    comprehensiveDeletion(data) {
        let result = { ...data };
        let total_deleted = 0;
        let deletion_results = [];

        // Bước 1: Xóa theo tuổi dữ liệu
        const age_result = this.ageBasedDeletion(result, 200);
        if (age_result.deleted_count > 0) {
            total_deleted += age_result.deleted_count;
            deletion_results.push({ step: 'Age-based', ...age_result });
            result = age_result.kept;
        }

        // Bước 2: Xóa trùng lặp và chất lượng thấp
        const smart_result = this.smartDeletion(result);
        if (smart_result.deleted_count > 0) {
            total_deleted += smart_result.deleted_count;
            deletion_results.push({ step: 'Smart deletion', ...smart_result });
            result = smart_result.kept;
        }

        // Bước 3: Xóa cluster nếu cần
        const analysis = this.analyzeDataForDeletion(result);
        if (analysis.temporal_clusters.length > 0 && analysis.temporal_clusters.some(c => c.size > 30)) {
            const cluster_result = this.smartDeletion(result, Math.floor(result.length * 0.05));
            if (cluster_result.deleted_count > 0) {
                total_deleted += cluster_result.deleted_count;
                deletion_results.push({ step: 'Cluster cleanup', ...cluster_result });
                result = cluster_result.kept;
            }
        }

        return {
            deleted_count: total_deleted,
            kept: result,
            kept_count: result.length,
            steps: deletion_results,
            message: `Hoàn thành xóa tổng hợp: đã xóa ${total_deleted} bản ghi`
        };
    }
}

// ============================================================
// 2. HÀM XÓA DỮ LIỆU ĐỊNH KỲ
// ============================================================
const randomDeletion = new RandomDeletionAlgorithm();

function performScheduledDeletion() {
    console.log('\n🧹 BẮT ĐẦU XÓA DỮ LIỆU THÔNG MINH');
    console.log('═══════════════════════════════════════════');
    
    const history = loadHistory();
    
    if (history.length < 50) {
        console.log('📊 Dữ liệu quá ít (< 50), bỏ qua xóa');
        return;
    }

    console.log(`📚 Tổng dữ liệu hiện tại: ${history.length.toLocaleString()} phiên`);

    // Sử dụng chiến lược tổng hợp
    const result = randomDeletion.comprehensiveDeletion(history);
    
    if (result.deleted_count > 0) {
        // Lưu log xóa
        const deletion_log = {
            timestamp: vnNow(),
            deleted_count: result.deleted_count,
            kept_count: result.kept_count,
            total_before: history.length,
            total_after: result.kept_count,
            steps: result.steps.map(s => ({
                step: s.step,
                deleted: s.deleted_count,
                kept: s.kept_count
            })),
            stats: randomDeletion.getDeletionStats()
        };

        // Lưu log
        let logs = [];
        try {
            if (fs.existsSync(DELETION_LOG_FILE)) {
                logs = JSON.parse(fs.readFileSync(DELETION_LOG_FILE, 'utf-8'));
            }
        } catch (e) {}
        
        logs.push(deletion_log);
        if (logs.length > 100) logs = logs.slice(-100);
        
        fs.writeFileSync(DELETION_LOG_FILE, JSON.stringify(logs, null, 2));
        
        // Backup dữ liệu xóa
        const backup_dir = 'database/backups';
        if (!fs.existsSync(backup_dir)) {
            fs.mkdirSync(backup_dir, { recursive: true });
        }
        
        // Lưu riêng từng bước xóa
        result.steps.forEach((step, idx) => {
            if (step.deleted && step.deleted.length > 0) {
                const backup_file = path.join(backup_dir, `deleted_${Date.now()}_step${idx+1}.json`);
                fs.writeFileSync(backup_file, JSON.stringify(step.deleted, null, 2));
            }
        });
        
        // Lưu dữ liệu đã xóa tổng hợp
        const backup_file = path.join(backup_dir, `deleted_summary_${Date.now()}.json`);
        const deleted_data = history.filter(item => !result.kept.includes(item));
        fs.writeFileSync(backup_file, JSON.stringify(deleted_data, null, 2));
        
        // Cập nhật dữ liệu chính
        saveHistory(result.kept);
        
        // Cập nhật stats
        stats.total_deleted = (stats.total_deleted || 0) + result.deleted_count;
        stats.last_deletion = vnNow();
        saveStatsFile();
        
        console.log(`✅ ĐÃ XÓA: ${result.deleted_count.toLocaleString()} bản ghi`);
        console.log(`📦 GIỮ LẠI: ${result.kept_count.toLocaleString()} bản ghi`);
        console.log(`📊 TỔNG ĐÃ XÓA: ${stats.total_deleted.toLocaleString()} bản ghi`);
        console.log(`📝 LOG XÓA: ${DELETION_LOG_FILE}`);
        console.log(`💾 BACKUP: ${backup_dir}`);
        
        // Hiển thị phân tích
        console.log('\n📊 PHÂN TÍCH XÓA:');
        const analysis = randomDeletion.analyzeDataForDeletion(history);
        console.log(`   - Điểm sức khỏe dữ liệu: ${analysis.data_health_score}/100`);
        console.log(`   - Trùng lặp: ${analysis.duplicate_patterns.length} pattern`);
        console.log(`   - Outlier: ${analysis.outlier_scores.filter(o => o.is_outlier).length} bản ghi`);
        console.log(`   - Chất lượng thấp: ${analysis.quality_scores.filter(q => q.score < 0.5).length} bản ghi`);
    } else {
        console.log('ℹ️ Không có dữ liệu cần xóa');
    }
}

// ============================================================
// 3. THUẬT TOÁN DỰ ĐOÁN V4 (GIỮ NGUYÊN)
// ============================================================
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

    // Các phương thức dự đoán (giữ nguyên)
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

// ============================================================
// 4. HÀM LƯU DỮ LIỆU (CÓ HỖ TRỢ XÓA)
// ============================================================
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
        last_updated: vnNow(),
        total_deleted: stats.total_deleted || 0
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
        total_deleted: stats.total_deleted || 0,
        last_deletion: stats.last_deletion || null,
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
                console.log(`🔍 XÁC MINH #${latest.phien}: ${ok ? '✅ ĐÚNG' : '❌ SAI'} | Tỷ lệ: ${acc}% (${stats.correct}/${stats.total})`);
                
                stats.last_prediction = null;
                saveStatsFile();
            }
        }
    }
}

// ============================================================
// 5. HÀM DỰ ĐOÁN
// ============================================================
function makePrediction(history) {
    if (history.length < MIN_DATA_FOR_PREDICTION) {
        return {
            error: true,
            message: `Chưa đủ ${MIN_DATA_FOR_PREDICTION} phiên dữ liệu để dự đoán (hiện có ${history.length} phiên)`,
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
        
        stats.total_predictions_made++;
        stats.last_prediction = {
            phien: nextPhien,
            prediction: r.pred,
            confidence: r.conf
        };
        saveStatsFile();
        
        return {
            "phiên": cur.phien,
            "xúc xắc 1": cur.xuc_xac_1 || 0,
            "xúc xắc 2": cur.xuc_xac_2 || 0,
            "xúc xắc 3": cur.xuc_xac_3 || 0,
            "tổng": cur.tong || 0,
            "kết quả": cur.ket_qua || "",
            "phiên dự đoán": nextPhien,
            "dự đoán": r.pred,
            "tỉ lệ": r.conf + "%",
            "id": "@tranhoang2286"
        };
    } catch (e) {
        return {
            error: true,
            message: `Lỗi dự đoán: ${e.message}`
        };
    }
}

// ============================================================
// 6. WEB SERVER VỚI API
// ============================================================
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
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
        
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result, null, 2));
        return;
    }
    
    // API lấy lịch sử dự đoán
    if (pathname === '/api/lonsun/history' && req.method === 'GET') {
        const limit = parseInt(parsedUrl.query.limit) || 50;
        const predictions = loadPredictions();
        const recent = predictions.slice(-limit);
        
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
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
        
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
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
            total_deleted: stats.total_deleted || 0,
            last_deletion: stats.last_deletion || null,
            deletion_stats: randomDeletion.getDeletionStats(),
            id: "@tranhoang2286",
            timestamp: vnNow()
        }, null, 2));
        return;
    }
    
    // API xóa dữ liệu thủ công
    if (pathname === '/api/lonsun/delete' && req.method === 'POST') {
        const history = loadHistory();
        const strategy = parsedUrl.query.strategy || 'balanced';
        const result = randomDeletion.adaptiveDeletion(history, strategy);
        
        if (result.deleted_count > 0) {
            saveHistory(result.kept);
            stats.total_deleted = (stats.total_deleted || 0) + result.deleted_count;
            stats.last_deletion = vnNow();
            saveStatsFile();
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            success: true,
            ...result,
            id: "@tranhoang2286",
            timestamp: vnNow()
        }, null, 2));
        return;
    }
    
    // API lấy log xóa
    if (pathname === '/api/lonsun/deletion-log' && req.method === 'GET') {
        let logs = [];
        try {
            if (fs.existsSync(DELETION_LOG_FILE)) {
                logs = JSON.parse(fs.readFileSync(DELETION_LOG_FILE, 'utf-8'));
            }
        } catch (e) {}
        
        const limit = parseInt(parsedUrl.query.limit) || 20;
        const recent = logs.slice(-limit);
        
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            success: true,
            total: logs.length,
            logs: recent,
            id: "@tranhoang2286",
            timestamp: vnNow()
        }, null, 2));
        return;
    }
    
    // Trang chủ
    if (pathname === '/') {
        const history = loadHistory();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            status: 'running',
            service: 'SUNWIN TX Collector V2',
            version: '2.1.0',
            predictions_made: stats.total_predictions_made || 0,
            accuracy: stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(2) + '%' : '0%',
            data_sessions: history.length,
            min_required: MIN_DATA_FOR_PREDICTION,
            total_deleted: stats.total_deleted || 0,
            deletion_enabled: true,
            api_endpoints: [
                'GET /api/lonsun/tx - Dự đoán phiên tiếp theo',
                'GET /api/lonsun/history - Lịch sử dự đoán',
                'GET /api/lonsun/stats - Thống kê',
                'POST /api/lonsun/delete?strategy=balanced - Xóa dữ liệu thủ công',
                'GET /api/lonsun/deletion-log - Xem log xóa'
            ],
            deletion_strategies: ['aggressive', 'balanced', 'conservative'],
            id: '@tranhoang2286',
            timestamp: vnNow()
        }, null, 2));
        return;
    }
    
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
        error: true,
        message: 'Không tìm thấy endpoint',
        available: ['/api/lonsun/tx', '/api/lonsun/history', '/api/lonsun/stats', '/api/lonsun/delete', '/api/lonsun/deletion-log']
    }, null, 2));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server đang chạy trên port ${PORT}`);
    console.log(`📊 Các API:`);
    console.log(`   GET /api/lonsun/tx - Dự đoán phiên tiếp theo`);
    console.log(`   GET /api/lonsun/history - Xem lịch sử dự đoán`);
    console.log(`   GET /api/lonsun/stats - Xem thống kê`);
    console.log(`   POST /api/lonsun/delete?strategy=balanced - Xóa dữ liệu thủ công`);
    console.log(`   GET /api/lonsun/deletion-log - Xem log xóa`);
});

function safeInt(v, d = 0) {
    const parsed = parseInt(v);
    return isNaN(parsed) ? d : parsed;
}

// ============================================================
// 7. COLLECTOR CHÍNH
// ============================================================
async function collect() {
    console.log("🚀 SUNWIN TX COLLECTOR V2.1 - KHỞI ĐỘNG");
    console.log("═══════════════════════════════════════════");
    console.log(`📊 Yêu cầu dữ liệu tối thiểu: ${MIN_DATA_FOR_PREDICTION} phiên`);
    console.log(`🎯 Giới hạn dự đoán: ${MAX_PREDICTIONS.toLocaleString()} phiên`);
    console.log(`💾 Giới hạn lưu trữ: ${MAX_STORAGE.toLocaleString()} phiên`);
    console.log(`🧠 Thuật toán: 6 thuật toán cũ + 6 thuật toán mới`);
    console.log(`🗑️  Xóa thông minh: Mỗi ${DELETION_INTERVAL/3600000} giờ`);
    console.log(`👤 ID: @tranhoang2286`);
    console.log(`🌐 API: http://0.0.0.0:${PORT}/api/lonsun/tx`);
    console.log("═══════════════════════════════════════════\n");
    
    let history = loadHistory();
    predictions_history = loadPredictions();
    
    console.log(`📚 Đã tải ${history.length.toLocaleString()} phiên dữ liệu hiện có`);
    console.log(`📚 Đã tải ${predictions_history.length} dự đoán đã lưu`);
    
    try {
        if (fs.existsSync(STATS_FILE)) {
            const savedStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
            stats = { ...stats, ...savedStats };
            console.log(`📈 Đã dự đoán ${stats.total_predictions_made.toLocaleString()}/${MAX_PREDICTIONS.toLocaleString()} phiên`);
            console.log(`📊 Tỷ lệ đúng: ${((stats.correct/Math.max(stats.total,1))*100).toFixed(1)}% (${stats.correct}/${stats.total})`);
            console.log(`🗑️  Đã xóa: ${(stats.total_deleted || 0).toLocaleString()} bản ghi`);
            console.log(`📅 Lần xóa cuối: ${stats.last_deletion || 'Chưa có'}\n`);
        }
    } catch (e) {}
    
    let last_deletion_check = Date.now();
    
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
        
        // Kiểm tra xóa định kỳ
        if (Date.now() - last_deletion_check >= DELETION_INTERVAL) {
            performScheduledDeletion();
            last_deletion_check = Date.now();
            
            // Reload history sau khi xóa
            history = loadHistory();
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

// ============================================================
// 8. XỬ LÝ THOÁT
// ============================================================
process.on('SIGINT', () => {
    console.log("\n🛑 Đang dừng chương trình...");
    saveStatsFile();
    savePredictions(predictions_history);
    console.log("✅ Đã lưu thống kê và dự đoán!");
    
    // Lưu log xóa cuối cùng
    console.log("📊 Thống kê xóa cuối cùng:", randomDeletion.getDeletionStats());
    process.exit();
});

// ============================================================
// 9. KHỞI CHẠY
// ============================================================
collect().catch(console.error);
