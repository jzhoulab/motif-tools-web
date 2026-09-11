// @ts-nocheck
// -------- Tomtom helpers --------
// Ported from memesuite-lite (https://github.com/jmschrei/memesuite-lite),
// Copyright (c) Jacob Schreiber, MIT license — see THIRD_PARTY_NOTICES.md.
// Algorithm: Gupta et al., "Quantifying similarity between motifs", Genome Biology (2007).
export function flattenPpmColumns(ppm) {
    const L = ppm[0].length;
    const out = new Float64Array(L * 4);
    for (let i = 0; i < L; i++) {
        const idx = i * 4;
        out[idx + 0] = ppm[0][i];
        out[idx + 1] = ppm[1][i];
        out[idx + 2] = ppm[2][i];
        out[idx + 3] = ppm[3][i];
    }
    return out;
}

export function columnNormsFromFlat(flat) {
    const L = flat.length / 4;
    const out = new Float64Array(L);
    for (let i = 0; i < L; i++) {
        const idx = i * 4;
        const a = flat[idx], c = flat[idx + 1], g = flat[idx + 2], t = flat[idx + 3];
        out[i] = a * a + c * c + g * g + t * t;
    }
    return out;
}

export function reverseComplementFlat(flat, L) {
    const out = new Float64Array(flat.length);
    for (let i = 0; i < L; i++) {
        const src = (L - 1 - i) * 4;
        const dst = i * 4;
        out[dst + 0] = flat[src + 3];
        out[dst + 1] = flat[src + 2];
        out[dst + 2] = flat[src + 1];
        out[dst + 3] = flat[src + 0];
    }
    return out;
}

export function reverseComplementString(seq) {
    const map = { A: "T", C: "G", G: "C", T: "A" };
    return seq.split("").reverse().map(ch => map[ch.toUpperCase()] || ch).join("");
}

export function buildLogoCols(lo) {
    const L = lo[0].length;
    const cols = new Array(L);
    for (let j = 0; j < L; j++) {
        cols[j] = [lo[0][j], lo[1][j], lo[2][j], lo[3][j]];
    }
    return cols;
}

export function reverseLogoCols(cols) {
    const L = cols.length;
    const out = new Array(L);
    for (let i = 0; i < L; i++) {
        const src = cols[L - 1 - i];
        out[i] = [src[3], src[2], src[1], src[0]];
    }
    return out;
}

export function buildTomTomCaches(motifs) {
    return {
        base: buildTomTomCache(motifs, false),
        withRC: buildTomTomCache(motifs, true)
    };
}

function buildTomTomCache(motifs, includeRC) {
    if (!motifs.length) return null;
    const motifCount = motifs.length;
    let totalColsSingle = 0;
    for (const m of motifs) totalColsSingle += m.L;
    const strandMult = includeRC ? 2 : 1;
    const totalCols = totalColsSingle * strandMult;
    if (totalCols === 0) return null;
    const columns = new Float64Array(totalCols * 4);
    const norms = new Float64Array(totalCols);
    const lens = new Uint32Array(motifCount * strandMult);
    const offsets = new Uint32Array(motifCount * strandMult);
    const meta = new Array(motifCount * strandMult);
    let cursor = 0;
    for (let i = 0; i < motifCount; i++) {
        const m = motifs[i];
        offsets[i] = cursor;
        lens[i] = m.L;
        columns.set(m.tomFlat, cursor * 4);
        norms.set(m.tomNorm, cursor);
        meta[i] = { motifIndex: i, rc: 0 };
        cursor += m.L;
    }
    if (includeRC) {
        for (let i = 0; i < motifCount; i++) {
            const idx = motifCount + i;
            const m = motifs[i];
            offsets[idx] = cursor;
            lens[idx] = m.L;
            columns.set(m.tomFlatRC, cursor * 4);
            norms.set(m.tomNorm, cursor);
            meta[idx] = { motifIndex: i, rc: 1 };
            cursor += m.L;
        }
    }
    const totalColsFinal = cursor;
    const rrInv = new Uint32Array(totalColsFinal);
    const rrCounts = new Float64Array(totalColsFinal);
    for (let i = 0; i < totalColsFinal; i++) { rrInv[i] = i; rrCounts[i] = 1; }
    let tMax = 0;
    for (const len of lens) if (len > tMax) tMax = len;
    return { columns, norms, lens, offsets, totalCols: totalColsFinal, rrInv, rrCounts, meta, motifCount, includeRC, tMax };
}

