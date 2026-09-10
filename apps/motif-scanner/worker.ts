// @ts-nocheck
/// <reference lib="webworker" />
import { prepareDatabase, scanSequence } from './fimo';

let DB = { name: "empty", motifs: [] };

self.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === "load-db") {
    try {
      DB = prepareDatabase(payload);
      const motifDefs = DB.motifs.map(m => ({
        id: m.id,
        len: m.L,
        consensus: m.consensus,
        logoCols: m.logoCols,
        pssm: m.flat,
        pssmRC: m.flatRC,
        maxScore: m.maxScore,
        minScore: m.minScore,
        trimLeft: m.trimLeft,
        trimRight: m.trimRight
      }));
      self.postMessage({ type: "loaded", name: DB.name, count: DB.motifs.length, motifs: motifDefs });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
    return;
  }

  if (type === "query") {
    const { text, rc, threshold } = payload;
    try {
      const hits = scanSequence(text, rc, threshold, DB);
      self.postMessage({ type: "results", hits });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
};

