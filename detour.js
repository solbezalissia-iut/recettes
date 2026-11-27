// ────────────────────────────────────────────────────────────────────────
// detour.js — enlève l'arrière-plan d'une photo, directement dans le
// navigateur (gratuit, rien n'est envoyé ailleurs).
// Modèle U²-Net « u2netp » (licence Apache 2.0, 4,6 Mo, models/u2netp.onnx)
// exécuté avec onnxruntime-web, chargé seulement quand on en a besoin.
//   Detour.cut(src)  → Promise<dataURL PNG/WebP transparent, recadré au plus près>
//   Detour.cached(key, src) → même chose, mémorisé dans le navigateur (IndexedDB)
// ────────────────────────────────────────────────────────────────────────
(function () {
  const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  const SIZE = 320;
  let sessionP = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.ort) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('ort'));
      document.head.appendChild(s);
    });
  }
  function session() {
    if (!sessionP) {
      sessionP = loadScript(ORT + 'ort.min.js').then(() => {
        ort.env.wasm.wasmPaths = ORT;
        ort.env.wasm.numThreads = 1;
        return ort.InferenceSession.create('models/u2netp.onnx', { executionProviders: ['wasm'] });
      });
      sessionP.catch(() => { sessionP = null; });
    }
    return sessionP;
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      if (!/^data:/.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => res(img); img.onerror = rej; img.src = src;
    });
  }

  async function cut(src, maxDim = 640) {
    const [sess, img] = await Promise.all([session(), loadImage(src)]);
    let w = img.naturalWidth, h = img.naturalHeight;
    const k = Math.min(1, maxDim / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);

    // Entrée du modèle : 320×320, normalisée
    const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
    const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, SIZE, SIZE);
    const px = cx.getImageData(0, 0, SIZE, SIZE).data;
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    const input = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++)
      for (let ch = 0; ch < 3; ch++) input[ch * SIZE * SIZE + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
    const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
    const m = out[sess.outputNames[0]].data;
    let lo = Infinity, hi = -Infinity;
    for (const v of m) { if (v < lo) lo = v; if (v > hi) hi = v; }

    // Masque 320×320 → taille de la photo
    const mc = document.createElement('canvas'); mc.width = SIZE; mc.height = SIZE;
    const mctx = mc.getContext('2d'); const md = mctx.createImageData(SIZE, SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
      let a = (m[i] - lo) / (hi - lo || 1);
      a = Math.min(1, Math.max(0, (a - 0.12) / 0.6)); // bords plus nets
      md.data[i * 4 + 3] = Math.round(a * 255);
    }
    mctx.putImageData(md, 0, 0);
    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    const octx = oc.getContext('2d');
    octx.drawImage(mc, 0, 0, w, h);
    octx.globalCompositeOperation = 'source-in';
    octx.drawImage(img, 0, 0, w, h);

    // Recadrage au plus près du sujet
    const d = octx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) throw new Error('rien trouvé');
    const fc = document.createElement('canvas'); fc.width = x1 - x0 + 1; fc.height = y1 - y0 + 1;
    fc.getContext('2d').drawImage(oc, x0, y0, fc.width, fc.height, 0, 0, fc.width, fc.height);
    let url = fc.toDataURL('image/webp', 0.82);
    if (!/^data:image\/webp/.test(url)) url = fc.toDataURL('image/png'); // Safari ancien
    return url;
  }

  // ── Petit cache dans le navigateur (IndexedDB) ──
  const dbP = new Promise(res => {
    try {
      const rq = indexedDB.open('recettes-detour', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('img');
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  async function idb(mode, key, val) {
    const db = await dbP; if (!db) return null;
    return new Promise(res => {
      try {
        const st = db.transaction('img', mode).objectStore('img');
        const rq = val === undefined ? st.get(key) : st.put(val, key);
        rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  let queue = Promise.resolve();
  function cached(key, src) {
    const k = key + '|' + String(src).length + '|' + String(src).slice(-40);
    return idb('readonly', k).then(hit => {
      if (hit) return hit;
      const p = queue.catch(() => {}).then(() => cut(src)); // une photo à la fois
      queue = p;
      return p.then(u => { idb('readwrite', k, u); return u; });
    });
  }

  window.Detour = { cut, cached };
})();
