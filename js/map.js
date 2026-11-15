/* map.js — mapa de fundo centrado no radar e seletor de radares.
 * Fronteiras (países e estados dos EUA) vêm do jsDelivr em tempo de execução: precisa de internet.
 * Sem internet o radar funciona normalmente, só sem o mapa de fundo. */
(() => {
    "use strict";

    const $ = id => document.getElementById(id);
    const URLS = [
        "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json",
        "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"
    ];
    const R = 6371, D = Math.PI / 180, MAXKM = 240;
    const L = { world: null, states: null };
    const API = { paths: null, ready: false, center, openPicker };
    window.RadarMap = API;
    let last = null;

    // arcos do TopoJSON (codificados por diferenças) -> polilinhas [lon, lat]
    function decode(t) {
        const [sx, sy] = t.transform.scale, [tx, ty] = t.transform.translate;
        return t.arcs.map(a => {
            let x = 0, y = 0;
            return a.map(p => { x += p[0]; y += p[1]; return [x * sx + tx, y * sy + ty]; });
        });
    }

    // projeção azimutal equidistante centrada no radar: x = leste, y = norte (km),
    // o mesmo sistema do alcance e azimute do radar
    function proj(lat0, lon0) {
        const s0 = Math.sin(lat0 * D), c0 = Math.cos(lat0 * D);
        return (lon, lat) => {
            const f = lat * D, dl = (lon - lon0) * D, sf = Math.sin(f), cf = Math.cos(f), cd = Math.cos(dl);
            const c = Math.acos(Math.max(-1, Math.min(1, s0 * sf + c0 * cf * cd)));
            const k = c < 1e-9 ? 1 : c / Math.sin(c);
            return [R * k * cf * Math.sin(dl), R * k * (c0 * sf - s0 * cf * cd)];
        };
    }

    function center(lat, lon) {
        last = [lat, lon];
        if (!L.world) return;
        const f = proj(lat, lon), out = {};
        for (const k of ["world", "states"]) {
            const p = new Path2D();
            for (const arc of L[k]) {
                let pen = false;
                for (const q of arc) {
                    const [x, y] = f(q[0], q[1]);
                    if (x * x + y * y > MAXKM * MAXKM) { pen = false; continue; }
                    if (pen) p.lineTo(x, y); else p.moveTo(x, y);
                    pen = true;
                }
            }
            out[k] = p;
        }
        API.paths = out;
        document.dispatchEvent(new Event("radarmap"));
    }

    Promise.all(URLS.map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); })))
        .then(([w, s]) => {
            L.world = decode(w); L.states = decode(s); API.ready = true;
            if (last) center(last[0], last[1]);
        })
        .catch(e => console.warn("Mapa de fundo indisponível (sem internet?):", e));

    /* ---------- seletor: mapa com todos os radares ---------- */
    const REG = {
        "EUA": [-126, -66, 23, 50], "Alasca": [-172, -128, 52, 72.5], "Havaí": [-161, -153.5, 18.5, 22.5],
        "Porto Rico": [-68.5, -64, 17, 19.5], "Guam": [143, 147, 12, 15], "Ásia": [122, 132, 24, 39.5],
        "Açores": [-29.5, -24.5, 37, 40.5], "Mundo": [-180, 180, -60, 80]
    };

    function openPicker(cur, onPick) {
        const modal = $("mapa-modal"), cv = $("sitemap"), lab = $("sm-label"), regs = $("sm-regions");
        if (!modal || !cv || !window.RADARS) return;
        let reg = "EUA", pts = [];

        const close = () => { modal.hidden = true; window.removeEventListener("keydown", esc); };
        const esc = e => { if (e.key === "Escape") close(); };

        function draw() {
            const cx = cv.getContext("2d"), dpr = Math.min(window.devicePixelRatio || 1, 2);
            const W = cv.width = Math.round(cv.clientWidth * dpr), H = cv.height = Math.round(cv.clientHeight * dpr);
            const [x0, x1, y0, y1] = REG[reg], cs = Math.cos((y0 + y1) / 2 * D);
            const sc = Math.min(W / ((x1 - x0) * cs), H / (y1 - y0));
            const ox = (W - (x1 - x0) * cs * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
            const X = lon => ox + (lon - x0) * cs * sc, Y = lat => oy + (y1 - lat) * sc;
            cx.fillStyle = "#04080c"; cx.fillRect(0, 0, W, H);
            cx.lineWidth = dpr; cx.lineJoin = "round";
            for (const [k, col] of [["world", "#4b5d6e"], ["states", "#34444f"]]) {
                if (!L[k]) continue;
                cx.strokeStyle = col; cx.beginPath();
                for (const arc of L[k]) arc.forEach((q, i) => i ? cx.lineTo(X(q[0]), Y(q[1])) : cx.moveTo(X(q[0]), Y(q[1])));
                cx.stroke();
            }
            if (!L.world) { cx.fillStyle = "#8fa2b8"; cx.font = 12 * dpr + "px sans-serif"; cx.fillText("Mapa de fundo indisponível (sem internet?)", 12 * dpr, 20 * dpr); }
            pts = [];
            cx.font = 11 * dpr + "px 'Courier New', monospace";
            for (const r of window.RADARS) {
                if (r[3] < x0 || r[3] > x1 || r[2] < y0 || r[2] > y1) continue;
                const x = X(r[3]), y = Y(r[2]);
                pts.push({ r, x, y });
                cx.fillStyle = r[0] === cur ? "#ffd23f" : "#00ff66";
                cx.beginPath(); cx.arc(x, y, 3.5 * dpr, 0, 2 * Math.PI); cx.fill();
                if (sc > 70) { cx.fillStyle = "#cfe9cf"; cx.fillText(r[0], x + 6 * dpr, y + 4 * dpr); }
            }
            lab.textContent = pts.length + " radares nesta região. Clique em um para abri-lo.";
        }

        function nearest(e) {
            const rc = cv.getBoundingClientRect(), k = cv.width / rc.width;
            const px = (e.clientX - rc.left) * k, py = (e.clientY - rc.top) * k;
            let best = null, bd = 16 * k;
            for (const p of pts) { const d = Math.hypot(p.x - px, p.y - py); if (d < bd) { bd = d; best = p.r; } }
            return best;
        }

        regs.innerHTML = Object.keys(REG).map(k => '<button type="button" data-r="' + k + '">' + k + "</button>").join("");
        regs.onclick = e => { const b = e.target.closest("button"); if (b) { reg = b.dataset.r; draw(); } };
        $("sm-close").onclick = close;
        modal.onclick = e => { if (e.target === modal) close(); };
        cv.onpointermove = e => { const n = nearest(e); if (n) lab.textContent = n[0] + " — " + n[1]; };
        cv.onclick = e => { const n = nearest(e); if (n) { onPick(n[0]); close(); } };
        window.addEventListener("keydown", esc);
        modal.hidden = false;
        draw();
    }
})();
