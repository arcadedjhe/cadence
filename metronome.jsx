// ============================================================================
// MÉTRONOME INTÉRIEUR — module intégré à Cadence
// Chargé par index.html (<script type="text/babel" src="metronome.jsx">) AVANT le script principal.
// Expose : window.CadenceMetronome  (composant React, plein écran)
// Props :
//   title       : nom de l'élément travaillé (affiché en haut)
//   initial     : dernier niveau validé { v, tempo, num, den, sub, beacon, bell, vol, pos } ou null
//   history     : historique [{ d, bpm, sig, sub }] (affichage seulement)
//   onValidate  : (niveau) => void  — appelé par « Valider ce niveau »
//   onClose     : () => void
//   autoStart   : lance la lecture à l'ouverture (true par défaut)
//   claves      : banque de claves [{ id, name, num, den, sub, bars, pos }] (boutons « Ouvrir » des pistes)
//   onSaveClave : (clave) => void — « Enregistrer » d'une piste dans la banque
//   free        : mode libre (hors exercice) : pas de validation, réglages mémorisés via onAutoSave
//   onAutoSave  : (niveau) => void — appelé (différé) à chaque changement en mode libre
//   autoSeq     : ouvre directement en mode séquenceur (création de clave)
// Tout est enveloppé dans une fonction : aucun nom global (pas de conflit avec Cadence).
// ============================================================================
(function () {
const { useState, useEffect, useRef, useCallback, useMemo } = React;

// ─── Icônes minimalistes ─────────────────────────────────────────────────────
const Play = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
);
const Pause = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" /></svg>
);
const Volume2 = ({ size = 20, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>
);

// ─── Constantes ──────────────────────────────────────────────────────────────
const SUBDIVISION_OPTIONS = {
  quarter: { name: 'Noire', symbol: '♩', label: 'Noires' },
  eighth: { name: 'Croche', symbol: '♪', label: 'Croches' },
  sixteenth: { name: 'Double-croche', symbol: '♬', label: 'Doubles-croches' },
  triplet: { name: 'Triolet de croche', symbol: '♪₃', label: 'Triolets' }
};

const AVAILABLE_SOUNDS = {
  clave:     { label: 'C',    name: 'Clave',     color: '#ef4444', icon: '🔴', freq: 2600, type: 'sine' },
  woodblock: { label: 'W',    name: 'Woodblock', color: '#f59e0b', icon: '🟡', freq: 1800, type: 'square' },
  cowbell:   { label: 'B',    name: 'Cowbell',   color: '#10b981', icon: '🟢', freq: 800,  type: 'triangle' },
  kick:      { label: 'K',    name: 'Kick',      color: '#3b82f6', icon: '🔵', freq: 100,  type: 'sine' },
  bell:      { label: 'Bell', name: 'Repère',    color: '#a855f7', icon: '🔔', freq: 3200, type: 'sine' }
};

const FREQUENCIES = {
  every:   { label: '●', name: 'Toutes',     color: '#10b981' },
  every_2: { label: '②', name: '/2 mesures', color: '#3b82f6' },
  every_4: { label: '④', name: '/4 mesures', color: '#8b5cf6' },
  never:   { label: '○', name: 'Jamais',     color: '#64748b' }
};
const FREQUENCY_ORDER = ['every', 'every_2', 'every_4', 'never'];

const DEFAULT_VOLUMES = { clave: 0.3, woodblock: 0.25, cowbell: 0.3, kick: 0.5, bell: 0.7 };

const MAX_BARS = 8;
const TEMPO_MIN = 30;
const TEMPO_MAX = 300;

// ─── Géométrie de la mesure (même calcul que le métronome d'origine) ─────────
function unitsToLabelFor(num, den, sub) {
  if (den === 8) return sub === 'quarter' ? Math.round(num / 2) : num;
  return num;
}

function totalFor(num, den, sub) {
  const quarters = den === 2 ? num * 2 : den === 4 ? num : num / 2;
  switch (sub) {
    case 'quarter': return Math.round(quarters);
    case 'eighth': return Math.round(quarters * 2);
    case 'sixteenth': return Math.round(quarters * 4);
    case 'triplet': return Math.round(quarters * 3);
    default: return Math.round(quarters * 2);
  }
}

// Étiquettes et valeurs par défaut de chaque position
function buildLayout(num, den, sub) {
  const total = totalFor(num, den, sub);
  const units = unitsToLabelFor(num, den, sub);
  const subsPerUnit = total / units;
  const labels = [];
  const defaults = [];
  for (let i = 0; i < total; i++) {
    const unitNum = Math.floor(i / subsPerUnit) + 1;
    const posInUnit = i % subsPerUnit;
    let label;
    if (sub === 'quarter') label = String(unitNum);
    else if (sub === 'eighth') label = Math.floor(posInUnit) === 0 ? String(unitNum) : '∧';
    else if (sub === 'sixteenth') {
      const rel = Math.floor((posInUnit / subsPerUnit) * 4);
      label = [String(unitNum), 'e', '∧', 'a'][Math.min(rel, 3)];
    } else {
      const rel = Math.floor((posInUnit / subsPerUnit) * 3);
      label = String(Math.min(rel + 1, 3));
    }
    labels.push(label);
    defaults.push({
      frequency: Math.floor(posInUnit) === 0 ? 'every' : 'never',
      sound: (unitNum - 1) % 2 === 0 ? 'clave' : 'woodblock'
    });
  }
  return { total, units, subsPerUnit, labels, defaults };
}

// Positions par défaut : 1 mesure = valeurs habituelles ; plusieurs mesures = motif vide à dessiner
function defaultPositions(num, den, sub, bars) {
  const L = buildLayout(num, den, sub);
  if (bars <= 1) return L.defaults;
  const out = [];
  for (let b = 0; b < bars; b++) L.defaults.forEach(d => out.push({ frequency: 'never', sound: 'clave' }));
  return out;
}

// Piste B : vide par défaut, son « woodblock »
function emptyTrack(num, den, sub, bars, sound) {
  const total = totalFor(num, den, sub);
  const out = [];
  for (let i = 0; i < total * bars; i++) out.push({ frequency: 'never', sound });
  return out;
}

// ─── Instantané d'un niveau (ce que Cadence enregistre) ──────────────────────
const FREQ_CODE = { every: 'e', every_2: '2', every_4: '4', never: 'n' };
const CODE_FREQ = { e: 'every', '2': 'every_2', '4': 'every_4', n: 'never' };

function makeSnapshot(s) {
  return {
    v: 3,
    tempo: s.tempo,
    num: s.num,
    den: s.den,
    sub: s.sub,
    bars: s.bars,
    seq: !!s.seq,
    beacon: s.beacon,
    bell: s.bell,
    vol: { ...s.volumes },
    pos: s.positions.map(p => [FREQ_CODE[p.frequency] || 'n', p.sound]),
    posB: (s.positionsB || []).map(p => [FREQ_CODE[p.frequency] || 'n', p.sound])
  };
}

// Lit un niveau enregistré en le validant (valeurs hors limites ou absentes → défauts)
function readSnapshot(snap) {
  const d = { tempo: 120, num: 4, den: 4, sub: 'eighth', bars: 1, seq: false, beacon: 'none', bell: 'harmonic', volumes: { ...DEFAULT_VOLUMES }, positions: null, positionsB: null };
  if (!snap || typeof snap !== 'object') return d;
  const tempo = parseInt(snap.tempo, 10);
  if (tempo >= TEMPO_MIN && tempo <= TEMPO_MAX) d.tempo = tempo;
  const num = parseInt(snap.num, 10);
  if (num >= 2 && num <= 15) d.num = num;
  if ([2, 4, 8].includes(snap.den)) d.den = snap.den;
  if (SUBDIVISION_OPTIONS[snap.sub]) d.sub = snap.sub;
  if (['none', '8', '12', '16', '20', '24'].includes(String(snap.beacon))) d.beacon = String(snap.beacon);
  if (['harmonic', 'click', 'block'].includes(snap.bell)) d.bell = snap.bell;
  if (snap.vol && typeof snap.vol === 'object') {
    Object.keys(DEFAULT_VOLUMES).forEach(k => {
      const v = Number(snap.vol[k]);
      if (isFinite(v) && v >= 0 && v <= 1) d.volumes[k] = v;
    });
  }
  const bars = parseInt(snap.bars, 10);
  if (bars >= 1 && bars <= MAX_BARS) d.bars = bars;   // niveaux anciens (sans « bars ») : 1 mesure
  // Mode séquenceur : explicite (v3) ou déduit des niveaux v2 à plusieurs mesures
  d.seq = snap.seq === true || (snap.v === 2 && d.bars > 1);
  const total = totalFor(d.num, d.den, d.sub);
  const readTrack = (arr, fallbackSound) => arr.map(p => ({
    frequency: CODE_FREQ[p && p[0]] || 'never',
    sound: AVAILABLE_SOUNDS[p && p[1]] ? p[1] : fallbackSound
  }));
  if (Array.isArray(snap.pos) && snap.pos.length === total * d.bars) d.positions = readTrack(snap.pos, 'clave');
  if (Array.isArray(snap.posB) && snap.posB.length === total * d.bars) d.positionsB = readTrack(snap.posB, 'woodblock');
  return d;
}

// ─── Banque de claves : un motif de piste (signature, subdivision, mesures, cases) ─
function claveToCells(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.pos)) return null;
  const num = parseInt(c.num, 10), bars = parseInt(c.bars, 10);
  if (!(num >= 2 && num <= 15) || ![2, 4, 8].includes(c.den) || !SUBDIVISION_OPTIONS[c.sub]) return null;
  if (!(bars >= 1 && bars <= MAX_BARS)) return null;
  const total = totalFor(num, c.den, c.sub);
  if (c.pos.length !== total * bars) return null;
  const cells = c.pos.map(p => ({
    frequency: p && p[0] === 'e' ? 'every' : 'never',
    sound: AVAILABLE_SOUNDS[p && p[1]] ? p[1] : 'clave'
  }));
  return { num, den: c.den, sub: c.sub, bars, total, cells };
}
function makeClave(name, s) {
  return {
    id: 'cl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, num: s.num, den: s.den, sub: s.sub, bars: s.bars,
    pos: s.positions.map(p => [p.frequency === 'every' ? 'e' : 'n', p.sound]),
    createdAt: new Date().toISOString().slice(0, 10)
  };
}
function claveInfo(c) {
  const v = claveToCells(c);
  if (!v) return 'clave illisible';
  const notes = v.cells.filter(x => x.frequency === 'every').length;
  return v.num + '/' + v.den + ' · ' + SUBDIVISION_OPTIONS[v.sub].label.toLowerCase() + ' · ' + v.bars + ' mes. · ' + notes + ' note' + (notes > 1 ? 's' : '');
}