export function binnedMedian(gamma, colIdx, nt, binsCount, binsSum, xMin, xMax, counts, stride) {
    binsCount.fill(0); binsSum.fill(0);
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax === xMin) xMax = xMin + 1;
    const range = xMax - xMin;
    const bins = binsCount.length;
    let total = 0;
    for (let j = 0; j < nt; j++) {
        const val = gamma[j * stride + colIdx];
        const idx = Math.min(bins - 1, Math.max(0, Math.floor(((val - xMin) / range) * (bins - 1))));
        const w = counts[j] || 1;
        binsCount[idx] += w;
        binsSum[idx] += val * w;
        total += w;
    }
    const halfway = total / 2;
    let acc = 0;
    for (let i = 0; i < bins; i++) {
        acc += binsCount[i];
        if (acc >= halfway && binsCount[i] > 0) {
            return binsSum[i] / binsCount[i];
        }
    }
    return xMin;
}

function integerizeScoresTomTom(qFlat, qNorms, cache, gamma, gammaInt, histogram, medians, medianCounts, medianSums, nBins) {
    const nq = qNorms.length;
    const nt = cache.totalCols;
    const yFlat = cache.columns;
    const yNorms = cache.norms;
    const counts = cache.rrCounts;
    let totalWeight = 0;
    for (let i = 0; i < counts.length; i++) totalWeight += counts[i];
    if (totalWeight === 0) totalWeight = counts.length || 1;

    let zMin = 9999999;
    let zMax = -9999999;
    for (let i = 0; i < nq; i++) {
        let colMin = 9999999;
        let colMax = -9999999;
        for (let j = 0; j < nt; j++) {
            const idxQ = i * 4;
            const idxT = j * 4;
            let z = qNorms[i] + yNorms[j];
            z -= 2 * (qFlat[idxQ + 0] * yFlat[idxT + 0] + qFlat[idxQ + 1] * yFlat[idxT + 1] + qFlat[idxQ + 2] * yFlat[idxT + 2] + qFlat[idxQ + 3] * yFlat[idxT + 3]);
            z = z > 0 ? -Math.sqrt(z) : 0;
            gamma[j * nq + i] = z;
            if (z > colMax) colMax = z;
            if (z < colMin) colMin = z;
        }
        const median = binnedMedian(gamma, i, nt, medianCounts, medianSums, colMin, colMax, counts, nq);
        medians[i] = median;
        if (colMin - median < zMin) zMin = colMin - median;
        if (colMax - median > zMax) zMax = colMax - median;
    }

    let iMin = Math.floor(zMin);
    if (!Number.isFinite(iMin)) iMin = 0;
    let denom = (zMax - iMin);
    if (!Number.isFinite(denom) || denom <= 0) denom = 1;
    let binScale = Math.floor(nBins / denom);
    if (!Number.isFinite(binScale) || binScale < 1) binScale = 1;
    const offset = -iMin * binScale;
    for (let i = 0; i < nq; i++) medians[i] += iMin;

    histogram.fill(0);
    const histStride = nBins + 1;
    for (let i = 0; i < nq; i++) {
        const median = medians[i];
        const flipped = nq - i - 1;
        for (let j = 0; j < nt; j++) {
            const raw = gamma[j * nq + i];
            const x = Math.floor((raw - median) * binScale + 0.5);
            gammaInt[j * nq + flipped] = x - offset;
            let hIdx = x;
            if (hIdx < 0) hIdx = 0;
            if (hIdx > nBins) hIdx = nBins;
            histogram[i * histStride + hIdx] += (counts[j] || 1) / totalWeight;
        }
    }
    return offset;
}

