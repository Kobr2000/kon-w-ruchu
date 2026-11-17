/*
 * horse-model.js — parametryczny model chodów konia (stęp, kłus, galop, cwał)
 * ---------------------------------------------------------------------------
 * Czysty JavaScript bez zależności; działa w przeglądarce i w Node.
 *
 * Układ współrzędnych: X — kierunek ruchu, Y — w górę, Z — w prawo konia.
 * Jednostki: metry, sekundy, radiany. Kąty odcinków kończyn liczone są
 * „od pionu w dół” w stronę przodu konia: dir(a) = (sin a, −cos a).
 *
 * Jak to działa (w skrócie):
 *  1. Wzorzec stąpania — każdy chód to cztery przesunięcia fazowe (kiedy w cyklu
 *     dana noga dotyka podłoża) oraz współczynnik podparcia β (jaką część cyklu
 *     noga stoi na ziemi). Częstotliwość i długość cyklu wynikają z prędkości.
 *  2. Kopyto w fazie podparcia jest przyklejone do podłoża (bez poślizgu),
 *     w fazie przeniesienia pęcina leci po zaplanowanym łuku.
 *  3. Kąty stawów wyznacza kinematyka odwrotna (IK) w płaszczyźnie nogi.
 *  4. Ruch tułowia (kołysanie pionowe, pochylenie, przechył) NIE jest
 *     animowany ręcznie — wynika z bilansu pionowych sił reakcji podłoża
 *     dla aktualnego wzorca stąpania (dwukrotne całkowanie po cyklu).
 */
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;
  const GRAV = 9.81;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const frac = (x) => x - Math.floor(x);
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const wrapDiff = (d) => d - Math.round(d);          // różnica faz w przedziale [−0,5; 0,5]
  const dir = (a) => [Math.sin(a), -Math.cos(a)];

  /* Kolejność nóg w całym modelu: lewa tylna, lewa przednia, prawa tylna, prawa przednia. */
  const LEG_NAMES = ['LT', 'LP', 'PT', 'PP'];
  const IS_FORE = [false, true, false, true];
  const SIDE = [-1, -1, 1, 1];                        // −1 lewa (Z<0), +1 prawa (Z>0)

  /*
   * Tabela chodów. Wartości odnoszą się do konia wzorcowego (160 cm w kłębie);
   * dla innych rozmiarów skalowane są zgodnie z podobieństwem Froude'a.
   *  off       — fazy postawienia nóg [LT, LP, PT, PP] (ułamek cyklu), galop i cwał „z prawej nogi”
   *  contact   — droga, jaką tułów pokonuje nad stojącym kopytem [m]
   *  strideA/B — długość cyklu L = A + B·v [m]
   *  liftF/H   — uniesienie pęciny w przeniesieniu (przód / tył) [m]
   *  carp      — maks. zgięcie nadgarstka w przeniesieniu [°]
   *  fetFlex   — maks. zgięcie stawu pęcinowego w przeniesieniu [°]
   *  sink      — ugięcie pęciny pod obciążeniem [°]
   *  breakover — kąt odwinięcia kopyta w chwili oderwania [°]
   *  neck/head — ustawienie szyi (nad poziomem) i głowy (pod poziomem) [°]
   *  nod       — amplituda kiwania głową [°]
   *  tail      — uniesienie ogona [°];  spine — praca grzbietu (staw lędźwiowo-krzyżowy) [°]
   *  track     — połowa rozstawu śladów [m];  mShape — „dwugarbny” profil siły (stęp)
   *  bob / pitchMax / rollMax — górne ograniczenia amplitudy ruchu tułowia [m, °, °]
   */
  const GAITS = {
    walk:   { name: 'stęp',  off: [0.00, 0.25, 0.50, 0.75], contact: 1.15, strideA: 1.20, strideB: 0.42,
              liftF: 0.07, liftH: 0.05, carp: 50, fetFlex: 45, sink: 8,  breakover: 35, neck: 27, head: 50,
              nod: 4.5, tail: 10, spine: 1.5, track: 0.10, mShape: 1, ears: 0, bob: 0.020, pitchMax: 1.3, rollMax: 1.8 },
    trot:   { name: 'kłus',  off: [0.00, 0.50, 0.50, 0.00], contact: 1.14, strideA: 1.00, strideB: 0.45,
              liftF: 0.14, liftH: 0.11, carp: 80, fetFlex: 70, sink: 16, breakover: 45, neck: 40, head: 58,
              nod: 0.8, tail: 22, spine: 1.5, track: 0.08, mShape: 0, ears: 4, bob: 0.042, pitchMax: 0.9, rollMax: 1.0 },
    canter: { name: 'galop', off: [0.00, 0.25, 0.25, 0.50], contact: 1.22, strideA: 0.60, strideB: 0.48,
              liftF: 0.20, liftH: 0.19, carp: 95, fetFlex: 80, sink: 20, breakover: 50, neck: 37, head: 52,
              nod: 4.0, tail: 40, spine: 7,   track: 0.07, mShape: 0, ears: 8, bob: 0.055, pitchMax: 4.4, rollMax: 1.6 },
    gallop: { name: 'cwał',  off: [0.00, 0.37, 0.11, 0.50], contact: 1.30, strideA: 1.86, strideB: 0.314,
              liftF: 0.30, liftH: 0.31, carp: 115, fetFlex: 95, sink: 27, breakover: 55, neck: 24, head: 40,
              nod: 3.0, tail: 62, spine: 11,  track: 0.05, mShape: 0, ears: 24, bob: 0.050, pitchMax: 3.6, rollMax: 1.0 }
  };
  const GAIT_KEYS = ['walk', 'trot', 'canter', 'gallop'];
  const STYLE_KEYS = ['contact', 'strideA', 'strideB', 'liftF', 'liftH', 'carp', 'fetFlex', 'sink',
    'breakover', 'neck', 'head', 'nod', 'tail', 'spine', 'track', 'mShape', 'ears', 'bob', 'pitchMax', 'rollMax'];

  const SMOOTH_KEYS = ['freqK', 'dutyK', 'liftK', 'flexK', 'bounceK', 'pitchK', 'rollK', 'spineK', 'nodK', 'tailK'];

  /* Progi automatycznej zmiany chodu (prędkość znormalizowana, m/s) — z histerezą. */
  const AUTO = { walkUp: 2.0, trotDown: 1.7, trotUp: 5.0, canterDown: 4.2, gallopFrom: 7.0, gallopFull: 10.5 };

  /* Gładki „garb” 0→1→0 na [0, end] z maksimum w s = peak (zerowe nachylenie na końcach). */
  function bump(s, peak, end) {
    const t = s / end;
    if (t <= 0 || t >= 1) return 0;
    const u = Math.pow(t, Math.log(0.5) / Math.log(peak / end));
    const sn = Math.sin(Math.PI * u);
    return sn * sn;
  }

  /* Profil pionowej siły reakcji w fazie podparcia (całka = 1); m — udział kształtu „M”. */
  function loadShape(s, m) {
    const k = 0.33 * m;
    return (Math.sin(Math.PI * s) + k * Math.sin(3 * Math.PI * s)) / ((2 / Math.PI) * (1 + k / 3));
  }

  /* IK dwóch odcinków w płaszczyźnie. bendForward: „kolano” wysunięte do przodu. */
  function twoBone(dx, dy, l1, l2, bendForward, dmax) {
    let d = Math.hypot(dx, dy), err = 0;
    const dmin = Math.abs(l1 - l2) * 1.001 + 1e-4;
    if (d > dmax) { err = d - dmax; d = dmax; } else if (d < dmin) { err = dmin - d; d = dmin; }
    const psi = Math.atan2(dx, -dy);
    const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    const B = Math.acos(clamp((l2 * l2 + d * d - l1 * l1) / (2 * l2 * d), -1, 1));
    return bendForward ? { a1: psi + A, a2: psi - B, err } : { a1: psi - A, a2: psi + B, err };
  }

  /*
   * Geometria konia zależna od parametrów budowy.
   *  height — wysokość w kłębie [m], legK — mnożnik długości nóg,
   *  bodyK — mnożnik długości tułowia, bulk — masywność (tylko wygląd).
   */
  function makeGeometry(b) {
    const S = b.height / 1.6, K = b.legK, B = b.bodyK;
    const g = { S, K, B, bulk: b.bulk, lenScale: S * K };

    // tułów — współrzędne lokalne (początek w środku kłody)
    g.comX = 0.07 * S * B;                       // środek masy (57% ciężaru na przodzie)
    g.kPitch = 0.76 * S * B;                     // promień bezwładności — pochylenie
    g.kRoll = 0.36 * S;                          // promień bezwładności — przechył
    g.ls = [-0.36 * S * B, 0.36 * S];            // staw lędźwiowo-krzyżowy
    g.hip = [-0.62 * S * B, 0.10 * S, 0.17 * S]; // staw biodrowy
    g.scapPivot = [0.40 * S * B, 0.328 * S, 0.19 * S]; // oś obrotu łopatki
    g.neckBase = [0.56 * S * B, 0.26 * S];
    g.neck1 = 0.38 * S; g.neck2 = 0.36 * S; g.headLen = 0.60 * S;
    g.tailBase = [-0.86 * S * B, 0.30 * S];

    // kończyna tylna: udo, podudzie, nadpęcie, pęcina
    g.femur = 0.41 * S * K; g.tibia = 0.44 * S * K; g.cannonH = 0.34 * S * K; g.pasternH = 0.16 * S * K;
    g.delta = 28 * DEG;                          // stały kąt udo–nadpęcie (aparat wzajemny stawu skokowego)
    g.L1 = Math.sqrt(g.femur * g.femur + g.cannonH * g.cannonH + 2 * g.femur * g.cannonH * Math.cos(g.delta));
    g.eps = Math.atan2(g.cannonH * Math.sin(g.delta), g.femur + g.cannonH * Math.cos(g.delta));
    // największy wyprost: staw skokowy nie przekracza 172°
    g.dmaxH = Math.sqrt(g.L1 * g.L1 + g.tibia * g.tibia + 2 * g.L1 * g.tibia * Math.cos(g.delta - g.eps + 8 * DEG));
    g.gamma0H = 36 * DEG;                        // kąt pęciny w spoczynku (od pionu)

    // kończyna przednia: łopatka, ramię, przedramię, nadpęcie, pęcina
    g.scap = 0.42 * S * K; g.hum = 0.32 * S * K; g.radius = 0.45 * S * K; g.cannonF = 0.27 * S * K;
    g.pasternF = 0.15 * S * K;
    g.scapA0 = 35 * DEG; g.scapK = 0.52; g.scapRange = 24 * DEG; g.psi0 = 2.2 * DEG;
    g.gamma0F = 40 * DEG;
    g.elbowMax = 158 * DEG;                      // największy wyprost stawu łokciowego

    // kopyto: punkt zaczepienia pęciny względem czubka kopyta
    g.hoofAx = -0.075 * S; g.hoofAy = 0.075 * S;

    // postawa stojąca
    const fetYH = g.hoofAy + g.pasternH * Math.cos(g.gamma0H);
    const fetYF = g.hoofAy + g.pasternF * Math.cos(g.gamma0F);
    const H0h = fetYH + 1.048 * S * K - g.hip[1];
    const H0f = fetYF + 1.288 * S * K - g.scapPivot[1];
    g.H0 = (H0h + H0f) / 2;                      // wysokość początku układu tułowia
    g.pitch0 = Math.atan2(H0f - H0h, g.scapPivot[0] - g.hip[0]);
    g.neutralH = 0.07 * S;                       // czubek kopyta względem stawu (oś X) w postawie stojącej
    g.neutralF = 0.22 * S;
    g.biasH = -0.03 * S * K;                      // przesunięcie środka fazy podparcia
    g.biasF = -0.045 * S * K;
    return g;
  }

  /* IK nogi tylnej. Udo i nadpęcie zachowują stały kąt względem siebie (pantograf). */
  function solveHind(dx, dy, g) {
    const r = twoBone(dx, dy, g.L1, g.tibia, true, g.dmaxH);
    const aF = r.a1 + g.eps, aT = r.a2, aC = aF - g.delta;
    const f = dir(aF), t = dir(aT), c = dir(aC);
    const p1 = [g.femur * f[0], g.femur * f[1]];
    const p2 = [p1[0] + g.tibia * t[0], p1[1] + g.tibia * t[1]];
    const p3 = [p2[0] + g.cannonH * c[0], p2[1] + g.cannonH * c[1]];
    return { pts: [[0, 0], p1, p2, p3], aC, err: r.err, angles: [aF, aT, aC] };
  }

  /* IK nogi przedniej. Łopatka podąża za osią kończyny; nadgarstek zgina się tylko w przeniesieniu. */
  function solveFore(dx, dy, g, flexDes, pitch) {
    const psi = Math.atan2(dx, -dy);
    const base = g.scapA0 + pitch;
    const aS = clamp(base + g.scapK * (psi - g.psi0), base - g.scapRange, base + g.scapRange);
    const sd = dir(aS);
    const P = [g.scap * sd[0], g.scap * sd[1]];
    const ex = dx - P[0], ey = dy - P[1];
    const r = g.radius, c = g.cannonF;
    // nadgarstek zgina się według planu fazy przeniesienia; jeśli noga jest wtedy za krótka, po prostu nie sięga celu
    const th = flexDes;
    const Leff = Math.sqrt(r * r + c * c + 2 * r * c * Math.cos(th));
    const eta = Math.atan2(c * Math.sin(th), r + c * Math.cos(th));
    const tb = twoBone(ex, ey, g.hum, Leff, false,
      Math.sqrt(g.hum * g.hum + Leff * Leff - 2 * g.hum * Leff * Math.cos(Math.min(Math.PI, g.elbowMax + eta))));
    const aH = tb.a1, aR = tb.a2 + eta, aC = aR - th;
    const h = dir(aH), rr = dir(aR), cc = dir(aC);
    const E = [P[0] + g.hum * h[0], P[1] + g.hum * h[1]];
    const C = [E[0] + r * rr[0], E[1] + r * rr[1]];
    const F = [C[0] + c * cc[0], C[1] + c * cc[1]];
    return { pts: [[0, 0], P, E, C, F], aC, err: tb.err, angles: [aS, aH, aR, aC], flex: th };
  }

  class HorseModel {
    static defaultControls() {
      return {
        speed: 1.6,            // prędkość zadana [m/s]
        gait: 'auto',          // 'auto' | 'walk' | 'trot' | 'canter' | 'gallop'
        lead: 'R',             // noga prowadząca w galopie/cwale: 'R' | 'L'
        accel: 3.5, decel: 5,  // ograniczenie przyspieszenia [m/s²]
        freqK: 1,              // mnożnik częstotliwości cyklu
        dutyK: 1,              // mnożnik długości fazy podparcia
        liftK: 1,              // mnożnik wysokości kroku
        flexK: 1,              // mnożnik zgięcia stawów w przeniesieniu
        bounceK: 1, pitchK: 1, rollK: 1, spineK: 1, nodK: 1, tailK: 1,
        custom: false,         // własny wzorzec stąpania
        customOff: [0, 0.25, 0.5, 0.75]
      };
    }
    static defaultBuild() { return { height: 1.6, legK: 1, bodyK: 1, bulk: 1 }; }

    constructor(build, controls) {
      this.controls = Object.assign(HorseModel.defaultControls(), controls || {});
      this.N = 64;
      this.tabY = new Float64Array(this.N);
      this.tabPitch = new Float64Array(this.N);
      this.tabRoll = new Float64Array(this.N);
      this.tabNod = new Float64Array(this.N);
      this._a = new Float64Array(this.N);
      this._v = new Float64Array(this.N);
      this.setBuild(Object.assign(HorseModel.defaultBuild(), build || {}));
    }

    /* Zmiana budowy konia. Stan ruchu (położenie, faza, prędkość) zostaje zachowany. */
    setBuild(b) {
      this.build = Object.assign({}, b);
      this.g = makeGeometry(this.build);
      if (!this.legs) { this.reset(); return; }
      this._init = true;
      this.update(0);
    }

    /* Przesunięcie całego świata wzdłuż X (żeby współrzędne nie rosły bez końca). */
    rebase(dx) {
      this.x -= dx;
      for (const leg of this.legs) {
        leg.lockX -= dx; leg.fet[0] -= dx; leg.prevFet[0] -= dx; leg.toe[0] -= dx;
        for (const j of leg.joints) j[0] -= dx;
      }
      this.pose.x = this.x; this.pose.com[0] -= dx;
    }

    reset() {
      const c = this.controls;
      this.v = c.speed; this.x = 0; this.phase = 0; this.time = 0; this.drop = 0; this.dropFb = 0;
      const vh = this.v / Math.sqrt(this.g.lenScale);
      this.autoGait = vh > AUTO.trotUp ? 'canter' : vh > AUTO.walkUp ? 'trot' : 'walk';
      this.W = { walk: 0, trot: 0, canter: 0, gallop: 0 };
      const wt = this._targetWeights(vh);
      for (const k of GAIT_KEYS) this.W[k] = wt[k];
      this.off = this._targetOffsets(wt).slice();
      this.style = {};
      this.legs = [0, 1, 2, 3].map((i) => ({
        index: i, name: LEG_NAMES[i], fore: IS_FORE[i], side: SIDE[i],
        stance: false, s: 0, lockX: 0, lockZ: 0,
        loX: 0, loY: 0, loZ: 0, loVx: 0, loVy: 0,
        fet: [0, 0, 0], prevFet: [0, 0, 0], toe: [0, 0, 0],
        joints: [], q: 0, err: 0, load: 0, ny: 1, nz: 0, flex: 0
      }));
      this.k = {};                                    // wygładzone mnożniki z panelu
      for (const key of SMOOTH_KEYS) this.k[key] = c[key];
      this.pose = { events: [] };
      this.info = {};
      this._init = true;
      this.update(0);
    }

    _targetWeights(vh) {
      const c = this.controls, w = { walk: 0, trot: 0, canter: 0, gallop: 0 };
      if (c.gait === 'auto') {
        if (this.autoGait === 'canter') {
          const m = smooth((vh - AUTO.gallopFrom) / (AUTO.gallopFull - AUTO.gallopFrom));
          w.canter = 1 - m; w.gallop = m;
        } else w[this.autoGait] = 1;
      } else w[c.gait] = 1;
      return w;
    }

    _targetOffsets(w) {
      const c = this.controls;
      let t = [0, 0, 0, 0];
      if (c.custom) t = c.customOff.slice();
      else for (const k of GAIT_KEYS) for (let i = 0; i < 4; i++) t[i] += w[k] * GAITS[k].off[i];
      // zmiana nogi prowadzącej = lustrzane odbicie wzorca
      return (c.lead === 'L' && !c.custom) ? [t[2], t[3], t[0], t[1]] : t;
    }

    /* Tablice ruchu tułowia dla bieżącego wzorca: dwukrotne całkowanie przyspieszeń po jednym cyklu. */
    _computeTables() {
      const N = this.N, g = this.g, st = this.style, beta = this.beta, Lc = this.Lc;
      const dt = 1 / (N * Math.max(this.f, 0.3));
      const xf = g.scapPivot[0] + g.neutralF + g.biasF - g.comX - 0.06 * g.S;   // środek kopyta względem środka masy
      const xh = g.hip[0] + g.neutralH + g.biasH - g.comX - 0.06 * g.S;
      const wF = -xh / (xf - xh), wH = 1 - wF;          // rozkład ciężaru przód/tył
      const m = st.mShape * smooth((beta - 0.5) / 0.1);
      const aY = this._a, aP = this.tabPitch, aR = this.tabRoll, nod = this.tabNod;
      let air = 0;
      for (let k = 0; k < N; k++) {
        const ph = k / N;
        let Fy = 0, Tz = 0, Tx = 0, Ff = 0, n = 0;
        for (let i = 0; i < 4; i++) {
          const lp = frac(ph - this.off[i]);
          if (lp >= beta) continue;
          const s = lp / beta, fore = IS_FORE[i];
          const F = (fore ? wF : wH) * 0.5 * GRAV / beta * loadShape(s, m);
          const xi = (fore ? xf : xh) + Lc * (0.5 - s);
          Fy += F; Tz += F * xi; Tx -= F * SIDE[i] * 0.14 * g.S;
          if (fore) Ff += F;
          n++;
        }
        if (n === 0) air++;
        aY[k] = Fy - GRAV; aP[k] = Tz / (g.kPitch * g.kPitch); aR[k] = Tx / (g.kRoll * g.kRoll); nod[k] = Ff;
      }
      this.suspension = air / N;
      this._integrateTwice(aY, this.tabY, dt);
      this._integrateTwice(aP, this.tabPitch, dt);
      this._integrateTwice(aR, this.tabRoll, dt);
      // ograniczenie amplitud (model sił jest uproszczony — nie pozwalamy mu „odlecieć”)
      this._limit(this.tabY, st.bob * g.S);
      this._limit(this.tabPitch, st.pitchMax * DEG);
      this._limit(this.tabRoll, st.rollMax * DEG);
      // sygnał kiwania głową: znormalizowane obciążenie przodu
      let mean = 0, peak = 1e-6;
      for (let k = 0; k < N; k++) mean += nod[k];
      mean /= N;
      for (let k = 0; k < N; k++) { nod[k] -= mean; peak = Math.max(peak, Math.abs(nod[k])); }
      for (let k = 0; k < N; k++) nod[k] /= peak;
    }

    _integrateTwice(acc, out, dt) {
      const N = this.N, vel = this._v;
      let mean = 0;
      for (let k = 0; k < N; k++) mean += acc[k];
      mean /= N;
      let sum = 0, vm = 0;
      for (let k = 0; k < N; k++) { sum += (acc[k] - mean) * dt; vel[k] = sum; vm += sum; }
      vm /= N;
      let pos = 0, pm = 0;
      for (let k = 0; k < N; k++) { pos += (vel[k] - vm) * dt; out[k] = pos; pm += pos; }
      pm /= N;
      for (let k = 0; k < N; k++) out[k] -= pm;
    }

    _limit(tab, maxAmp) {
      let peak = 0;
      for (let k = 0; k < this.N; k++) peak = Math.max(peak, Math.abs(tab[k]));
      if (peak > maxAmp) { const s = maxAmp / peak; for (let k = 0; k < this.N; k++) tab[k] *= s; }
    }

    _sample(tab, ph) {
      const x = frac(ph) * this.N, i = Math.floor(x), t = x - i;
      return lerp(tab[i % this.N], tab[(i + 1) % this.N], t);
    }

    /* Położenie pęciny względem czubka kopyta stojącego na ziemi (s — postęp fazy podparcia). */
    _stanceFetlock(fore, s) {
      const g = this.g, st = this.style;
      const tb = clamp((s - 0.68) / 0.32, 0, 1);
      const q = st.breakover * DEG * tb * tb * (3 - 2 * tb);                 // odwijanie kopyta
      const sink = st.sink * DEG * Math.pow(Math.sin(Math.PI * s), 1.4) * (fore ? 1 : 0.85);
      const G0 = fore ? g.gamma0F : g.gamma0H, p = fore ? g.pasternF : g.pasternH;
      const Gam = G0 + sink - q;
      const cq = Math.cos(q), sq = Math.sin(q);
      const ax = g.hoofAx * cq + g.hoofAy * sq, ay = -g.hoofAx * sq + g.hoofAy * cq;
      return { x: ax - p * Math.sin(Gam), y: ay + p * Math.cos(Gam), q, Gam };
    }

    /* Ustawienie tułowia w zadanej fazie cyklu (kołysanie, pochylenie, przechył, praca grzbietu). */
    _trunkAt(ph) {
      const k = this.k, g = this.g, st = this.style, beta = this.beta, mb = this.mb;
      let reachH = 0, ldDiff = 0;
      for (let i = 0; i < 4; i += 2) {                  // nogi tylne: 0 (lewa), 2 (prawa)
        const lp = frac(ph - this.off[i]);
        reachH += lp < beta ? 1 - 2 * lp / beta : -1 + 2 * smooth((lp - beta) / (1 - beta));
        ldDiff += SIDE[i] * (lp < beta ? Math.sin(Math.PI * lp / beta) : 0);
      }
      return {
        yb: this._sample(this.tabY, ph) * k.bounceK * mb,
        pitch: g.pitch0 + this._sample(this.tabPitch, ph) * k.pitchK * mb,
        roll: this._sample(this.tabRoll, ph) * k.rollK * mb,
        // miednica podąża za średnim wysunięciem nóg tylnych (zgięcie w stawie lędźwiowo-krzyżowym)
        lam: st.spine * DEG * k.spineK * mb * 0.5 * reachH,
        // biodro nogi obciążonej unosi się, biodro nogi w przeniesieniu opada
        pelRoll: -2.0 * DEG * mb * k.rollK * (st.mShape * 0.9 + 0.35) * ldDiff
      };
    }

    /* Punkt lokalny tułowia → położenie względem punktu odniesienia (x konia, podłoże). */
    _toWorld(tp, drop, lx, ly, lz) {
      const g = this.g;
      const cp = Math.cos(tp.pitch), sp = Math.sin(tp.pitch), cr = Math.cos(tp.roll), sr = Math.sin(tp.roll);
      const x = lx - g.comX, y = ly * cr - lz * sr, z = ly * sr + lz * cr;
      return [g.comX + x * cp - y * sp, g.H0 - drop + tp.yb + x * sp + y * cp, z];
    }

    /* Oś obrotu nogi i (łopatka albo staw biodrowy). */
    _pivot(i, tp, drop) {
      const g = this.g, side = SIDE[i];
      if (IS_FORE[i]) return this._toWorld(tp, drop, g.scapPivot[0], g.scapPivot[1], side * g.scapPivot[2]);
      const cl = Math.cos(tp.lam), sl = Math.sin(tp.lam), cr = Math.cos(tp.pelRoll), sr = Math.sin(tp.pelRoll);
      const rx = g.hip[0] - g.ls[0], ry0 = g.hip[1] - g.ls[1], rz0 = side * g.hip[2];
      const ry = ry0 * cr - rz0 * sr, rz = ry0 * sr + rz0 * cr;
      return this._toWorld(tp, drop, g.ls[0] + rx * cl - ry * sl, g.ls[1] + rx * sl + ry * cl, rz);
    }

    /* O ile trzeba obniżyć tułów, żeby każda noga sięgała podłoża w chwili postawienia i oderwania kopyta. */
    _requiredDrop(Lc) {
      const g = this.g, st = this.style, cases = [];
      for (let i = 0; i < 4; i++) {
        const fore = IS_FORE[i];
        for (const e of [0, 0.72, 1]) {
          const fl = this._stanceFetlock(fore, e);
          const toeX = (fore ? g.scapPivot[0] + g.neutralF + g.biasF : g.hip[0] + g.neutralH + g.biasH) + Lc * (0.5 - e);
          cases.push({ i, fore, tp: this._trunkAt(this.off[i] + e * this.beta), fx: toeX + fl.x, fy: fl.y, fz: SIDE[i] * st.track * g.S });
        }
      }
      const errAt = (drop) => {
        let worst = 0;
        for (const k of cases) {
          const piv = this._pivot(k.i, k.tp, drop - 0.006 * g.S);          // z małym zapasem
          const dx = k.fx - piv[0], depth = Math.hypot(k.fy - piv[1], k.fz - piv[2]);
          const sol = k.fore ? solveFore(dx, -depth, g, 0, k.tp.pitch) : solveHind(dx, -depth, g);
          if (sol.err > worst) worst = sol.err;
        }
        return worst;
      };
      if (errAt(0) <= 0) return 0;
      let lo = 0, hi = 0.4 * g.lenScale;
      for (let it = 0; it < 12; it++) { const mid = (lo + hi) / 2; if (errAt(mid) > 0) lo = mid; else hi = mid; }
      return hi;
    }

    update(dt) {
      const c = this.controls, g = this.g;
      dt = clamp(dt, 0, 0.05);
      this.time += dt;

      // 1. prędkość i wygładzenie mnożników (suwaki nie powodują skoków)
      const kk = this.k, ks = this._init ? 1 : 1 - Math.exp(-dt / 0.18);
      for (const key of SMOOTH_KEYS) kk[key] += (c[key] - kk[key]) * ks;
      const dv = c.speed - this.v;
      this.v += clamp(dv, -c.decel * dt, c.accel * dt);
      const v = this.v;
      const vh = v / Math.sqrt(g.lenScale);

      // 2. chód
      if (this.autoGait === 'walk' && vh > AUTO.walkUp) this.autoGait = 'trot';
      else if (this.autoGait === 'trot' && vh < AUTO.trotDown) this.autoGait = 'walk';
      else if (this.autoGait === 'trot' && vh > AUTO.trotUp) this.autoGait = 'canter';
      else if (this.autoGait === 'canter' && vh < AUTO.canterDown) this.autoGait = 'trot';
      const wt = this._targetWeights(vh);
      const kw = this._init ? 1 : 1 - Math.exp(-dt / 0.22);
      const st = this.style;
      for (const k of GAIT_KEYS) this.W[k] += (wt[k] - this.W[k]) * kw;
      for (const key of STYLE_KEYS) {
        let val = 0;
        for (const k of GAIT_KEYS) val += this.W[k] * GAITS[k][key];
        st[key] = val;
      }

      // 3. częstotliwość, długość cyklu, współczynnik podparcia
      const stride = (st.strideA + st.strideB * vh) * g.lenScale / kk.freqK;
      const f = v / stride;
      const beta = clamp(Math.min(st.contact * kk.dutyK, 1.5) * g.lenScale / stride, 0.12, 0.88);
      const Lc = beta * stride;                       // droga tułowia nad stojącym kopytem
      this.f = f; this.beta = beta; this.Lc = Lc; this.stride = stride;
      const mb = this.mb = smooth(vh / 0.6);          // wygaszanie ruchu przy zatrzymaniu

      // 4. przesunięcia fazowe — płynne dochodzenie do wzorca docelowego
      const tgt = this._targetOffsets(wt);
      if (this._init) this.off = tgt.slice();
      else {
        let best = 0, bestCost = Infinity;             // dowolne wspólne przesunięcie fazy nie zmienia chodu
        for (let k = 0; k < 48; k++) {
          let cost = 0;
          for (let i = 0; i < 4; i++) { const d = wrapDiff(tgt[i] + k / 48 - this.off[i]); cost += d * d; }
          if (cost < bestCost - 1e-9) { bestCost = cost; best = k / 48; }
        }
        let mean = 0;
        for (let i = 0; i < 4; i++) mean += wrapDiff(tgt[i] + best - this.off[i]);
        best -= mean / 4;
        const ko = 1 - Math.exp(-dt / 0.12);
        for (let i = 0; i < 4; i++) {
          const d = wrapDiff(tgt[i] + best - this.off[i]);
          // nogi stojącej na ziemi nie „opóźniamy” — dokończy podparcie i nadrobi w przeniesieniu
          const up = (d > 0 && this.legs[i].stance) ? 0 : 0.5 * f * dt;
          this.off[i] = frac(this.off[i] + clamp(d * ko, -f * dt, up));
        }
      }

      // 5. faza cyklu i położenie
      this.phase = frac(this.phase + f * dt);
      this.x += v * dt;
      const phase = this.phase;

      // 6. ruch tułowia z bilansu sił + praca grzbietu
      this._computeTables();
      const dropT = this._requiredDrop(Lc);
      this.drop += (dropT - this.drop) * (this._init ? 1 : 1 - Math.exp(-dt / (dropT > this.drop ? 0.05 : 0.25)));
      const tp = this._trunkAt(phase);
      const pitch = tp.pitch, roll = tp.roll, lam = tp.lam, pelRoll = tp.pelRoll, yb = tp.yb;
      const drop = this.drop + this.dropFb;
      const Cx = this.x + g.comX, Cy = g.H0 - drop + yb;

      // 8. nogi
      const events = [];
      const swingLen = (1 - beta) * stride;           // droga tułowia w czasie przeniesienia nogi
      const Tsw = Math.min((1 - beta) / Math.max(f, 1e-3), 3);
      let nStance = 0;
      for (let i = 0; i < 4; i++) {
        const leg = this.legs[i], fore = leg.fore, side = leg.side;
        const piv = this._pivot(i, tp, drop);
        piv[0] += this.x;
        const nX = this.x + (fore ? g.scapPivot[0] + g.neutralF + g.biasF : g.hip[0] + g.neutralH + g.biasH);
        const trackZ = side * st.track * g.S;
        const lp = frac(phase - this.off[i]);
        const stance = lp < beta;
        const G0 = fore ? g.gamma0F : g.gamma0H, pl = fore ? g.pasternF : g.pasternH;

        if (this._init) {                               // stan ustalony na starcie
          if (stance) { leg.lockX = nX + Lc * (0.5 - lp / beta); leg.lockZ = trackZ; }
          else { const fl = this._stanceFetlock(fore, 1); leg.loX = -Lc / 2 + fl.x; leg.loY = fl.y; leg.loZ = trackZ; leg.loVx = 0; leg.loVy = 0; }
        } else if (stance && !leg.stance) {             // postawienie kopyta
          leg.lockX = leg.toe[0]; leg.lockZ = leg.toe[2];
          events.push({ type: 'down', leg: i, x: leg.lockX, z: leg.lockZ });
        } else if (!stance && leg.stance) {             // oderwanie kopyta
          leg.loX = leg.fet[0] - (nX - v * dt); leg.loY = leg.fet[1]; leg.loZ = leg.fet[2];
          if (dt > 1e-6) {
            leg.loVx = clamp((leg.fet[0] - leg.prevFet[0]) / dt - v, -v, 4);
            leg.loVy = clamp((leg.fet[1] - leg.prevFet[1]) / dt, -1, 4);
          }
        }
        leg.stance = stance;

        let F, q, Gam, flexDes = 0, sSwing = 0;
        if (stance) {
          const s = lp / beta;
          leg.s = s;
          // zabezpieczenie na czas zmiany chodu: kopyto nie zostaje dalej, niż sięga noga
          const relMin = -0.85 * g.lenScale;
          if (leg.lockX - nX < relMin) leg.lockX = nX + relMin;
          const fl = this._stanceFetlock(fore, s);
          q = fl.q; Gam = fl.Gam;
          F = [leg.lockX + fl.x, fl.y, leg.lockZ];
          leg.load = loadShape(s, 0) / beta;
          nStance++;
        } else {
          const s = (lp - beta) / (1 - beta);
          sSwing = s; leg.s = s; leg.load = 0;
          const fl1 = this._stanceFetlock(fore, 0);
          const u1 = Lc / 2 + fl1.x, y1 = fl1.y;
          const e = s * s * s * (s * (6 * s - 15) + 10);
          const e0 = 0.25, e1 = 0.22;
          const w0 = s < e0 ? s * (1 - s / e0) * (1 - s / e0) : 0;
          const t1 = 1 - s;
          const w1 = t1 < e1 ? -t1 * (1 - t1 / e1) * (1 - t1 / e1) : 0;
          const lift = (fore ? st.liftF : st.liftH) * g.lenScale * kk.liftK * mb;
          const m0x = clamp(leg.loVx * Tsw, -swingLen, 0.5 * swingLen);
          const m0y = clamp(leg.loVy * Tsw, -0.3 * g.lenScale, 0.8 * g.lenScale);
          const ux = leg.loX + (u1 - leg.loX) * e + m0x * w0 - swingLen * w1;
          const uy = leg.loY + (y1 - leg.loY) * e + lift * bump(s, 0.45, 1) + m0y * w0;
          F = [nX + ux, Math.max(uy, 0.05 * g.S), lerp(leg.loZ, trackZ, e)];
          if (fore) flexDes = st.carp * DEG * kk.flexK * mb * bump(s, 0.42, 0.9);
        }

        // IK w płaszczyźnie nogi (zawiera oś X i wektor staw→pęcina)
        const solve = (Ft) => {
          const dx = Ft[0] - piv[0], dy = Ft[1] - piv[1], dz = Ft[2] - piv[2];
          const depth = Math.hypot(dy, dz);
          const sol = fore ? solveFore(dx, -depth, g, flexDes, pitch) : solveHind(dx, -depth, g);
          sol.ey = dy / depth; sol.ez = dz / depth;
          return sol;
        };
        const place = (sol) => {
          const pts = sol.pts.map((p) => [piv[0] + p[0], piv[1] - sol.ey * p[1], piv[2] - sol.ez * p[1]]);
          const Fa = pts[pts.length - 1];
          if (!stance) {                               // pęcina i kopyto w przeniesieniu
            const follow = smooth(sSwing / 0.22) * (1 - smooth((sSwing - 0.72) / 0.28));
            const Q = st.breakover * DEG * (1 - smooth(sSwing / 0.3))
              + st.fetFlex * DEG * kk.flexK * mb * (fore ? 1 : 0.85) * bump(sSwing, 0.38, 0.88);
            Gam = G0 + follow * sol.aC - Q;
            q = G0 - Gam;
          }
          const gd = dir(Gam);
          const A = [Fa[0] + pl * gd[0], Fa[1] + pl * gd[1], Fa[2]];
          const cq = Math.cos(q), sq = Math.sin(q);
          const ax = g.hoofAx * cq + g.hoofAy * sq, ay = -g.hoofAx * sq + g.hoofAy * cq;
          const T = [A[0] - ax, A[1] - ay, A[2]];
          return { pts, Fa, A, T };
        };
        let sol = solve(F), pl3 = place(sol);
        if (!stance && pl3.T[1] < 0.004) {             // prześwit kopyta nad podłożem
          F[1] += 0.004 - pl3.T[1];
          sol = solve(F); pl3 = place(sol);
        }
        leg.prevFet = leg.fet; leg.fet = pl3.Fa; leg.toe = pl3.T;
        leg.joints = pl3.pts.concat([pl3.A, pl3.T]);
        leg.q = q; leg.err = sol.err; leg.ny = -sol.ey; leg.nz = -sol.ez;
        leg.angles = sol.angles; leg.flex = sol.flex || 0; leg.pastern = Gam;
      }

      // jeśli mimo wszystko któraś stojąca noga nie sięga podłoża (np. ostre hamowanie) — tułów przysiada
      let worst = 0;
      for (const leg of this.legs) if (leg.stance && leg.err > worst) worst = leg.err;
      this.dropFb = Math.min(this.dropFb * Math.exp(-dt / 0.4) + 0.8 * worst, 0.2 * g.lenScale);

      // 9. szyja, głowa, ogon
      const nodSig = this._sample(this.tabNod, phase - 0.04);
      const dPitch = pitch - g.pitch0;
      const neck1 = st.neck * DEG - 0.45 * dPitch - st.nod * DEG * kk.nodK * mb * nodSig;
      const neck2 = 7 * DEG + 0.25 * (st.neck - 30) * DEG;
      const head = -(st.head * DEG) - neck1 - neck2 - 0.4 * dPitch + 0.5 * st.nod * DEG * kk.nodK * mb * nodSig;

      const p = this.pose;
      p.x = this.x; p.com = [Cx, Cy, 0]; p.pitch = pitch; p.roll = roll; p.yb = yb;
      p.lam = lam; p.pelRoll = pelRoll; p.neck1 = neck1; p.neck2 = neck2; p.head = head;
      p.ears = st.ears * DEG; p.tail = st.tail * DEG * kk.tailK * lerp(0.6, 1, mb);
      p.phase = phase; p.mb = mb; p.events = events;

      // 10. informacje do wyświetlenia
      let top = 'walk';
      for (const k of GAIT_KEYS) if (this.W[k] > this.W[top]) top = k;
      const inf = this.info;
      inf.gait = top; inf.gaitName = GAITS[top].name; inf.v = v; inf.f = f; inf.stride = stride;
      inf.beta = beta; inf.suspension = this.suspension; inf.nStance = nStance; inf.phase = phase;
      inf.drop = drop; inf.Lc = Lc; inf.vh = vh;
      this._init = false;
      return p;
    }
  }

  HorseModel.GAITS = GAITS;
  HorseModel.GAIT_KEYS = GAIT_KEYS;
  HorseModel.LEG_NAMES = LEG_NAMES;
  HorseModel.IS_FORE = IS_FORE;
  HorseModel.SIDE = SIDE;
  HorseModel.makeGeometry = makeGeometry;
  HorseModel.solveFore = solveFore;
  HorseModel.solveHind = solveHind;

  if (typeof module !== 'undefined' && module.exports) module.exports = HorseModel;
  else root.HorseModel = HorseModel;
})(typeof window !== 'undefined' ? window : globalThis);