// ─── Petit champ numérique − / + avec saisie directe (tempo) ─────────────────
function TempoField({ value, onChange, onStep }) {
  const [text, setText] = useState(String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(value)); }, [value, focus]);
  const clamp = n => Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, n));
  const commit = () => {
    const n = parseInt(text, 10);
    const v = isNaN(n) ? value : clamp(n);
    setText(String(v));
    if (v !== value) onChange(v);
  };
  // Simple fonction (pas un composant) : le bouton n'est pas recréé à chaque rendu, aucun appui n'est perdu
  const stepBtn = (d, label) => (
    <button
      type="button"
      onClick={() => onStep(d)}
      disabled={(d < 0 && value <= TEMPO_MIN) || (d > 0 && value >= TEMPO_MAX)}
      className="metro-step-btn"
      style={{ touchAction: 'manipulation' }}
    >{label}</button>
  );
  return (
    <div className="flex items-center justify-center" style={{ gap: 6 }}>
      {stepBtn(-5, "−5")}
      {stepBtn(-1, "−1")}
      <div className="metro-tempo-box" style={{ borderColor: focus ? '#c9a84c' : undefined }}>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={focus ? text : String(value)}
          onFocus={e => { setText(String(value)); setFocus(true); e.target.select(); }}
          onBlur={() => { setFocus(false); commit(); }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
          onChange={e => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          style={{ width: Math.max(1, (focus ? text : String(value)).length) + 'ch' }}
          aria-label="Tempo en battements par minute"
        />
        <span>bpm</span>
      </div>
      {stepBtn(1, "+1")}
      {stepBtn(5, "+5")}
    </div>
  );
}

// Section repliable
function Fold({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="metro-card mb-4 overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full p-4 flex items-center justify-between text-white">
        <span className="text-base font-semibold">{title}</span>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="p-4 pt-1 border-t border-slate-700">{children}</div>}
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================
function CadenceMetronome({ title, initial, history, onValidate, onClose, autoStart = true, claves, onSaveClave, free = false, onAutoSave, autoSeq = false }) {
  const init = useMemo(() => readSnapshot(initial), []); // lu une seule fois à l'ouverture

  // ─── États (le niveau chargé est appliqué dès le premier rendu) ───────────
  const [tempo, setTempo] = useState(init.tempo);
  const [num, setNum] = useState(init.num);
  const [den, setDen] = useState(init.den);
  const [sub, setSub] = useState(init.sub);
  const [bars, setBars] = useState(init.bars);
  const [seq, setSeq] = useState(!!init.seq);          // mode séquenceur (2 pistes)
  const [brush, setBrush] = useState('clave');          // son posé sur la piste A
  const [brushB, setBrushB] = useState('woodblock');    // son posé sur la piste B
  const [muteA, setMuteA] = useState(false);
  const [muteB, setMuteB] = useState(false);
  const [modal, setModal] = useState(null);       // { type: 'open'|'save'|'confirm', track, clave }
  const [saveName, setSaveName] = useState('');
  const [notice, setNotice] = useState('');
  const [beacon, setBeacon] = useState(init.beacon);
  const [bell, setBell] = useState(init.bell);
  const [volumes, setVolumes] = useState(init.volumes);
  const [positions, setPositions] = useState(
    () => init.positions || defaultPositions(init.num, init.den, init.sub, init.bars)
  );
  const [positionsB, setPositionsB] = useState(
    () => init.positionsB || emptyTrack(init.num, init.den, init.sub, init.bars, 'woodblock')
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMeasure, setCurrentMeasure] = useState(1);
  const [currentStep, setCurrentStep] = useState(-1);
  const [soundSelectorOpen, setSoundSelectorOpen] = useState(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [justValidated, setJustValidated] = useState(null); // tempo du dernier niveau validé ici

  const layout = useMemo(() => buildLayout(num, den, sub), [num, den, sub]);
  const total = layout.total;
  const cycleSteps = total * bars;
  // Filet de sécurité : jamais d'accès hors tableau
  const pos = positions.length === cycleSteps ? positions : defaultPositions(num, den, sub, bars);
  const posB = positionsB.length === cycleSteps ? positionsB : emptyTrack(num, den, sub, bars, 'woodblock');
  const eb = seq ? bars : 1;   // mesures réellement jouées (la grille classique n'utilise que la 1re)
  const steps = useMemo(() => pos.map((p, i) => ({ ...p, label: layout.labels[i % total] })), [pos, layout, total]);

  // ─── Refs : le planificateur lit toujours les valeurs courantes, sans redémarrer ─
  const live = useRef({});
  live.current = { tempo, num, den, sub, bars: eb, seq, muteA, muteB, beacon, bell, volumes, pos, posB, layout, total };

  const audioRef = useRef(null);
  const noteRef = useRef(0);
  const measureRef = useRef(1);
  const nextTimeRef = useRef(0);
  const timerRef = useRef(null);
  const queueRef = useRef([]);
  const rafRef = useRef(null);
  const wakeRef = useRef(null);
  const playingRef = useRef(false);
  const gridMeasureRef = useRef(null);

  // ─── Audio ────────────────────────────────────────────────────────────────
  useEffect(() => {
    audioRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return () => {
      stopEngine();
      releaseWake();
      const ctx = audioRef.current;
      if (ctx && ctx.state !== 'closed') ctx.close();
    };
  }, []);

  // Largeur réelle de la grille (rotation, redimensionnement)
  useEffect(() => {
    const el = gridMeasureRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0] && entries[0].contentRect && entries[0].contentRect.width;
      if (w) setGridWidth(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const playSound = useCallback((time, soundType, isStrong) => {
    const ctx = audioRef.current;
    if (!ctx) return;
    const cfg = AVAILABLE_SOUNDS[soundType];
    if (!cfg) return;
    const { volumes: vols, bell: bellType } = live.current;
    const base = vols[soundType] !== undefined ? vols[soundType] : 0.3;
    const vol = base * (isStrong ? 1.15 : 1.0);
    if (vol <= 0) return;

    if (soundType === 'kick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(cfg.freq, time);
      o.frequency.exponentialRampToValueAtTime(40, time + 0.1);
      o.type = 'sine';
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
      o.connect(g); g.connect(ctx.destination);
      o.start(time); o.stop(time + 0.3);
      return;
    }
    if (soundType === 'cowbell') {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o1.frequency.value = 800; o2.frequency.value = 540;
      o1.type = 'square'; o2.type = 'square';
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
      o1.connect(g); o2.connect(g); g.connect(ctx.destination);
      o1.start(time); o2.start(time); o1.stop(time + 0.15); o2.stop(time + 0.15);
      return;
    }
    if (soundType === 'bell') {
      if (bellType === 'click') {
        const size = Math.floor(ctx.sampleRate * 0.05);
        const buf = ctx.createBuffer(1, size, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass'; f.frequency.value = 2000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * 1.5, time);
        g.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
        src.connect(f); f.connect(g); g.connect(ctx.destination);
        src.start(time); src.stop(time + 0.05);
        return;
      }
      if (bellType === 'block') {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        const g1 = ctx.createGain(), g2 = ctx.createGain(), main = ctx.createGain();
        o1.frequency.value = 200; o1.type = 'square';
        g1.gain.setValueAtTime(vol * 0.8, time);
        g1.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
        o2.frequency.value = 3500; o2.type = 'sine';
        g2.gain.setValueAtTime(vol * 1.2, time);
        g2.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
        o1.connect(g1); o2.connect(g2); g1.connect(main); g2.connect(main); main.connect(ctx.destination);
        o1.start(time); o2.start(time); o1.stop(time + 0.08); o2.stop(time + 0.08);
        return;
      }
      // harmonique (défaut)
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
      const g = ctx.createGain();
      o1.frequency.value = 3200; o2.frequency.value = 4800; o3.frequency.value = 6400;
      o1.type = o2.type = o3.type = 'sine';
      g.gain.setValueAtTime(vol * 1.2, time);
      g.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
      o1.connect(g); o2.connect(g); o3.connect(g); g.connect(ctx.destination);
      o1.start(time); o2.start(time); o3.start(time);
      o1.stop(time + 0.1); o2.stop(time + 0.1); o3.stop(time + 0.1);
      return;
    }
    // clave / woodblock
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = cfg.freq * (isStrong ? 1.15 : 1.0);
    o.type = cfg.type;
    const dur = soundType === 'clave' ? 0.05 : 0.08;
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.01, time + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(time); o.stop(time + dur);
  }, []);

  const previewSound = useCallback((soundType) => {
    const ctx = audioRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    playSound(ctx.currentTime, soundType, false);
  }, [playSound]);

  // ─── Planificateur ────────────────────────────────────────────────────────
  const shouldPlay = (freq, measure) => {
    switch (freq) {
      case 'every': return true;
      case 'every_2': return measure % 2 === 1;
      case 'every_4': return (measure - 1) % 4 === 0;
      default: return false;
    }
  };

  const tick = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx || !playingRef.current) return;
    const L = live.current;
    const perBeat = 60 / L.tempo;
    const div = L.sub === 'quarter' ? 1 : L.sub === 'sixteenth' ? 4 : L.sub === 'triplet' ? 3 : 2;
    const secPerStep = perBeat / div;
    const AHEAD = 0.15;

    const cycle = L.total * L.bars;
    // Anciens niveaux à 1 mesure : « une sur 2 / une sur 4 » se comptent sur un cycle de 4 mesures (ou de la longueur du repère)
    const legacyCycle = L.beacon !== 'none' ? parseInt(L.beacon, 10) : 4;

    while (nextTimeRef.current < ctx.currentTime + AHEAD) {
      const idx = noteRef.current % cycle;              // position dans tout le motif
      const stepInBar = idx % L.total;
      const count = measureRef.current - 1;             // mesures écoulées depuis le départ (0, 1, 2…)
      const legacyMeasure = (count % legacyCycle) + 1;
      const p = L.pos[idx];
      const strong = Math.floor(stepInBar % L.layout.subsPerUnit) === 0;
      if (p && !L.muteA && shouldPlay(p.frequency, L.bars === 1 ? legacyMeasure : 1)) {
        playSound(nextTimeRef.current, p.sound, strong);
      }
      if (L.seq) {
        const pb = L.posB[idx];
        if (pb && !L.muteB && pb.frequency === 'every') playSound(nextTimeRef.current, pb.sound, strong);
      }
      if (L.beacon !== 'none' && stepInBar === 0 && count % parseInt(L.beacon, 10) === 0) {
        playSound(nextTimeRef.current, 'bell', true);
      }
      queueRef.current.push({ time: nextTimeRef.current, idx, measure: L.bars === 1 ? legacyMeasure : Math.floor(idx / L.total) + 1 });
      nextTimeRef.current += secPerStep;
      noteRef.current++;
      if (noteRef.current % L.total === 0) measureRef.current++;
    }
  }, [playSound]);

  // Affichage : la case s'allume au moment où le son est joué (pas 100 ms avant)
  const draw = useCallback(() => {
    const ctx = audioRef.current;
    if (ctx) {
      const q = queueRef.current;
      let last = null;
      while (q.length && q[0].time <= ctx.currentTime) last = q.shift();
      if (last) { setCurrentStep(last.idx); setCurrentMeasure(last.measure); }
    }
    rafRef.current = requestAnimationFrame(draw);
  }, []);

  // ─── Écran allumé pendant la lecture (Android coupe les minuteurs sinon) ──
  const requestWake = async () => {
    try {
      if ('wakeLock' in navigator && !wakeRef.current) {
        wakeRef.current = await navigator.wakeLock.request('screen');
        wakeRef.current.addEventListener('release', () => { wakeRef.current = null; });
      }
    } catch (e) { /* non disponible : sans conséquence */ }
  };
  const releaseWake = () => {
    try { if (wakeRef.current) { wakeRef.current.release(); wakeRef.current = null; } } catch (e) {}
  };

  const startEngine = async () => {
    const ctx = audioRef.current;
    if (!ctx || playingRef.current) return;
    try { if (ctx.state === 'suspended') await ctx.resume(); } catch (e) {}
    noteRef.current = 0;
    measureRef.current = 1;
    queueRef.current = [];
    nextTimeRef.current = ctx.currentTime + 0.06;
    playingRef.current = true;
    setIsPlaying(true);
    timerRef.current = setInterval(tick, 25);
    tick();
    rafRef.current = requestAnimationFrame(draw);
    requestWake();
  };

  function stopEngine() {
    playingRef.current = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    queueRef.current = [];
  }

  const stop = () => {
    stopEngine();
    releaseWake();
    setIsPlaying(false);
    setCurrentStep(-1);
  };

  const toggle = () => { if (playingRef.current) stop(); else startEngine(); };

  // Lancement automatique à l'ouverture (le toucher sur le bouton « Métronome » sert de geste utilisateur)
  useEffect(() => {
    if (autoStart) startEngine();
  }, []);

  // Si l'écran revient au premier plan pendant la lecture, on reprend le verrou d'écran
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && playingRef.current) requestWake(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ─── Actions sur la grille (mises à jour immuables) ───────────────────────
  const basePos = (prev) => (prev.length === cycleSteps ? prev : defaultPositions(num, den, sub, bars));
  const basePosB = (prev) => (prev.length === cycleSteps ? prev : emptyTrack(num, den, sub, bars, 'woodblock'));
  const toggleFrequency = (i) => {
    setPositions(prev => basePos(prev).map((p, k) => k !== i ? p : { ...p, frequency: FREQUENCY_ORDER[(FREQUENCY_ORDER.indexOf(p.frequency) + 1) % FREQUENCY_ORDER.length] }));
  };
  const changeSound = (i, s) => {
    setPositions(prev => basePos(prev).map((p, k) => k !== i ? p : { ...p, sound: s }));
    setSoundSelectorOpen(null);
  };
  // Séquenceur : touche une case → pose le son de la piste ; re-touche avec le même son → retire
  const paintCell = (track, i) => {
    const isA = track === 'A';
    const br = isA ? brush : brushB;
    const cur = (isA ? pos : posB)[i];
    const removing = cur && cur.frequency === 'every' && cur.sound === br;
    const base = isA ? basePos : basePosB;
    (isA ? setPositions : setPositionsB)(prev => base(prev).map((p, k) => k !== i ? p : (removing ? { ...p, frequency: 'never' } : { frequency: 'every', sound: br })));
    if (!removing) previewSound(br);
  };
  // Changement de signature / subdivision : on repart de zéro pour la nouvelle mesure
  const changeMeter = (n, d, s) => {
    setNum(n); setDen(d); setSub(s);
    if (seq) setPositions(emptyTrack(n, d, s, bars, 'clave'));
    else {
      const first = buildLayout(n, d, s).defaults;
      setPositions([...first, ...emptyTrack(n, d, s, bars - 1, 'clave')]);
    }
    setPositionsB(emptyTrack(n, d, s, bars, 'woodblock'));
    setSoundSelectorOpen(null);
  };
  // Longueur du motif : en l'allongeant, chaque nouvelle mesure reprend la précédente ; en la raccourcissant, on garde le début
  const resolvePos = (list, measure) => list.map(p => ({ ...p, frequency: shouldPlay(p.frequency, measure) ? 'every' : 'never' }));
  const resizeTrack = (cur, old, n, legacy) => {
    if (n <= old) return cur.slice(0, total * n);
    const barList = [];
    for (let b = 0; b < old; b++) barList.push(cur.slice(b * total, (b + 1) * total));
    const fromLegacy = legacy && old === 1;   // les anciens « une sur 2 / une sur 4 » deviennent de vrais motifs
    if (fromLegacy) barList[0] = resolvePos(barList[0], 1);
    for (let b = old; b < n; b++) barList.push(fromLegacy ? resolvePos(cur.slice(0, total), b + 1) : barList[b - 1].map(p => ({ ...p })));
    return barList.flat();
  };
  const changeBars = (n) => {
    setPositions(prev => resizeTrack(basePos(prev), bars, n, true));
    setPositionsB(prev => resizeTrack(basePosB(prev), bars, n, false));
    setBars(n);
    setSoundSelectorOpen(null);
  };
  // Mode séquenceur : la grille actuelle devient la piste A (1re entrée : 2 mesures), la piste B reste à dessiner
  const toggleSeq = () => {
    if (isPlaying) return;
    if (!seq) {
      if (bars === 1) changeBars(2);
      else if (pos.slice(0, total).some(p => p.frequency === 'every_2' || p.frequency === 'every_4')) {
        setPositions(prev => { const cur = basePos(prev); const first = cur.slice(0, total); const out = []; for (let b = 0; b < bars; b++) out.push(...resolvePos(first, b + 1)); return out; });
      }
      setSeq(true);
    } else setSeq(false);
    setSoundSelectorOpen(null);
  };
  // ─── Banque de claves ─────────────────────────────────────────────────────
  const sameMeterAs = (v) => v.num === num && v.den === den && v.sub === sub;
  const applyClave = (track, c) => {
    const v = claveToCells(c);
    if (!v) return;
    const same = sameMeterAs(v);
    const nb = same ? Math.max(bars, v.bars) : v.bars;             // une clave plus courte se répète sur toute la longueur
    const tiled = [];
    for (let b = 0; b < nb; b++) tiled.push(...v.cells.slice((b % v.bars) * v.total, (b % v.bars + 1) * v.total).map(p => ({ ...p })));
    const otherIsA = track === 'B';
    const otherNew = same ? resizeTrack(otherIsA ? pos : posB, bars, nb, otherIsA) : emptyTrack(v.num, v.den, v.sub, nb, otherIsA ? 'clave' : 'woodblock');
    setNum(v.num); setDen(v.den); setSub(v.sub); setBars(nb);
    if (track === 'A') { setPositions(tiled); setPositionsB(otherNew); } else { setPositionsB(tiled); setPositions(otherNew); }
    setSeq(true);
    setModal(null);
    setNotice('📂 « ' + c.name + ' » chargée sur la piste ' + track);
  };
  const requestLoad = (track, c) => {
    const v = claveToCells(c);
    if (!v) return;
    const other = track === 'A' ? posB : pos;
    if (!sameMeterAs(v) && other.some(p => p.frequency !== 'never')) setModal({ type: 'confirm', track, clave: c });
    else applyClave(track, c);
  };
  const saveTrackAsClave = () => {
    if (!modal) return;
    const name = saveName.trim();
    if (!name) return;
    onSaveClave && onSaveClave(makeClave(name, { num, den, sub, bars, positions: modal.track === 'A' ? pos : posB }));
    setModal(null);
    setNotice('💾 « ' + name + ' » enregistrée dans la banque de claves');
  };
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { if (autoSeq && !autoStart) toggleSeq(); }, []);

  // Mode libre : les réglages sont mémorisés automatiquement (différé), plus un envoi final à la fermeture
  const autoRef = useRef(null);
  const autoFirst = useRef(true);
  useEffect(() => {
    if (!onAutoSave) return;
    if (autoFirst.current) { autoFirst.current = false; return; }
    const snap = makeSnapshot({ tempo, num, den, sub, bars, seq, beacon, bell, volumes, positions: pos, positionsB: posB });
    autoRef.current = snap;
    const t = setTimeout(() => { onAutoSave(snap); autoRef.current = null; }, 700);
    return () => clearTimeout(t);
  }, [tempo, num, den, sub, bars, seq, beacon, bell, volumes, positions, positionsB]);
  useEffect(() => () => { if (onAutoSave && autoRef.current) onAutoSave(autoRef.current); }, []);

  const clearTrack = (t) => (t === 'A' ? setPositions : setPositionsB)(prev => (t === 'A' ? basePos : basePosB)(prev).map(p => ({ ...p, frequency: 'never' })));
  const repeatFirstBar = (t) => (t === 'A' ? setPositions : setPositionsB)(prev => { const cur = (t === 'A' ? basePos : basePosB)(prev); return cur.map((p, k) => ({ ...cur[k % total] })); });

  const applyPreset = (type) => {
    setPositions(prev => {
      const base = basePos(prev);
      const perBeat = total / num;
      return base.map((p, i) => {
        if (i >= total) return p;                       // grille classique : 1re mesure seulement
        let f = p.frequency;
        if (type === 'all') f = 'every';
        else if (type === 'none') f = 'never';
        else if (type === 'downbeats') f = (i % perBeat === 0) ? 'every' : 'never';
        else if (type === 'backbeat') f = (i === 2 || i === 6) ? 'every' : 'never';          // temps 2 et 4 (croches, 4/4)
        else if (type === 'offbeats') f = (i % 2 === 1) ? 'every' : 'never';                  // les « et » (croches)
        return { ...p, frequency: f };
      });
    });
  };

  const validate = () => {
    const snap = makeSnapshot({ tempo, num, den, sub, bars, seq, beacon, bell, volumes, positions: pos, positionsB: posB });
    onValidate && onValidate(snap);
    setJustValidated(tempo);
  };

  // ─── Aperçu (grille classique : 4 mesures de cycle ; séquenceur : le motif entier, 2 pistes) ─
  const previewMeasures = useMemo(() => {
    const out = [];
    const n = eb === 1 && !seq ? 4 : eb;
    for (let m = 1; m <= n; m++) {
      const sl = (arr) => eb === 1 ? arr.slice(0, total) : arr.slice((m - 1) * total, m * total);
      const f = (arr, m2) => sl(arr).map(p => shouldPlay(p.frequency, m2) ? '♪' : '_').join(' ');
      out.push({ measure: m, notes: f(pos, eb === 1 ? m : 1), notesB: seq ? f(posB, 1) : null });
    }
    return out;
  }, [pos, posB, eb, seq, total]);
  const currentBar = eb > 1 && currentStep >= 0 ? Math.floor(currentStep / total) + 1 : currentMeasure;

  const last = history && history.length ? history[history.length - 1] : null;
  const fmtDate = (d) => { try { const [y, m, dd] = d.split('-'); return dd + '/' + m; } catch (e) { return d; } };

  // ─── Grille (même logique de mise en page que le métronome d'origine) ─────
  const renderGrid = () => {
    const unitsToLabel = layout.units;
    const subsPerUnit = layout.subsPerUnit;
    const unitGroups = [];
    for (let i = 0; i < total; i++) {
      const u = Math.floor(i / subsPerUnit);
      if (!unitGroups[u]) unitGroups[u] = [];
      unitGroups[u].push(steps[i]);
    }
    const PREF_MIN_STEP = 40, ABS_MIN_STEP = 30, MAX_ROWS = 3;
    const W = gridWidth > 0 ? gridWidth : 340;
    const GAP = W < 500 ? 4 : 8;
    const unitCount = Math.max(1, unitGroups.length);
    const unitSize = Math.max(1, Math.ceil(subsPerUnit));
    const sepCount = (units) => sub === 'triplet' ? Math.max(0, units - 1) : 0;
    const fixedPx = (st, units) => (st - 1) * GAP + sepCount(units) * (GAP + 2);
    const stepWidthFor = (units) => { const st = units * unitSize; return (W - fixedPx(st, units)) / st; };

    let numberOfRows = unitCount;
    for (let r = 1; r <= unitCount; r++) {
      const w = stepWidthFor(Math.ceil(unitCount / r));
      if (w >= PREF_MIN_STEP || (r >= MAX_ROWS && w >= ABS_MIN_STEP)) { numberOfRows = r; break; }
    }
    const base = Math.floor(unitGroups.length / numberOfRows);
    const extra = unitGroups.length % numberOfRows;
    const rows = [], rowStarts = [];
    let uc = 0, sc = 0;
    for (let r = 0; r < numberOfRows; r++) {
      const n = base + (r < extra ? 1 : 0);
      const rs = [];
      rowStarts.push(sc);
      for (let u = 0; u < n; u++) {
        const g = unitGroups[uc] || [];
        rs.push(...g); sc += g.length; uc++;
      }
      rows.push(rs);
    }
    const maxRowLength = Math.max(...rows.map(r => r.length));
    const maxUnitsInRow = Math.ceil(unitCount / numberOfRows);
    const fixedTotal = fixedPx(maxRowLength, maxUnitsInRow);
    const stepW = (W - fixedTotal) / maxRowLength;
    const size = stepW >= 62 ? 'normal' : stepW >= 52 ? 'medium' : stepW >= 44 ? 'compact' : 'tiny';
    const SIZES = {
      normal:  { pad: '0.75rem', label: '1.25rem', idx: '0.65rem', sym: '1.5rem', name: '0.65rem', sPad: '0.5rem', sFont: '0.75rem', sIcon: '1rem',    tFont: '0.75rem', hideName: false },
      medium:  { pad: '0.5rem',  label: '1rem',    idx: '0.65rem', sym: '1.3rem', name: '0.65rem', sPad: '0.5rem', sFont: '0.75rem', sIcon: '1rem',    tFont: '0.75rem', hideName: false },
      compact: { pad: '0.4rem',  label: '0.9rem',  idx: '0.6rem',  sym: '1.1rem', name: '0.6rem',  sPad: '0.3rem', sFont: '0.65rem', sIcon: '0.9rem',  tFont: '0.7rem',  hideName: false },
      tiny:    { pad: '0.25rem', label: '0.85rem', idx: '0.55rem', sym: '1rem',   name: '0.55rem', sPad: '0.2rem', sFont: '0.6rem',  sIcon: '0.85rem', tFont: '0.65rem', hideName: true  }
    };
    const S = SIZES[size];
    const stepCss = `calc((100% - ${fixedTotal}px) / ${maxRowLength})`;
    const slotCss = `((100% - ${fixedTotal}px) / ${maxRowLength} + ${GAP}px)`;

    return rows.map((rowSubs, rowIndex) => (
      <div key={rowIndex} className="mb-6">
        <div className="flex mb-2">
          {rowSubs.map((s, idx) => {
            const gi = rowStarts[rowIndex] + idx;
            const unitNum = Math.floor(gi / subsPerUnit) + 1;
            const posInUnit = gi % subsPerUnit;
            if (Math.floor(posInUnit) === 0 && unitNum <= unitsToLabel) {
              const remaining = rowSubs.length - idx;
              const unitWidth = Math.min(Math.ceil(subsPerUnit), remaining);
              const sepExtra = (sub === 'triplet' && idx + unitWidth < rowSubs.length) ? GAP + 2 : 0;
              return (
                <div key={idx} className="text-slate-300 font-semibold text-center"
                  style={{ width: `calc(${unitWidth} * ${slotCss} + ${sepExtra}px)`, flexShrink: 0, fontSize: S.tFont }}>
                  T{unitNum}
                </div>
              );
            }
            return null;
          }).filter(Boolean)}
        </div>
        <div className="flex" style={{ gap: GAP }}>
          {rowSubs.map((s, localIdx) => {
            const idx = rowStarts[rowIndex] + localIdx;
            const freq = FREQUENCIES[s.frequency];
            const snd = AVAILABLE_SOUNDS[s.sound] || AVAILABLE_SOUNDS.clave;
            const isActive = isPlaying && currentStep === idx;
            const willPlay = shouldPlay(s.frequency, currentMeasure);
            const isGhost = isPlaying && !willPlay && currentStep === idx;
            const showSep = sub === 'triplet' && (idx + 1) % 3 === 0 && localIdx < rowSubs.length - 1;
            const hot = isActive && willPlay;
            return (
              <React.Fragment key={idx}>
                <div className="relative" style={{ width: stepCss, flexShrink: 0, opacity: isPlaying ? (isActive ? 1 : 0.6) : 1 }}>
                  <div
                    onClick={() => toggleFrequency(idx)}
                    className="rounded-t-lg text-center cursor-pointer"
                    style={{
                      backgroundColor: isGhost ? '#374151' : freq.color + '33',
                      borderTop: `2px solid ${hot ? '#fbbf24' : freq.color}`,
                      borderLeft: `2px solid ${hot ? '#fbbf24' : freq.color}`,
                      borderRight: `2px solid ${hot ? '#fbbf24' : freq.color}`,
                      borderBottom: 'none',
                      padding: S.pad
                    }}
                  >
                    <div className="text-white font-bold mb-1" style={{ fontSize: S.label }}>{s.label}</div>
                    <div className="text-slate-300" style={{ fontSize: S.idx }}>#{idx + 1}</div>
                    <div className="mb-1" style={{ color: isGhost ? '#6b7280' : freq.color, opacity: isGhost ? 0.5 : 1, fontSize: S.sym }}>{freq.label}</div>
                    {!S.hideName && (
                      <div className="font-medium" style={{ color: isGhost ? '#6b7280' : freq.color, opacity: isGhost ? 0.5 : 1, fontSize: S.name }}>{freq.name}</div>
                    )}
                  </div>
                  <button
                    onClick={() => setSoundSelectorOpen(idx)}
                    className="w-full rounded-b-lg font-bold"
                    style={{
                      backgroundColor: s.frequency === 'never' ? '#64748b' : snd.color,
                      color: 'white',
                      borderTop: 'none',
                      borderLeft: `2px solid ${hot ? '#fbbf24' : (s.frequency === 'never' ? '#64748b' : snd.color)}`,
                      borderRight: `2px solid ${hot ? '#fbbf24' : (s.frequency === 'never' ? '#64748b' : snd.color)}`,
                      borderBottom: `2px solid ${hot ? '#fbbf24' : (s.frequency === 'never' ? '#64748b' : snd.color)}`,
                      padding: S.sPad, fontSize: S.sFont,
                      opacity: s.frequency === 'never' ? 0.5 : 1
                    }}
                  >
                    <div style={{ fontSize: S.sIcon }}>{s.frequency === 'never' ? '🔇' : snd.icon}</div>
                    <div>{s.frequency === 'never' ? '—' : snd.label}</div>
                  </button>
                </div>
                {showSep && (<div className="flex items-center"><div className="w-0.5 bg-slate-600 h-full"></div></div>)}
              </React.Fragment>
            );
          })}
        </div>
        {rows.length > 1 && (
          <div className="text-center text-slate-500 text-xs mt-1">
            Ligne {rowIndex + 1}/{rows.length}
            {` (${SUBDIVISION_OPTIONS[sub].label.toLowerCase()} ${rowStarts[rowIndex] + 1}-${rowStarts[rowIndex] + rowSubs.length})`}
          </div>
        )}
      </div>
    ));
  };

  // ─── Séquenceur compact : 2 pistes superposées (A et B) ───────────────────
  const renderSequencer = () => {
    const perRow = 16;
    const nRows = Math.max(1, Math.ceil(total / perRow));
    const unitCount = Math.max(1, Math.ceil(total / layout.subsPerUnit));
    const unitsPerRow = Math.ceil(unitCount / nRows);
    const rowGroups = [];
    for (let r = 0; r < nRows; r++) {
      const groups = [];
      for (let u = r * unitsPerRow; u < Math.min(unitCount, (r + 1) * unitsPerRow); u++) {
        const g = [];
        for (let si = Math.ceil(u * layout.subsPerUnit - 1e-9); si < Math.min(total, Math.ceil((u + 1) * layout.subsPerUnit - 1e-9)); si++) g.push(si);
        if (g.length) groups.push({ u, g });
      }
      rowGroups.push(groups);
    }
    const tracks = [
      { id: 'A', arr: pos, br: brush, setBr: setBrush, mute: muteA, setMute: setMuteA },
      { id: 'B', arr: posB, br: brushB, setBr: setBrushB, mute: muteB, setMute: setMuteB }
    ];
    const smallBtn = { fontSize: '0.7rem', padding: '0.25rem 0.5rem', borderRadius: 6, background: '#334155', color: '#e2e8f0' };
    return (
      <div>
        {notice && <div className="mb-3 text-green-400 text-sm font-semibold" data-notice>{notice}</div>}
        {tracks.map(t => (
          <div key={t.id} className="mb-3 p-2 rounded-lg" style={{ background: '#0f172a', border: '2px solid #1e293b' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-bold">Piste {t.id}</span>
              <button type="button" data-mute={t.id} aria-pressed={t.mute} onClick={() => t.setMute(m => !m)}
                style={{ ...smallBtn, background: t.mute ? '#b91c1c' : '#334155', color: '#fff', fontWeight: 700, fontSize: '0.8rem', padding: '0.3rem 0.7rem' }}>{t.mute ? '🔇 Muet' : '🔊 Muet'}</button>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {claves && <button type="button" data-open={t.id} disabled={isPlaying} onClick={() => setModal({ type: 'open', track: t.id })} style={{ ...smallBtn, opacity: isPlaying ? 0.5 : 1 }}>📂 Ouvrir</button>}
              {onSaveClave && <button type="button" data-save={t.id} disabled={isPlaying} onClick={() => { setSaveName(''); setModal({ type: 'save', track: t.id }); }} style={{ ...smallBtn, opacity: isPlaying ? 0.5 : 1 }}>💾 Enregistrer</button>}
              {bars > 1 && <button type="button" data-repeat={t.id} onClick={() => repeatFirstBar(t.id)} style={smallBtn}>Répéter la mes. 1</button>}
              <button type="button" data-clear={t.id} onClick={() => clearTrack(t.id)} style={smallBtn}>Vider</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(AVAILABLE_SOUNDS).map(([key, snd]) => (
                <button key={key} type="button" data-brush={t.id + key} onClick={() => { t.setBr(key); previewSound(key); }}
                  className="rounded-lg font-bold text-white"
                  style={{ backgroundColor: snd.color, padding: '0.35rem 0.6rem', fontSize: '0.78rem', outline: t.br === key ? '3px solid #fbbf24' : 'none', opacity: t.br === key ? 1 : 0.6 }}>
                  {snd.icon} {snd.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        {Array.from({ length: bars }, (_, b) => {
          const isCurBar = isPlaying && currentBar === b + 1;
          return (
            <div key={b} className="mb-3 p-2 rounded-lg" style={{ background: isCurBar ? '#1e293b' : '#0f172a', border: isCurBar ? '2px solid #4ade80' : '2px solid #1e293b' }}>
              <div className={isCurBar ? 'text-green-400 font-bold text-sm mb-1' : 'text-slate-300 text-sm font-semibold mb-1'}>Mesure {b + 1}</div>
              {rowGroups.map((groups, r) => (
                <div key={r} className="mb-1">
                  {tracks.map(t => (
                    <div key={t.id} className="flex items-center mb-1" style={{ gap: 4 }}>
                      <span className="text-slate-400 font-bold" style={{ width: 12, fontSize: '0.7rem', flexShrink: 0 }}>{t.id}</span>
                      <div className="flex flex-1" style={{ gap: 6, minWidth: 0 }}>
                        {groups.map(({ u, g }) => (
                          <div key={u} className="flex" style={{ gap: 2, flex: g.length + ' 1 0', minWidth: 0 }}>
                            {g.map(si => {
                              const gi = b * total + si;
                              const c = t.arr[gi];
                              const on = c && c.frequency === 'every';
                              const snd = AVAILABLE_SOUNDS[(c && c.sound)] || AVAILABLE_SOUNDS.clave;
                              const isActive = isPlaying && currentStep === gi;
                              const isDown = Math.floor(si % layout.subsPerUnit) === 0;
                              return (
                                <button key={si} type="button" data-cell={t.id + gi} data-on={on ? 1 : 0} onClick={() => paintCell(t.id, gi)}
                                  aria-label={`Piste ${t.id}, mesure ${b + 1}, ${layout.labels[si]}`}
                                  style={{ flex: '1 1 0', minWidth: 0, height: 38, borderRadius: 6, fontSize: '0.8rem', lineHeight: 1,
                                    background: on ? snd.color : '#1e293b',
                                    border: isActive ? '2px solid #fbbf24' : (isDown ? '2px solid #475569' : '2px solid #334155'),
                                    color: '#fff', opacity: (t.mute ? 0.35 : 1) * (isPlaying && !isActive ? 0.7 : 1) }}>
                                  {on ? snd.icon : <span style={{ color: '#64748b', fontSize: '0.6rem' }}>{layout.labels[si]}</span>}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
        <div className="text-slate-500 text-xs">Touche une case pour poser le son de la piste ; touche-la de nouveau (même son) pour l'effacer.</div>
      </div>
    );
  };

  // ─── Rendu ────────────────────────────────────────────────────────────────
  const hasChanged = justValidated !== null && justValidated === tempo;

  return (
    <div className="metro-root" role="dialog" aria-label="Métronome">
      {/* En-tête */}
      <div className="metro-header">
        <button type="button" onClick={() => { stop(); onClose && onClose(); }} className="metro-close" aria-label="Fermer le métronome">✕</button>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-400">🎚 Métronome</div>
          <div className="text-white font-semibold truncate">{title || 'Métronome libre'}</div>
        </div>
        {last && <div className="text-right text-xs text-slate-400 leading-tight">Dernier niveau<br /><span className="text-gold font-mono">{last.bpm} bpm</span> · {fmtDate(last.d)}</div>}
      </div>

      <div className="metro-scroll">
        <div className="max-w-3xl mx-auto px-3 pt-4 pb-32">

          {/* Tempo + lecture */}
          <div className="metro-card p-4 mb-4">
            <div className="text-slate-300 text-sm mb-3 text-center">Tempo</div>
            <TempoField value={tempo} onChange={setTempo} onStep={(d) => setTempo(t => Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, t + d)))} />
            <button
              type="button"
              onClick={toggle}
              className={`w-full mt-4 py-3 px-6 rounded-lg font-semibold flex items-center justify-center gap-2 text-white ${isPlaying ? 'bg-orange-600' : 'bg-green-600'}`}
            >
              {isPlaying ? (<><Pause size={20} /> PAUSE</>) : (<><Play size={20} /> PLAY</>)}
            </button>
          </div>

          {/* Mesure */}
          <div className="metro-card p-4 mb-4 space-y-4">
            <div>
              <label className="block text-slate-300 text-sm mb-2">Signature rythmique</label>
              <div className="flex items-center gap-2">
                <select value={num} disabled={isPlaying} onChange={(e) => changeMeter(parseInt(e.target.value, 10), den, sub)} className="metro-select font-mono text-xl">
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(n => (<option key={n} value={n}>{n}</option>))}
                </select>
                <span className="text-white text-2xl font-bold">/</span>
                <select value={den} disabled={isPlaying} onChange={(e) => changeMeter(num, parseInt(e.target.value, 10), sub)} className="metro-select font-mono text-xl">
                  <option value={2}>2 (𝅗𝅥 Blanche)</option>
                  <option value={4}>4 (♩ Noire)</option>
                  <option value={8}>8 (♪ Croche)</option>
                </select>
              </div>
              <div className="mt-2 text-slate-400 text-sm">
                → <strong className="text-gold">{num}/{den}</strong> = {num} x {den === 2 ? 'blanches' : den === 4 ? 'noires' : 'croches'} par mesure
              </div>
            </div>

            <div>
              <label className="block text-slate-300 text-sm mb-2">Subdivision affichée</label>
              <select value={sub} disabled={isPlaying} onChange={(e) => changeMeter(num, den, e.target.value)} className="metro-select w-full font-mono text-lg">
                {Object.entries(SUBDIVISION_OPTIONS).map(([k, o]) => (<option key={k} value={k}>{o.symbol} {o.name}</option>))}
              </select>
              <div className="mt-2 text-slate-400 text-sm">→ <strong className="text-green-400">{total} {SUBDIVISION_OPTIONS[sub].label.toLowerCase()} affichées</strong></div>
            </div>

            <div>
              <label className="block text-slate-300 text-sm mb-2">Clic repère (grilles d'accords) 🔔</label>
              <select value={beacon} disabled={isPlaying} onChange={(e) => setBeacon(e.target.value)} className="metro-select w-full font-mono text-lg">
                <option value="none">Désactivé</option>
                <option value="8">Toutes les 8 mesures (2×4)</option>
                <option value="12">Toutes les 12 mesures (3×4)</option>
                <option value="16">Toutes les 16 mesures (4×4)</option>
                <option value="20">Toutes les 20 mesures (5×4)</option>
                <option value="24">Toutes les 24 mesures (6×4)</option>
              </select>
              {beacon !== 'none' && (
                <div className="mt-2 text-slate-400 text-sm">→ <strong className="text-purple-400">Clic repère 🔔 sur mesures 1, {parseInt(beacon, 10) + 1}, {parseInt(beacon, 10) * 2 + 1}...</strong></div>
              )}
            </div>
          </div>

          {/* Mode séquenceur */}
          <div className="metro-card p-4 mb-4">
            <button type="button" onClick={toggleSeq} disabled={isPlaying} data-seq-toggle aria-pressed={seq}
              className={`w-full py-3 px-4 rounded-lg font-semibold text-white ${seq ? 'bg-green-600' : 'bg-slate-600'}`}
              style={{ opacity: isPlaying ? 0.6 : 1 }}>
              🎼 Mode séquenceur : {seq ? 'activé' : 'désactivé'}
            </button>
            {!seq && <div className="mt-2 text-slate-500 text-xs text-center">Patterns sur plusieurs mesures, 2 pistes jouées ensemble (claves).</div>}
            {seq && (
              <div className="mt-3">
                <label className="block text-slate-300 text-sm mb-2 text-center">Longueur du motif</label>
                <div className="flex items-center justify-center gap-4">
                  <button type="button" disabled={isPlaying || bars <= 1} onClick={() => changeBars(bars - 1)} className="metro-btn bg-slate-600" style={{ minWidth: 48 }} aria-label="Moins de mesures">−</button>
                  <div className="text-center" style={{ minWidth: 110 }}>
                    <span className="text-white font-mono text-3xl font-bold" data-bars>{bars}</span>
                    <span className="text-slate-400 ml-2">{bars > 1 ? 'mesures' : 'mesure'}</span>
                  </div>
                  <button type="button" disabled={isPlaying || bars >= MAX_BARS} onClick={() => changeBars(bars + 1)} className="metro-btn bg-slate-600" style={{ minWidth: 48 }} aria-label="Plus de mesures">+</button>
                </div>
                <div className="mt-2 text-slate-500 text-xs text-center">Les deux pistes ont la même longueur et se répètent en boucle.</div>
              </div>
            )}
          </div>

          {/* Grille interactive */}
          <div className="metro-card p-3 sm:p-5 mb-4">
            <h2 className="text-white text-lg font-semibold mb-3">{seq ? `Séquenceur — ${bars} mesure${bars > 1 ? 's' : ''} en ${num}/${den}` : `Grille — ${num}/${den} en ${SUBDIVISION_OPTIONS[sub].label.toLowerCase()}`}</h2>
            {!seq && (
              <div className="mb-4 text-slate-400 text-sm">
                <div className="mb-1"><strong>Fréquence :</strong> touche le haut d'une note pour passer de {FREQUENCY_ORDER.map(f => FREQUENCIES[f].label).join(' → ')}</div>
                <div><strong>Son :</strong> touche le bouton coloré en bas</div>
              </div>
            )}
            <div ref={gridMeasureRef} style={{ width: '100%', height: 0 }} aria-hidden="true" />
            {seq ? renderSequencer() : renderGrid()}
          </div>

          {/* Actions rapides (grille classique) */}
          {!seq && (<div className="metro-card p-4 mb-4">
            <h2 className="text-white text-lg font-semibold mb-3">Actions rapides</h2>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => applyPreset('all')} className="metro-btn bg-green-600">Tout activer</button>
              <button onClick={() => applyPreset('none')} className="metro-btn bg-gray-600">Tout désactiver</button>
              <button onClick={() => applyPreset('downbeats')} className="metro-btn bg-blue-600">Temps forts</button>
              <button onClick={() => applyPreset('backbeat')} disabled={sub !== 'eighth' || num !== 4} className="metro-btn bg-purple-600">Backbeat 2-4</button>
              <button onClick={() => applyPreset('offbeats')} disabled={sub !== 'eighth'} className="metro-btn bg-indigo-600 col-span-2">Contre-temps (les « et »)</button>
            </div>
            <div className="mt-2 text-slate-500 text-xs">Backbeat : croches en 4/4. Contre-temps : croches.</div>
          </div>)}

          {/* Aperçu */}
          <Fold title={!seq ? "Aperçu sur 4 mesures" : `Aperçu du motif (${eb} mesure${eb > 1 ? "s" : ""}, 2 pistes)`}>
            <div className="space-y-2 font-mono">
              {previewMeasures.map(({ measure, notes, notesB }) => (
                <div key={measure} className={`p-3 rounded ${isPlaying && currentBar === measure ? 'bg-slate-700 border-l-4 border-green-400' : 'bg-slate-900'}`}>
                  <span className={isPlaying && currentBar === measure ? 'text-green-400 font-bold' : 'text-slate-400'}>Mes.{measure} :</span>
                  <span className="text-white ml-3 text-lg break-all">{seq ? 'A ' : ''}{notes}</span>
                  {notesB !== null && <div className="text-slate-300 text-lg break-all" style={{ marginLeft: '4.2rem' }}>B {notesB}</div>}
                </div>
              ))}
            </div>
            <div className="mt-3 text-slate-400 text-sm">♪ = note jouée · _ = silence (ghost note)</div>
          </Fold>

          {/* Volumes */}
          <Fold title="Réglages avancés — volumes et cloche">
            <div className="space-y-3 mb-4">
              {Object.entries(AVAILABLE_SOUNDS).map(([key, s]) => (
                <div key={key} className="bg-slate-900 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2"><span className="text-2xl">{s.icon}</span><span className="text-white font-semibold">{s.name}</span></div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-sm font-mono">{Math.round(volumes[key] * 100)}%</span>
                      <button onClick={() => previewSound(key)} className="p-2 rounded-lg" style={{ backgroundColor: s.color }} title="Écouter"><Volume2 size={16} className="text-white" /></button>
                    </div>
                  </div>
                  <input type="range" min="0" max="100" value={Math.round(volumes[key] * 100)}
                    onChange={(e) => setVolumes(prev => ({ ...prev, [key]: parseInt(e.target.value, 10) / 100 }))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                    style={{ background: `linear-gradient(to right, ${s.color} 0%, ${s.color} ${volumes[key] * 100}%, #475569 ${volumes[key] * 100}%, #475569 100%)` }} />
                </div>
              ))}
            </div>
            <div className="mb-4 p-3 bg-slate-950 rounded-lg border border-slate-700">
              <h3 className="text-white font-semibold mb-2">🔔 Type de clic repère</h3>
              <div className="space-y-2">
                {[
                  { value: 'harmonic', name: 'Bell 1 — Cloche harmonique', desc: '« TING ! »' },
                  { value: 'click', name: 'Bell 2 — Click percussif', desc: '« CLACK ! »' },
                  { value: 'block', name: 'Bell 3 — Temple block', desc: '« TOCK ! »' }
                ].map(b => (
                  <label key={b.value} className="flex items-center gap-3 p-3 bg-slate-900 rounded-lg cursor-pointer">
                    <input type="radio" name="metroBell" value={b.value} checked={bell === b.value} onChange={() => setBell(b.value)} className="w-4 h-4" />
                    <div className="flex-1"><div className="text-white font-semibold">{b.name}</div><div className="text-slate-400 text-xs">{b.desc}</div></div>
                  </label>
                ))}
              </div>
            </div>
            <button onClick={() => setVolumes({ ...DEFAULT_VOLUMES })} className="w-full py-2 px-4 bg-slate-700 text-white rounded-lg text-sm font-semibold">Réinitialiser les volumes</button>
          </Fold>

          {/* Historique */}
          {!free && <Fold title={`Historique des niveaux validés${history && history.length ? ' (' + history.length + ')' : ''}`}>
            {history && history.length ? (
              <div className="space-y-1">
                {history.slice().reverse().slice(0, 30).map((h, i) => (
                  <div key={i} className="flex items-center justify-between bg-slate-900 rounded px-3 py-2 text-sm">
                    <span className="text-slate-400">{fmtDate(h.d)}</span>
                    <span className="text-slate-300">{h.sig} · {(SUBDIVISION_OPTIONS[h.sub] || {}).label || ''}</span>
                    <span className="text-gold font-mono font-bold">{h.bpm} bpm</span>
                  </div>
                ))}
              </div>
            ) : (<div className="text-slate-400 text-sm">Aucun niveau validé pour l'instant.</div>)}
          </Fold>}

          {/* Aide */}
          <Fold title="Mode d'emploi et légende">
            <ul className="text-slate-300 text-sm space-y-1 mb-3">
              <li>• <strong>Haut d'une note :</strong> change sa fréquence d'apparition</li>
              <li>• <strong>Bouton coloré :</strong> choisit le son de la note</li>
              <li>• Les <strong className="text-yellow-400">notes actives</strong> s'illuminent en jaune</li>
              <li>• Les <strong className="text-slate-400">ghost notes</strong> sont à sentir intérieurement</li>
              <li>• <strong>Valider ce niveau</strong> enregistre tempo et réglages pour cet exercice : il se rouvrira là-dessus</li>
            </ul>
            <div className="flex flex-wrap gap-3 mb-3">
              {Object.entries(FREQUENCIES).map(([k, v]) => (<div key={k} className="flex items-center gap-2"><span className="text-2xl" style={{ color: v.color }}>{v.label}</span><span className="text-slate-300 text-sm">{v.name}</span></div>))}
            </div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(AVAILABLE_SOUNDS).map(([k, v]) => (<div key={k} className="flex items-center gap-2"><span className="text-2xl">{v.icon}</span><span className="text-slate-300 text-sm">{v.name}</span></div>))}
            </div>
          </Fold>
        </div>
      </div>

      {/* Barre fixe : valider le niveau */}
      {free ? (
        <div className="metro-validate">
          <div className="min-w-0">
            <div className="text-white font-mono text-lg leading-tight">{tempo} bpm · {num}/{den}</div>
            <div className="text-xs text-slate-400 truncate">Réglages mémorisés automatiquement</div>
          </div>
        </div>
      ) : (
      <div className="metro-validate">
        <div className="min-w-0">
          <div className="text-white font-mono text-lg leading-tight">{tempo} bpm · {num}/{den}</div>
          <div className="text-xs text-slate-400 truncate">
            {hasChanged ? '✅ Niveau enregistré pour cet exercice' : (last ? `Dernier niveau : ${last.bpm} bpm` : 'Aucun niveau validé')}
          </div>
        </div>
        <button type="button" onClick={validate} className={`metro-validate-btn ${hasChanged ? 'done' : ''}`}>
          {hasChanged ? '✅ Validé' : 'Valider ce niveau'}
        </button>
      </div>
      )}

      {/* Banque de claves : ouvrir / enregistrer / confirmer */}
      {modal && (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', zIndex: 2000 }} onClick={() => setModal(null)}>
          <div className="bg-slate-800 rounded-2xl p-5 max-w-sm w-full border-2 border-slate-600" style={{ maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            {modal.type === 'open' && (() => {
              const list = (claves || []).filter(c => claveToCells(c)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr', { sensitivity: 'base' }));
              return (
                <div>
                  <h3 className="text-white text-xl font-bold mb-1">Ouvrir une clave</h3>
                  <p className="text-slate-400 text-sm mb-3">Elle sera chargée sur la piste {modal.track}.</p>
                  {list.length === 0 ? (
                    <p className="text-slate-400 text-sm mb-3">Aucune clave enregistrée. Dessine un motif sur une piste puis touche « 💾 Enregistrer ».</p>
                  ) : (
                    <div className="space-y-2 mb-3">
                      {list.map(c => (
                        <button key={c.id} type="button" data-clave-id={c.id} onClick={() => requestLoad(modal.track, c)}
                          className="w-full text-left rounded-lg p-3" style={{ background: '#1a1a18', border: '1px solid #4a4a43' }}>
                          <div className="text-white font-semibold">{c.name}</div>
                          <div className="text-slate-400 text-xs">{claveInfo(c)}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setModal(null)} className="w-full py-3 bg-slate-700 text-white rounded-lg font-semibold">Fermer</button>
                </div>
              );
            })()}
            {modal.type === 'confirm' && (() => {
              const v = claveToCells(modal.clave);
              return (
                <div>
                  <h3 className="text-white text-xl font-bold mb-2">Changer la signature ?</h3>
                  <p className="text-slate-300 text-sm mb-4">« {modal.clave.name} » est en {v ? claveInfo(modal.clave) : ''}. Pour la charger, la signature et la subdivision des deux pistes vont changer et l'autre piste sera vidée.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setModal(null)} className="py-3 bg-slate-700 text-white rounded-lg font-semibold">Annuler</button>
                    <button data-confirm-load onClick={() => applyClave(modal.track, modal.clave)} className="py-3 bg-green-600 text-white rounded-lg font-semibold">Charger</button>
                  </div>
                </div>
              );
            })()}
            {modal.type === 'save' && (() => {
              const arr = modal.track === 'A' ? pos : posB;
              const hasNotes = arr.some(p => p.frequency === 'every');
              const exists = (claves || []).some(c => String(c.name).trim().toLowerCase() === saveName.trim().toLowerCase());
              return (
                <div>
                  <h3 className="text-white text-xl font-bold mb-1">Enregistrer la piste {modal.track}</h3>
                  <p className="text-slate-400 text-sm mb-3">{num}/{den} · {SUBDIVISION_OPTIONS[sub].label.toLowerCase()} · {bars} mesure{bars > 1 ? 's' : ''}</p>
                  {!hasNotes ? (
                    <p className="text-orange-400 text-sm mb-3">Cette piste est vide : pose d'abord quelques notes.</p>
                  ) : (
                    <div>
                      <input data-clave-name type="text" value={saveName} autoFocus maxLength={60} placeholder="Nom de la clave (ex. Son clave 3-2)"
                        onChange={(e) => setSaveName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveTrackAsClave(); }}
                        style={{ width: '100%', padding: '0.7rem', borderRadius: 8, background: '#1a1a18', color: '#f5ecd6', border: '1px solid #6b6b62', fontSize: '1rem' }} />
                      {exists && <p className="text-orange-400 text-xs mt-2">Une clave porte déjà ce nom : elle sera remplacée.</p>}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <button onClick={() => setModal(null)} className="py-3 bg-slate-700 text-white rounded-lg font-semibold">Annuler</button>
                    <button data-confirm-save disabled={!hasNotes || !saveName.trim()} onClick={saveTrackAsClave} className="py-3 bg-green-600 text-white rounded-lg font-semibold" style={{ opacity: (!hasNotes || !saveName.trim()) ? 0.5 : 1 }}>Enregistrer</button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Sélecteur de son */}
      {soundSelectorOpen !== null && soundSelectorOpen < total && (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', zIndex: 2000 }} onClick={() => setSoundSelectorOpen(null)}>
          <div className="bg-slate-800 rounded-2xl p-6 max-w-sm w-full border-2 border-slate-600" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-xl font-bold mb-2">Choisir le son</h3>
            <p className="text-slate-400 text-sm mb-4">Note #{soundSelectorOpen + 1} — {steps[soundSelectorOpen].label}</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {Object.entries(AVAILABLE_SOUNDS).filter(([k]) => k !== 'bell').map(([key, s]) => (
                <button key={key}
                  onClick={() => { changeSound(soundSelectorOpen, key); previewSound(key); }}
                  className={`p-4 rounded-xl font-bold text-white ${steps[soundSelectorOpen].sound === key ? 'ring-4 ring-yellow-400' : ''}`}
                  style={{ backgroundColor: s.color }}>
                  <div className="text-3xl mb-2">{s.icon}</div>
                  <div className="text-sm">{s.name}</div>
                  <div className="text-xs opacity-75 mt-1">({s.label})</div>
                </button>
              ))}
            </div>
            <button onClick={() => setSoundSelectorOpen(null)} className="w-full py-3 bg-slate-700 text-white rounded-lg font-semibold">Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

window.CadenceMetronome = CadenceMetronome;
// Fonctions pures exposées pour les tests
window.CadenceMetronomeInternals = { buildLayout, totalFor, makeSnapshot, readSnapshot, claveToCells, makeClave };
})();