export function pairwiseMaxArrays(x, y, yCsum, out, n) {
    if (x[0] === -1) {
        for (let i = 0; i < n; i++) out[i] = y[i];
        return;
    }
    let xCsum = 0;
    for (let i = 0; i < n; i++) {
        xCsum += x[i];
        out[i] = x[i] * yCsum[i] + y[i] * xCsum - x[i] * y[i];
    }
}

function pValueBackgroundsTomTom(f, A, B, A_csum, nq, nBins, tMax, offset, nLen, nActual) {
    const histStride = nBins + 1;
    A.fill(0); A_csum.fill(0); B.fill(0);
    for (let i = 0; i < nq; i++) {
        for (let j = i; j < nq; j++) {
            const c = offset * (nq - j + i - 1);
            const base = ((i * nq) + j) * nLen;
            if (i === j) {
                for (let l = 1; l <= nBins; l++) {
                    A[base + l + c] = f[j * histStride + l];
                }
            } else {
                const prevBase = ((i * nq) + (j - 1)) * nLen;
                const limit = nBins * j + 1;
                for (let k = 0; k < limit; k++) {
                    const a = A[prevBase + k + c + offset];
                    if (!a) continue;
                    for (let l = 1; l <= nBins; l++) {
                        A[base + l + k + c] += a * f[j * histStride + l];
                    }
                }
            }
            const cap = Math.min(nLen, nBins * (j + 1) + c);
            let running = 0;
            for (let k = 0; k < cap; k++) {
                running += A[base + k];
                A_csum[base + k] = running;
            }
            for (let k = cap; k < nLen; k++) A_csum[base + k] = 1;
        }
    }

    for (let row = 0; row <= tMax; row++) {
        const slice = B.subarray(row * nLen, (row + 1) * nLen);
        slice.fill(-1);
    }

    const minVal = Math.min(nq, tMax + 1);
    for (let i = 1; i < minVal; i++) {
        const prev = B.subarray((i - 1) * nLen, i * nLen);
        const dest = B.subarray(i * nLen, (i + 1) * nLen);
        const a1 = A.subarray(((0 * nq) + (i - 1)) * nLen, ((0 * nq) + (i - 1)) * nLen + nLen);
        const c1 = A_csum.subarray(((0 * nq) + (i - 1)) * nLen, ((0 * nq) + (i - 1)) * nLen + nLen);
        pairwiseMaxArrays(prev, a1, c1, dest, nActual);
        const a2 = A.subarray(((nq - i) * nq + (nq - 1)) * nLen, ((nq - i) * nq + (nq - 1)) * nLen + nLen);
        const c2 = A_csum.subarray(((nq - i) * nq + (nq - 1)) * nLen, ((nq - i) * nq + (nq - 1)) * nLen + nLen);
        pairwiseMaxArrays(dest, a2, c2, dest, nActual);
    }

    if ((tMax + 1) > nq) {
        for (let i = nq; i <= tMax; i++) {
            const prev = B.subarray((i - 1) * nLen, i * nLen);
            const dest = B.subarray(i * nLen, (i + 1) * nLen);
            const aFull = A.subarray(((0 * nq) + (nq - 1)) * nLen, ((0 * nq) + (nq - 1)) * nLen + nLen);
            const cFull = A_csum.subarray(((0 * nq) + (nq - 1)) * nLen, ((0 * nq) + (nq - 1)) * nLen + nLen);
            pairwiseMaxArrays(prev, aFull, cFull, dest, nActual);
        }
    }

    for (let i = 1; i < minVal; i++) {
        const dest = B.subarray(i * nLen, (i + 1) * nLen);
        dest.fill(-1);
        for (let j = 0; j < nq - i + 1; j++) {
            const a = A.subarray(((j * nq) + (j + i - 1)) * nLen, ((j * nq) + (j + i - 1)) * nLen + nLen);
            const c = A_csum.subarray(((j * nq) + (j + i - 1)) * nLen, ((j * nq) + (j + i - 1)) * nLen + nLen);
            pairwiseMaxArrays(dest, a, c, dest, nActual);
        }
        for (let j = 0; j < i - 1; j++) {
            const leftA = A.subarray(((0 * nq) + j) * nLen, ((0 * nq) + j) * nLen + nLen);
            const leftC = A_csum.subarray(((0 * nq) + j) * nLen, ((0 * nq) + j) * nLen + nLen);
            pairwiseMaxArrays(dest, leftA, leftC, dest, nActual);
            const rightA = A.subarray(((nq - 1 - j) * nq + (nq - 1)) * nLen, ((nq - 1 - j) * nq + (nq - 1)) * nLen + nLen);
            const rightC = A_csum.subarray(((nq - 1 - j) * nq + (nq - 1)) * nLen, ((nq - 1 - j) * nq + (nq - 1)) * nLen + nLen);
            pairwiseMaxArrays(dest, rightA, rightC, dest, nActual);
        }
    }

    for (let i = 0; i <= tMax; i++) {
        const row = B.subarray(i * nLen, (i + 1) * nLen);
        for (let j = 1; j < nActual; j++) row[j] += row[j - 1];
        for (let j = 0; j < nActual; j++) row[j] = 1 - row[j];
        for (let j = nActual; j < nLen; j++) row[j] = row[nActual - 1] || 1;
    }
}

