/*
 * horse-app.js — scena 3D (Three.js), panel parametrów i diagram stąpania.
 * Model ruchu znajduje się w horse-model.js; ten plik tylko go rysuje i steruje nim.
 */
(function () {
  'use strict';

  const T = window.THREE, HorseModel = window.HorseModel;
  const $ = (sel) => document.querySelector(sel);
  const DEG = Math.PI / 180, TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const fmt = (x, d) => x.toFixed(d === undefined ? 1 : d).replace('.', ',');
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const COATS = {
    gniada:       { label: 'Gniada',       coat: '#7b4424', points: '#1d1512', mane: '#14100e', hoof: '#2b2420' },
    kara:         { label: 'Kara',         coat: '#24201f', points: '#151312', mane: '#0f0e0d', hoof: '#2e2925' },
    siwa:         { label: 'Siwa',         coat: '#c8c5bf', points: '#8d8a86', mane: '#dddad5', hoof: '#6b665f' },
    kasztanowata: { label: 'Kasztanowata', coat: '#9c5226', points: '#8a4520', mane: '#a8602e', hoof: '#5c4435' },
    izabelowata:  { label: 'Izabelowata',  coat: '#d3a65e', points: '#c4964f', mane: '#efe4cd', hoof: '#7b6951' }
  };

  const DEFAULTS = {
    controls: Object.assign(HorseModel.defaultControls(), { speed: 3.6 }),
    build: HorseModel.defaultBuild(),
    view: { timeScale: 1, paused: false, skeleton: false, prints: true, chrono: false, wall: true, camera: 'q', coat: 'gniada' }
  };

  function start(saved) {
    /* ------------------------------------------------------------------ stan */
    const state = JSON.parse(JSON.stringify(DEFAULTS));
    for (const key of ['controls', 'build', 'view']) if (saved && saved[key]) Object.assign(state[key], saved[key]);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches && !(saved && saved.view)) state.view.paused = true;

    const model = new HorseModel(state.build, state.controls);
    state.controls = model.controls;                       // jeden wspólny obiekt sterowania
    if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
      window.claude.hot.snapshot(() => ({ controls: state.controls, build: state.build, view: state.view }));
    }

    /* ------------------------------------------------------------------ scena */
    const canvas = $('#scene'), stage = $('#stage');
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      const msg = document.createElement('p');
      msg.className = 'nogl';
      msg.textContent = 'Ta przeglądarka nie udostępnia WebGL, więc scena 3D nie może się wyświetlić. Włącz akcelerację sprzętową albo otwórz stronę w innej przeglądarce.';
      stage.appendChild(msg);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    const scene = new T.Scene();
    scene.background = new T.Color();
    scene.fog = new T.Fog(0xffffff, 34, 120);
    const camera = new T.PerspectiveCamera(30, 1, 0.1, 400);
    const orbit = new T.OrbitControls(camera, canvas);
    orbit.enableDamping = true; orbit.dampingFactor = 0.08;
    orbit.minDistance = 2.2; orbit.maxDistance = 40; orbit.maxPolarAngle = 89 * DEG;
    orbit.enablePan = false;

    const hemi = new T.HemisphereLight(0xffffff, 0x888888, 1.2);
    const sun = new T.DirectionalLight(0xffffff, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    const fill = new T.DirectionalLight(0xffffff, 0.5);
    scene.add(hemi, sun, sun.target, fill, fill.target);

    /* Podłoże i ściana pomiarowa (jak tor Muybridge'a: pionowe linie co pół metra, numerowane co metr). */
    const GROUND_TILE = 4, WALL_TILE = 20, WALL_H = 2.5, WALL_Z = -3.1;
    const groundCanvas = document.createElement('canvas'); groundCanvas.width = groundCanvas.height = 512;
    const groundTex = new T.CanvasTexture(groundCanvas);
    groundTex.wrapS = groundTex.wrapT = T.RepeatWrapping; groundTex.repeat.set(200 / GROUND_TILE, 80 / GROUND_TILE);
    groundTex.colorSpace = T.SRGBColorSpace; groundTex.anisotropy = 8;
    const ground = new T.Mesh(new T.PlaneGeometry(200, 80), new T.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);

    const wallCanvas = document.createElement('canvas'); wallCanvas.width = 4096; wallCanvas.height = 512;
    const wallTex = new T.CanvasTexture(wallCanvas);
    wallTex.wrapS = T.RepeatWrapping; wallTex.repeat.set(200 / WALL_TILE, 1);
    wallTex.colorSpace = T.SRGBColorSpace; wallTex.anisotropy = 8;
    const wall = new T.Mesh(new T.PlaneGeometry(200, WALL_H), new T.MeshStandardMaterial({ map: wallTex, roughness: 1, metalness: 0 }));
    wall.position.set(0, WALL_H / 2, WALL_Z); wall.receiveShadow = true;
    scene.add(wall);

    function paintGround(th) {
      const c = groundCanvas.getContext('2d'), n = 512;
      c.fillStyle = th.ground; c.fillRect(0, 0, n, n);
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 2600; i++) {                       // ziarno piasku
        c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        c.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
      }
      c.strokeStyle = th.groundLine; c.globalAlpha = 0.5; c.lineWidth = 1.5;
      for (let k = 0; k <= GROUND_TILE; k++) {               // siatka metrowa
        const p = k * n / GROUND_TILE;
        c.beginPath(); c.moveTo(p, 0); c.lineTo(p, n); c.moveTo(0, p); c.lineTo(n, p); c.stroke();
      }
      c.globalAlpha = 1;
      groundTex.needsUpdate = true;
    }

    function paintWall(th) {
      const c = wallCanvas.getContext('2d'), w = wallCanvas.width, h = wallCanvas.height;
      const ppm = w / WALL_TILE;                             // pikseli na metr
      c.fillStyle = th.wall; c.fillRect(0, 0, w, h);
      c.strokeStyle = th.wallInk; c.fillStyle = th.wallInk;
      for (let k = 0; k < WALL_TILE * 2; k++) {
        const x = k * ppm / 2, whole = k % 2 === 0;
        c.globalAlpha = whole ? 0.75 : 0.28; c.lineWidth = whole ? (k % 10 === 0 ? 7 : 4) : 2;
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
      }
      for (let m = 0.5; m < WALL_H; m += 0.5) {              // poziomice co pół metra
        const y = h - m * ppm, whole = Math.abs(m - Math.round(m)) < 1e-6;
        c.globalAlpha = whole ? 0.5 : 0.2; c.lineWidth = whole ? 3 : 2;
        c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      }
      c.globalAlpha = 0.9; c.textBaseline = 'top';
      c.font = '600 ' + Math.round(0.32 * ppm) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
      for (let k = 0; k < WALL_TILE; k++) c.fillText(String(k), k * ppm + 0.07 * ppm, h - (WALL_H - 0.07) * ppm);
      c.globalAlpha = 0.6;
      c.font = '500 ' + Math.round(0.15 * ppm) + 'px "Barlow Condensed", "Arial Narrow", sans-serif';
      c.textBaseline = 'bottom';
      for (let k = 0; k < WALL_TILE; k += 5) for (let m = 1; m <= 2; m++) c.fillText(m + ' m', k * ppm + 0.07 * ppm, h - m * ppm - 0.03 * ppm);
      c.globalAlpha = 1;
      wallTex.needsUpdate = true;
    }

    /* ------------------------------------------------------------------ motyw */
    let theme = null;
    function applyTheme() {
      theme = {
        dark: cssVar('--scene-dark') === '1',
        sky: cssVar('--scene-sky'), ground: cssVar('--scene-ground'), groundLine: cssVar('--scene-ground-line'),
        wall: cssVar('--scene-wall'), wallInk: cssVar('--scene-wall-ink'),
        ink: cssVar('--ink'), muted: cssVar('--muted'), line: cssVar('--line'), accent: cssVar('--accent'), panel: cssVar('--panel'),
        legs: [cssVar('--leg-lh'), cssVar('--leg-lf'), cssVar('--leg-rh'), cssVar('--leg-rf')]
      };
      scene.background.set(theme.sky); scene.fog.color.set(theme.sky);
      hemi.color.set(theme.dark ? '#93a7b8' : '#ffffff'); hemi.groundColor.set(theme.dark ? '#2d2a24' : '#b3aa98');
      hemi.intensity = theme.dark ? 0.75 : 1.25;
      sun.color.set(theme.dark ? '#ffe9c4' : '#fff6e8'); sun.intensity = theme.dark ? 2.3 : 2.5;
      fill.intensity = theme.dark ? 0.35 : 0.45;
      paintGround(theme); paintWall(theme);
      if (view) view.setLegColors(theme.legs);
      for (let i = 0; i < 4; i++) printColors[i].set(theme.legs[i]);
    }

    /* ------------------------------------------------------------------ koń */
    const unitSphere = new T.SphereGeometry(1, 28, 18);
    const AX_X = new T.Vector3(1, 0, 0), AX_Z = new T.Vector3(0, 0, 1);
    const _qa = new T.Quaternion(), _qb = new T.Quaternion();
    const _m = new T.Matrix4(), _vx = new T.Vector3(), _vy = new T.Vector3(), _vz = new T.Vector3(), _vp = new T.Vector3();

    class HorseView {
      constructor() {
        this.root = new T.Group();
        scene.add(this.root);
        this.mats = {
          coat: new T.MeshStandardMaterial({ roughness: 0.58, metalness: 0.02 }),
          points: new T.MeshStandardMaterial({ roughness: 0.62 }),
          mane: new T.MeshStandardMaterial({ roughness: 0.85 }),
          hoof: new T.MeshStandardMaterial({ roughness: 0.4 }),
          eye: new T.MeshStandardMaterial({ color: '#0b0908', roughness: 0.15 })
        };
        this.ownGeoms = [];
        // nakładka szkieletu
        this.SEG = 40;
        this.skelPos = new Float32Array(this.SEG * 6);
        this.skelCol = new Float32Array(this.SEG * 6);
        const sg = new T.BufferGeometry();
        sg.setAttribute('position', new T.BufferAttribute(this.skelPos, 3));
        sg.setAttribute('color', new T.BufferAttribute(this.skelCol, 3));
        this.skelLines = new T.LineSegments(sg, new T.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
        this.skelLines.renderOrder = 10; this.skelLines.frustumCulled = false;
        const pg = new T.BufferGeometry();
        pg.setAttribute('position', new T.BufferAttribute(this.skelPos, 3));
        pg.setAttribute('color', new T.BufferAttribute(this.skelCol, 3));
        this.skelPoints = new T.Points(pg, new T.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
        this.skelPoints.renderOrder = 11; this.skelPoints.frustumCulled = false;
        scene.add(this.skelLines, this.skelPoints);
        this.legColors = [new T.Color(), new T.Color(), new T.Color(), new T.Color()];
        this.spineColor = new T.Color();
        this.segCount = 0;
      }

      setLegColors(cols) {
        cols.forEach((c, i) => this.legColors[i].set(c));
        this.spineColor.set(theme.ink);
      }

      setCoat(name) {
        const c = COATS[name] || COATS.gniada;
        this.mats.coat.color.set(c.coat); this.mats.points.color.set(c.points);
        this.mats.mane.color.set(c.mane); this.mats.hoof.color.set(c.hoof);
      }

      setSkeleton(on) {
        this.skelLines.visible = this.skelPoints.visible = on;
        for (const key of ['coat', 'points', 'mane', 'hoof']) {
          const m = this.mats[key];
          m.transparent = on; m.opacity = on ? 0.2 : 1; m.depthWrite = !on; m.needsUpdate = true;
        }
      }

      /* elipsoida */
      ell(parent, rx, ry, rz, mat, x, y, z) {
        const m = new T.Mesh(unitSphere, mat);
        m.scale.set(rx, ry, rz); m.position.set(x || 0, y || 0, z || 0);
        m.castShadow = true;
        parent.add(m);
        return m;
      }

      /* zwężający się walec z zaokrąglonymi końcami, biegnący od początku układu wzdłuż −Y */
      limb(parent, len, r0, r1, mat, flatZ) {
        const grp = new T.Group();
        const geo = new T.CylinderGeometry(r0, r1, len, 18, 1, true);
        this.ownGeoms.push(geo);
        const cyl = new T.Mesh(geo, mat); cyl.position.y = -len / 2; cyl.castShadow = true;
        grp.add(cyl);
        this.ell(grp, r0, r0, r0, mat, 0, 0, 0);
        this.ell(grp, r1, r1, r1, mat, 0, -len, 0);
        if (flatZ) grp.scale.z = flatZ;
        parent.add(grp);
        return grp;
      }

      /* jak limb(), ale wzdłuż +X (szyja, głowa) */
      limbX(parent, len, r0, r1, mat, flatZ) {
        const holder = new T.Group();
        const inner = this.limb(holder, len, r0, r1, mat, flatZ);
        inner.rotation.z = Math.PI / 2;
        parent.add(holder);
        return holder;
      }

      build(g) {
        // sprzątanie poprzedniej bryły
        this.root.clear();
        for (const geo of this.ownGeoms) geo.dispose();
        this.ownGeoms = [];
        const M = this.mats, S = g.S, B = g.B, U = g.bulk, K = g.K;
        const Uy = 1 + 0.45 * (U - 1), Uh = Math.sqrt(U), Bh = 0.6 + 0.4 * B;
        const lx = (x) => x * S * B - g.comX, ly = (y) => y * S;

        /* tułów */
        const trunk = this.trunk = new T.Group();
        this.root.add(trunk);
        this.ell(trunk, 0.62 * S * B, 0.335 * S * Uy, 0.285 * S * U, M.coat, lx(-0.02), ly(0.035), 0);       // kłoda
        this.ell(trunk, 0.34 * S * Bh, 0.365 * S * Uy, 0.25 * S * U, M.coat, lx(0.40), ly(0.04), 0);         // klatka piersiowa
        this.ell(trunk, 0.27 * S * Bh, 0.075 * S, 0.075 * S * Uh, M.coat, lx(0.31), ly(0.375), 0);           // kłąb
        this.ell(trunk, 0.21 * S, 0.25 * S * Uh, 0.165 * S * U, M.coat, lx(0.57), ly(0.2), 0);               // nasada szyi
        this.mkWithers = new T.Object3D(); this.mkWithers.position.set(lx(0.31), ly(0.40), 0); trunk.add(this.mkWithers);

        /* zad (obraca się w stawie lędźwiowo-krzyżowym) */
        const pelvis = this.pelvis = new T.Group();
        pelvis.position.set(g.ls[0] - g.comX, g.ls[1], 0);
        trunk.add(pelvis);
        const px = (x) => (x + 0.36) * S * B, py = (y) => (y - 0.36) * S;
        this.ell(pelvis, 0.37 * S * Bh, 0.35 * S * Uy, 0.285 * S * U, M.coat, px(-0.54), py(0.085), 0);
        this.ell(pelvis, 0.19 * S, 0.25 * S * Uy, 0.215 * S * U, M.coat, px(-0.74), py(-0.02), 0);

        /* ogon */
        this.tail = [];
        let tparent = pelvis;
        const tr = [0.04, 0.058, 0.066, 0.066, 0.058, 0.046, 0.03], tlen = 0.14 * S;
        for (let k = 0; k < tr.length; k++) {
          const seg = new T.Group();
          if (k === 0) seg.position.set(px(-0.86), py(0.30), 0); else seg.position.set(0, -tlen, 0);
          this.limb(seg, tlen, tr[k] * S, (tr[k + 1] || 0.02) * S, M.mane, 0.8);
          tparent.add(seg); tparent = seg; this.tail.push(seg);
        }
        this.mkTailTip = new T.Object3D(); this.mkTailTip.position.set(0, -tlen, 0); tparent.add(this.mkTailTip);

        /* szyja i głowa */
        const n1 = this.neck1 = new T.Group();
        n1.position.set(g.neckBase[0] - g.comX, g.neckBase[1], 0);
        trunk.add(n1);
        this.limbX(n1, g.neck1, 0.2 * S * Uh, 0.15 * S * Uh, M.coat, 0.62 * Uh);
        this.ell(n1, g.neck1 * 0.56, 0.05 * S, 0.026 * S, M.mane, g.neck1 * 0.5, 0.185 * S * Uh, 0);        // grzywa
        const n2 = this.neck2 = new T.Group();
        n2.position.set(g.neck1, 0, 0);
        n1.add(n2);
        this.limbX(n2, g.neck2, 0.15 * S * Uh, 0.112 * S, M.coat, 0.6 * Uh);
        this.ell(n2, g.neck2 * 0.58, 0.045 * S, 0.024 * S, M.mane, g.neck2 * 0.5, 0.14 * S, 0);
        const head = this.head = new T.Group();
        head.position.set(g.neck2, 0, 0);
        n2.add(head);
        this.limbX(head, 0.55 * S, 0.112 * S, 0.062 * S, M.coat, 0.78);
        this.ell(head, 0.15 * S, 0.12 * S, 0.082 * S, M.coat, 0.15 * S, -0.06 * S, 0);                       // ganasze
        this.ell(head, 0.075 * S, 0.068 * S, 0.06 * S, M.points, 0.565 * S, -0.012 * S, 0);                  // chrapy
        this.ell(head, 0.075 * S, 0.035 * S, 0.05 * S, M.mane, 0.06 * S, 0.105 * S, 0);                      // grzywka
        this.ears = [];
        const earGeo = new T.ConeGeometry(0.03 * S, 0.13 * S, 10); this.ownGeoms.push(earGeo);
        for (const side of [-1, 1]) {
          const ear = new T.Group(); ear.position.set(0.0, 0.085 * S, side * 0.06 * S);
          const cone = new T.Mesh(earGeo, M.coat); cone.position.y = 0.06 * S; cone.rotation.x = side * 0.22; cone.castShadow = true;
          ear.add(cone); head.add(ear); this.ears.push(ear);
          this.ell(head, 0.02 * S, 0.02 * S, 0.012 * S, M.eye, 0.19 * S, 0.035 * S, side * 0.083 * S);        // oko
        }
        this.mkMuzzle = new T.Object3D(); this.mkMuzzle.position.set(0.6 * S, 0, 0); head.add(this.mkMuzzle);

        /* kończyny — części ustawiane co klatkę między stawami wyznaczonymi przez model */
        this.legs = [];
        for (let i = 0; i < 4; i++) {
          const fore = HorseModel.IS_FORE[i], side = HorseModel.SIDE[i];
          const parts = [], balls = [];
          const bone = (a, b) => { const grp = new T.Group(); this.root.add(grp); parts.push({ grp, a, b }); return grp; };
          const ball = (j, r, mat) => { balls.push({ mesh: this.ell(this.root, r, r, r, mat), j }); };
          if (fore) {
            const sc = bone(0, 1);
            this.ell(sc, 0.135 * S, 0.3 * S * K, 0.05 * S * U, M.coat, 0.012 * S, -0.2 * S * K, -side * 0.006 * S);     // łopatka
            const hu = bone(1, 2);
            this.ell(hu, 0.115 * S * Uh, 0.23 * S * K, 0.085 * S * U, M.coat, 0, -0.5 * g.hum, 0);                    // ramię
            const fa = bone(2, 3);
            this.limb(fa, g.radius, 0.072 * S * Uh, 0.045 * S, M.coat);
            this.ell(fa, 0.082 * S * Uh, 0.19 * S * K, 0.062 * S * Uh, M.coat, 0.008 * S, -0.28 * g.radius, 0);       // przedramię
            ball(3, 0.05 * S, M.points);                                                                               // nadgarstek
            this.limb(bone(3, 4), g.cannonF, 0.035 * S, 0.034 * S, M.points);                                          // nadpęcie
            ball(4, 0.045 * S, M.points);                                                                              // staw pęcinowy
            this.limb(bone(4, 5), g.pasternF, 0.037 * S, 0.043 * S, M.points);                                         // pęcina
          } else {
            const th = bone(0, 1);
            this.ell(th, 0.2 * S * Uh, 0.31 * S * K, 0.115 * S * U, M.coat, -0.045 * S, -0.46 * g.femur, 0);          // udo
            ball(1, 0.08 * S * Uh, M.coat);                                                                            // staw kolanowy
            const ga = bone(1, 2);
            this.limb(ga, g.tibia, 0.086 * S * Uh, 0.05 * S, M.coat, 0.85);
            this.ell(ga, 0.1 * S * Uh, 0.2 * S * K, 0.068 * S * Uh, M.coat, -0.015 * S, -0.3 * g.tibia, 0);           // podudzie
            ball(2, 0.055 * S, M.points);                                                                              // staw skokowy
            const ca = bone(2, 3);
            this.limb(ca, g.cannonH, 0.04 * S, 0.037 * S, M.points);
            this.ell(ca, 0.036 * S, 0.05 * S, 0.03 * S, M.points, -0.048 * S, 0.012 * S, 0);                           // guz piętowy
            ball(3, 0.047 * S, M.points);
            this.limb(bone(3, 4), g.pasternH, 0.038 * S, 0.044 * S, M.points);
          }
          const hoof = new T.Group();
          const hgeo = new T.CylinderGeometry(0.046 * S, 0.06 * S, 0.085 * S, 16); this.ownGeoms.push(hgeo);
          const hm = new T.Mesh(hgeo, M.hoof); hm.position.set(-0.058 * S, 0.0425 * S, 0); hm.scale.x = 1.15; hm.castShadow = true;
          hoof.add(hm); this.root.add(hoof);
          this.legs.push({ parts, balls, hoof, fore });
        }
      }

      update(mdl) {
        const p = mdl.pose, g = mdl.g;
        this.trunk.position.set(p.com[0], p.com[1], 0);
        this.trunk.quaternion.copy(_qa.setFromAxisAngle(AX_Z, p.pitch)).multiply(_qb.setFromAxisAngle(AX_X, p.roll));
        this.pelvis.quaternion.copy(_qa.setFromAxisAngle(AX_Z, p.lam)).multiply(_qb.setFromAxisAngle(AX_X, p.pelRoll));
        this.neck1.rotation.z = p.neck1; this.neck2.rotation.z = p.neck2; this.head.rotation.z = p.head;
        for (const ear of this.ears) ear.rotation.z = -0.25 + p.ears;   // uszy do przodu, w cwale położone po sobie

        // ogon: uniesienie zależne od chodu + fala biegnąca wzdłuż włosia
        const n = this.tail.length, ph = p.phase * TAU;
        for (let k = 0; k < n; k++) {
          const wave = 0.07 * p.mb * Math.sin(2 * ph - 1.1 * k);
          this.tail[k].rotation.z = k === 0 ? -(0.2 + p.tail) + 0.5 * wave : 0.55 * p.tail / (n - 1) + wave;
          this.tail[k].rotation.x = 0.1 * p.mb * Math.sin(ph - 0.75 * k) * (k === 0 ? 0.4 : 1);
        }

        for (let i = 0; i < 4; i++) {
          const L = mdl.legs[i], V = this.legs[i], J = L.joints;
          // normalna płaszczyzny nogi: (0, −nz, ny), gdzie (ny, nz) to „góra” w tej płaszczyźnie
          const nx = 0, nyy = -L.nz, nzz = L.ny;
          for (const part of V.parts) {
            const A = J[part.a], Bp = J[part.b];
            _vy.set(A[0] - Bp[0], A[1] - Bp[1], A[2] - Bp[2]).normalize();
            _vz.set(nx, nyy, nzz); _vz.addScaledVector(_vy, -_vz.dot(_vy)).normalize();
            _vx.crossVectors(_vy, _vz);
            part.grp.quaternion.setFromRotationMatrix(_m.makeBasis(_vx, _vy, _vz));
            part.grp.position.set(A[0], A[1], A[2]);
          }
          for (const b of V.balls) b.mesh.position.set(J[b.j][0], J[b.j][1], J[b.j][2]);
          const toe = J[J.length - 1];
          V.hoof.position.set(toe[0], toe[1], toe[2]);
          V.hoof.rotation.z = -L.q;
        }
      }

      /* Odcinki szkieletu (pary punktów) w układzie świata; zwraca liczbę odcinków. */
      collectSkeleton(mdl, pos, col, offset, alpha) {
        let k = offset * 6;
        const push = (a, b, c) => {
          pos[k] = a.x !== undefined ? a.x : a[0]; pos[k + 1] = a.y !== undefined ? a.y : a[1]; pos[k + 2] = a.z !== undefined ? a.z : a[2];
          pos[k + 3] = b.x !== undefined ? b.x : b[0]; pos[k + 4] = b.y !== undefined ? b.y : b[1]; pos[k + 5] = b.z !== undefined ? b.z : b[2];
          if (col) {
            const stride = col.length / (pos.length / 3);
            let q = (k / 3) * stride;
            for (let e = 0; e < 2; e++) { col[q++] = c.r; col[q++] = c.g; col[q++] = c.b; if (stride === 4) col[q++] = alpha; }
          }
          k += 6;
        };
        this.root.updateMatrixWorld(true);
        const wp = (o) => o.getWorldPosition(new T.Vector3());
        const spine = [wp(this.mkMuzzle), wp(this.head), wp(this.neck2), wp(this.neck1), wp(this.mkWithers), wp(this.pelvis), wp(this.tail[0]), wp(this.tail[3]), wp(this.mkTailTip)];
        for (let i = 0; i < spine.length - 1; i++) push(spine[i], spine[i + 1], this.spineColor);
        for (let i = 0; i < 4; i++) {
          const J = mdl.legs[i].joints;
          push(HorseModel.IS_FORE[i] ? spine[4] : spine[5], J[0], this.spineColor);
          for (let j = 0; j < J.length - 1; j++) push(J[j], J[j + 1], this.legColors[i]);
        }
        return k / 6 - offset;
      }

      updateSkeleton(mdl) {
        this.segCount = this.collectSkeleton(mdl, this.skelPos, this.skelCol, 0, 1);
        for (const o of [this.skelLines, this.skelPoints]) {
          o.geometry.setDrawRange(0, this.segCount * 2);
          o.geometry.attributes.position.needsUpdate = true;
          o.geometry.attributes.color.needsUpdate = true;
        }
      }
    }

    /* ------------------------------------------------------------------ ślady kopyt */
    const PRINTS = 260;
    const printColors = [new T.Color(), new T.Color(), new T.Color(), new T.Color()];
    const printGeo = new T.CircleGeometry(0.062, 18); printGeo.rotateX(-Math.PI / 2);
    const prints = new T.InstancedMesh(printGeo, new T.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false }), PRINTS);
    prints.frustumCulled = false; prints.count = 0; prints.renderOrder = 1;
    scene.add(prints);
    let printHead = 0;
    function addPrint(leg, x, z) {
      _m.makeScale(model.g.S * 1.1, 1, model.g.S * 0.9); _m.setPosition(x - 0.055 * model.g.S, 0.006, z);
      prints.setMatrixAt(printHead, _m); prints.setColorAt(printHead, printColors[leg]);
      printHead = (printHead + 1) % PRINTS;
      prints.count = Math.min(prints.count + 1, PRINTS);
      prints.instanceMatrix.needsUpdate = true; if (prints.instanceColor) prints.instanceColor.needsUpdate = true;
    }

    /* ------------------------------------------------------------------ chronofotografia (ślad szkieletu) */
    const SNAPS = 28, SNAP_SEG = 40;
    const chronoPos = new Float32Array(SNAPS * SNAP_SEG * 6), chronoCol = new Float32Array(SNAPS * SNAP_SEG * 8);
    const chronoGeo = new T.BufferGeometry();
    chronoGeo.setAttribute('position', new T.BufferAttribute(chronoPos, 3));
    chronoGeo.setAttribute('color', new T.BufferAttribute(chronoCol, 4));
    const chrono = new T.LineSegments(chronoGeo, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    chrono.frustumCulled = false; chrono.renderOrder = 5;
    scene.add(chrono);
    let snapHead = 0, snapCount = 0, lastSnapIndex = -1;
    function clearChrono() { snapCount = 0; snapHead = 0; chronoPos.fill(0); chronoCol.fill(0); chronoGeo.attributes.position.needsUpdate = true; chronoGeo.attributes.color.needsUpdate = true; }
    function takeSnap() {
      view.collectSkeleton(model, chronoPos, chronoCol, snapHead * SNAP_SEG, 1);
      snapHead = (snapHead + 1) % SNAPS; snapCount = Math.min(snapCount + 1, SNAPS);
      // im starsze ujęcie, tym bledsze
      for (let s = 0; s < SNAPS; s++) {
        const age = (snapHead - 1 - s + SNAPS) % SNAPS;
        const a = s < snapCount || snapCount === SNAPS ? 0.85 * Math.pow(1 - age / SNAPS, 1.6) : 0;
        const base = s * SNAP_SEG * 8;
        for (let v = 0; v < SNAP_SEG * 2; v++) chronoCol[base + v * 4 + 3] = a;
      }
      chronoGeo.attributes.position.needsUpdate = true; chronoGeo.attributes.color.needsUpdate = true;
    }

    /* ------------------------------------------------------------------ diagram stąpania */
    const plot = $('#gaitplot'), pctx = plot.getContext('2d');
    const HIST = 1400, histPhi = new Float64Array(HIST), histMask = new Uint8Array(HIST);
    let histHead = 0, histLen = 0, phiTotal = 0;
    function record() {
      let mask = 0;
      for (let i = 0; i < 4; i++) if (model.legs[i].stance) mask |= 1 << i;
      histPhi[histHead] = phiTotal; histMask[histHead] = mask;
      histHead = (histHead + 1) % HIST; histLen = Math.min(histLen + 1, HIST);
    }
    function drawPlot() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = plot.clientWidth, h = plot.clientHeight;
      if (plot.width !== Math.round(w * dpr) || plot.height !== Math.round(h * dpr)) { plot.width = Math.round(w * dpr); plot.height = Math.round(h * dpr); }
      pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pctx.clearRect(0, 0, w, h);
      const left = 30, right = w - 2, span = 3, rowH = h / 4, barH = Math.max(6, rowH - 7);
      const X = (phi) => right - (phiTotal - phi) / span * (right - left);
      pctx.font = '600 13px "Barlow Condensed", "Arial Narrow", sans-serif'; pctx.textBaseline = 'middle';
      // kolejność wierszy jak w diagramach Hildebranda: LT, LP, PP, PT
      const rows = [0, 1, 3, 2];
      rows.forEach((leg, r) => {
        const y = r * rowH + (rowH - barH) / 2;
        pctx.fillStyle = theme.line; pctx.globalAlpha = 0.45; pctx.fillRect(left, y, right - left, barH); pctx.globalAlpha = 1;
        pctx.fillStyle = theme.legs[leg]; pctx.fillText(HorseModel.LEG_NAMES[leg], 2, r * rowH + rowH / 2 + 1);
      });
      if (histLen < 2) return;
      const first = (histHead - histLen + HIST) % HIST;
      // faza lotu (żadne kopyto nie dotyka ziemi) i granice cykli
      let runStart = null;
      for (let n = 0; n < histLen; n++) {
        const idx = (first + n) % HIST, x = X(histPhi[idx]);
        if (x < left - 4) continue;
        const air = histMask[idx] === 0;
        if (air && runStart === null) runStart = x;
        if ((!air || n === histLen - 1) && runStart !== null) {
          pctx.fillStyle = theme.accent; pctx.globalAlpha = 0.16;
          pctx.fillRect(Math.max(left, runStart), 0, Math.max(1, x - Math.max(left, runStart)), h); pctx.globalAlpha = 1;
          runStart = null;
        }
      }
      rows.forEach((leg, r) => {
        const y = r * rowH + (rowH - barH) / 2, bit = 1 << leg;
        pctx.fillStyle = theme.legs[leg];
        let x0 = null;
        for (let n = 0; n < histLen; n++) {
          const idx = (first + n) % HIST, x = X(histPhi[idx]), on = (histMask[idx] & bit) !== 0;
          if (on && x0 === null) x0 = x;
          if ((!on || n === histLen - 1) && x0 !== null) {
            const a = Math.max(left, x0), b = Math.max(left, x);
            if (b - a > 0.5) pctx.fillRect(a, y, b - a, barH);
            x0 = null;
          }
        }
      });
      pctx.strokeStyle = theme.ink; pctx.globalAlpha = 0.35; pctx.lineWidth = 1;
      for (let c = Math.ceil(phiTotal - span); c <= phiTotal; c++) {
        const x = Math.round(X(c)) + 0.5;
        if (x < left) continue;
        pctx.beginPath(); pctx.moveTo(x, 0); pctx.lineTo(x, h); pctx.stroke();
      }
      pctx.globalAlpha = 1;
    }

    /* ------------------------------------------------------------------ kamera */
    const CAMS = {
      s: { label: 'Bok', off: [0.3, 1.15, 9.2] },
      q: { label: 'Skos', off: [5.6, 2.3, 7.2] },
      f: { label: 'Przód', off: [10.5, 1.5, 1.1] },
      b: { label: 'Tył', off: [-10.5, 1.9, 1.6] },
      t: { label: 'Góra', off: [0, 14, 0.02] }
    };
    const camGoal = new T.Vector3(); let camMoving = false;
    function setCamera(key, instant) {
      const S = Math.pow(model.g.S * (0.5 + 0.5 * model.g.K), 0.8);
      const o = CAMS[key].off;
      orbit.target.set(model.x + 0.15, 0.95 * model.g.S, 0);
      camGoal.set(model.x + 0.15 + o[0] * S, o[1] * S, o[2] * S);
      if (instant) camera.position.copy(camGoal); else camMoving = true;
    }
    orbit.addEventListener('start', () => { camMoving = false; });

    /* ------------------------------------------------------------------ panel */
    const panel = $('#panel'), refreshers = [];
    const refreshAll = () => refreshers.forEach((fn) => fn());
    function section(title, open) {
      const d = document.createElement('details'); d.open = open !== false;
      const s = document.createElement('summary'); s.textContent = title; d.appendChild(s);
      const gdiv = document.createElement('div'); gdiv.className = 'group'; d.appendChild(gdiv);
      panel.appendChild(d);
      return gdiv;
    }
    function slider(parent, o) {
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.htmlFor = o.id; lab.innerHTML = o.label;
      const out = document.createElement('output'); out.htmlFor = o.id;
      const inp = document.createElement('input');
      Object.assign(inp, { type: 'range', id: o.id, min: o.min, max: o.max, step: o.step });
      const show = () => { inp.value = o.get(); out.textContent = o.fmt(o.get()); };
      inp.addEventListener('input', () => { o.set(parseFloat(inp.value)); out.textContent = o.fmt(o.get()); });
      row.append(lab, out, inp); parent.appendChild(row);
      refreshers.push(show); show();
      return row;
    }
    function segmented(parent, o) {
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('span'); lab.className = 'label'; lab.id = o.id + '-label'; lab.textContent = o.label;
      const box = document.createElement('div'); box.className = 'seg'; box.setAttribute('role', 'group'); box.setAttribute('aria-labelledby', lab.id);
      const btns = o.options.map((op) => {
        const b = document.createElement('button');
        b.type = 'button'; b.id = o.id + '-' + op.value; b.textContent = op.label; b.dataset.value = op.value;
        b.addEventListener('click', () => { o.set(op.value); show(); });
        box.appendChild(b);
        return b;
      });
      const show = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(o.get()))));
      row.append(lab, document.createElement('span'), box); parent.appendChild(row);
      refreshers.push(show); show();
      return { row, btns };
    }
    function toggle(parent, o) {
      const lab = document.createElement('label'); lab.className = 'check';
      const inp = document.createElement('input'); inp.type = 'checkbox'; inp.id = o.id;
      const txt = document.createElement('span'); txt.innerHTML = o.label;
      inp.addEventListener('change', () => o.set(inp.checked));
      const show = () => { inp.checked = !!o.get(); };
      lab.append(inp, txt); parent.appendChild(lab);
      refreshers.push(show); show();
    }
    const mult = (v) => '×' + fmt(v, 2);
    const C = state.controls, Bd = state.build, V = state.view;

    // --- Ruch
    const gMove = section('Ruch');
    const speedRow = slider(gMove, { id: 'speed', label: 'Prędkość', min: 0, max: 18, step: 0.1,
      get: () => C.speed, set: (v) => { C.speed = v; }, fmt: (v) => fmt(v, 1) + ' m/s' });
    const bands = document.createElement('div'); bands.className = 'bands'; bands.setAttribute('aria-hidden', 'true');
    const bandSpans = ['stęp', 'kłus', 'galop', 'cwał'].map((t) => { const s = document.createElement('span'); s.textContent = t; bands.appendChild(s); return s; });
    speedRow.appendChild(bands);
    function layoutBands() {
      const k = Math.sqrt(model.g.lenScale), edges = [0, 2.0 * k, 5.0 * k, 8.75 * k, 18];
      bandSpans.forEach((s, i) => { s.style.flex = Math.max(0.01, Math.min(18, edges[i + 1]) - Math.min(18, edges[i])) + ' 1 0'; });
    }
    const gaitSeg = segmented(gMove, { id: 'gait', label: 'Chód',
      options: [{ value: 'auto', label: 'Auto' }, { value: 'walk', label: 'Stęp' }, { value: 'trot', label: 'Kłus' }, { value: 'canter', label: 'Galop' }, { value: 'gallop', label: 'Cwał' }],
      get: () => C.gait, set: (v) => { C.gait = v; } });
    segmented(gMove, { id: 'lead', label: 'Noga prowadząca w galopie',
      options: [{ value: 'L', label: 'Lewa' }, { value: 'R', label: 'Prawa' }], get: () => C.lead, set: (v) => { C.lead = v; } });
    slider(gMove, { id: 'timescale', label: 'Tempo czasu', min: 0.05, max: 2, step: 0.05,
      get: () => V.timeScale, set: (v) => { V.timeScale = v; }, fmt: (v) => v === 1 ? 'rzeczywiste' : mult(v) });

    // --- Krok
    const gStep = section('Krok');
    slider(gStep, { id: 'freqK', label: 'Częstotliwość cyklu', min: 0.6, max: 1.6, step: 0.01, get: () => C.freqK, set: (v) => { C.freqK = v; }, fmt: mult });
    slider(gStep, { id: 'dutyK', label: 'Czas podparcia', min: 0.6, max: 1.3, step: 0.01, get: () => C.dutyK, set: (v) => { C.dutyK = v; }, fmt: mult });
    slider(gStep, { id: 'liftK', label: 'Wysokość kroku', min: 0, max: 2, step: 0.01, get: () => C.liftK, set: (v) => { C.liftK = v; }, fmt: mult });
    slider(gStep, { id: 'flexK', label: 'Zgięcie stawów w przeniesieniu', min: 0, max: 1.4, step: 0.01, get: () => C.flexK, set: (v) => { C.flexK = v; }, fmt: mult });

    // --- Tułów
    const gTrunk = section('Tułów, szyja, ogon');
    slider(gTrunk, { id: 'bounceK', label: 'Kołysanie pionowe', min: 0, max: 2, step: 0.01, get: () => C.bounceK, set: (v) => { C.bounceK = v; }, fmt: mult });
    slider(gTrunk, { id: 'pitchK', label: 'Pochylanie przód–tył', min: 0, max: 2, step: 0.01, get: () => C.pitchK, set: (v) => { C.pitchK = v; }, fmt: mult });
    slider(gTrunk, { id: 'rollK', label: 'Przechył na boki', min: 0, max: 2, step: 0.01, get: () => C.rollK, set: (v) => { C.rollK = v; }, fmt: mult });
    slider(gTrunk, { id: 'spineK', label: 'Praca grzbietu', min: 0, max: 2, step: 0.01, get: () => C.spineK, set: (v) => { C.spineK = v; }, fmt: mult });
    slider(gTrunk, { id: 'nodK', label: 'Ruch głowy', min: 0, max: 3, step: 0.01, get: () => C.nodK, set: (v) => { C.nodK = v; }, fmt: mult });
    slider(gTrunk, { id: 'tailK', label: 'Uniesienie ogona', min: 0, max: 1.5, step: 0.01, get: () => C.tailK, set: (v) => { C.tailK = v; }, fmt: mult });

    // --- Własny wzorzec stąpania
    const gPat = section('Własny wzorzec stąpania', false);
    toggle(gPat, { id: 'custom', label: 'Użyj własnych faz postawienia nóg', get: () => C.custom,
      set: (v) => { if (v) C.customOff = model.off.map((o) => Math.round(((o - model.off[0] + 1) % 1) * 100) / 100); C.custom = v; refreshAll(); } });
    const legLabels = ['Lewa tylna', 'Lewa przednia', 'Prawa tylna', 'Prawa przednia'];
    [0, 1, 3, 2].forEach((i) => slider(gPat, { id: 'off' + i,
      label: '<span class="legkey" style="background:var(--leg-' + ['lh', 'lf', 'rh', 'rf'][i] + ')"></span>' + legLabels[i],
      min: 0, max: 0.99, step: 0.01, get: () => C.customOff[i], set: (v) => { C.customOff[i] = v; C.custom = true; refreshers[customIdx](); },
      fmt: (v) => fmt(v * 100, 0) + ' % cyklu' }));
    const customIdx = refreshers.length - 5;
    const presetRow = document.createElement('div'); presetRow.className = 'seg';
    [['inochod', 'Inochód', [0, 0, 0.5, 0.5]], ['skoki', 'Skoki (tył–przód)', [0, 0.5, 0, 0.5]], ['tolt', 'Tölt', [0, 0.25, 0.5, 0.75]]].forEach(([id, name, off]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.id = 'preset-' + id;
      b.addEventListener('click', () => { C.customOff = off.slice(); C.custom = true; refreshAll(); });
      presetRow.appendChild(b);
    });
    gPat.appendChild(presetRow);

    // --- Budowa
    const gBuild = section('Budowa konia');
    const rebuild = () => { model.setBuild(Bd); view.build(model.g); layoutBands(); };
    slider(gBuild, { id: 'height', label: 'Wysokość w kłębie', min: 1.0, max: 1.9, step: 0.01, get: () => Bd.height, set: (v) => { Bd.height = v; rebuild(); }, fmt: (v) => fmt(v * 100, 0) + ' cm' });
    slider(gBuild, { id: 'legK', label: 'Długość nóg', min: 0.85, max: 1.15, step: 0.01, get: () => Bd.legK, set: (v) => { Bd.legK = v; rebuild(); }, fmt: mult });
    slider(gBuild, { id: 'bodyK', label: 'Długość tułowia', min: 0.85, max: 1.2, step: 0.01, get: () => Bd.bodyK, set: (v) => { Bd.bodyK = v; rebuild(); }, fmt: mult });
    slider(gBuild, { id: 'bulk', label: 'Masywność', min: 0.8, max: 1.3, step: 0.01, get: () => Bd.bulk, set: (v) => { Bd.bulk = v; rebuild(); }, fmt: mult });
    segmented(gBuild, { id: 'coat', label: 'Maść', options: Object.keys(COATS).map((k) => ({ value: k, label: COATS[k].label })),
      get: () => V.coat, set: (v) => { V.coat = v; view.setCoat(v); } });

    // --- Widok
    const gView = section('Widok');
    segmented(gView, { id: 'cam', label: 'Kamera', options: Object.keys(CAMS).map((k) => ({ value: k, label: CAMS[k].label })),
      get: () => V.camera, set: (v) => { V.camera = v; setCamera(v); } });
    toggle(gView, { id: 'skeleton', label: 'Szkielet (prześwietlenie)', get: () => V.skeleton, set: (v) => { V.skeleton = v; view.setSkeleton(v); } });
    toggle(gView, { id: 'prints', label: 'Ślady kopyt w kolorach nóg', get: () => V.prints, set: (v) => { V.prints = v; prints.visible = v; } });
    toggle(gView, { id: 'chrono', label: 'Chronofotografia: ślad szkieletu', get: () => V.chrono, set: (v) => { V.chrono = v; chrono.visible = v; clearChrono(); } });
    toggle(gView, { id: 'wall', label: 'Ściana pomiarowa', get: () => V.wall, set: (v) => { V.wall = v; wall.visible = v; } });
    const resetBtn = document.createElement('button'); resetBtn.type = 'button'; resetBtn.className = 'plain-btn'; resetBtn.id = 'reset'; resetBtn.textContent = 'Przywróć ustawienia początkowe';
    resetBtn.addEventListener('click', () => {
      Object.assign(C, JSON.parse(JSON.stringify(DEFAULTS.controls)));
      Object.assign(Bd, DEFAULTS.build); Object.assign(V, DEFAULTS.view);
      rebuild(); applyView(); refreshAll(); setCamera(V.camera);
    });
    gView.appendChild(resetBtn);
    const note = document.createElement('p'); note.className = 'note';
    note.innerHTML = '<kbd>Spacja</kbd> pauza · <kbd>←</kbd> <kbd>→</kbd> prędkość · <kbd>0</kbd>–<kbd>4</kbd> chód. Przeciągnij scenę, aby obrócić kamerę; kółko myszy przybliża.';
    panel.appendChild(note);

    const pauseBtn = $('#pause');
    function setPaused(v) { V.paused = v; pauseBtn.setAttribute('aria-pressed', String(v)); pauseBtn.textContent = v ? 'Odtwórz' : 'Pauza'; }
    pauseBtn.addEventListener('click', () => setPaused(!V.paused));
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|BUTTON|SELECT|TEXTAREA/.test(e.target.tagName) && e.code === 'Space') return;
      if (e.code === 'Space') { e.preventDefault(); setPaused(!V.paused); }
      else if (e.code === 'ArrowRight' && !(e.target && e.target.tagName === 'INPUT')) { C.speed = clamp(Math.round((C.speed + 0.5) * 10) / 10, 0, 18); refreshAll(); }
      else if (e.code === 'ArrowLeft' && !(e.target && e.target.tagName === 'INPUT')) { C.speed = clamp(Math.round((C.speed - 0.5) * 10) / 10, 0, 18); refreshAll(); }
      else if (/^(Digit|Numpad)[0-4]$/.test(e.code)) { C.gait = ['auto', 'walk', 'trot', 'canter', 'gallop'][+e.code.slice(-1)]; refreshAll(); }
    });

    /* ------------------------------------------------------------------ uruchomienie */
    let view = null;
    view = new HorseView();
    applyTheme();
    view.build(model.g);
    function applyView() {
      view.setCoat(V.coat); view.setSkeleton(V.skeleton);
      prints.visible = V.prints; chrono.visible = V.chrono; wall.visible = V.wall;
      setPaused(V.paused);
    }
    applyView(); layoutBands();
    setCamera(V.camera, true);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => paintWall(theme));
    new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

    const dock = $('.dock');
    function resize() {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      // kadr przesunięty w górę o wysokość dolnej nakładki — koń pozostaje w wolnej części sceny
      const lift = Math.round(Math.min(dock.offsetHeight + 18, h * 0.45));
      camera.aspect = w / (h + lift);
      camera.fov = w / h < 1 ? 40 : 30;                       // w pionie szerszy kąt, żeby koń mieścił się w kadrze
      camera.zoom = h / (h + lift);                           // skala obrazu taka, jak bez przesunięcia
      camera.setViewOffset(w, h + lift, 0, lift, w, h);
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(stage); ro.observe(dock);
    resize();

    const el = { gait: $('#gait-name'), ms: $('#v-ms'), kmh: $('#v-kmh'), f: $('#s-f'), l: $('#s-l'), b: $('#s-b'), s: $('#s-s') };
    let hudTimer = 0, lastX = model.x, lastTime = performance.now();
    const GAIT_BTN = { walk: 1, trot: 2, canter: 3, gallop: 4 };

    function simulate(dt) {
      const steps = clamp(Math.ceil(dt / (1 / 120)), 1, 8), h = dt / steps;
      for (let s = 0; s < steps; s++) {
        const pose = model.update(h);
        phiTotal += model.f * h;
        for (const ev of pose.events) addPrint(ev.leg, ev.x, ev.z);
        record();
      }
      if (V.chrono) {                                        // 8 ujęć na cykl
        const idx = Math.floor(phiTotal * 8);
        if (idx !== lastSnapIndex) { lastSnapIndex = idx; view.update(model); takeSnap(); }
      }
      if (model.x > 2000) {                                  // przesunięcie świata — liczby pozostają małe
        const dx = 2000;
        model.rebase(dx); lastX -= dx; camera.position.x -= dx; orbit.target.x -= dx; camGoal.x -= dx;
        const arr = prints.instanceMatrix.array;
        for (let i = 0; i < PRINTS; i++) arr[i * 16 + 12] -= dx;
        prints.instanceMatrix.needsUpdate = true;
        for (let i = 0; i < chronoPos.length; i += 3) chronoPos[i] -= dx;
        chronoGeo.attributes.position.needsUpdate = true;
      }
    }

    function frame(now) {
      requestAnimationFrame(frame);
      const dtReal = Math.min((now - lastTime) / 1000, 0.1); lastTime = now;
      if (!V.paused) simulate(dtReal * V.timeScale);
      view.update(model);
      if (V.skeleton) view.updateSkeleton(model);

      // kamera, światło i tło podążają za koniem
      const dx = model.x - lastX; lastX = model.x;
      camera.position.x += dx; orbit.target.x += dx; camGoal.x += dx;
      if (camMoving) { camera.position.lerp(camGoal, 1 - Math.exp(-dtReal / 0.18)); if (camera.position.distanceTo(camGoal) < 0.02) camMoving = false; }
      orbit.update();
      sun.position.set(model.x + 3.5, 9, 6.5); sun.target.position.set(model.x, 0.8, 0);
      fill.position.set(model.x - 6, 4, -2); fill.target.position.set(model.x, 1, 0);
      ground.position.x = model.x; groundTex.offset.x = model.x / GROUND_TILE;
      wall.position.x = model.x; wallTex.offset.x = model.x / WALL_TILE;
      renderer.render(scene, camera);
      drawPlot();

      hudTimer -= dtReal;
      if (hudTimer <= 0) {
        hudTimer = 0.1;
        const inf = model.info;
        el.gait.textContent = inf.v < 0.05 ? 'Stój' : C.custom ? 'Własny' : inf.gaitName;
        el.ms.textContent = fmt(inf.v, 1); el.kmh.textContent = fmt(inf.v * 3.6, 0);
        el.f.textContent = fmt(inf.f, 2); el.l.textContent = fmt(inf.stride, 2);
        el.b.textContent = fmt(inf.beta * 100, 0); el.s.textContent = fmt(inf.suspension * 100, 0);
        gaitSeg.btns.forEach((b, i) => b.classList.toggle('now', i === GAIT_BTN[inf.gait] && inf.v >= 0.05));
        bandSpans.forEach((s, i) => s.classList.toggle('on', i + 1 === GAIT_BTN[inf.gait] && C.gait === 'auto' && !C.custom));
      }
    }
    record();
    requestAnimationFrame(frame);

    // dla testów i ciekawskich: dostęp z konsoli
    window.horseSim = { model, state, view, setCamera, simulate, scene, camera, orbit };
  }

  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})();
