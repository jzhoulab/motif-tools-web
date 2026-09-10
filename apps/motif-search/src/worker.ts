// @ts-nocheck
/// <reference lib="webworker" />
import { runTomTomSearch, buildTomTomCaches, reverseComplementString } from './tomtom';
import { prepareNccDatabase, buildQueryFromString, runNccSearch } from './ncc';

let DB = { name: 'unnamed', motifs: [], tomtom: null };

self.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === 'load-db') {
    try {
      const prepared = prepareNccDatabase(payload);
      const motifs = prepared.motifs;
      DB = { name: prepared.name, motifs, tomtom: buildTomTomCaches(motifs) };

      const motifDefs = motifs.map((m) => ({
        id: m.id,
        len: m.L,
        consensus: m.cons,
        logoCols: m.logoCols,
        pssm: m.flat,
        pssmRC: m.flatRC,
        maxScore: m.maxScore,
        minScore: m.minScore,
        trimLeft: m.trimLeft ?? 0,
        trimRight: m.trimRight ?? 0,
      }));

      self.postMessage({ type: 'loaded', name: DB.name, count: motifs.length, motifs: motifDefs });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
    return;
  }

  if (type === 'query') {
    const { text, rc, threshold, mode } = payload;
    if (!text || !text.trim()) {
      self.postMessage({ type: 'results', results: [] });
      return;
    }

    try {
      const querySeq = text.trim();
      const Q = buildQueryFromString(querySeq);

      if (mode === 'tomtom') {
        const tomResults = runTomTomSearch(Q, !!rc, DB);
        self.postMessage({ type: 'results', results: tomResults, mode: 'tomtom' });
        return;
      }

      let Qrc = null;
      if (rc) {
        const rcSeq = reverseComplementString(querySeq);
        Qrc = buildQueryFromString(rcSeq);
      }

      const results = runNccSearch(Q, Qrc, !!rc, threshold ?? -Infinity, DB);
      self.postMessage({ type: 'results', results, mode: 'ncc' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
  }
};