function pValuesTomTom(gammaInt, B, rrInv, offsets, lens, nq, offset, results, nLen) {
    const nTargets = lens.length;
    let maxLen = 0;
    for (let i = 0; i < nTargets; i++) {
        if (lens[i] > maxLen) maxLen = lens[i];
    }
    if (maxLen === 0) maxLen = 1;
    const tSums = new Int32Array(maxLen + nq);
    for (let i = 0; i < nTargets; i++) {
        const len = lens[i];
        const resIdx = i * 5;
        results[resIdx] = 1; results[resIdx + 1] = 0; results[resIdx + 2] = 0; results[resIdx + 3] = 0; results[resIdx + 4] = 0;
        for (let k = 0; k < len + nq - 1; k++) tSums[k] = nq * offset;
        const start = offsets[i];
        for (let k = 0; k < len; k++) {
            const colIdx = rrInv[start + k];
            const base = colIdx * nq;
            for (let l = 0; l < nq; l++) {
                tSums[k + l] += gammaInt[base + l];
            }
        }
        const Brow = B.subarray(len * nLen, (len + 1) * nLen);
        for (let k = 0; k < len + nq - 1; k++) {
            const score = tSums[k];
            if (score <= 0) continue;
            const overlap = Math.min(k + 1, nq) - Math.max(0, k - len + 1);
            if (overlap <= 0) continue;
            if (score < results[resIdx + 1]) continue;
            if (score === results[resIdx + 1] && results[resIdx + 3] >= overlap) continue;
            const idx = Math.min(nLen - 1, Math.max(0, score - 1));
            const pv = Brow[idx] || 1;
            results[resIdx] = pv;
            results[resIdx + 1] = score;
            results[resIdx + 2] = k - nq + 1;
            results[resIdx + 3] = overlap;
        }
    }
}

export function mergeRcResultsTomTom(results, motifCount) {
    for (let i = 0; i < motifCount; i++) {
        const base = i * 5;
        const rc = (i + motifCount) * 5;
        const p = Math.min(results[base], results[rc]);
        results[base] = 1 - Math.pow(1 - p, 2);
        results[base + 4] = 0;
        if (results[base + 1] <= results[rc + 1]) {
            results[base + 1] = results[rc + 1];
            results[base + 2] = results[rc + 2];
            results[base + 3] = results[rc + 3];
            results[base + 4] = 1;
        }
    }
}

function buildTomTomPreview(qSeq, mSeq, shift) {
    let top = qSeq;
    let bot = mSeq;
    if (shift >= 0) {
        top = " ".repeat(shift) + qSeq;
    } else {
        bot = " ".repeat(-shift) + mSeq;
    }
    const len = Math.max(top.length, bot.length);
    top = top.padEnd(len, " ");
    bot = bot.padEnd(len, " ");
    let mid = "";
    for (let i = 0; i < len; i++) {
        const qc = top[i], mc = bot[i];
        if (qc === " " || mc === " ") mid += " ";
        else mid += (qc === mc ? "|" : ".");
    }
    return top + "\n" + mid + "\n" + bot;
}

export function runTomTomSearch(query, rcEnabled, DB) {
    if (!DB || !DB.tomtom) return [];
    const cache = rcEnabled ? DB.tomtom.withRC : DB.tomtom.base;
    if (!cache) return [];
    const qFlat = flattenPpmColumns(query.ppm);
    const qNorms = columnNormsFromFlat(qFlat);
    const nq = qNorms.length;
    if (nq === 0) return [];
    const queryLen = query.L || (query.ppm && query.ppm[0] ? query.ppm[0].length : nq);
    const opts = { nScoreBins: 80, nMedianBins: 800, nCache: 256 };
    const nt = cache.totalCols;
    if (!nt) return [];
    const gamma = new Float64Array(nt * nq);
    const gammaInt = new Int32Array(nt * nq);
    const histogram = new Float64Array(nq * (opts.nScoreBins + 1));
    const medians = new Float64Array(nq);
    const medianCounts = new Float64Array(opts.nMedianBins);
    const medianSums = new Float64Array(opts.nMedianBins);
    const offset = integerizeScoresTomTom(qFlat, qNorms, cache, gamma, gammaInt, histogram, medians, medianCounts, medianSums, opts.nScoreBins);
    let cacheSize = opts.nCache;
    if (offset > cacheSize) cacheSize = offset + 5;
    const nLen = nq * opts.nScoreBins + nq * cacheSize;
    const nActual = nq * opts.nScoreBins + nq * offset;
    const A = new Float64Array(nq * nq * nLen);
    const B = new Float64Array((cache.tMax + 1) * nLen);
    const A_csum = new Float64Array(nq * nq * nLen);
    pValueBackgroundsTomTom(histogram, A, B, A_csum, nq, opts.nScoreBins, cache.tMax, offset, nLen, nActual);
    const results = new Float64Array(cache.lens.length * 5);
    pValuesTomTom(gammaInt, B, cache.rrInv, cache.offsets, cache.lens, nq, offset, results, nLen);
    if (cache.includeRC) mergeRcResultsTomTom(results, cache.motifCount);

    const out = [];
    for (let i = 0; i < cache.motifCount; i++) {
        const base = i * 5;
        const motif = DB.motifs[i];
        if (!motif) continue;
        const pvalue = Math.min(1, Math.max(1e-300, results[base] || 1));
        const score = results[base + 1] || 0;
        const shift = Math.trunc(results[base + 2] || 0);
        const overlap = Math.max(0, Math.trunc(results[base + 3] || 0));
        const rcFlag = results[base + 4] || 0;
        const ori = rcFlag ? "-" : "+";
        const motifCons = rcFlag ? motif.consRC : motif.cons;
        const motifLogo = rcFlag ? motif.logoColsRC : motif.logoCols;
        const motifLen = motif.L || 0;
        let mStart = shift > 0 ? shift : 0;
        if (overlap > 0 && motifLen > 0) {
            if (mStart + overlap > motifLen) {
                mStart = Math.max(0, motifLen - overlap);
            }
        } else {
            mStart = 0;
        }
        let qStart = shift < 0 ? -shift : 0;
        if (overlap > 0 && queryLen) {
            if (qStart + overlap > queryLen) {
                qStart = Math.max(0, queryLen - overlap);
            }
        } else {
            qStart = 0;
        }
        const preview = buildTomTomPreview(query.seq, motifCons, shift);
        out.push({
            id: motif.id,
            len: motif.L,
            logoCols: motifLogo,
            logoColsTom: motifLogo,
            tomtom: {
                pvalue,
                score,
                offset: shift,
                overlap,
                ori,
                preview,
                neglogp: -Math.log10(pvalue),
                mStart,
                qStart
            }
        });
    }
    out.sort((a, b) => (a.tomtom.pvalue - b.tomtom.pvalue));
    return out.slice(0, 500);
}


