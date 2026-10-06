// 숲속 친구들 탐험대 — 7~8세용 3D 자연 탐험 미션 게임
// 조작은 한 손가락: 톡 = 걸어가기, 친구를 꾹 = 관찰하기
// 대사·도감 내용은 story.json, 성우 음성은 voice/ (make_voice.py 로 생성)
import * as THREE from 'three';

const $ = s => document.querySelector(s);
const V3 = THREE.Vector3;

// ───────── 대본 불러오기 ─────────
const STORY = await (await fetch('story.json?v=' + window.GAME_VER)).json();
const FRIENDS = STORY.friends, MSG = STORY.msg, REGIONS = STORY.regions;
const DEF = Object.fromEntries(FRIENDS.map(f => [f.id, f]));
const ALL_IDS = FRIENDS.filter(f => !f.companion).map(f => f.id);

// ───────── 저장 ─────────
const SAVE_KEY = 'forest.save.v2';   // 이야기 버전 (v1 은 이야기 없던 때)
const save = { step: 0, found: {}, flashlight: false, night: false, voice: true, sound: true, done: false, swimTold: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch (e) {}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

// ───────── 소리 (효과음은 직접 합성) ─────────
let ac = null, master = null, voiceOut = null;
function initAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  if (ac) { ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -6; lim.ratio.value = 4;
  master = ac.createGain(); master.gain.value = 1.4;
  master.connect(lim); lim.connect(ac.destination);
  voiceOut = ac.createGain(); voiceOut.gain.value = 1.1; voiceOut.connect(ac.destination); // 성우 목소리는 리미터 없이
}
function tone(freq, dur, type = 'sine', vol = 0.2, when = 0, slideTo = 0) {
  if (!ac || !save.sound) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
const sfx = {
  pop() { tone(520, 0.1, 'sine', 0.2, 0, 900); },
  chime() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, 'triangle', 0.16, i * 0.09)); },
  bark() { tone(560, 0.12, 'triangle', 0.22, 0, 330); tone(520, 0.14, 'triangle', 0.22, 0.17, 300); },
  tap() { tone(880, 0.06, 'sine', 0.08); },
  item() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.6, 'sine', 0.15, i * 0.12)); },
  splash() { tone(900, 0.25, 'sine', 0.08, 0, 300); tone(1300, 0.2, 'sine', 0.05, 0.05, 500); },
  cicada() { // 맴-맴: 빠르게 떨리는 높은 소리 두 번
    if (!ac || !save.sound) return;
    for (let k = 0; k < 2; k++) {
      const t = ac.currentTime + k * 0.42;
      const o = ac.createOscillator(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = 1900;
      lfo.frequency.value = 38; lg.gain.value = 0.035;
      lfo.connect(lg); lg.connect(g.gain);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.04, t + 0.05);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.34);
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 3;
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t); lfo.start(t); o.stop(t + 0.4); lfo.stop(t + 0.4);
    }
  },
};

// ───────── 성우 음성 ─────────
// 미리 녹음한 파일(voice/)을 Web Audio 로 재생한다. 파일이 없는 대사만 기기 음성으로 대신 읽는다.
let voiceIdx = {};
fetch('voice/index.json?v=' + window.GAME_VER).then(r => r.json()).then(j => { voiceIdx = j; }).catch(() => {});
const norm = s => s.split(/\s+/).filter(Boolean).join(' ');
const voiceBytes = new Map();     // 파일 → mp3 바이트 (작아서 전부 기억해도 된다)
function voiceFile(text) { return voiceIdx[norm(text)] || null; }
function fetchVoice(f) {
  if (!voiceBytes.has(f)) voiceBytes.set(f, fetch('voice/' + f).then(r => r.arrayBuffer()).catch(() => null));
  return voiceBytes.get(f);
}
function preloadVoices() { Object.values(voiceIdx).forEach(f => fetchVoice(f)); }
let vToken = 0, vSrc = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function playVoice(f, my) {
  const bytes = await fetchVoice(f);
  if (!bytes || !ac || my !== vToken) return false;
  let buf;
  try { buf = await new Promise((res, rej) => ac.decodeAudioData(bytes.slice(0), res, rej)); } catch (e) { return false; }
  if (my !== vToken) return true;
  const src = ac.createBufferSource(); src.buffer = buf; src.connect(voiceOut);
  vSrc = src; src.start();
  await new Promise(r => { src.onended = r; setTimeout(r, buf.duration * 1000 + 400); });
  if (vSrc === src) vSrc = null;
  return true;
}
let koVoice = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const vs = speechSynthesis.getVoices();
  koVoice = vs.find(v => v.lang === 'ko-KR' && /Yuna|유나/.test(v.name)) || vs.find(v => /^ko/.test(v.lang)) || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function ttsOne(text) { // 대신 읽기 (iOS 는 cancel 직후 speak 하면 삼키므로 잠깐 쉬고)
  return new Promise(async res => {
    if (!window.speechSynthesis) return res();
    await sleep(150);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; if (koVoice) u.voice = koVoice; u.rate = 0.95; u.pitch = 1.1;
    u.onend = u.onerror = () => res();
    speechSynthesis.speak(u);
    setTimeout(res, 400 + text.length * 260);
  });
}
async function speak(parts, onEach, onEnd) {
  if (!Array.isArray(parts)) parts = [parts];
  hush();
  const my = vToken;
  if (!save.voice) { onEnd && onEnd(); return; }
  for (let i = 0; i < parts.length; i++) {
    if (my !== vToken) return;
    onEach && onEach(i);
    const f = voiceFile(parts[i]);
    const ok = f ? await playVoice(f, my) : false;
    if (!ok && my === vToken) await ttsOne(parts[i]);
    if (my !== vToken) return;
    if (i < parts.length - 1) await sleep(280);
  }
  if (my === vToken) onEnd && onEnd();
}
function hush() {
  vToken++;
  if (vSrc) { try { vSrc.stop(); } catch (e) {} vSrc = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
}

// ───────── 3D 기본 도구 ─────────
const matCache = new Map();
function mat(color, o = {}) {
  const key = color + '|' + JSON.stringify(o);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.85, metalness: 0, flatShading: o.flat ?? true,
      transparent: o.opacity != null, opacity: o.opacity ?? 1,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1,
      side: o.double ? THREE.DoubleSide : THREE.FrontSide, depthWrite: o.opacity == null,
    }));
  }
  return matCache.get(key);
}
const GEO = {
  ico: new THREE.IcosahedronGeometry(1, 1),
  ico2: new THREE.IcosahedronGeometry(1, 2),
  ball: new THREE.SphereGeometry(1, 14, 10),
};
function mesh(geo, m) { const x = new THREE.Mesh(geo, m); x.castShadow = true; x.receiveShadow = true; return x; }
function blob(sx, sy, sz, color, o, smooth) { const m = mesh(smooth ? GEO.ico2 : GEO.ico, mat(color, o)); m.scale.set(sx, sy, sz); return m; }
function ball(r, color, o) { const m = mesh(GEO.ball, mat(color, { flat: false, ...o })); m.scale.setScalar(r); return m; }
function cyl(rt, rb, h, color, seg = 8, o) { return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, o)); }
function cone(r, h, color, seg = 7, o) { return mesh(new THREE.ConeGeometry(r, h, seg), mat(color, o)); }
function at(m, x, y, z) { m.position.set(x, y, z); return m; }
// 흰자+검은자+반짝이 눈 (+z 를 본다)
function eye(s) {
  const g = new THREE.Group();
  g.add(ball(s, 0xffffff, { rough: 0.4 }));
  g.add(at(ball(s * 0.62, 0x1b1b1b, { rough: 0.3 }), 0, 0, s * 0.48));
  g.add(at(ball(s * 0.2, 0xffffff, { emissive: 0xffffff, ei: 0.5 }), s * 0.2, s * 0.24, s * 0.98));
  return g;
}
// 곤충 다리: 몸 옆에서 바깥·아래로
function insectLegs(g, color, xs, zs, len) {
  const legs = [];
  zs.forEach((z, i) => {
    for (const s of [-1, 1]) {
      const p = new THREE.Group(); p.position.set(xs * s, 0.02, z);
      const l = at(cyl(0.018, 0.012, len, color, 5), 0, -len / 2, 0);
      p.add(l); p.rotation.z = s * 1.0; p.rotation.y = s * (i - 1) * 0.5;
      g.add(p); legs.push(p);
    }
  });
  return legs;
}

// ───────── 캐릭터 모델 ─────────
// 아이를 닮은 소년: 바가지 머리, 흰 깃 파란 셔츠, 남색 소매, 노란 소맷단·밑단
function makeBoy() {
  const g = new THREE.Group();
  const SKIN = 0xf6cfb2, HAIR = 0x1f1919, SHIRT = 0x6f93d8, NAVY = 0x2c3a66, YEL = 0xf3c64a, PANTS = 0x7596d2, WHITE = 0xf7f5ee;
  const legs = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(0.13 * s, 0.56, 0);
    p.add(at(cyl(0.1, 0.11, 0.46, PANTS), 0, -0.22, 0));
    p.add(at(blob(0.12, 0.08, 0.17, WHITE), 0, -0.48, 0.04));
    g.add(p); legs.push(p);
  }
  g.add(at(cyl(0.3, 0.36, 0.56, SHIRT, 10), 0, 0.83, 0));
  g.add(at(cyl(0.365, 0.37, 0.1, YEL, 10), 0, 0.58, 0));
  const collar = mesh(new THREE.TorusGeometry(0.16, 0.055, 6, 12), mat(WHITE));
  collar.rotation.x = Math.PI / 2; collar.position.y = 1.1; g.add(collar);
  for (const s of [-1, 1]) { const f = at(blob(0.1, 0.03, 0.08, WHITE), 0.09 * s, 1.06, 0.2); f.rotation.z = 0.45 * s; f.rotation.x = 0.5; g.add(f); }
  g.add(at(blob(0.03, 0.12, 0.02, WHITE), 0, 0.98, 0.3)); // 단추줄
  const sun = cyl(0.07, 0.07, 0.03, YEL, 10); sun.rotation.x = Math.PI / 2; sun.position.set(0.15, 0.88, 0.315); g.add(sun);
  const arms = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(0.37 * s, 1.02, 0);
    p.add(at(cyl(0.085, 0.09, 0.4, NAVY), 0, -0.2, 0));
    p.add(at(cyl(0.097, 0.097, 0.07, YEL), 0, -0.41, 0));
    p.add(at(blob(0.08, 0.08, 0.08, SKIN), 0, -0.49, 0));
    p.rotation.z = 0.12 * s; g.add(p); arms.push(p);
  }
  const head = new THREE.Group(); head.position.y = 1.5; g.add(head);
  head.add(blob(0.46, 0.44, 0.44, SKIN, {}, true));
  const hair = mesh(new THREE.SphereGeometry(0.485, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.56), mat(HAIR, { double: true }));
  hair.rotation.x = -0.32; hair.position.y = 0.03; head.add(hair);
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(0.155 * s, -0.04, 0.4);
    e.add(ball(1, 0x1b1b1b)); e.children[0].scale.set(0.055, 0.075, 0.04);
    e.add(at(ball(0.022, 0xffffff, { emissive: 0xffffff, ei: 0.6 }), 0.018, 0.03, 0.035));
    head.add(e);
    head.add(at(blob(0.08, 0.05, 0.03, 0xf5a3a3), 0.27 * s, -0.15, 0.34));
    head.add(at(blob(0.08, 0.1, 0.06, SKIN), 0.45 * s, -0.04, 0));
  }
  head.add(at(blob(0.04, 0.035, 0.03, 0xeab79a), 0, -0.1, 0.44));
  const mouth = mesh(new THREE.CircleGeometry(0.1, 12, Math.PI, Math.PI), mat(0x8a2e2e, { flat: false }));
  mouth.position.set(0, -0.19, 0.415); mouth.rotation.x = -0.3; head.add(mouth);
  const teeth = mesh(new THREE.PlaneGeometry(0.14, 0.03), mat(0xffffff, { flat: false }));
  teeth.position.set(0, -0.2, 0.42); teeth.rotation.x = -0.3; head.add(teeth);
  return { group: g, legs, arms, head };
}

// 골든 리트리버 '골디'
function makeGoldie() {
  const g = new THREE.Group();
  const FUR = 0xe2a554, LIGHT = 0xf3c98a, DARK = 0xc78a3e;
  const body = new THREE.Group(); g.add(body);
  body.add(at(blob(0.34, 0.32, 0.6, FUR), 0, 0.68, 0));
  body.add(at(blob(0.26, 0.28, 0.2, LIGHT), 0, 0.62, 0.42));
  const legs = [];
  for (const [x, z] of [[-0.18, 0.36], [0.18, 0.36], [-0.18, -0.36], [0.18, -0.36]]) {
    const p = new THREE.Group(); p.position.set(x, 0.55, z);
    p.add(at(cyl(0.08, 0.075, 0.5, FUR, 6), 0, -0.25, 0));
    p.add(at(blob(0.09, 0.06, 0.11, LIGHT), 0, -0.52, 0.03));
    g.add(p); legs.push(p);
  }
  const head = new THREE.Group(); head.position.set(0, 1.05, 0.55); g.add(head);
  head.add(blob(0.3, 0.28, 0.28, FUR, {}, true));
  head.add(at(blob(0.15, 0.12, 0.2, LIGHT), 0, -0.08, 0.24));
  head.add(at(ball(0.065, 0x222222, { rough: 0.3 }), 0, -0.02, 0.43));
  const tongue = at(blob(0.06, 0.02, 0.07, 0xf27c8a), 0, -0.17, 0.33); head.add(tongue);
  const ears = [];
  for (const s of [-1, 1]) {
    head.add(at(eye(0.07), 0.12 * s, 0.07, 0.22));
    const p = new THREE.Group(); p.position.set(0.25 * s, 0.1, 0);
    p.add(at(blob(0.08, 0.2, 0.13, DARK), 0.02 * s, -0.15, 0)); p.rotation.z = 0.15 * s;
    head.add(p); ears.push(p);
  }
  const tail = new THREE.Group(); tail.position.set(0, 0.82, -0.55); g.add(tail);
  const tm = at(blob(0.08, 0.08, 0.3, LIGHT), 0, 0.12, -0.22); tm.rotation.x = -0.6; tail.add(tm);
  return { group: g, legs, head, ears, tail, tongue };
}

function makeSquirrel() {
  const g = new THREE.Group();
  const FUR = 0xb0703f, BELLY = 0xf2dab8, DARK = 0x3d2412, TAIL = 0x9a5a30;
  g.add(at(blob(0.2, 0.25, 0.19, FUR), 0, 0.3, 0));
  g.add(at(blob(0.13, 0.18, 0.08, BELLY), 0, 0.28, 0.13));
  for (const x of [-0.08, 0, 0.08]) g.add(at(blob(0.022, 0.2, 0.03, DARK), x, 0.33, -0.17)); // 줄무늬
  for (const x of [-0.04, 0.04]) g.add(at(blob(0.015, 0.17, 0.025, BELLY), x, 0.33, -0.18));
  const head = new THREE.Group(); head.position.set(0, 0.62, 0.03); g.add(head);
  head.add(blob(0.17, 0.16, 0.16, FUR, {}, true));
  head.add(at(blob(0.1, 0.07, 0.08, BELLY), 0, -0.05, 0.11));
  head.add(at(ball(0.025, 0x2a1a10), 0, -0.02, 0.18));
  for (const s of [-1, 1]) {
    head.add(at(eye(0.05), 0.08 * s, 0.04, 0.12));
    const ear = at(cone(0.05, 0.1, FUR, 5), 0.1 * s, 0.17, 0); ear.rotation.z = -0.3 * s; head.add(ear);
    head.add(at(blob(0.04, 0.025, 0.02, 0xf5a3a3), 0.11 * s, -0.06, 0.12));
  }
  g.add(at(blob(0.05, 0.05, 0.05, 0x8a5a2b), 0, 0.42, 0.2)); // 도토리
  g.add(at(blob(0.055, 0.03, 0.055, 0x5c3a1a), 0, 0.46, 0.2));
  const tail = new THREE.Group(); tail.position.set(0, 0.2, -0.18); g.add(tail);
  const t1 = at(blob(0.13, 0.22, 0.12, TAIL), 0, 0.18, -0.12); t1.rotation.x = -0.4; tail.add(t1);
  const t2 = at(blob(0.12, 0.2, 0.12, TAIL), 0, 0.5, -0.14); t2.rotation.x = 0.4; tail.add(t2);
  const t3 = at(blob(0.09, 0.12, 0.1, TAIL), 0, 0.66, -0.02); t3.rotation.x = 1.1; tail.add(t3);
  for (const s of [-1, 1]) g.add(at(blob(0.07, 0.05, 0.1, FUR), 0.11 * s, 0.05, 0.06));
  return { group: g, head, tail };
}

// 곤충은 머리가 +z, 등이 +y
function makeCicada() {
  const g = new THREE.Group();
  const BODY = 0x3f4a2c, GREEN = 0x6f8a3a;
  g.add(at(blob(0.15, 0.12, 0.32, BODY), 0, 0, -0.05));
  g.add(at(blob(0.18, 0.1, 0.12, GREEN), 0, 0.03, 0.22));
  const head = at(blob(0.2, 0.09, 0.09, BODY), 0, 0.02, 0.34); g.add(head);
  for (const s of [-1, 1]) g.add(at(eye(0.065), 0.16 * s, 0.07, 0.36));
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.quadraticCurveTo(0.2, -0.15, 0.12, -0.6); wingShape.quadraticCurveTo(0.02, -0.55, 0, 0);
  const wGeo = new THREE.ShapeGeometry(wingShape, 6);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wGeo, mat(0xd8eef5, { opacity: 0.55, double: true, flat: false, rough: 0.2 }));
    w.position.set(0.04 * s, 0.12, 0.18); w.rotation.x = -Math.PI / 2 + 0.12; w.scale.x = s;
    w.rotation.z = 0; g.add(w); wings.push(w);
  }
  insectLegs(g, 0x2b311e, 0.1, [0.15, 0.02, -0.12], 0.16);
  return { group: g, wings };
}

function makeLadybug() {
  const g = new THREE.Group();
  const shell = mesh(new THREE.SphereGeometry(0.28, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe53935, { rough: 0.3 }));
  shell.scale.set(1, 0.8, 1.15); g.add(shell);
  g.add(at(blob(0.008, 0.005, 0.3, 0x111111), 0, 0.224, -0.02)); // 가운데 줄
  const spots = [[0, 0.05, 0.28], [-0.12, 0.08, 0.13], [0.12, 0.08, 0.13], [-0.17, 0.05, -0.06], [0.17, 0.05, -0.06], [-0.1, 0.08, -0.2], [0.1, 0.08, -0.2]];
  for (const [x, y, z] of spots) {
    const sp = blob(0.055, 0.02, 0.055, 0x151515); const n = new V3(x, y + 0.13, z).normalize();
    sp.position.set(n.x * 0.28, n.y * 0.224, n.z * 0.32); sp.lookAt(sp.position.clone().multiplyScalar(2)); sp.rotateX(Math.PI / 2);
    g.add(sp);
  }
  g.add(at(blob(0.16, 0.1, 0.1, 0x151515), 0, 0.04, 0.3));
  for (const s of [-1, 1]) {
    g.add(at(blob(0.04, 0.03, 0.02, 0xffffff), 0.1 * s, 0.07, 0.38));
    g.add(at(eye(0.05), 0.07 * s, 0.1, 0.36));
  }
  const legs = insectLegs(g, 0x151515, 0.18, [0.12, 0, -0.12], 0.1);
  return { group: g, legs };
}

function makeRhino() {
  const g = new THREE.Group();
  const SHELL = 0x55301b, DARK = 0x2e190d;
  g.add(at(blob(0.32, 0.2, 0.42, SHELL, { rough: 0.3 }), 0, 0.12, -0.12));
  g.add(at(blob(0.006, 0.006, 0.4, DARK), 0, 0.32, -0.12));
  g.add(at(blob(0.27, 0.17, 0.2, SHELL, { rough: 0.3 }), 0, 0.14, 0.3));
  const small = at(cone(0.05, 0.17, DARK, 6, { rough: 0.3 }), 0, 0.33, 0.36); small.rotation.x = 0.6; g.add(small);
  for (const s of [-1, 1]) { const f = at(cone(0.025, 0.06, DARK, 5), 0.035 * s, 0.4, 0.42); f.rotation.x = 0.9; g.add(f); }
  g.add(at(blob(0.13, 0.1, 0.12, DARK, { rough: 0.3 }), 0, 0.08, 0.5));
  // 머리뿔: 앞으로 뻗다가 위로 휘고 끝이 두 갈래
  const h1 = at(cyl(0.04, 0.06, 0.32, SHELL, 6, { rough: 0.3 }), 0, 0.14, 0.68); h1.rotation.x = 1.15; g.add(h1);
  const h2 = at(cyl(0.03, 0.04, 0.24, SHELL, 6, { rough: 0.3 }), 0, 0.33, 0.83); h2.rotation.x = 0.35; g.add(h2);
  for (const s of [-1, 1]) { const tip = at(cone(0.025, 0.1, SHELL, 5, { rough: 0.3 }), 0.035 * s, 0.47, 0.86); tip.rotation.z = -0.5 * s; g.add(tip); }
  for (const s of [-1, 1]) g.add(at(eye(0.045), 0.1 * s, 0.14, 0.55));
  const legs = insectLegs(g, DARK, 0.2, [0.28, 0.02, -0.2], 0.26);
  return { group: g, legs };
}

function makeStag() {
  const g = new THREE.Group();
  const SHELL = 0x2c1b10, JAW = 0x5a3418;
  g.add(at(blob(0.26, 0.13, 0.4, SHELL, { rough: 0.3 }), 0, 0.1, -0.12));
  g.add(at(blob(0.006, 0.006, 0.38, 0x120a05), 0, 0.23, -0.12));
  g.add(at(blob(0.24, 0.12, 0.15, SHELL, { rough: 0.3 }), 0, 0.11, 0.3));
  g.add(at(blob(0.22, 0.09, 0.13, SHELL, { rough: 0.3 }), 0, 0.09, 0.5));
  for (const s of [-1, 1]) {
    const jaw = new THREE.Group(); jaw.position.set(0.11 * s, 0.09, 0.58); g.add(jaw);
    const a = at(cyl(0.025, 0.045, 0.3, JAW, 6, { rough: 0.3 }), 0.04 * s, 0, 0.13); a.rotation.x = Math.PI / 2; a.rotation.z = -0.35 * s; jaw.add(a);
    const b = at(cone(0.028, 0.2, JAW, 6, { rough: 0.3 }), 0.03 * s, 0, 0.36); b.rotation.x = Math.PI / 2; b.rotation.z = 0.7 * s; jaw.add(b);
    const tooth = at(cone(0.018, 0.08, JAW, 5), -0.01 * s, 0, 0.2); tooth.rotation.z = Math.PI / 2 * s; jaw.add(tooth);
    g.add(at(eye(0.045), 0.17 * s, 0.14, 0.52));
  }
  const legs = insectLegs(g, 0x1a0f08, 0.18, [0.28, 0.02, -0.2], 0.25);
  return { group: g, legs };
}

// ───────── 계곡 친구들 ─────────
// 물고기·새·게도 머리가 +z, 등이 +y
function makeMinnow() {
  const g = new THREE.Group();
  const BODY = 0x8c8a55, BELLY = 0xe8e2c0, FIN = 0x6f6c40;
  g.add(at(blob(0.11, 0.13, 0.4, BODY), 0, 0, 0));
  g.add(at(blob(0.08, 0.07, 0.3, BELLY), 0, -0.06, 0.02));
  for (const [x, y, z] of [[0.08, 0.05, 0.1], [-0.08, 0.05, -0.05], [0.07, 0.03, -0.18], [-0.07, 0.06, 0.18], [0.09, 0.0, 0.0]]) g.add(at(blob(0.025, 0.025, 0.02, 0x3a3820), x, y, z));
  g.add(at(blob(0.006, 0.02, 0.32, 0x4d4a2a), 0.105, 0.01, 0)); g.add(at(blob(0.006, 0.02, 0.32, 0x4d4a2a), -0.105, 0.01, 0)); // 옆줄
  const tail = new THREE.Group(); tail.position.z = -0.38; g.add(tail);
  const tf = cone(0.14, 0.22, FIN, 4); tf.rotation.x = -Math.PI / 2; tf.scale.x = 0.25; tf.position.z = -0.08; tail.add(tf);
  const df = cone(0.07, 0.14, FIN, 4); df.scale.x = 0.25; df.position.set(0, 0.14, -0.02); g.add(df);
  for (const s of [-1, 1]) g.add(at(eye(0.045), 0.07 * s, 0.04, 0.3));
  return { group: g, tail };
}
function makeCrayfish() {
  const g = new THREE.Group();
  const SHELL = 0x9a4a2a, DARK = 0x6e2f18;
  g.add(at(blob(0.15, 0.11, 0.24, SHELL, { rough: 0.4 }), 0, 0.08, 0.08));
  for (let i = 0; i < 4; i++) g.add(at(blob(0.12 - i * 0.015, 0.07, 0.07, i % 2 ? SHELL : DARK, { rough: 0.4 }), 0, 0.07 - i * 0.01, -0.16 - i * 0.1));
  for (const s of [-1, 0, 1]) { const fan = at(blob(0.06, 0.015, 0.08, SHELL), s * 0.06, 0.04, -0.6); fan.rotation.y = s * 0.4; g.add(fan); }
  const claws = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(0.12 * s, 0.07, 0.25); g.add(arm);
    const a = cyl(0.025, 0.03, 0.22, SHELL, 5); a.rotation.x = Math.PI / 2; a.rotation.z = -0.5 * s; a.position.set(0.05 * s, 0, 0.09); arm.add(a);
    const claw = new THREE.Group(); claw.position.set(0.11 * s, 0, 0.24); arm.add(claw);
    claw.add(blob(0.07, 0.04, 0.1, SHELL, { rough: 0.4 }));
    const pin = at(blob(0.03, 0.025, 0.09, DARK), 0.04 * s, 0, 0.1); claw.add(pin);
    const pin2 = at(blob(0.03, 0.025, 0.09, DARK), -0.02 * s, 0, 0.1); claw.add(pin2);
    claws.push({ pin, pin2, s });
    const ant = cyl(0.006, 0.01, 0.5, DARK, 4); ant.rotation.x = Math.PI / 2 - 0.3; ant.rotation.z = 0.3 * s; ant.position.set(0.05 * s, 0.15, 0.45); g.add(ant);
    g.add(at(eye(0.035), 0.05 * s, 0.17, 0.3));
  }
  const legs = insectLegs(g, DARK, 0.12, [0.12, 0.02, -0.08], 0.15);
  return { group: g, claws, legs };
}
function makeKingfisher() {
  const g = new THREE.Group();
  const BLUE = 0x1f8fd0, DEEP = 0x17639a, ORANGE = 0xf08a24;
  g.add(at(blob(0.17, 0.2, 0.22, BLUE), 0, 0.25, 0));
  g.add(at(blob(0.14, 0.15, 0.12, ORANGE), 0, 0.2, 0.1));
  for (const s of [-1, 1]) { const w = at(blob(0.05, 0.14, 0.2, DEEP), 0.15 * s, 0.27, -0.03); w.rotation.x = 0.2; g.add(w); }
  const tail = at(blob(0.06, 0.03, 0.12, DEEP), 0, 0.17, -0.25); tail.rotation.x = 0.5; g.add(tail);
  const head = new THREE.Group(); head.position.set(0, 0.5, 0.06); g.add(head);
  head.add(blob(0.15, 0.14, 0.15, BLUE, {}, true));
  for (const s of [-1, 1]) { head.add(at(blob(0.04, 0.05, 0.05, 0xffffff), 0.12 * s, -0.04, 0.03)); head.add(at(blob(0.05, 0.03, 0.06, ORANGE), 0.11 * s, 0.0, 0.08)); head.add(at(eye(0.04), 0.08 * s, 0.03, 0.1)); }
  const bill = cone(0.04, 0.28, 0x1a1a1a, 5); bill.rotation.x = Math.PI / 2; bill.position.set(0, -0.02, 0.27); head.add(bill);
  for (const s of [-1, 1]) g.add(at(blob(0.03, 0.03, 0.05, 0xe2533f), 0.06 * s, 0.04, 0.04));
  return { group: g, head };
}

// ───────── 바닷가 친구들 ─────────
function makeCrab() {
  const g = new THREE.Group();
  const SHELL = 0x7a6a8c, LIGHT = 0xb7a9c4, CLAW = 0x5b6fb0;
  const body = at(blob(0.36, 0.11, 0.22, SHELL, { rough: 0.5 }), 0, 0.14, 0); g.add(body);
  for (const [x, z] of [[-0.12, 0.05], [0.12, 0.05], [0, -0.08], [-0.2, -0.04], [0.2, -0.04]]) g.add(at(blob(0.04, 0.02, 0.03, LIGHT), x, 0.24, z));
  for (const s of [-1, 1]) { const sp = cone(0.035, 0.18, SHELL, 5); sp.rotation.z = -Math.PI / 2 * s; sp.position.set(0.42 * s, 0.15, 0.02); g.add(sp); }
  const claws = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(0.2 * s, 0.13, 0.16); g.add(arm);
    const a = cyl(0.03, 0.035, 0.22, CLAW, 5); a.rotation.x = Math.PI / 2; a.rotation.z = -0.6 * s; a.position.set(0.07 * s, 0, 0.08); arm.add(a);
    const claw = new THREE.Group(); claw.position.set(0.15 * s, 0.02, 0.22); arm.add(claw);
    claw.add(blob(0.07, 0.05, 0.11, CLAW));
    const tip = at(blob(0.025, 0.02, 0.07, 0xf3f0ff), 0.03 * s, 0.01, 0.1); claw.add(tip);
    const tip2 = at(blob(0.025, 0.02, 0.07, 0xf3f0ff), -0.03 * s, 0.01, 0.1); claw.add(tip2);
    claws.push({ arm, s });
    const stalk = cyl(0.015, 0.015, 0.1, SHELL, 4); stalk.position.set(0.07 * s, 0.27, 0.15); g.add(stalk);
    g.add(at(eye(0.04), 0.07 * s, 0.33, 0.15));
  }
  const legs = [];
  [0.06, -0.04, -0.13].forEach((z, i) => {
    for (const s of [-1, 1]) {
      const p = new THREE.Group(); p.position.set(0.3 * s, 0.12, z); g.add(p);
      const l = at(cyl(0.018, 0.012, 0.24, SHELL, 4), 0, -0.12, 0); p.add(l); p.rotation.z = 1.0 * s; legs.push(p);
    }
  });
  for (const s of [-1, 1]) { // 맨 뒷다리: 노처럼 납작
    const p = new THREE.Group(); p.position.set(0.24 * s, 0.14, -0.2); g.add(p);
    p.add(at(cyl(0.016, 0.016, 0.16, SHELL, 4), 0, -0.08, 0));
    const paddle = at(blob(0.06, 0.012, 0.045, LIGHT), 0, -0.17, 0); p.add(paddle);
    p.rotation.z = 1.2 * s; p.rotation.y = -0.6 * s; legs.push(p);
  }
  return { group: g, claws, legs };
}
function makeHermit() {
  const g = new THREE.Group();
  const SHELL = 0xe8c9a0, STRIPE = 0xc9935f, BODY = 0xe0603a;
  const shell = new THREE.Group(); shell.position.set(0, 0.2, -0.08); g.add(shell);
  for (let i = 0; i < 4; i++) { const r = 0.22 - i * 0.05; shell.add(at(blob(r, r * 0.9, r, i % 2 ? STRIPE : SHELL, {}, true), 0, i * 0.11, -i * 0.05)); }
  const tip = cone(0.04, 0.12, STRIPE, 6); tip.position.set(0, 0.46, -0.2); tip.rotation.x = -0.4; shell.add(tip);
  const front = new THREE.Group(); front.position.set(0, 0.12, 0.12); g.add(front);
  front.add(blob(0.13, 0.09, 0.08, BODY));
  for (const s of [-1, 1]) {
    const c = at(blob(0.06, 0.05, 0.08, BODY), 0.09 * s, -0.02, 0.09); front.add(c);
    const stalk = cyl(0.012, 0.012, 0.1, BODY, 4); stalk.position.set(0.04 * s, 0.1, 0.03); front.add(stalk);
    front.add(at(eye(0.035), 0.04 * s, 0.16, 0.04));
  }
  const legs = insectLegs(front, BODY, 0.1, [0.05, -0.04], 0.14);
  return { group: g, front, legs };
}
function makeStarfish() {
  const g = new THREE.Group();
  const C = 0xf08a3a, DOT = 0xffd08a;
  g.add(at(blob(0.15, 0.06, 0.15, C), 0, 0.05, 0));
  const arms = [];
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const p = new THREE.Group(); p.rotation.y = a; g.add(p);
    const arm = cone(0.09, 0.42, C, 5); arm.rotation.x = Math.PI / 2; arm.scale.y = 1; arm.scale.z = 0.5; arm.position.set(0, 0.04, 0.3); p.add(arm);
    for (const d of [0.16, 0.27, 0.37]) p.add(at(blob(0.022, 0.012, 0.022, DOT), 0, 0.075 - d * 0.08, d));
    arms.push(p);
  }
  for (const s of [-1, 1]) g.add(at(eye(0.045), 0.05 * s, 0.11, 0.04));
  g.add(at(blob(0.03, 0.01, 0.015, 0xb04a2a), 0, 0.1, 0.1));
  return { group: g, arms };
}
// ───────── 2부 친구들 ─────────
function makeBat() { // 동굴 천장에 거꾸로 매달린 모습이 기본 (머리가 아래)
  const g = new THREE.Group();
  const FUR = 0x5a4636, WING = 0x3b2e26;
  const body = new THREE.Group(); body.rotation.z = Math.PI; g.add(body); // 거꾸로 매달림
  body.add(at(blob(0.2, 0.26, 0.18, FUR), 0, 0, 0));
  body.add(at(blob(0.17, 0.15, 0.16, FUR, {}, true), 0, 0.3, 0.02));
  for (const s of [-1, 1]) {
    const ear = at(cone(0.07, 0.18, FUR, 5), 0.1 * s, 0.47, 0); ear.rotation.z = -0.25 * s; body.add(ear);
    body.add(at(eye(0.045), 0.07 * s, 0.33, 0.14));
    const w = new THREE.Group(); w.position.set(0.15 * s, 0.05, 0); body.add(w);
    const wing = blob(0.36, 0.26, 0.04, WING); wing.position.set(0.25 * s, -0.05, 0); wing.rotation.z = 0.5 * s; w.add(wing);
    body.add(at(cyl(0.015, 0.015, 0.2, 0x2a2018, 4), 0.07 * s, -0.33, 0));
  }
  body.add(at(blob(0.04, 0.025, 0.03, 0xf5a3a3), 0, 0.24, 0.16));
  return { group: g, body };
}
function makeSalamander() {
  const g = new THREE.Group();
  const SKIN = 0x7a5a3a, SPOT = 0xc9a24a, BELLY = 0xe8c98a;
  g.add(at(blob(0.13, 0.08, 0.32, SKIN, {}, true), 0, 0.08, 0));
  g.add(at(blob(0.15, 0.08, 0.14, SKIN, {}, true), 0, 0.09, 0.36));
  const tail = new THREE.Group(); tail.position.set(0, 0.07, -0.3); g.add(tail);
  const t1 = blob(0.07, 0.06, 0.32, SKIN); t1.position.z = -0.25; tail.add(t1);
  for (const [x, z] of [[0.06, 0.1], [-0.07, -0.05], [0.05, -0.18], [-0.05, 0.25], [0.06, 0.38]]) g.add(at(blob(0.03, 0.01, 0.03, SPOT), x, 0.16, z));
  for (const s of [-1, 1]) {
    g.add(at(eye(0.05), 0.09 * s, 0.15, 0.42));
    for (const z of [0.2, -0.2]) { const l = at(blob(0.03, 0.025, 0.1, SKIN), 0.16 * s, 0.03, z); l.rotation.y = 0.8 * s; g.add(l); }
  }
  g.add(at(blob(0.09, 0.02, 0.2, BELLY), 0, 0.01, 0.05));
  return { group: g, tail };
}
function makeBadger() {
  const g = new THREE.Group();
  const FUR = 0x8a7a6a, DARK = 0x2e2a28, WHITE = 0xf2efe8;
  g.add(at(blob(0.36, 0.28, 0.5, FUR), 0, 0.33, 0));
  const head = new THREE.Group(); head.position.set(0, 0.38, 0.48); g.add(head);
  head.add(blob(0.22, 0.2, 0.24, WHITE, {}, true));
  for (const s of [-1, 1]) { const st = at(blob(0.07, 0.17, 0.2, DARK), 0.11 * s, 0.03, 0.04); head.add(st); head.add(at(eye(0.045), 0.1 * s, 0.05, 0.2)); head.add(at(blob(0.06, 0.06, 0.03, DARK), 0.16 * s, 0.17, -0.04)); }
  head.add(at(blob(0.07, 0.06, 0.12, WHITE), 0, -0.06, 0.2)); head.add(at(ball(0.045, 0x1a1a1a), 0, -0.04, 0.32));
  for (const [x, z] of [[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]]) { g.add(at(cyl(0.08, 0.08, 0.24, DARK, 6), x, 0.12, z)); for (const c of [-0.04, 0, 0.04]) g.add(at(cone(0.015, 0.08, 0xe8e0d0, 4), x + c, 0.02, z + 0.08)).rotation.x = Math.PI / 2; }
  g.add(at(blob(0.08, 0.06, 0.12, FUR), 0, 0.42, -0.5));
  return { group: g, head };
}
function makeMudskipper() {
  const g = new THREE.Group();
  const SKIN = 0x7a7058, SPOT = 0x5bb3e0;
  g.add(at(blob(0.12, 0.11, 0.38, SKIN, {}, true), 0, 0.1, 0));
  for (const [x, y, z] of [[0.07, 0.17, 0.05], [-0.06, 0.18, -0.08], [0.05, 0.15, -0.2], [-0.06, 0.16, 0.15]]) g.add(at(blob(0.022, 0.012, 0.022, SPOT, { emissive: SPOT, ei: 0.3 }), x, y, z));
  for (const s of [-1, 1]) { const e = at(eye(0.06), 0.045 * s, 0.24, 0.24); g.add(e); const fin = at(blob(0.09, 0.02, 0.07, SKIN), 0.13 * s, 0.04, 0.12); fin.rotation.z = 0.5 * s; g.add(fin); }
  const df = cone(0.08, 0.16, SKIN, 4); df.scale.x = 0.2; df.position.set(0, 0.25, -0.05); g.add(df);
  const tail = new THREE.Group(); tail.position.z = -0.36; g.add(tail);
  const tf = cone(0.12, 0.2, SKIN, 4); tf.rotation.x = -Math.PI / 2; tf.scale.x = 0.25; tf.position.z = -0.08; tail.add(tf);
  return { group: g, tail };
}
function makeFiddler() {
  const g = new THREE.Group();
  const SHELL = 0x6a5a4a, RED = 0xe2533f;
  g.add(at(blob(0.24, 0.1, 0.17, SHELL, { rough: 0.5 }), 0, 0.14, 0));
  g.add(at(blob(0.12, 0.03, 0.08, 0x8fb3c4), 0, 0.24, 0));
  // 수컷: 한쪽 집게발만 아주 크다
  const big = new THREE.Group(); big.position.set(0.25, 0.14, 0.12); g.add(big);
  big.add(at(blob(0.2, 0.12, 0.13, RED), 0.12, 0.05, 0.05));
  const pin = at(blob(0.16, 0.04, 0.05, 0xf3d0c4), 0.2, 0.17, 0.06); big.add(pin);
  g.add(at(blob(0.04, 0.03, 0.05, RED), -0.2, 0.12, 0.15));
  for (const s of [-1, 1]) { const st = cyl(0.012, 0.012, 0.16, SHELL, 4); st.position.set(0.06 * s, 0.3, 0.12); g.add(st); g.add(at(eye(0.035), 0.06 * s, 0.39, 0.12)); }
  const legs = [];
  [0.08, -0.02, -0.11].forEach(z => { for (const s of [-1, 1]) { const p = new THREE.Group(); p.position.set(0.2 * s, 0.12, z); g.add(p); p.add(at(cyl(0.014, 0.01, 0.2, SHELL, 4), 0, -0.1, 0)); p.rotation.z = 1.0 * s; legs.push(p); } });
  return { group: g, big, legs };
}
function makeSpoonbill() {
  const g = new THREE.Group();
  const WHITE = 0xf7f7f2, BLACK = 0x1c1c1c;
  g.add(at(blob(0.26, 0.24, 0.36, WHITE), 0, 0.85, 0));
  for (const s of [-1, 1]) { const w = at(blob(0.06, 0.18, 0.3, 0xeeeeea), 0.22 * s, 0.88, -0.05); g.add(w); g.add(at(cyl(0.025, 0.025, 0.6, BLACK, 5), 0.1 * s, 0.33, 0)); }
  const neck = cyl(0.07, 0.09, 0.4, WHITE, 6); neck.position.set(0, 1.15, 0.22); neck.rotation.x = 0.4; g.add(neck);
  const head = new THREE.Group(); head.position.set(0, 1.36, 0.32); g.add(head);
  head.add(blob(0.12, 0.11, 0.13, WHITE, {}, true));
  head.add(at(blob(0.1, 0.08, 0.09, BLACK), 0, -0.01, 0.07)); // 검은 얼굴
  for (const s of [-1, 1]) head.add(at(eye(0.035), 0.07 * s, 0.03, 0.1));
  const bill = cyl(0.03, 0.04, 0.42, BLACK, 5); bill.rotation.x = Math.PI / 2 + 0.25; bill.position.set(0, -0.08, 0.3); head.add(bill);
  head.add(at(blob(0.09, 0.025, 0.08, BLACK), 0, -0.14, 0.5)); // 숟가락 끝
  head.add(at(blob(0.05, 0.09, 0.05, 0xffffff), 0, 0.12, -0.08));
  return { group: g, head };
}
function makeHare() {
  const g = new THREE.Group();
  const FUR = 0xa98a68, LIGHT = 0xe9dcc8;
  g.add(at(blob(0.24, 0.24, 0.32, FUR, {}, true), 0, 0.26, -0.05));
  const head = new THREE.Group(); head.position.set(0, 0.5, 0.22); g.add(head);
  head.add(blob(0.17, 0.16, 0.18, FUR, {}, true));
  head.add(at(blob(0.08, 0.06, 0.06, LIGHT), 0, -0.06, 0.14));
  const ears = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(0.07 * s, 0.13, -0.02); head.add(e);
    e.add(at(blob(0.05, 0.24, 0.03, FUR), 0, 0.22, 0)); e.add(at(blob(0.03, 0.18, 0.01, 0xf2c4c0), 0, 0.22, 0.025)); e.add(at(blob(0.05, 0.05, 0.03, 0x2a2018), 0, 0.44, 0));
    e.rotation.z = -0.15 * s; ears.push(e);
    head.add(at(eye(0.045), 0.1 * s, 0.04, 0.12));
    g.add(at(blob(0.08, 0.06, 0.18, FUR), 0.14 * s, 0.06, -0.08));
  }
  g.add(at(blob(0.08, 0.08, 0.06, 0xffffff), 0, 0.3, -0.38));
  return { group: g, head, ears };
}
function makeGoral() {
  const g = new THREE.Group();
  const FUR = 0x7a7066, DARK = 0x3a332e, LIGHT = 0xd9d2c4;
  g.add(at(blob(0.3, 0.3, 0.5, FUR), 0, 0.72, 0));
  for (const [x, z] of [[-0.16, 0.3], [0.16, 0.3], [-0.16, -0.3], [0.16, -0.3]]) { g.add(at(cyl(0.06, 0.05, 0.5, DARK, 5), x, 0.3, z)); g.add(at(blob(0.06, 0.04, 0.07, 0x1a1612), x, 0.04, z + 0.02)); }
  const head = new THREE.Group(); head.position.set(0, 1.05, 0.48); g.add(head);
  head.add(blob(0.17, 0.18, 0.24, FUR, {}, true));
  head.add(at(blob(0.12, 0.08, 0.06, LIGHT), 0, -0.12, 0.1)); // 흰 목
  for (const s of [-1, 1]) {
    const horn = cone(0.035, 0.22, 0x1f1a16, 5); horn.position.set(0.07 * s, 0.22, -0.05); horn.rotation.x = -0.5; head.add(horn);
    head.add(at(eye(0.045), 0.11 * s, 0.05, 0.15));
    const ear = at(blob(0.06, 0.03, 0.09, FUR), 0.17 * s, 0.12, -0.06); ear.rotation.z = 0.5 * s; head.add(ear);
  }
  head.add(at(ball(0.03, 0x1a1a1a), 0, -0.02, 0.24));
  g.add(at(blob(0.05, 0.07, 0.08, DARK), 0, 0.82, -0.5));
  return { group: g, head };
}
function makeOwl() {
  const g = new THREE.Group();
  const FUR = 0x9a7048, DARK = 0x5a3a20, LIGHT = 0xd9b88a;
  g.add(at(blob(0.3, 0.38, 0.28, FUR, {}, true), 0, 0.4, 0));
  g.add(at(blob(0.22, 0.28, 0.12, LIGHT), 0, 0.36, 0.17));
  for (const [x, y] of [[-0.08, 0.42], [0.08, 0.36], [0, 0.26], [-0.06, 0.2], [0.07, 0.48]]) g.add(at(blob(0.025, 0.035, 0.01, DARK), x, y, 0.29));
  const head = new THREE.Group(); head.position.set(0, 0.84, 0.02); g.add(head);
  head.add(blob(0.27, 0.23, 0.24, FUR, {}, true));
  for (const s of [-1, 1]) {
    head.add(at(blob(0.12, 0.12, 0.04, LIGHT), 0.1 * s, -0.01, 0.2));
    const e = new THREE.Group(); e.position.set(0.1 * s, 0, 0.23); head.add(e);
    e.add(ball(0.075, 0xff9a1f, { emissive: 0xff8800, ei: 0.25 })); e.add(at(ball(0.045, 0x111111), 0, 0, 0.04)); e.add(at(ball(0.014, 0xffffff, { emissive: 0xffffff, ei: 0.5 }), 0.015, 0.02, 0.075));
    const tuft = cone(0.05, 0.2, DARK, 4); tuft.position.set(0.15 * s, 0.24, 0); tuft.rotation.z = -0.4 * s; head.add(tuft);
    g.add(at(blob(0.08, 0.26, 0.2, DARK), 0.28 * s, 0.4, -0.02));
  }
  const beak = cone(0.035, 0.09, 0x2a2a2a, 4); beak.rotation.x = Math.PI; beak.position.set(0, -0.06, 0.25); head.add(beak);
  for (const s of [-1, 1]) g.add(at(blob(0.05, 0.03, 0.07, 0xd9a03a), 0.1 * s, 0.03, 0.06));
  return { group: g, head };
}
// 번개 꼬마 찌릿이: 남색 먹구름 몸 + 노란 번개 꼬리 (장난꾸러기 표정)
function makeJjiri() {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  body.add(blob(0.45, 0.4, 0.4, 0x3d4a6b, {}, true));
  for (const [x, y, z, r] of [[-0.38, -0.05, 0, 0.28], [0.38, -0.05, 0, 0.28], [0, 0.3, -0.05, 0.3]]) body.add(at(blob(r, r * 0.9, r, 0x4f5c80, {}, true), x, y, z));
  const brows = [];
  for (const s of [-1, 1]) { body.add(at(eye(0.1), 0.15 * s, 0.05, 0.33)); const b = at(blob(0.1, 0.025, 0.03, 0x111522), 0.15 * s, 0.2, 0.4); b.rotation.z = -0.4 * s; body.add(b); brows.push({ b, s }); }
  const grin = mesh(new THREE.TorusGeometry(0.09, 0.022, 5, 10, Math.PI), mat(0x111522)); grin.rotation.z = Math.PI; grin.position.set(0, -0.08, 0.4); body.add(grin);
  const bolt = new THREE.Shape(); bolt.moveTo(0, 0); bolt.lineTo(0.18, -0.25); bolt.lineTo(0.06, -0.25); bolt.lineTo(0.2, -0.55); bolt.lineTo(-0.06, -0.2); bolt.lineTo(0.06, -0.2); bolt.lineTo(-0.05, 0); bolt.closePath();
  const bm = new THREE.Mesh(new THREE.ExtrudeGeometry(bolt, { depth: 0.06, bevelEnabled: false }), mat(0xffd23f, { emissive: 0xffc400, ei: 0.7 }));
  bm.position.set(-0.05, -0.3, -0.03); bm.castShadow = true; body.add(bm);
  return { group: g, body, brows, wand: bm, mouth: grin };
}
const MAKERS = { goldie: makeGoldie, squirrel: makeSquirrel, cicada: makeCicada, ladybug: makeLadybug, rhino: makeRhino, stag: makeStag,
  minnow: makeMinnow, crayfish: makeCrayfish, kingfisher: makeKingfisher, crab: makeCrab, hermit: makeHermit, starfish: makeStarfish,
  bat: makeBat, salamander: makeSalamander, badger: makeBadger, mudskipper: makeMudskipper, fiddler: makeFiddler, spoonbill: makeSpoonbill, hare: makeHare, goral: makeGoral, owl: makeOwl };

// ───────── 렌더러·장면 ─────────
const app = $('#app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const DAY_SKY = new THREE.Color(0xbfe6ff), NIGHT_SKY = new THREE.Color(0x1d2748), STORM_SKY = new THREE.Color(0x8d95a8);
let stormK = 0; // 2부 먹구름 정도 (0~1)
scene.background = DAY_SKY.clone();
scene.fog = new THREE.Fog(DAY_SKY.clone(), 40, 110);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 260);

const hemi = new THREE.HemisphereLight(0xe3f4ff, 0x5d7a3a, 1.4); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ───────── 지도: 숲(가운데) · 계곡(위) · 바닷가(오른쪽) ─────────
//   x 는 오른쪽, z 는 화면 아래쪽. 카메라는 늘 -z(위) 를 본다.
const rand = (() => { let a = 20261006; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const R = (a, b) => a + rand() * (b - a);
const FOREST_R = 31;
const VALLEY = { x0: -30, x1: 30, z0: -57, z1: -40 };   // 계곡 남쪽 물가 (걸을 수 있음)
const STREAM = { x0: -30, x1: 44, z0: -63.5, z1: -57 }; // 개울
const BEACH = { x0: 44, x1: 76, z0: -22, z1: 22 };      // 모래사장
const SEA_X = 76;
const CAVE = { x0: -78, x1: -46, z0: -16, z1: 16 };     // 동굴 (숲 왼쪽, 지붕 덮인 굴)
const FLAT = { x0: -26, x1: 26, z0: 46, z1: 74 };       // 갯벌 (숲 아래쪽)
const SNOW = { x0: 46, x1: 74, z0: -68, z1: -38 };      // 눈 덮인 산 (바닷가 위쪽, 북쪽으로 오르막)
const FLAT_SEA_Z = 76;                                  // 갯벌 앞바다
const PATH = {
  valley: { x0: -3.4, x1: 3.4, z0: -41, z1: -29 }, beach: { x0: 29, x1: 45, z0: -3.4, z1: 3.4 },
  cave: { x0: -47, x1: -29, z0: -3.4, z1: 3.4 }, flat: { x0: -3.4, x1: 3.4, z0: 29, z1: 47 }, snow: { x0: 56.6, x1: 63.4, z0: -39, z1: -21 },
};
const REGION_RECT = { valley: VALLEY, beach: BEACH, cave: CAVE, flat: FLAT, snow: SNOW };
const PARENT = { valley: 'forest', beach: 'forest', cave: 'forest', flat: 'forest', snow: 'beach' };
const inRect = (r, x, z, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
const rectDist = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
const smooth = k => k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
const gates = {}; // 지역 사이 길막이
// 헤엄칠 수 있는 물: 계곡 개울, 바닷가 앞바다
function isWater(x, z) {
  return (inRect(STREAM, x, z) && x > -29.5 && x < 29) || (x > SEA_X - 0.6 && x < SEA_X + 12 && Math.abs(z) < 21);
}
function walkable(x, z) {
  if (Math.hypot(x, z) < FOREST_R) return true;
  for (const [r, rect] of Object.entries(PATH)) if (inRect(rect, x, z)) return !!gates[r]?.open;
  return inRect(VALLEY, x, z) || inRect(BEACH, x, z) || inRect(CAVE, x, z) || inRect(FLAT, x, z) || inRect(SNOW, x, z) || isWater(x, z);
}
function regionAt(x, z) {
  if (inRect(VALLEY, x, z, 2) || inRect(STREAM, x, z) || (inRect(PATH.valley, x, z) && z < -36)) return 'valley';
  if (inRect(SNOW, x, z, 2) || (inRect(PATH.snow, x, z) && z < -30)) return 'snow';
  if (inRect(BEACH, x, z, 2) || x > SEA_X - 2 || inRect(PATH.snow, x, z) || (inRect(PATH.beach, x, z) && x > 38)) return 'beach';
  if (inRect(CAVE, x, z, 1) || (inRect(PATH.cave, x, z) && x < -40)) return 'cave';
  if (inRect(FLAT, x, z, 2) || (inRect(PATH.flat, x, z) && z > 40)) return 'flat';
  return 'forest';
}
// 걷는 곳의 높낮이: 숲 언덕, 눈 덮인 산 오르막
const HILLS = [[17, -17, 8, 2.6]];
function terrainH(x, z) {
  let h = 0;
  for (const [hx, hz, r, hh] of HILLS) { const d = Math.hypot(x - hx, z - hz); if (d < r) h += hh * (Math.cos(Math.PI * d / r) + 1) / 2; }
  if (inRect(SNOW, x, z, 6) || inRect(PATH.snow, x, z)) h += 4.5 * smooth((-38 - z) / 30) + (z < -40 ? 0.35 * Math.sin(x * 0.5) * Math.sin(z * 0.4) * smooth((-40 - z) / 6) : 0);
  return h;
}
// 평지(걷는 곳·물)에서 얼마나 떨어졌나 → 언덕 높이
function openDist(x, z) {
  let d = Math.min(Math.max(0, Math.hypot(x, z) - FOREST_R), rectDist(VALLEY, x, z), rectDist(STREAM, x, z), rectDist(BEACH, x, z),
    rectDist(CAVE, x, z), rectDist(FLAT, x, z), rectDist(SNOW, x, z), x > SEA_X - 2 && Math.abs(z) < 70 ? 0 : 999, z > FLAT_SEA_Z - 2 && Math.abs(x) < 60 ? 0 : 999);
  for (const r of Object.values(PATH)) d = Math.min(d, rectDist(r, x, z));
  return d;
}
function groundH(x, z) {
  if (x > SEA_X - 1 && Math.abs(z) < 70) return -Math.min(2.5, (x - SEA_X + 1) * 0.3);           // 바다 바닥
  if (z > FLAT_SEA_Z - 1 && Math.abs(x) < 60) return -Math.min(2, (z - FLAT_SEA_Z + 1) * 0.25);  // 갯벌 앞바다
  if (inRect(STREAM, x, z)) return -0.45;                                                       // 개울 바닥
  const t = terrainH(x, z);
  const d = openDist(x, z);
  if (d < 3) return t;
  const k = Math.min(1, (d - 3) / 20);
  const wall = rectDist(CAVE, x, z) < 14 ? 1.6 : 1;   // 동굴 둘레는 가파른 바위벽
  return t + k * k * 13 * wall * (0.7 + 0.3 * Math.sin(x * 0.13) * Math.cos(z * 0.11));
}
const colliders = [];        // {x, z, r}

// 땅: 조각마다 다른 색 (로우폴리 느낌). 모래·갯벌·눈·동굴 바닥은 색을 바꾼다
let groundMesh;
{
  let geo = new THREE.PlaneGeometry(232, 222, 129, 123); geo.rotateX(-Math.PI / 2); geo.translate(10, 0, -2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, groundH(x, z) + (openDist(x, z) > 3 ? rand() * 0.5 : 0)); }
  geo = geo.toNonIndexed(); geo.computeVertexNormals();
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const pal = hexes => hexes.map(c => new THREE.Color(c));
  const GRASS = pal([0x8cc65a, 0x84bf52, 0x93cc61, 0x7db74c, 0x9ad168]), HILL = pal([0x6aa84f, 0x5f9c47, 0x73b155]);
  const SAND = pal([0xf3ddaa, 0xeed6a0, 0xf6e3b6]), WET = pal([0xd8c28c, 0xcfb984]), BED = pal([0x8c9a92, 0x7f8f88, 0x98a49a]);
  const BANK = pal([0x9cc874, 0x92bf6a, 0xa9b89a]);
  const CAVEF = pal([0x6b6258, 0x5f574e, 0x746a5f]), ROCK = pal([0x777069, 0x6a645d, 0x837b72]);
  const MUD = pal([0x8a7a63, 0x7d6e58, 0x6f6352, 0x93836a]), SNOWC = pal([0xf4f7fb, 0xe6edf5, 0xdde6f0, 0xeef3f9]);
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3, cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    let set = GRASS;
    if (cx > SEA_X - 1 && Math.abs(cz) < 70) set = WET;
    else if (cz > FLAT_SEA_Z - 1 && Math.abs(cx) < 60) set = MUD;
    else if (inRect(STREAM, cx, cz)) set = BED;
    else if (inRect(SNOW, cx, cz, 26) && cz < -30 && cx > 36) set = SNOWC;
    else if (inRect(CAVE, cx, cz, 0.5)) set = CAVEF;
    else if (rectDist(CAVE, cx, cz) < 16) set = ROCK;
    else if (inRect(FLAT, cx, cz, 3) || (inRect(PATH.flat, cx, cz) && cz > 40)) set = MUD;
    else if (cx > 40 && (inRect(BEACH, cx, cz, 3) || (cx > 60 && Math.abs(cz) < 70 && cy < 1))) set = SAND;
    else if (inRect(VALLEY, cx, cz, 1) && cz < -52) set = BANK;
    else if (cy > 0.8 && openDist(cx, cz) > 1) set = HILL;
    const c = set[Math.floor(rand() * set.length)];
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  groundMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  groundMesh.receiveShadow = true; scene.add(groundMesh);
}

const deco = new THREE.Group(); // 움직이지 않는 장식은 나중에 재질별로 합친다
const LEAF = [0x4e9a3c, 0x5fae45, 0x6bbb4a, 0x3f8a3a];
function makeTree(kind, s = 1) {
  const g = new THREE.Group();
  if (kind === 'pine') {
    g.add(at(cyl(0.18 * s, 0.26 * s, 1.2 * s, 0x7a5434, 6), 0, 0.6 * s, 0));
    for (let i = 0; i < 3; i++) g.add(at(cone((1.5 - i * 0.35) * s, 1.6 * s, i % 2 ? 0x2f7a4a : 0x2a6b42, 7), 0, (1.6 + i * 0.85) * s, 0));
  } else if (kind === 'snowpine') { // 눈 덮인 소나무
    g.add(at(cyl(0.18 * s, 0.26 * s, 1.2 * s, 0x6e4a2c, 6), 0, 0.6 * s, 0));
    for (let i = 0; i < 3; i++) {
      g.add(at(cone((1.5 - i * 0.35) * s, 1.6 * s, 0x2a5f45, 7), 0, (1.6 + i * 0.85) * s, 0));
      g.add(at(cone((1.05 - i * 0.25) * s, 0.75 * s, 0xf4f8fc, 7), 0, (2.05 + i * 0.85) * s, 0));
    }
  } else if (kind === 'seapine') { // 바닷가 해송: 굽은 줄기, 납작한 잎
    const t = cyl(0.16 * s, 0.24 * s, 2.6 * s, 0x6e4a2c, 6); t.position.set(0.3 * s, 1.3 * s, 0); t.rotation.z = -0.25; g.add(t);
    for (const [x, y, z, r] of [[0.7, 2.8, 0, 1.2], [-0.2, 2.5, 0.5, 0.9], [0.9, 2.4, -0.6, 0.8]]) g.add(at(blob(r * s, r * 0.45 * s, r * s, 0x2f6b45), x * s, y * s, z * s));
  } else if (kind === 'round') {
    g.add(at(cyl(0.2 * s, 0.3 * s, 2 * s, 0x86603d, 6), 0, 1 * s, 0));
    const c = LEAF[Math.floor(rand() * LEAF.length)];
    g.add(at(blob(1.3 * s, 1.2 * s, 1.3 * s, c), 0, 2.7 * s, 0));
    g.add(at(blob(0.8 * s, 0.75 * s, 0.8 * s, c), 0.7 * s, 2.3 * s, 0.3 * s));
  } else { // 참나무: 굵은 줄기 + 뭉게 잎
    g.add(at(cyl(0.4 * s, 0.6 * s, 3.4 * s, 0x6e4a2c, 7), 0, 1.7 * s, 0));
    for (const [x, y, z, r] of [[0, 4, 0, 1.8], [1.3, 3.5, 0.4, 1.3], [-1.2, 3.6, -0.3, 1.4], [0.2, 3.4, 1.2, 1.2], [-0.3, 3.5, -1.2, 1.2]])
      g.add(at(blob(r * s, r * 0.85 * s, r * s, LEAF[(x > 0) + (z > 0)]), x * s, y * s, z * s));
  }
  g.userData.tree = { kind, s };
  return g;
}
const TRUNK_R = { pine: 0.26, round: 0.3, oak: 0.6, seapine: 0.3, snowpine: 0.26 };
// 나무가 카메라와 친구 사이를 가리는지 계산하려고 잎·줄기를 공 모양으로 기억해 둔다
const occluders = [];
const OCC = { pine: [[0, 1.9, 0, 1.4], [0, 3.2, 0, 0.9]], round: [[0, 2.6, 0, 1.45], [0, 1, 0, 0.35]], oak: [[0, 3.8, 0, 2.2], [0, 1.6, 0, 0.7]], seapine: [[0.4, 2.7, 0, 1.3]], snowpine: [[0, 1.9, 0, 1.4], [0, 3.2, 0, 0.9]] };
function place(obj, x, z, colR) {
  const y = groundH(x, z); obj.position.set(x, y, z); deco.add(obj); if (colR) colliders.push({ x, z, r: colR });
  const tr = obj.userData.tree;
  if (tr) for (const [ox, oy, oz, r] of OCC[tr.kind]) occluders.push({ c: new V3(x + ox * tr.s, y + oy * tr.s, z + oz * tr.s), r: r * tr.s });
  return obj;
}
function rock(s, color = 0xa4a9a0) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat(color)); r.castShadow = true; r.receiveShadow = true; r.rotation.set(rand(), rand(), rand()); return r; }

// 주요 장소
const SPOT = {
  start: new V3(0, 0, 8),
  bigOak: new V3(-6, 0, -8),     // 장수풍뎅이·사슴벌레가 모이는 참나무 수액
  cicadaTree: new V3(10, 0, -3),
  log: new V3(-12, 0, 6),
  bush: new V3(7, 0, 9),
  pond: new V3(15, 0, 13),
  ball: new V3(-19, 0, -5),     // 골디 공 미션
  minnow: new V3(-9, 0, -59.2),  // 개울 속
  crayRock: new V3(7, 0, -56.2),
  kfTree: new V3(19, 0, -54.5),
  crab: new V3(58, 0, 8),
  hermit: new V3(65, 0, -11),
  pool: new V3(70, 0, 2),
  // 스모기가 나타나는 곳 (연기 구름 미니게임)
  oakBoss: new V3(-2.5, 0, -3.5),
  fallBoss: new V3(-24, 0, -54),
  seaBoss: new V3(85, 0, -6),
  // 2부: 동굴 · 갯벌 · 눈 덮인 산
  batRoost: new V3(-62, 0, -9),     // 동굴 천장 바위 (박쥐가 거꾸로 매달림)
  cavePool: new V3(-56, 0, 7),      // 동굴 물웅덩이 (도롱뇽)
  burrow: new V3(-70, 0, 6),        // 오소리 땅굴
  caveBoss: new V3(-72, 0, -10),
  mudMound: new V3(-12, 0, 58),     // 짱뚱어 구멍 언덕
  fiddler: new V3(8, 0, 56),
  spoonPuddle: new V3(16, 0, 65),   // 저어새 물웅덩이
  flatBoss: new V3(-6, 0, 67),
  hare: new V3(51, 0, -47),
  goralRock: new V3(68, 0, -54),    // 높은 바위 (산양)
  owlTree: new V3(55, 0, -62),      // 눈 덮인 소나무 (수리부엉이)
  snowBoss: new V3(63, 0, -63),
  kingBoss: new V3(4, 0, -18),      // 숲 한가운데 (대마왕 결전)
};
// 줍기 미니게임 물건 자리
const ITEM_SPOTS = {
  acorn: [[-15, 9], [-8, 11.5], [-17, 2], [-9, 2.5], [-14, 12.5]],
  stream: [[-21, -60], [-14, -61.5], [-4, -59.5], [4, -61], [13, -60], [23, -61.5]],
  beach: [[49, -7], [55, 13.5], [61, -18], [68, 11], [73, -5], [80, 7]],
  shell: [[47, 16], [53, -19], [66, 17], [74, -15]],
  mushroom: [[-50, -12], [-58, 13], [-66, -14], [-75, 1], [-61, 1]],
  clam: [[-20, 50], [-8, 51.5], [4, 63], [20, 50], [-19, 70]],
  track: [[48, -41], [51, -44], [55, -46], [59, -48.5], [62, -50.5], [64.5, -52]],
};
const keepOut = [[SPOT.start, 7], [new V3(0, 0, 14), 5], [SPOT.bigOak, 4.5], [SPOT.cicadaTree, 3.5], [SPOT.log, 3.5], [SPOT.bush, 3], [SPOT.pond, 5.5], [SPOT.ball, 3], [new V3(0, 0, 0), 3],
  [SPOT.minnow, 5], [SPOT.crayRock, 4], [SPOT.kfTree, 4], [SPOT.crab, 5], [SPOT.hermit, 4], [SPOT.pool, 5],
  [SPOT.oakBoss, 5], [SPOT.fallBoss, 5], [SPOT.kingBoss, 7], [SPOT.mudMound, 5], [SPOT.fiddler, 4], [SPOT.spoonPuddle, 5], [SPOT.flatBoss, 6],
  [SPOT.hare, 4], [SPOT.goralRock, 5], [SPOT.owlTree, 4], [SPOT.snowBoss, 6], ...Object.values(ITEM_SPOTS).flat().map(([x, z]) => [new V3(x, 0, z), 1.6])];
function freeAt(x, z, r) {
  for (const [p, k] of keepOut) if (Math.hypot(x - p.x, z - p.z) < k + r) return false;
  for (const c of colliders) if (Math.hypot(x - c.x, z - c.z) < c.r + r + 0.6) return false;
  return true;
}

// ── 숲 ──
place(makeTree('oak', 1.15), SPOT.bigOak.x, SPOT.bigOak.z, 0.75);
place(makeTree('round', 1.1), SPOT.cicadaTree.x, SPOT.cicadaTree.z, 0.4);
{ // 쓰러진 통나무
  const log = new THREE.Group();
  const body = cyl(0.5, 0.5, 2.6, 0x7a5434, 8); body.rotation.x = Math.PI / 2; body.position.y = 0.42; log.add(body);
  for (const z of [-1.3, 1.3]) { const end = cyl(0.42, 0.42, 0.02, 0xd8b07a, 8); end.rotation.x = Math.PI / 2; end.position.set(0, 0.42, z * 1.005); log.add(end); }
  log.add(at(blob(0.25, 0.12, 0.25, 0x6aa84f), 0.15, 0.85, 0.5));
  place(log, SPOT.log.x, SPOT.log.z);
  for (const dz of [-1.1, 0, 1.1]) colliders.push({ x: SPOT.log.x, z: SPOT.log.z + dz, r: 0.6 });
}
{ // 무당벌레 덤불
  const b = new THREE.Group();
  b.add(at(blob(0.95, 0.75, 0.95, 0x5aa845), 0, 0.55, 0));
  b.add(at(blob(0.6, 0.5, 0.6, 0x6bbb4a), 0.6, 0.4, 0.3));
  for (let i = 0; i < 6; i++) { const a = i * 1.1; b.add(at(blob(0.09, 0.09, 0.09, 0xfff3f7), Math.cos(a) * 0.75, 0.75 + (i % 2) * 0.2, Math.sin(a) * 0.75)); }
  place(b, SPOT.bush.x, SPOT.bush.z, 1.0);
}
{ // 연못
  const water = new THREE.Mesh(new THREE.CircleGeometry(3.2, 18), mat(0x5fb3d9, { rough: 0.15, flat: false }));
  water.rotation.x = -Math.PI / 2; water.position.set(SPOT.pond.x, 0.04, SPOT.pond.z); water.receiveShadow = true; scene.add(water);
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; place(blob(R(0.35, 0.6), R(0.25, 0.4), R(0.35, 0.6), 0x9aa3a8), SPOT.pond.x + Math.cos(a) * 3.3, SPOT.pond.z + Math.sin(a) * 3.3); }
  for (const [dx, dz] of [[-1, 0.5], [0.8, -1], [1.2, 1.1]]) { const pad = cyl(0.42, 0.42, 0.03, 0x4f9a3a, 9); pad.position.set(SPOT.pond.x + dx, 0.07, SPOT.pond.z + dz); scene.add(pad); }
  colliders.push({ x: SPOT.pond.x, z: SPOT.pond.z, r: 3.6 });
}
// 숲 안쪽 나무
for (let n = 0; n < 220; n++) {
  const a = R(0, Math.PI * 2), r = R(9, 29), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (Math.abs(x) < 5 && z < -20) continue;           // 계곡 길목
  if (Math.abs(z) < 5 && Math.abs(x) > 20) continue;  // 바닷가·동굴 길목
  if (Math.abs(x) < 5 && z > 20) continue;            // 갯벌 길목
  if (!freeAt(x, z, 1.6)) continue;
  const kind = rand() < 0.4 ? 'pine' : (rand() < 0.8 ? 'round' : 'oak');
  const s = R(0.85, 1.25);
  place(makeTree(kind, s), x, z, TRUNK_R[kind] * s + 0.25);
  if (colliders.length > 75) break;
}
// ── 계곡 ──
{
  const water = new THREE.Mesh(new THREE.PlaneGeometry(STREAM.x1 - STREAM.x0, STREAM.z1 - STREAM.z0), new THREE.MeshStandardMaterial({ color: 0x6cc3e6, roughness: 0.1, transparent: true, opacity: 0.45, depthWrite: false }));
  water.rotation.x = -Math.PI / 2; water.position.set((STREAM.x0 + STREAM.x1) / 2, -0.06, (STREAM.z0 + STREAM.z1) / 2); water.renderOrder = 1; scene.add(water);
  // 물가 돌·징검돌
  for (let x = STREAM.x0 + 1; x < 30; x += R(1.4, 2.4)) {
    if (Math.abs(x - SPOT.minnow.x) < 3) continue;
    const s = R(0.35, 0.8); const rk = rock(s, rand() < 0.5 ? 0xb0b4ad : 0x9aa09a); rk.position.set(x, s * 0.25, STREAM.z1 + R(-0.2, 0.4)); deco.add(rk);
    const s2 = R(0.4, 0.9); const rk2 = rock(s2, 0x9aa09a); rk2.position.set(x + R(-0.5, 0.5), s2 * 0.2, STREAM.z0 - R(-0.2, 0.4)); deco.add(rk2);
  }
  for (const [x, z] of [[-1, -59], [0.6, -60.5], [-0.4, -62]]) { const st = rock(0.5, 0xc4c7bf); st.scale.y = 0.4; st.position.set(x, -0.1, z); deco.add(st); }
  // 가재 바위
  const big = rock(0.85, 0x8e958e); big.scale.set(1.3, 0.7, 1); big.position.set(SPOT.crayRock.x - 0.9, 0.3, SPOT.crayRock.z - 0.3); deco.add(big); colliders.push({ x: SPOT.crayRock.x - 0.9, z: SPOT.crayRock.z - 0.3, r: 1 });
  // 물총새 나무: 가지가 개울 위로
  const kt = makeTree('round', 1.05); place(kt, SPOT.kfTree.x, SPOT.kfTree.z, 0.45);
  const branch = cyl(0.07, 0.11, 3.2, 0x7a5434, 6); branch.rotation.x = Math.PI / 2 - 0.15; branch.position.set(SPOT.kfTree.x, 2.0, SPOT.kfTree.z - 1.6); deco.add(branch);
  // 폭포 절벽 (서쪽 끝)
  for (const [x, z, s] of [[-33, -60, 4], [-34, -64, 4.5], [-32, -56, 3.2], [-35, -68, 4], [-31, -66, 3]]) { const c = rock(s, 0x8f978d); c.scale.y = 1.3; c.position.set(x, s * 0.6, z); deco.add(c); }
  // 갈대·고사리
  for (let n = 0; n < 160; n++) {
    const x = R(-29, 29), z = R(-56.8, -41);
    if (Math.abs(x) < 4 && z > -45) continue;
    if (!freeAt(x, z, 0.1)) continue;
    const roll = rand();
    if (roll < 0.35 && z < -53) { const g = new THREE.Group(); for (let k = 0; k < 4; k++) { const r = cyl(0.015, 0.02, R(0.8, 1.3), 0x7e9a4a, 4); r.position.set(R(-0.15, 0.15), 0.5, R(-0.15, 0.15)); r.rotation.z = R(-0.15, 0.15); g.add(r); } g.add(at(blob(0.04, 0.12, 0.04, 0x8a6a3a), 0, 1.1, 0)); place(g, x, z); }
    else if (roll < 0.6) { const f = new THREE.Group(); for (let k = 0; k < 5; k++) { const l = blob(0.08, 0.02, 0.35, 0x4f9a3a); l.rotation.y = k * 1.25; l.position.y = 0.15; l.rotation.x = -0.4; f.add(l); } place(f, x, z); }
    else if (roll < 0.75) { const s = R(0.2, 0.5); const rk = rock(s); rk.position.set(x, s * 0.3, z); deco.add(rk); }
    else { const t = cone(0.09, 0.3, 0x6faf45, 4); t.position.y = 0.12; const tg = new THREE.Group(); tg.add(t); place(tg, x, z); }
  }
}
// ── 바닷가 ──
{
  for (let n = 0; n < 140; n++) {
    const x = R(45, 75), z = R(-21, 21);
    if (!freeAt(x, z, 0.2)) continue;
    const roll = rand();
    if (roll < 0.35) { const sh = blob(0.08, 0.04, 0.08, [0xfff1e6, 0xffc9b5, 0xf6e2b3][n % 3]); sh.position.y = 0.03; place(sh, x, z); }
    else if (roll < 0.5) { const s = R(0.3, 0.8); const rk = rock(s, 0x8f8f86); rk.position.set(x, s * 0.3, z); deco.add(rk); if (s > 0.6) colliders.push({ x, z, r: s * 0.9 }); }
    else if (roll < 0.6 && x < 52) { const g = new THREE.Group(); for (let k = 0; k < 3; k++) { const r = cone(0.05, R(0.4, 0.7), 0x9cb86a, 3); r.position.set(R(-0.1, 0.1), 0.25, R(-0.1, 0.1)); g.add(r); } place(g, x, z); }
  }
  // 파라솔 + 모래성
  { const g = new THREE.Group(); g.add(at(cyl(0.05, 0.05, 2.4, 0xffffff, 6), 0, 1.2, 0)); const top = cone(1.6, 0.6, 0xff6b6b, 8); top.position.y = 2.5; g.add(top); const top2 = cone(1.62, 0.6, 0xffffff, 8); top2.position.y = 2.49; top2.rotation.y = Math.PI / 8; top2.scale.set(0.98, 1, 0.98); g.add(top2); place(g, 52, -14, 0.3); }
  { const g = new THREE.Group(); g.add(at(cyl(0.6, 0.75, 0.5, 0xe8cf95, 8), 0, 0.25, 0)); for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) { g.add(at(cyl(0.2, 0.22, 0.9, 0xe8cf95, 6), x, 0.45, z)); g.add(at(cone(0.22, 0.3, 0xe8cf95, 6), x, 1.05, z)); } g.add(at(cyl(0.01, 0.01, 0.4, 0x8a6a3a, 3), 0.45, 1.35, 0.45)); g.add(at(blob(0.12, 0.08, 0.01, 0xff6b6b), 0.55, 1.5, 0.45)); place(g, 55, 16, 1.0); }
  // 바위 웅덩이 (불가사리)
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const s = R(0.4, 0.7); const rk = rock(s, 0x7f8a85); rk.position.set(SPOT.pool.x + Math.cos(a) * 2.2, s * 0.3, SPOT.pool.z + Math.sin(a) * 2.2); deco.add(rk); }
  const pw = new THREE.Mesh(new THREE.CircleGeometry(2, 16), new THREE.MeshStandardMaterial({ color: 0x7fd0e8, roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }));
  pw.rotation.x = -Math.PI / 2; pw.position.set(SPOT.pool.x, 0.32, SPOT.pool.z); pw.renderOrder = 1; scene.add(pw);
  const pb = new THREE.Mesh(new THREE.CircleGeometry(2, 16), mat(0xc9b88a)); pb.rotation.x = -Math.PI / 2; pb.position.set(SPOT.pool.x, 0.02, SPOT.pool.z); scene.add(pb);
  colliders.push({ x: SPOT.pool.x, z: SPOT.pool.z, r: 2.5 });
  // 소라게 근처 바위
  for (const [dx, dz, s] of [[-1.5, -1.2, 0.7], [1.2, -1.6, 0.55]]) { const rk = rock(s, 0x8f8f86); rk.position.set(SPOT.hermit.x + dx, s * 0.3, SPOT.hermit.z + dz); deco.add(rk); colliders.push({ x: SPOT.hermit.x + dx, z: SPOT.hermit.z + dz, r: s * 0.9 }); }
}
// 바다 위 바위 (스모기 마지막 자리)
{ const rk = rock(1.8, 0x7f8a85); rk.scale.y = 0.9; rk.position.set(SPOT.seaBoss.x, -0.4, SPOT.seaBoss.z); deco.add(rk); colliders.push({ x: SPOT.seaBoss.x, z: SPOT.seaBoss.z, r: 1.8 }); }
// 바다
const sea = new THREE.Mesh(new THREE.PlaneGeometry(120, 160), new THREE.MeshStandardMaterial({ color: 0x3fa9d6, roughness: 0.15, transparent: true, opacity: 0.85, depthWrite: false }));
sea.rotation.x = -Math.PI / 2; sea.position.set(SEA_X + 59.5, -0.12, 0); sea.renderOrder = 1; scene.add(sea);
const foam = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 140), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
foam.rotation.x = -Math.PI / 2; foam.position.set(SEA_X + 0.3, -0.05, 0); foam.renderOrder = 2; scene.add(foam);

// ── 동굴: 종유석·석순, 빛 버섯, 물웅덩이, 오소리 땅굴, 박쥐 천장 바위 ──
const glowMushMat = (c) => mat(c, { emissive: c, ei: 0.9, flat: true });
{
  for (let n = 0; n < 90; n++) {
    const x = R(CAVE.x0 + 1, CAVE.x1 - 1), z = R(CAVE.z0 + 1, CAVE.z1 - 1);
    if (Math.abs(z) < 4 && x > -52) continue;
    if (!freeAt(x, z, 0.6)) continue;
    const roll = rand();
    if (roll < 0.3) { const h = R(0.8, 2.2); const st = cone(R(0.25, 0.45), h, 0x8a8178, 6); st.position.y = h / 2; place(st, x, z, 0.4); }
    else if (roll < 0.75) { const m = new THREE.Group(); const c = rand() < 0.5 ? 0x5ff3ff : 0xc08cff; for (let k = 0; k < 3; k++) { const ox = R(-0.3, 0.3), oz = R(-0.3, 0.3), hh = R(0.12, 0.3); m.add(at(cyl(0.03, 0.04, hh, 0xe8f2ef, 5), ox, hh / 2, oz)); const cap = new THREE.Mesh(GEO.ico, glowMushMat(c)); cap.scale.set(0.12, 0.07, 0.12); cap.position.set(ox, hh, oz); m.add(cap); } place(m, x, z); }
    else { const s = R(0.3, 0.7); const rk = place(rock(s, 0x6a635b), x, z, s * 0.8); rk.position.y += s * 0.3; }
  }
  // 동굴 물웅덩이
  const pw = new THREE.Mesh(new THREE.CircleGeometry(2.4, 16), new THREE.MeshStandardMaterial({ color: 0x3f7f9a, roughness: 0.1, transparent: true, opacity: 0.75, depthWrite: false }));
  pw.rotation.x = -Math.PI / 2; pw.position.set(SPOT.cavePool.x, 0.03, SPOT.cavePool.z - 0.6); pw.renderOrder = 1; scene.add(pw);
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; if (Math.sin(a) > 0.6) continue; const rk = rock(R(0.35, 0.55), 0x6a635b); rk.position.set(SPOT.cavePool.x + Math.cos(a) * 2.6, 0.15, SPOT.cavePool.z - 0.6 + Math.sin(a) * 2.6); deco.add(rk); }
  colliders.push({ x: SPOT.cavePool.x, z: SPOT.cavePool.z - 0.6, r: 2.3 });
  // 오소리 땅굴: 흙 언덕 + 깜깜한 굴 입구
  const mound = blob(3, 1.6, 2.4, 0x7a5a3a, {}, true); mound.position.set(SPOT.burrow.x, 0, SPOT.burrow.z - 1.4); deco.add(mound);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.75, 14), new THREE.MeshBasicMaterial({ color: 0x120c08 }));
  hole.position.set(SPOT.burrow.x, 0.62, SPOT.burrow.z + 0.62); hole.rotation.x = -0.35; scene.add(hole);
  colliders.push({ x: SPOT.burrow.x, z: SPOT.burrow.z - 1.4, r: 2.4 });
  // 박쥐 천장 바위: 위에서 내려온 종유석 기둥
  for (const [dx, dz, h] of [[0, -0.4, 3.2], [-0.9, -0.6, 2.4], [0.8, -0.5, 2.6]]) { const t = cone(0.45, h, 0x7d746a, 6); t.rotation.x = Math.PI; t.position.set(SPOT.batRoost.x + dx, 6.3 - h / 2, SPOT.batRoost.z + dz); scene.add(t); }
}
// 동굴 지붕: 밖에선 덮여 있고, 안에 들어가면 사라져 속이 보인다
const caveRoofMat = new THREE.MeshStandardMaterial({ color: 0x5e5850, roughness: 1, flatShading: true, transparent: true, opacity: 1 });
const caveRoof = new THREE.Group(); scene.add(caveRoof);
for (let x = CAVE.x0 - 2; x <= CAVE.x1 + 1; x += 6) for (let z = CAVE.z0 - 2; z <= CAVE.z1 + 2; z += 6) {
  const b = new THREE.Mesh(GEO.ico, caveRoofMat); b.scale.set(R(4.5, 6), R(1.6, 2.4), R(4.5, 6)); b.position.set(x + R(-1, 1), R(6.4, 7.2), z + R(-1, 1)); b.castShadow = true; caveRoof.add(b);
}
// 동굴 입구 바위 아치
for (let i = 0; i <= 6; i++) { const a = Math.PI * i / 6; const rk = rock(R(0.9, 1.3), 0x6f6962); rk.position.set(CAVE.x1 + 0.6, Math.sin(a) * 4.6, Math.cos(a) * 4.4); deco.add(rk); }
colliders.push({ x: CAVE.x1 + 0.6, z: 4.6, r: 1.1 }, { x: CAVE.x1 + 0.6, z: -4.6, r: 1.1 });

// ── 갯벌: 진흙 언덕, 게 구멍, 물웅덩이, 갈대, 앞바다 ──
{
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x2a2219 });
  for (let n = 0; n < 160; n++) {
    const x = R(FLAT.x0 + 0.5, FLAT.x1 - 0.5), z = R(FLAT.z0 + 0.5, FLAT.z1 - 0.5);
    if (Math.abs(x) < 4 && z < 50) continue;
    if (!freeAt(x, z, 0.3)) continue;
    const roll = rand();
    if (roll < 0.55) { const h = new THREE.Mesh(new THREE.CircleGeometry(R(0.06, 0.12), 8), holeMat); h.rotation.x = -Math.PI / 2; h.position.set(x, 0.02, z); scene.add(h); }
    else if (roll < 0.75) { const pw = new THREE.Mesh(new THREE.CircleGeometry(R(0.6, 1.4), 12), mat(0x9fb8c4, { rough: 0.1, flat: false })); pw.rotation.x = -Math.PI / 2; pw.position.set(x, 0.02, z); pw.scale.y = R(0.5, 1); scene.add(pw); }
    else if (roll < 0.85) { const sh = blob(0.07, 0.03, 0.06, 0xe9e1d0); sh.position.y = 0.02; place(sh, x, z); }
    else if (z > 68 || Math.abs(x) > 22) { const g = new THREE.Group(); for (let k = 0; k < 5; k++) { const r = cyl(0.015, 0.02, R(0.9, 1.4), 0xb59a5a, 4); r.position.set(R(-0.2, 0.2), 0.55, R(-0.2, 0.2)); r.rotation.z = R(-0.2, 0.2); g.add(r); } place(g, x, z); }
  }
  // 짱뚱어 진흙 언덕 + 구멍
  const mm = blob(1.6, 0.5, 1.3, 0x7d6e58, {}, true); mm.position.set(SPOT.mudMound.x, 0, SPOT.mudMound.z - 0.3); deco.add(mm);
  const mh = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10), holeMat); mh.rotation.x = -Math.PI / 2; mh.position.set(SPOT.mudMound.x - 0.6, 0.47, SPOT.mudMound.z - 0.4); scene.add(mh);
  colliders.push({ x: SPOT.mudMound.x, z: SPOT.mudMound.z - 0.3, r: 1.3 });
  // 저어새 물웅덩이
  const sp = new THREE.Mesh(new THREE.CircleGeometry(2.4, 16), new THREE.MeshStandardMaterial({ color: 0x8fb3c4, roughness: 0.1, transparent: true, opacity: 0.8, depthWrite: false }));
  sp.rotation.x = -Math.PI / 2; sp.position.set(SPOT.spoonPuddle.x, 0.03, SPOT.spoonPuddle.z); sp.renderOrder = 1; scene.add(sp);
}
const flatSea = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshStandardMaterial({ color: 0x5aa6c4, roughness: 0.15, transparent: true, opacity: 0.85, depthWrite: false }));
flatSea.rotation.x = -Math.PI / 2; flatSea.position.set(0, -0.12, FLAT_SEA_Z + 29); flatSea.renderOrder = 1; scene.add(flatSea);

// ── 눈 덮인 산: 오르막, 눈 소나무, 눈 바위, 산양 바위, 부엉이 나무 ──
{
  for (let n = 0; n < 120; n++) {
    const x = R(SNOW.x0 + 1, SNOW.x1 - 1), z = R(SNOW.z0 + 1, SNOW.z1 - 1);
    if (Math.abs(x - 60) < 4 && z > -44) continue;
    if (!freeAt(x, z, 1)) continue;
    const roll = rand();
    if (roll < 0.25) { const s = R(0.9, 1.3); place(makeTree('snowpine', s), x, z, TRUNK_R.snowpine * s + 0.25); }
    else if (roll < 0.45) { const s = R(0.4, 0.9); const g = new THREE.Group(); g.add(rock(s, 0x8a8f96)); const cap = blob(s * 0.85, s * 0.35, s * 0.85, 0xf4f8fc); cap.position.y = s * 0.55; g.add(cap); place(g, x, z, s * 0.9).position.y += s * 0.3; }
    else if (roll < 0.7) { const b = blob(R(0.4, 0.7), R(0.2, 0.35), R(0.4, 0.7), 0xffffff); place(b, x, z); }
  }
  // 산양 바위: 높은 바위 더미
  const g = new THREE.Group();
  for (const [x, y, z, s] of [[0, 0.8, 0, 1.5], [-1.2, 0.6, 0.4, 1.1], [1.1, 0.7, -0.3, 1.2], [0.1, 2.0, -0.2, 1.0], [0, 2.9, 0, 0.6]]) { const r = rock(s, 0x8a8f96); r.position.set(x, y, z); g.add(r); }
  for (const [x, y, z, s] of [[0, 3.35, 0, 0.55], [-1.2, 1.4, 0.4, 0.7]]) g.add(at(blob(s, s * 0.3, s, 0xf4f8fc), x, y, z));
  place(g, SPOT.goralRock.x, SPOT.goralRock.z, 2.0);
  // 부엉이 나무
  const ot = makeTree('snowpine', 1.35); place(ot, SPOT.owlTree.x, SPOT.owlTree.z, 0.45);
  const br = cyl(0.06, 0.1, 1.6, 0x6e4a2c, 5); br.rotation.x = Math.PI / 2 - 0.1; br.position.set(SPOT.owlTree.x, groundH(SPOT.owlTree.x, SPOT.owlTree.z) + 2.5, SPOT.owlTree.z + 0.8); deco.add(br);
}

// 바깥 나무: 걸을 수 있는 곳 둘레를 빽빽하게 (해변 쪽은 해송, 눈 산은 눈 소나무, 동굴 둘레는 바위)
{
  const occupied = new Set();
  for (let n = 0; n < 4200; n++) {
    const x = R(-100, 112), z = R(-112, 100);
    const d = openDist(x, z);
    if (d < 1.2 || d > 26) continue;
    if (x > SEA_X - 3 && Math.abs(z) < 70) continue;
    if (z > FLAT_SEA_Z - 3 && Math.abs(x) < 60) continue;
    const key = Math.round(x / 3.2) + ',' + Math.round(z / 3.2);
    if (occupied.has(key)) continue; occupied.add(key);
    if (rectDist(CAVE, x, z) < 12) { const s = R(1.2, 2.6); const rk = place(rock(s, rand() < 0.5 ? 0x6f6962 : 0x7d766d), x, z); rk.position.y += s * 0.5; rk.scale.y = R(1.2, 2); continue; }
    const kind = inRect(SNOW, x, z, 24) && z < -30 && x > 36 ? 'snowpine' : x > 38 ? 'seapine' : (rand() < 0.5 ? 'pine' : (rand() < 0.75 ? 'round' : 'oak'));
    place(makeTree(kind, R(1, 1.7)), x + R(-0.8, 0.8), z + R(-0.8, 0.8));
  }
}
// 숲 덤불·바위·버섯·꽃·풀
const FLOWER = [0xff8fb1, 0xffd23f, 0xffffff, 0xb08cff, 0xff9f43];
for (let n = 0; n < 900; n++) {
  const a = R(0, Math.PI * 2), r = R(2, 31), x = Math.cos(a) * r, z = Math.sin(a) * r;
  const roll = rand();
  if (roll < 0.06) { if (!freeAt(x, z, 0.8)) continue; const s = R(0.5, 0.9); place(blob(s, s * 0.75, s, LEAF[n % 4]), x, z, s * 0.8).position.y += s * 0.45; }
  else if (roll < 0.1) { if (!freeAt(x, z, 0.5)) continue; const s = R(0.3, 0.7); const rk = place(rock(s), x, z, s * 0.9); rk.position.y += s * 0.4; }
  else if (roll < 0.15) { if (!freeAt(x, z, 0.2)) continue; const m = new THREE.Group(); m.add(at(cyl(0.05, 0.06, 0.2, 0xfff3e0, 6), 0, 0.1, 0)); m.add(at(blob(0.15, 0.09, 0.15, rand() < 0.6 ? 0xe2533f : 0xc58b4f), 0, 0.22, 0)); place(m, x, z); }
  else if (roll < 0.42) { if (!freeAt(x, z, 0)) continue; const f = new THREE.Group(); f.add(at(cyl(0.015, 0.015, 0.25, 0x4f8f3a, 4), 0, 0.12, 0)); f.add(at(blob(0.07, 0.04, 0.07, FLOWER[n % 5]), 0, 0.26, 0)); f.add(at(blob(0.03, 0.03, 0.03, 0xffe680), 0, 0.29, 0)); place(f, x, z); }
  else { if (!freeAt(x, z, 0)) continue; const t = cone(0.09, 0.3, 0x6faf45, 4); t.position.y = 0.12; const tg = new THREE.Group(); tg.add(t); tg.add(at(cone(0.07, 0.24, 0x7dbd52, 4), 0.08, 0.1, 0.03)); place(tg, x, z); }
}
// 먼 산
for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + 0.3; if (Math.cos(a) > 0.55) continue; const m = blob(R(22, 30), R(12, 18), R(16, 24), i % 2 ? 0x76a98a : 0x6b9d80); m.position.set(25 + Math.cos(a) * 130, -2, -25 + Math.sin(a) * 120); m.castShadow = false; deco.add(m); }

// 장식을 재질별로 한 덩어리로 (iPad 그리기 횟수 줄이기)
function bake(root) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    g.applyMatrix4(o.matrixWorld);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const out = new THREE.Group();
  for (const [m, list] of byMat) {
    let n = 0; for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let off = 0;
    for (const g of list) { pos.set(g.attributes.position.array, off * 3); nor.set(g.attributes.normal.array, off * 3); off += g.attributes.position.count; g.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    const mm = new THREE.Mesh(geo, m); mm.castShadow = true; mm.receiveShadow = true; out.add(mm);
  }
  return out;
}
scene.add(bake(deco));

// 폭포: 줄무늬 그림을 아래로 천천히 흘린다
const fallTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#9fdcf2'; x.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 14; i++) { x.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.4})`; x.fillRect(Math.random() * 60, Math.random() * 128, 3 + Math.random() * 4, 20 + Math.random() * 40); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); return t;
})();
{
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(4, 7.5), new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0.9 }));
  fall.position.set(-30.2, 3.3, -60.2); fall.rotation.y = Math.PI / 2; scene.add(fall);
  for (let i = 0; i < 5; i++) { const f = blob(R(0.5, 0.8), 0.25, R(0.5, 0.8), 0xffffff, { opacity: 0.8 }); f.position.set(-29.3 + R(-0.3, 0.6), -0.05, -60.2 + R(-1.6, 1.6)); scene.add(f); }
}

// 길막이 (미션을 하면 내려간다) + 이정표
function signTex(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#d9a866'; x.fillRect(0, 0, 256, 128); x.strokeStyle = '#8a5a2b'; x.lineWidth = 10; x.strokeRect(5, 5, 246, 118);
  x.fillStyle = '#4a2a10'; x.font = 'bold 52px "Jua", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 66);
  return new THREE.CanvasTexture(c);
}
function makeSign(text, x, z, rotY) {
  const g = new THREE.Group();
  g.add(at(cyl(0.08, 0.08, 1.6, 0x8a5a2b, 6), 0, 0.8, 0));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: signTex(text), roughness: 0.9, side: THREE.DoubleSide }));
  board.position.y = 1.6; g.add(board);
  g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g); return g;
}
function makeGate(region, x, z, rotY) {
  const g = new THREE.Group();
  for (const px of [-3.2, -1.1, 1.1, 3.2]) g.add(at(cyl(0.12, 0.14, 1.4, 0x8a5a2b, 6), px, 0.7, 0));
  for (const y of [0.5, 1.05]) { const rail = blob(3.5, 0.08, 0.08, 0x9c6a35); rail.position.y = y; g.add(rail); }
  for (const px of [-2.2, 2.2]) g.add(at(blob(0.7, 0.55, 0.6, 0x5aa845), px, 0.4, 0.6));
  const lock = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshStandardMaterial({ map: signTex('🔒'), side: THREE.DoubleSide }));
  lock.position.set(0, 1.6, 0.05); g.add(lock);
  g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
  gates[region] = { mesh: g, open: false, k: 1, pos: new V3(x, 0, z) };
}
makeGate('valley', 0, -33.5, 0);
makeGate('beach', 34, 0, Math.PI / 2);
makeSign('🏞️ 계곡', -4.6, -30, 0.3);
makeSign('🏖️ 바닷가', 30, 4.8, Math.PI / 2 + 0.3);
makeGate('cave', -36, 0, Math.PI / 2);
makeGate('flat', 0, 35, 0);
makeGate('snow', 60, -25, 0);
makeSign('🕳️ 동굴', -30, -4.8, -Math.PI / 2 - 0.3);
makeSign('🦀 갯벌', 4.6, 30, -0.3);
makeSign('🏔️ 눈산', 64.8, -21, 0.3);

// 참나무 수액 자리 (밤엔 은은하게 반짝)
const sapDir = new V3(SPOT.start.x - SPOT.bigOak.x, 0, SPOT.start.z - SPOT.bigOak.z).normalize();
const sapMat = new THREE.MeshStandardMaterial({ color: 0xc77a1e, roughness: 0.15, emissive: 0xffa53a, emissiveIntensity: 0, flatShading: true });
{ const sap = new THREE.Mesh(GEO.ico, sapMat); sap.scale.set(0.16, 0.3, 0.08); const r = 0.6 * 1.15 * 0.88; sap.position.set(SPOT.bigOak.x + sapDir.x * r, 1.35, SPOT.bigOak.z + sapDir.z * r); sap.lookAt(sap.position.clone().add(sapDir)); scene.add(sap); }

// 하늘: 달·별·반딧불이 (밤에만), 갈매기 (바닷가 낮)
const moon = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d5, fog: false, transparent: true, opacity: 0 }));
moon.position.set(-30, 45, -70); scene.add(moon);
const stars = (() => {
  const n = 300, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = rand() * Math.PI * 2, e = R(0.15, 1.3), r = 170; p[i * 3] = 25 + Math.cos(a) * Math.cos(e) * r; p[i * 3 + 1] = Math.sin(e) * r; p[i * 3 + 2] = -25 + Math.sin(a) * Math.cos(e) * r; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const s = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: true, fog: false, transparent: true, opacity: 0 }));
  scene.add(s); return s;
})();
const fireflies = [];
for (let i = 0; i < 28; i++) {
  const m = new THREE.Mesh(GEO.ball, new THREE.MeshBasicMaterial({ color: 0xeaff7a, transparent: true, opacity: 0 }));
  m.scale.setScalar(0.07); const a = R(0, Math.PI * 2), r = R(3, 26);
  m.userData = { x: Math.cos(a) * r, z: Math.sin(a) * r, y: R(0.6, 2.2), ph: R(0, 6.28), sp: R(0.3, 0.6) };
  scene.add(m); fireflies.push(m);
}
const gulls = [];
for (let i = 0; i < 4; i++) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) { const w = blob(0.5, 0.03, 0.14, 0xffffff); w.position.x = 0.45 * s; w.rotation.z = 0.35 * s; g.add(w); }
  g.add(blob(0.12, 0.1, 0.25, 0xffffff));
  g.userData = { cx: R(55, 72), cz: R(-12, 12), r: R(4, 8), h: R(6, 9), sp: R(0.15, 0.3) * (i % 2 ? 1 : -1), ph: R(0, 6) };
  scene.add(g); gulls.push(g);
}

// ───────── 주인공·골디 ─────────
const boy = makeBoy();
boy.group.position.copy(SPOT.start); boy.group.rotation.y = Math.PI; scene.add(boy.group);
const goldie = makeGoldie();
goldie.group.scale.setScalar(0.9);
goldie.group.position.set(1.6, 0, 9.2); scene.add(goldie.group);

// 손전등 (밤에 주인공 앞을 비춘다)
const flash = new THREE.SpotLight(0xfff0c8, 0, 16, 0.55, 0.6, 1.2);
flash.position.set(0, 1.4, 0.3); boy.group.add(flash);
flash.target.position.set(0, 0, 5); boy.group.add(flash.target);
const glow = new THREE.PointLight(0xbfd4ff, 0, 7, 1.5); glow.position.set(0, 2.5, 0); boy.group.add(glow);

// ───────── 친구들 배치 ─────────
const creatures = [];
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const starMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffc400, emissiveIntensity: 0.7, flatShading: true });
function addCreature(id, holder, anchor, stand, scale, update) {
  const made = MAKERS[id]();
  made.group.scale.setScalar(scale);
  holder.add(made.group);
  const hit = new THREE.Mesh(GEO.ball, hitMat); hit.scale.setScalar(0.9); holder.add(hit);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), starMat);
  scene.add(star);
  scene.add(holder);
  const c = { id, def: DEF[id], holder, made, hit, star, anchor, stand, update, appear: DEF[id].time === 'night' ? 0 : 1, hop: 0 };
  hit.userData.c = c;
  creatures.push(c); return c;
}
// 나무 줄기에 붙이기: 등이 바깥, 머리가 위
function trunkMount(center, r, dir, y, angleOffset = 0) {
  const d = dir.clone().applyAxisAngle(new V3(0, 1, 0), angleOffset);
  const holder = new THREE.Group();
  holder.position.set(center.x + d.x * r, y, center.z + d.z * r);
  holder.lookAt(holder.position.clone().add(d));
  const flip = new THREE.Group(); flip.rotation.z = Math.PI; holder.add(flip);
  const inner = new THREE.Group(); inner.rotation.x = Math.PI / 2; flip.add(inner);
  return { holder, inner, outward: d };
}
function standFrom(center, dir, dist) { return new V3(center.x + dir.x * dist, 0, center.z + dir.z * dist); }

{ // 다람쥐: 통나무 위
  const holder = new THREE.Group(); holder.position.set(SPOT.log.x, 0.9, SPOT.log.z); holder.rotation.y = Math.PI / 2;
  const c = addCreature('squirrel', holder, SPOT.log.clone(), new V3(SPOT.log.x + 2, 0, SPOT.log.z), 1, (c, dt, t) => {
    c.made.tail.rotation.x = Math.sin(t * 2.2) * 0.15;
    c.made.head.rotation.y = Math.sin(t * 0.7) * 0.4;
    c.hopT = (c.hopT ?? 2) - dt;
    if (c.hopT < 0) { c.hopT = R(2, 4); c.hopFrom = c.made.group.position.z; c.hopTo = R(-0.8, 0.8); c.hopK = 0; }
    if (c.hopK != null && c.hopK < 1) { c.hopK = Math.min(1, c.hopK + dt * 2.5); c.made.group.position.z = THREE.MathUtils.lerp(c.hopFrom, c.hopTo, c.hopK); c.made.group.position.y = Math.sin(c.hopK * Math.PI) * 0.25; }
  });
  c.hit.position.y = 0.4;
}
{ // 매미: 둥근 나무 줄기
  const dir = new V3(SPOT.start.x - SPOT.cicadaTree.x, 0, SPOT.start.z - SPOT.cicadaTree.z).normalize();
  const m = trunkMount(SPOT.cicadaTree, 0.3 * 1.1 * 0.82, dir, 1.7);
  const c = addCreature('cicada', m.holder, SPOT.cicadaTree.clone(), standFrom(SPOT.cicadaTree, dir, 1.9), 1, (c, dt, t) => {
    const buzz = c.buzzing > 0; c.buzzing = (c.buzzing || 0) - dt;
    c.made.wings.forEach((w, i) => w.rotation.y = buzz ? Math.sin(t * 60 + i) * 0.05 : 0);
  });
  m.inner.add(c.made.group); m.inner.position.z = 0.1;
}
{ // 무당벌레: 덤불 위를 빙글빙글
  const holder = new THREE.Group(); holder.position.set(SPOT.bush.x, 1.28, SPOT.bush.z);
  const dir = new V3(SPOT.start.x - SPOT.bush.x, 0, SPOT.start.z - SPOT.bush.z).normalize();
  addCreature('ladybug', holder, SPOT.bush.clone(), standFrom(SPOT.bush, dir, 2.1), 1, (c, dt, t) => {
    const a = t * 0.5; c.made.group.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
    c.made.group.rotation.y = -a; c.made.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 10 + i * 2) * 0.3);
  });
}
{ // 장수풍뎅이·사슴벌레: 큰 참나무 수액 양옆 (밤에만)
  const r = 0.6 * 1.15 * 0.85;
  const stand = standFrom(SPOT.bigOak, sapDir, 2.4);
  const m1 = trunkMount(SPOT.bigOak, r, sapDir, 1.0, -0.6);
  const c1 = addCreature('rhino', m1.holder, SPOT.bigOak.clone(), stand, 1.35, (c, dt, t) => {
    c.made.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 2 + i) * 0.12);
    c.made.group.rotation.y = Math.sin(t * 0.6) * 0.08;
  });
  m1.inner.add(c1.made.group); m1.inner.position.z = 0.12;
  const m2 = trunkMount(SPOT.bigOak, r, sapDir, 1.9, 0.6);
  const c2 = addCreature('stag', m2.holder, SPOT.bigOak.clone(), stand, 1.35, (c, dt, t) => {
    c.made.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 2.4 + i) * 0.12);
    c.made.group.rotation.y = Math.sin(t * 0.5 + 1) * 0.08;
  });
  m2.inner.add(c2.made.group); m2.inner.position.z = 0.12;
}
{ // 버들치: 개울 속에서 셋이 무리 지어 빙글
  const holder = new THREE.Group(); holder.position.set(SPOT.minnow.x, -0.16, SPOT.minnow.z);
  const c = addCreature('minnow', holder, SPOT.minnow.clone(), new V3(SPOT.minnow.x, 0, -55.2), 1.9, (c, dt, t) => {
    c.school.forEach((f, i) => {
      const a = t * 0.6 + i * 2.1, r = 0.9 + i * 0.25;
      f.position.set(Math.cos(a) * r, Math.sin(t * 1.3 + i) * 0.04, Math.sin(a) * r * 0.55);
      f.rotation.y = -a; f.userData.tail.rotation.y = Math.sin(t * 9 + i) * 0.4;
    });
  });
  c.made.group.userData.tail = c.made.tail;
  c.school = [c.made.group];
  for (let i = 0; i < 2; i++) { const f = makeMinnow(); f.group.scale.setScalar(1.6); f.group.userData.tail = f.tail; holder.add(f.group); c.school.push(f.group); }
  c.hit.scale.setScalar(1.4);
}
{ // 가재: 물가 바위 옆, 집게를 벌렸다 오므렸다
  const holder = new THREE.Group(); holder.position.set(SPOT.crayRock.x, 0.02, SPOT.crayRock.z);
  addCreature('crayfish', holder, SPOT.crayRock.clone(), new V3(SPOT.crayRock.x, 0, -53.4), 1.3, (c, dt, t) => {
    c.made.claws.forEach(({ pin, s }) => pin.rotation.y = (Math.sin(t * 3) * 0.25 + 0.1) * s);
    c.made.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 4 + i) * 0.15);
    c.made.group.position.z = Math.sin(t * 0.5) * 0.15;
  });
}
{ // 물총새: 개울 위로 뻗은 가지 끝
  const holder = new THREE.Group(); holder.position.set(SPOT.kfTree.x, 2.1, SPOT.kfTree.z - 2.9);
  const c = addCreature('kingfisher', holder, new V3(SPOT.kfTree.x, 0, SPOT.kfTree.z - 2.9), new V3(SPOT.kfTree.x - 2.6, 0, -53.6), 1.25, (c, dt, t) => {
    c.made.head.rotation.y = Math.sin(t * 0.8) * 0.6;
    c.made.group.position.y = Math.abs(Math.sin(t * 1.6)) * 0.02;
  });
  c.hit.position.y = 0.4;
}
{ // 꽃게: 모래 위를 옆으로 왔다 갔다
  const holder = new THREE.Group(); holder.position.set(SPOT.crab.x, 0, SPOT.crab.z);
  addCreature('crab', holder, SPOT.crab.clone(), new V3(SPOT.crab.x, 0, SPOT.crab.z + 3), 1.25, (c, dt, t) => {
    c.made.group.position.x = Math.sin(t * 0.7) * 1.4;
    c.made.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 12 + i * 1.7) * 0.25);
    c.made.claws.forEach(({ arm, s }) => arm.rotation.x = Math.sin(t * 2 + s) * 0.2);
  });
}
{ // 소라게: 껍데기를 지고 느릿느릿
  const holder = new THREE.Group(); holder.position.set(SPOT.hermit.x, 0, SPOT.hermit.z);
  addCreature('hermit', holder, SPOT.hermit.clone(), new V3(SPOT.hermit.x - 1.5, 0, SPOT.hermit.z + 2.8), 1.3, (c, dt, t) => {
    const a = t * 0.25; c.made.group.position.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5); c.made.group.rotation.y = -a;
    c.made.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 8 + i * 2) * 0.3);
  });
}
{ // 불가사리: 바위 웅덩이 바닥
  const holder = new THREE.Group(); holder.position.set(SPOT.pool.x, 0.05, SPOT.pool.z);
  addCreature('starfish', holder, SPOT.pool.clone(), new V3(SPOT.pool.x - 2.9, 0, SPOT.pool.z + 1.8), 1.3, (c, dt, t) => {
    c.made.group.rotation.y = t * 0.08;
    c.made.arms.forEach((a, i) => a.rotation.x = Math.sin(t * 1.2 + i) * 0.06);
  });
}
// 2부 친구들: 사는 곳에 어울리게
const gh = (x, z) => groundH(x, z);
{ // 박쥐: 동굴 천장 종유석에 거꾸로 매달려 흔들흔들
  const holder = new THREE.Group(); holder.position.set(SPOT.batRoost.x, 2.45, SPOT.batRoost.z);
  const c = addCreature('bat', holder, SPOT.batRoost.clone(), new V3(SPOT.batRoost.x, 0, SPOT.batRoost.z + 4.4), 1.6, (c, dt, t) => { c.made.group.rotation.z = Math.sin(t * 1.1) * 0.08; c.made.group.rotation.y = Math.sin(t * 0.4) * 0.3; });
  c.hit.position.y = 0.1;
}
{ // 도롱뇽: 동굴 물웅덩이 가장자리
  const holder = new THREE.Group(); holder.position.set(SPOT.cavePool.x + 0.4, 0.04, SPOT.cavePool.z + 2.2);
  addCreature('salamander', holder, new V3(SPOT.cavePool.x + 0.4, 0, SPOT.cavePool.z + 2.2), new V3(SPOT.cavePool.x + 0.4, 0, SPOT.cavePool.z + 5.4), 1.6, (c, dt, t) => { c.made.tail.rotation.y = Math.sin(t * 2) * 0.35; c.made.group.rotation.y = Math.sin(t * 0.3) * 0.4; });
}
{ // 오소리: 땅굴 입구를 들락날락
  const holder = new THREE.Group(); holder.position.set(SPOT.burrow.x, 0, SPOT.burrow.z + 1.6);
  addCreature('badger', holder, new V3(SPOT.burrow.x, 0, SPOT.burrow.z + 1.6), new V3(SPOT.burrow.x, 0, SPOT.burrow.z + 5.2), 1.1, (c, dt, t) => { c.made.group.position.z = -0.35 + Math.abs(Math.sin(t * 0.35)) * 0.6; c.made.head.rotation.x = Math.sin(t * 3) * 0.08; c.made.head.rotation.y = Math.sin(t * 0.7) * 0.3; });
}
{ // 짱뚱어: 진흙 언덕 위에서 폴짝
  const holder = new THREE.Group(); holder.position.set(SPOT.mudMound.x + 0.4, 0.42, SPOT.mudMound.z + 0.2);
  addCreature('mudskipper', holder, SPOT.mudMound.clone(), new V3(SPOT.mudMound.x, 0, SPOT.mudMound.z + 3.5), 1.7, (c, dt, t) => { const k = (t * 0.5) % 1; c.made.group.position.y = k < 0.25 ? Math.sin(k / 0.25 * Math.PI) * 0.3 : 0; c.made.tail.rotation.y = Math.sin(t * 6) * 0.3; });
}
{ // 농게: 큰 집게발을 흔들흔들
  const holder = new THREE.Group(); holder.position.set(SPOT.fiddler.x, 0, SPOT.fiddler.z);
  addCreature('fiddler', holder, SPOT.fiddler.clone(), new V3(SPOT.fiddler.x, 0, SPOT.fiddler.z + 3.4), 1.8, (c, dt, t) => { c.made.big.rotation.z = Math.sin(t * 3) * 0.45; c.made.big.position.y = 0.14 + Math.max(0, Math.sin(t * 3)) * 0.08; c.made.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 5 + i) * 0.15); });
}
{ // 저어새: 물웅덩이에서 부리를 좌우로 저으며
  const holder = new THREE.Group(); holder.position.set(SPOT.spoonPuddle.x, 0, SPOT.spoonPuddle.z - 0.4);
  const c = addCreature('spoonbill', holder, SPOT.spoonPuddle.clone(), new V3(SPOT.spoonPuddle.x, 0, SPOT.spoonPuddle.z + 3.6), 1.1, (c, dt, t) => { c.made.head.rotation.y = Math.sin(t * 2.2) * 0.6; c.made.head.rotation.x = 0.5 + Math.sin(t * 0.5) * 0.15; });
  c.hit.position.y = 1;
}
{ // 멧토끼: 눈밭, 귀를 쫑긋
  const holder = new THREE.Group(); holder.position.set(SPOT.hare.x, gh(SPOT.hare.x, SPOT.hare.z), SPOT.hare.z);
  addCreature('hare', holder, SPOT.hare.clone(), new V3(SPOT.hare.x, 0, SPOT.hare.z + 3.6), 1.4, (c, dt, t) => { c.made.ears.forEach((e, i) => e.rotation.x = Math.sin(t * 2 + i * 1.3) * 0.15); c.made.head.rotation.y = Math.sin(t * 0.6) * 0.3; const k = (t * 0.3) % 1; c.made.group.position.y = k < 0.12 ? Math.sin(k / 0.12 * Math.PI) * 0.18 : 0; });
}
{ // 산양: 높은 바위 꼭대기
  const holder = new THREE.Group(); holder.position.set(SPOT.goralRock.x, gh(SPOT.goralRock.x, SPOT.goralRock.z) + 3.55, SPOT.goralRock.z + 0.1);
  const c = addCreature('goral', holder, SPOT.goralRock.clone(), new V3(SPOT.goralRock.x - 1, 0, SPOT.goralRock.z + 3.8), 0.9, (c, dt, t) => { c.made.head.rotation.y = Math.sin(t * 0.5) * 0.5; });
  c.hit.position.y = 0.8;
}
{ // 수리부엉이: 눈 덮인 소나무 가지 위, 고개를 빙글
  const holder = new THREE.Group(); holder.position.set(SPOT.owlTree.x, gh(SPOT.owlTree.x, SPOT.owlTree.z) + 2.58, SPOT.owlTree.z + 1.3);
  const c = addCreature('owl', holder, new V3(SPOT.owlTree.x, 0, SPOT.owlTree.z + 1.3), new V3(SPOT.owlTree.x, 0, SPOT.owlTree.z + 4.6), 0.9, (c, dt, t) => { c.made.head.rotation.y = Math.sin(t * 0.45) * 2.2; });
  c.hit.position.y = 0.6;
}

// ───────── 악당·물건 모델 ─────────
// 잿빛 마법사 스모기: 뭉게뭉게 회색 구름 몸 + 보라 마법사 모자 + 심술 눈썹 (무섭지 않게)
function makeSmogi() {
  const g = new THREE.Group();
  const GRAY = 0x8f949e, LIGHT = 0xb9bdc6;
  const body = new THREE.Group(); g.add(body);
  body.add(blob(0.62, 0.55, 0.55, GRAY, {}, true));
  for (const [x, y, z, r] of [[-0.5, -0.1, 0, 0.36], [0.5, -0.1, 0, 0.36], [0, -0.35, 0.1, 0.4], [-0.3, 0.35, -0.1, 0.32], [0.32, 0.32, -0.1, 0.3]]) body.add(at(blob(r, r * 0.9, r, LIGHT, {}, true), x, y, z));
  const brows = [];
  for (const s of [-1, 1]) {
    body.add(at(eye(0.12), 0.2 * s, 0.08, 0.46));
    const b = at(blob(0.13, 0.03, 0.03, 0x2a2a35), 0.2 * s, 0.25, 0.52); b.rotation.z = -0.45 * s; body.add(b); brows.push({ b, s });
  }
  const mouth = mesh(new THREE.TorusGeometry(0.1, 0.025, 5, 10, Math.PI), mat(0x2a2a35)); mouth.position.set(0, -0.12, 0.53); body.add(mouth);
  const hat = new THREE.Group(); hat.position.set(0.05, 0.5, -0.05); hat.rotation.z = -0.2; body.add(hat);
  hat.add(at(cyl(0.42, 0.42, 0.05, 0x5b3c88, 12), 0, 0, 0));
  const tip = cone(0.3, 0.75, 0x5b3c88, 8); tip.position.y = 0.38; tip.rotation.z = -0.15; hat.add(tip);
  hat.add(at(blob(0.08, 0.08, 0.03, 0xffd23f, { emissive: 0xffc400, ei: 0.4 }), 0.05, 0.32, 0.24));
  const wand = new THREE.Group(); wand.position.set(0.62, -0.05, 0.15); body.add(wand);
  const stick = cyl(0.025, 0.025, 0.6, 0x4a2a10, 5); stick.rotation.z = -0.6; stick.position.set(0.15, 0.15, 0); wand.add(stick);
  wand.add(at(blob(0.07, 0.07, 0.07, 0x9aa0aa, { emissive: 0x666a77, ei: 0.4 }), 0.32, 0.38, 0));
  return { group: g, body, brows, mouth, wand };
}
// 먹구름 대마왕: 하늘 저편의 커다란 먹구름 (마지막에 잠깐 등장)
function makeStormKing() {
  const g = new THREE.Group();
  for (const [x, y, z, r] of [[0, 0, 0, 5], [-5, -1, 0, 3.6], [5, -1, 0, 3.6], [-2.5, 2.6, 0, 3], [2.8, 2.4, 0, 3]]) g.add(at(blob(r, r * 0.8, r * 0.7, 0x3a3f4f, { opacity: 0.95 }, true), x, y, z));
  for (const s of [-1, 1]) { g.add(at(blob(0.9, 0.5, 0.2, 0xff4d4d, { emissive: 0xff2222, ei: 0.8 }), 1.6 * s, 0.6, 3.4)); const b = at(blob(1.2, 0.2, 0.2, 0x111111), 1.6 * s, 1.4, 3.5); b.rotation.z = -0.4 * s; g.add(b); }
  return g;
}
function makeItem(kind, i) {
  const g = new THREE.Group();
  if (kind === 'acorn') {
    g.add(at(blob(0.16, 0.2, 0.16, 0x9a5b2a, {}, true), 0, 0.2, 0));
    g.add(at(blob(0.18, 0.09, 0.18, 0x5c3a1a), 0, 0.36, 0));
    g.add(at(cyl(0.02, 0.02, 0.1, 0x5c3a1a, 4), 0, 0.46, 0));
  } else if (kind === 'shell') {
    for (let k = 0; k < 4; k++) { const r = 0.2 - k * 0.045; g.add(at(blob(r, r * 0.9, r, k % 2 ? 0xf2a7b5 : 0xffe1e6, {}, true), 0, 0.15 + k * 0.1, -k * 0.04)); }
  } else if (kind === 'mushroom') { // 빛 버섯
    g.add(at(cyl(0.07, 0.09, 0.4, 0xeef6f2, 6), 0, 0.2, 0));
    const cap = new THREE.Mesh(GEO.ico2, mat(0x5ff3ff, { emissive: 0x3fdcff, ei: 1 })); cap.scale.set(0.32, 0.18, 0.32); cap.position.y = 0.42; g.add(cap);
    for (const [x, z] of [[0.12, 0.1], [-0.1, 0.12], [0.02, -0.15]]) g.add(at(blob(0.04, 0.02, 0.04, 0xffffff, { emissive: 0xffffff, ei: 0.6 }), x, 0.52, z));
  } else if (kind === 'clam') { // 조개 숨구멍: 구멍 + 보글보글 물방울
    const h = new THREE.Mesh(new THREE.CircleGeometry(0.16, 10), new THREE.MeshBasicMaterial({ color: 0x2a2219 })); h.rotation.x = -Math.PI / 2; h.position.y = 0.025; g.add(h);
    for (let k = 0; k < 4; k++) g.add(at(ball(0.045 + k * 0.012, 0xe8f6ff, { opacity: 0.85 }), R(-0.06, 0.06), 0.08 + k * 0.12, R(-0.06, 0.06)));
    g.userData.flat = true;
  } else if (kind === 'track') { // 눈 위 발자국
    for (const [x, z, r] of [[-0.12, 0, 0.2], [0.12, -0.25, -0.2]]) { const f = blob(0.09, 0.012, 0.16, 0x7d8aa6); f.position.set(x, 0.03, z); f.rotation.y = r; g.add(f); for (const t of [-0.05, 0, 0.05]) g.add(at(blob(0.025, 0.01, 0.025, 0x7d8aa6), x + t, 0.03, z + 0.2)); }
    g.userData.flat = true;
  } else { // 쓰레기: 페트병·캔·비닐
    const t = i % 3;
    if (t === 0) { const b = cyl(0.1, 0.1, 0.42, 0x9fd8f0, 8, { opacity: 0.8 }); b.rotation.z = Math.PI / 2; b.position.y = 0.12; g.add(b); const cap = cyl(0.05, 0.05, 0.08, 0x2f6fe0, 6); cap.rotation.z = Math.PI / 2; cap.position.set(0.25, 0.12, 0); g.add(cap); }
    else if (t === 1) { const c = cyl(0.1, 0.1, 0.24, 0xe2533f, 8); c.rotation.x = Math.PI / 2; c.position.y = 0.1; g.add(c); g.add(at(cyl(0.101, 0.101, 0.06, 0xd8d8d8, 8), 0, 0.1, 0)).rotation.x = Math.PI / 2; }
    else { g.add(at(blob(0.25, 0.14, 0.2, 0xf4f4f4, { opacity: 0.85 }), 0, 0.12, 0)); g.add(at(blob(0.06, 0.12, 0.04, 0xf4f4f4), 0.12, 0.28, 0)); }
  }
  return g;
}

// ───────── 미션 목록·진행 상태 ─────────
const MISSIONS = STORY.missions, CHAPTERS = STORY.chapters, SPEAK = STORY.speakers;
const chapterOf = m => CHAPTERS.find(c => c.id === m.ch);
let step = Math.min(save.step || 0, MISSIONS.length);
save.done = step >= MISSIONS.length;
const cur = () => MISSIONS[step] || null;
// 길: 이미 지나온 미션이 연 길은 열어 둔다
MISSIONS.forEach((m, i) => { if (m.opens && step > i) { const g = gates[m.opens]; g.open = true; g.k = 0; g.mesh.visible = false; } });
// 낮·밤: 지금 미션이 정한 대로 (정하지 않았으면 앞 미션들 중 마지막 지정)
function nightFor(idx) { for (let i = Math.min(idx, MISSIONS.length - 1); i >= 0; i--) if (MISSIONS[i].night != null) return MISSIONS[i].night; return false; }
if (!save.done) save.night = nightFor(step);
if (step > MISSIONS.findIndex(m => m.reward === 'flashlight')) save.flashlight = true;

// ───────── 낮·밤 ─────────
let nightK = save.night ? 1 : 0;   // 0 낮 ~ 1 밤
let nightTarget = nightK;
function applyTime(k) {
  const sk = stormK;
  scene.background.copy(DAY_SKY).lerp(NIGHT_SKY, k).lerp(STORM_SKY, sk * 0.75);
  scene.fog.color.copy(scene.background);
  hemi.intensity = THREE.MathUtils.lerp(1.4, 0.75, k) * (1 - sk * 0.2);
  hemi.color.setHex(0xe3f4ff).lerp(new THREE.Color(0x8fa6e0), k);
  sun.intensity = THREE.MathUtils.lerp(2.4, 0.55, k) * (1 - sk * 0.45);
  sun.color.setHex(0xfff1d6).lerp(new THREE.Color(0xa9bdf0), k);
  flash.intensity = (save.flashlight ? 1 : 0) * k * 45;
  glow.intensity = k * 6;
  moon.material.opacity = k; stars.material.opacity = k * 0.9;
  sapMat.emissiveIntensity = k * 0.5;
  document.querySelector('meta[name=theme-color]').content = '#' + scene.background.getHexString();
}
applyTime(nightK);
function setNight(on) { nightTarget = on ? 1 : 0; save.night = on; persist(); refreshHud(); }

// ───────── 화면 크기 ─────────
let camDist = 1, camAhead = 2;
const CAM_OFF = new V3(0, 6.5, 10);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); camera.aspect = w / h;
  camera.fov = w / h < 1 ? 58 : 45;
  camDist = w / h < 1 ? 1.3 : 1;
  camAhead = w / h < 1 ? -1.5 : 2; // 세로 화면은 주인공이 화면 가운데쯤 오게
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ───────── 정보창·말풍선 ─────────
function foundCount() { return ALL_IDS.filter(id => save.found[id]).length; }
function gemDone(ch) { const bi = MISSIONS.findIndex(m => m.ch === ch.id && m.type === 'boss'); return step > bi; }
function refreshHud() {
  const n = foundCount();
  $('#lvlText').textContent = `탐험가 Lv.${1 + n}`;
  $('#stars').textContent = `🌟 ${n} / ${ALL_IDS.length}`;
  const part = step > P1END ? 2 : 1;
  $('#gems').innerHTML = CHAPTERS.filter(c => c.part === part).map(c => `<span class="${gemDone(c) ? 'on' : ''}">${c.gemIcon}</span>`).join('');
  $('#timeBtn').hidden = !save.done;
  $('#timeBtn').textContent = nightTarget ? '☀️' : '🌙';
}
let msgTimer = 0;
// 말풍선 + 성우 음성. 여러 문장이면 배열로
function say(lines, voice = true, ms = 4500) {
  const arr = Array.isArray(lines) ? lines : [lines];
  $('#msgText').textContent = arr.join(' ');
  const el = $('#msg'); el.classList.remove('hide'); el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  clearTimeout(msgTimer); msgTimer = setTimeout(() => el.classList.add('hide'), ms);
  if (voice) speak(arr);
}

// ───────── 잿빛 효과: 스모기가 구슬을 가져간 지역은 색이 바래고, 친구를 도울수록 돌아온다 ─────────
function regionSat(region) {
  const ch = CHAPTERS.find(c => c.region === region); if (!ch) return 1;
  const first = MISSIONS.findIndex(m => m.ch === ch.id), boss = MISSIONS.findIndex(m => m.ch === ch.id && m.type === 'boss');
  if (step <= first || step > boss) return 1;
  return 0.3 + 0.55 * (step - first - 1) / (boss - first);
}
let satNow = -1;
let caveK = 0;
function updateSat() {
  const s = Math.round(regionSat(regionAt(boy.group.position.x, boy.group.position.z)) * 100) / 100;
  const dark = Math.round(caveK * 10) / 10;
  const key = s + '|' + dark;
  if (key === satNow) return; satNow = key;
  const f = [];
  if (s < 0.99) f.push(`saturate(${s})`);
  const br = (s < 0.99 ? 0.94 + s * 0.06 : 1) * (1 - dark * 0.38);
  if (br < 0.99) f.push(`brightness(${br.toFixed(2)})`);
  renderer.domElement.style.filter = f.length ? f.join(' ') : 'none';
}

// ───────── 친구 카드 ─────────
const cardCanvas = $('#cardCanvas');
const cardR = new THREE.WebGLRenderer({ canvas: cardCanvas, antialias: true, alpha: true });
cardR.setPixelRatio(Math.min(devicePixelRatio, 2));
const cardScene = new THREE.Scene();
cardScene.add(new THREE.HemisphereLight(0xffffff, 0x9ab88a, 1.8));
const cardLight = new THREE.DirectionalLight(0xffffff, 2.2); cardLight.position.set(2, 4, 4); cardScene.add(cardLight);
const cardCam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
const CARD_TILT = { rhino: 0.35, stag: 0.35, ladybug: 0.35, cicada: 0.35, crayfish: 0.5, crab: 0.55, hermit: 0.35, starfish: 0.9, minnow: 0.2 };
let cardSpin = null, cardOpen = false, cardIsNew = false, cardCreature = null, cardBookId = null;
function setCardModel(id) {
  if (cardSpin) cardScene.remove(cardSpin);
  const m = MAKERS[id]().group;
  const box = new THREE.Box3().setFromObject(m), size = box.getSize(new V3());
  m.scale.multiplyScalar((id === 'goldie' || id === 'squirrel' || id === 'kingfisher' ? 1.9 : 2.3) / Math.max(size.x, size.y, size.z));
  box.setFromObject(m); m.position.sub(box.getCenter(new V3()));
  cardSpin = new THREE.Group(); cardSpin.add(m);
  cardSpin.rotation.x = CARD_TILT[id] || 0;
  cardScene.add(cardSpin);
  cardCam.position.set(0, 0.9, 4.6); cardCam.lookAt(0, 0, 0);
}
function sizeCard() {
  const w = cardCanvas.clientWidth, h = cardCanvas.clientHeight;
  if (w && h) { cardR.setSize(w, h, false); cardCam.aspect = w / h; cardCam.updateProjectionMatrix(); }
}
function readCard(def) {
  const lis = [...document.querySelectorAll('#cardFacts li')];
  lis.forEach(l => l.classList.remove('now'));
  speak([def.intro, ...def.facts], i => { lis.forEach(l => l.classList.remove('now')); if (i > 0) lis[i - 1].classList.add('now'); },
    () => lis.forEach(l => l.classList.remove('now')));
}
function openCard(id, isNew, creature) {
  const def = DEF[id];
  cardOpen = true; cardIsNew = isNew; cardCreature = creature; if (creature) cardBookId = null;
  $('#cardRibbon').textContent = def.companion ? '탐험 친구 골디!' : (isNew ? '새 친구를 만났어요!' : `${REGIONS[def.region].icon} ${REGIONS[def.region].name} 친구`);
  $('#cardName').textContent = def.companion ? `${def.nick} (${def.name})` : def.name;
  $('#cardFacts').innerHTML = def.facts.map(f => `<li>${f}</li>`).join('');
  $('#cardClose').textContent = isNew && !def.companion ? '💚 놓아주기' : (def.companion && isNew ? '🐾 같이 가자!' : '닫기');
  $('#card').classList.remove('hide');
  setCardModel(id); sizeCard();
  readCard(def);
}
function closeCard() {
  $('#card').classList.add('hide'); cardOpen = false; hush(); sfx.pop();
  const wasNew = cardIsNew, c = cardCreature;
  if (wasNew && c) {
    c.hop = 1; spawnHearts(c.holder.getWorldPosition(new V3()));
    say(MSG.bye, true, 2000);
    setTimeout(() => { if (cur() && cur().target === c.id) completeMission(); }, 1900);
  }
  if (wasNew && !c) setTimeout(() => startMission(), 400); // 골디 첫 인사 뒤 이야기 시작
}
$('#cardSpeak').onclick = () => { sfx.tap(); readCard(DEF[cardBookId || (cardCreature ? cardCreature.id : 'goldie')]); };
$('#cardClose').onclick = closeCard;

// ───────── 도감 (지역별) ─────────
function openBook() {
  sfx.pop(); hush();
  const grid = $('#bookGrid');
  grid.innerHTML = '';
  for (const [rid, r] of Object.entries(REGIONS)) {
    const h = document.createElement('div'); h.className = 'bookHead'; h.textContent = `${r.icon} ${r.name}`; grid.appendChild(h);
    for (const f of FRIENDS.filter(f => f.region === rid)) {
      const found = !!save.found[f.id];
      const el = document.createElement('div');
      el.className = 'slot ' + (found ? 'found' : 'locked');
      el.innerHTML = `<div class="ic">${f.emoji}</div><div>${found ? (f.companion ? f.nick : f.name) : '???'}</div>` +
        (!found ? `<div class="tag">${f.time === 'night' ? '🌙 밤에 만나요' : '☀️ 낮에 만나요'}</div>` : '');
      if (found) el.onclick = () => { $('#book').classList.add('hide'); cardBookId = f.id; openCard(f.id, false, null); };
      grid.appendChild(el);
    }
  }
  $('#book').classList.remove('hide');
}
$('#bookBtn').onclick = openBook;
$('#bookClose').onclick = () => { sfx.pop(); $('#book').classList.add('hide'); };

// ───────── 아이템·이벤트 카드 ─────────
let itemThen = null;
function showItem(icon, title, text, then, voiceLines) {
  $('#itemIcon').textContent = icon; $('#itemTitle').textContent = title; $('#itemText').textContent = text;
  $('#itemClose').textContent = '좋아요!';
  $('#item').classList.remove('hide'); itemThen = then; sfx.item();
  speak(voiceLines || [title, text]);
}
$('#itemClose').onclick = () => { sfx.pop(); hush(); $('#item').classList.add('hide'); const t = itemThen; itemThen = null; t && t(); };

// ───────── 이야기 대화 (화면 아래 말상자) ─────────
let talkOpen = false, talkSkip = null;
async function playLines(lines, done) {
  talkOpen = true; moveQueue = []; joy = null; $('#joy').classList.add('hide');
  $('#msg').classList.add('hide');
  const box = $('#talk'); box.classList.remove('hide');
  for (const ln of lines) {
    const sp = SPEAK[ln.who] || SPEAK.narr;
    $('#talkIcon').textContent = sp.icon; $('#talkName').textContent = sp.name; $('#talkName').style.display = sp.name ? '' : 'none';
    $('#talkText').textContent = ln.text;
    box.className = 'who-' + ln.who; box.offsetHeight; box.classList.add('show');
    if (ln.who === 'smogi' || ln.who === 'jjiri') villainCome(null, ln.who);
    if (ln.who === 'boss' && actors.king.state === 'off') stormShow = 1;
    await new Promise(res => {
      let ended = false; const fin = () => { if (!ended) { ended = true; talkSkip = null; res(); } };
      talkSkip = () => { hush(); fin(); };
      speak(ln.text, null, () => setTimeout(fin, 700));
      setTimeout(fin, 2500 + ln.text.length * 220); // 소리가 안 나도 넘어가게
    });
  }
  box.classList.add('hide'); talkOpen = false;
  done && done();
}
$('#talk').addEventListener('click', () => { sfx.tap(); talkSkip && talkSkip(); });

// ───────── 스모기 · 찌릿이 · 먹구름 대마왕 ─────────
const actors = {
  smogi: { made: makeSmogi(), h: 2.6, icon: '😈' },
  jjiri: { made: makeJjiri(), h: 2.3, icon: '⚡' },
  king: { made: { group: makeStormKing() }, h: 3.3, icon: '⛈️', scale: 0.42, dz: -4.5 },
};
for (const a of Object.values(actors)) { Object.assign(a, { state: 'off', pos: new V3(), k: 0 }); a.made.group.visible = false; scene.add(a.made.group); }
const smogi = actors.smogi.made;
const P1END = MISSIONS.findIndex(m => m.partEnd === 1);
const JJIRI_END = MISSIONS.map((m, i) => m.villain === 'jjiri' ? i : -1).filter(i => i >= 0).pop();
const KING_IDX = MISSIONS.findIndex(m => m.villain === 'king');
function villainCome(at, who = 'smogi') { // at 이 없으면 주인공 근처에 나타난다
  const a = actors[who];
  if (a.state === 'here' && !at) return;
  const bp = boy.group.position;
  a.pos.copy(at || new V3(bp.x + (who === 'jjiri' ? -2.6 : 2.4), 0, bp.z - 2.6));
  a.state = 'come'; a.k = 0; a.made.group.visible = true;
}
function villainLeave(who) { for (const [k, a] of Object.entries(actors)) if ((!who || k === who) && a.state !== 'off') { a.state = 'leave'; a.k = 0; } }
const storm = makeStormKing(); storm.visible = false; scene.add(storm);
let stormShow = 0;

// ───────── 미션 진행 ─────────
const fetchState = { step: 'find', t: 0, from: new V3(), to: new V3() };
const byId = id => creatures.find(c => c.id === id);
let items = [];          // 줍기 미니게임 물건
let clouds = [];         // 스모기 연기 구름
let bossReady = false;   // 스모기 앞에 도착해 대사를 들었나
function bossSpot(m) { return SPOT[m.at]; }
function bossStand(m) { const p = bossSpot(m); return new V3(p.x, 0, p.z + 4); }
// 지금 가야 할 곳 (없으면 null)
function missionGoal() {
  const m = cur(); if (!m || !playing) return null;
  if (m.type === 'meet') { const c = byId(m.target); return c.appear > 0.6 ? { pos: c.stand, look: c.anchor, c } : null; }
  if (m.type === 'collect') {
    const left = items.filter(it => !it.got); if (!left.length) return null;
    const bp = boy.group.position; left.sort((a, b) => flatDist(a.pos, bp) - flatDist(b.pos, bp));
    return { pos: left[0].pos, look: left[0].pos };
  }
  if (m.type === 'fetch') return fetchState.step === 'find' ? { pos: SPOT.ball, look: SPOT.ball } : null;
  if (m.type === 'boss') return bossReady ? null : { pos: bossStand(m), look: bossSpot(m) };
  return null;
}
function missionLabel() {
  const m = cur(); if (!m) return '';
  if (m.type === 'collect') return `${m.text} (${items.filter(i => i.got).length}/${items.length})`;
  if (m.type === 'boss' && clouds.length) return `${m.text} (${clouds.filter(c => c.gone).length}/${clouds.length})`;
  return m.text;
}
function paintMission() {
  const m = cur(); const box = $('#mission');
  if (!m || m.type === 'talk') { box.classList.add('hide'); return; }
  const ch = chapterOf(m);
  $('#mIcon').textContent = m.icon; $('#mText').textContent = missionLabel();
  $('#mStep').textContent = `${ch.title.split('.')[0]} · 미션 ${step + 1} / ${MISSIONS.length}`;
  box.classList.remove('hide');
}
function openGate(region) { const g = gates[region]; if (!g || g.open) return; g.open = true; g.opening = true; sfx.item(); }
function clearMissionStuff() {
  for (const it of items) scene.remove(it.mesh); items = [];
  for (const c of clouds) scene.remove(c.mesh); clouds = [];
  bossReady = false;
}
function startMission() {
  clearMissionStuff();
  const m = cur();
  if (!m) { $('#mission').classList.add('hide'); return; }
  if (m.opens) openGate(m.opens);
  if (m.night != null && !!m.night !== !!nightTarget) setNight(!!m.night);
  paintMission(); refreshHud();
  const box = $('#mission'); box.classList.remove('flash'); box.offsetHeight; box.classList.add('flash');
  if (m.type === 'talk') { playLines(m.lines, () => completeMission(true)); return; }
  if (m.type === 'fetch') { fetchState.step = 'find'; ballMesh.visible = true; ballMesh.position.copy(SPOT.ball).setY(0.25); }
  if (m.type === 'collect') spawnItems(m);
  if (m.type === 'boss') { villainCome(bossSpot(m), m.villain || 'smogi'); }
  paintMission();
  sfx.item();
  if (m.type === 'sumo') { say(m.announce, true, 4000); setTimeout(openSumo, 3600); return; }
  if (m.type === 'simon') { say(m.announce, true, 4000); setTimeout(openSimon, 3400); return; }
  say([m.announce || m.text + '!', step <= 2 ? MSG.firstTip : MSG.follow], true, 6500);
}
function completeMission(quiet) {
  const m = cur(); if (!m) return;
  step++; save.step = step; save.done = step >= MISSIONS.length; persist();
  refreshHud(); paintMission();
  if (!quiet) { sfx.chime(); cheer = 1; }
  const next = () => {
    if (m.reward === 'flashlight') { save.flashlight = true; persist(); showItem('🔦', MSG.flashTitle, MSG.flashText, () => startMission()); return; }
    if (m.type === 'boss') { chapterDone(m); return; }
    startMission();
  };
  const after = () => m.after ? playLines(m.after, next) : next();
  if (quiet) next();
  else { say(MSG.success, true, 2200); setTimeout(after, 2300); }
}
function chapterDone(m) {
  const ch = chapterOf(m);
  villainLeave(); clearMissionStuff();
  spawnHearts(boy.group.position.clone().setY(1.6)); cheer = 1;
  showItem(ch.gemIcon, `${ch.title.split('.')[0]} 완료!`, ch.doneText, () => {
    refreshHud();
    if (m.partEnd) {
      const T = MSG['part' + m.partEnd + 'Title'], X = MSG['part' + m.partEnd + 'Text'];
      showItem(m.partEnd === 2 ? '🌈' : '🏅', T, X, () => { stormShow = 0; refreshHud(); if (cur()) startMission(); }, [T, X]);
    } else startMission();
  }, [ch.doneText]);
}
// 미션 카드를 톡 = 그곳까지 데려다주기
$('#mission').onclick = () => {
  if (blocked()) return;
  sfx.pop();
  const m = cur(); if (!m) return;
  if (m.type === 'fetch' && fetchState.step === 'carry') { say(MSG.ballTapDog, true, 3500); return; }
  if (m.type === 'boss' && bossReady) { say(MSG.bossTip, true, 3000); return; }
  const g = missionGoal();
  if (!g) { say(MSG.wait, true, 2000); return; }
  pendingCreature = g.c || null; walkTo(g.pos.clone());
  speak(m.text);
};
$('#timeBtn').onclick = () => { sfx.pop(); setNight(!nightTarget); say(nightTarget ? MSG.nightOn : MSG.dayOn, true, 2500); };

// 줍기 미니게임: 걸어가면 저절로 주워진다
function spawnItems(m) {
  const spots = ITEM_SPOTS[m.area || m.item];
  items = spots.map(([x, z], i) => {
    const mesh = makeItem(m.item, i); const water = isWater(x, z);
    const base = water ? -0.12 : groundH(x, z);
    mesh.position.set(x, base, z); mesh.rotation.y = i; scene.add(mesh);
    addXray(mesh, 0xffe066, 0.55);
    return { mesh, pos: new V3(x, 0, z), got: false, water, ph: i * 1.3, base, flat: !!mesh.userData.flat };
  });
}
function updateItems(dt, t) {
  if (!items.length) return;
  const bp = boy.group.position;
  for (const it of items) {
    if (it.got) { if (it.k > 0) { it.k -= dt * 2; it.mesh.position.y += dt * 2; it.mesh.scale.setScalar(Math.max(0.01, it.k)); if (it.k <= 0) it.mesh.visible = false; } continue; }
    if (!it.flat) { it.mesh.rotation.y += dt * 0.8; it.mesh.position.y = it.base + (it.water ? 0 : 0.05) + Math.abs(Math.sin(t * 2 + it.ph)) * 0.12; }
    else it.mesh.children.forEach((b, k) => { if (k > 0 && b.geometry === GEO.ball) b.position.y = 0.08 + ((t * 0.5 + k * 0.25) % 1) * 0.45; });
    if (flatDist(bp, it.pos) < 1.3) {
      it.got = true; it.k = 1; sfx.pop(); tone(1100, 0.15, 'triangle', 0.12, 0.06);
      spawnHearts(it.pos.clone().setY(0.8)); paintMission();
      const left = items.filter(x => !x.got).length;
      if (left === 0) { say(MSG.allGot, true, 2000); setTimeout(() => completeMission(), 1800); }
      else say(MSG.got, true, 1200);
    }
  }
}

// 스모기 연기 구름 미니게임: 구름을 톡 하면 펑 날아간다
const cloudMat = new THREE.MeshStandardMaterial({ color: 0x7d828c, roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
function spawnClouds(m) {
  const c0 = bossSpot(m); const n = m.villain === 'king' ? 14 : m.at === 'seaBoss' ? 10 : 8; const y0 = Math.max(0, groundH(c0.x, c0.z));
  clouds = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, r = R(1.8, 2.8);
    const g = new THREE.Group();
    for (const [x, y, z, s] of [[0, 0, 0, 0.55], [-0.45, -0.1, 0, 0.4], [0.45, -0.08, 0, 0.42], [0, 0.3, 0, 0.38]]) { const b = new THREE.Mesh(GEO.ico2, cloudMat.clone()); b.scale.setScalar(s); b.position.set(x, y, z); g.add(b); }
    const hit = new THREE.Mesh(GEO.ball, hitMat); hit.scale.setScalar(0.95); g.add(hit);
    g.position.set(c0.x + Math.cos(a) * r, y0 + 1.3 + (i % 3) * 0.6, c0.z + Math.sin(a) * r * 0.7);
    scene.add(g);
    const cl = { mesh: g, hit, gone: false, k: 1, base: g.position.clone(), ph: R(0, 6) };
    hit.userData.cloud = cl; clouds.push(cl);
  }
}
function puffCloud(cl) {
  if (cl.gone) return;
  cl.gone = true; cl.k = 1;
  tone(700, 0.25, 'sine', 0.15, 0, 1400); tone(300, 0.3, 'triangle', 0.08, 0.02, 120);
  paintMission();
  if (clouds.every(c => c.gone)) setTimeout(() => {
    smogiHurt = 1;
    const m = cur(); if (m && m.type === 'boss') completeMission();
  }, 900);
}
let smogiHurt = 0;
function updateClouds(dt, t) {
  for (const cl of clouds) {
    if (cl.gone) {
      if (cl.k > 0) { cl.k -= dt * 1.8; cl.mesh.scale.setScalar(1 + (1 - cl.k) * 0.8); cl.mesh.children.forEach(b => b.material && b.material.opacity !== undefined && (b.material.opacity = Math.max(0, cl.k) * 0.9)); cl.mesh.position.y += dt * 1.5; }
      else cl.mesh.visible = false;
      continue;
    }
    cl.mesh.position.set(cl.base.x + Math.sin(t * 0.7 + cl.ph) * 0.25, cl.base.y + Math.sin(t * 1.1 + cl.ph) * 0.15, cl.base.z);
  }
  // 스모기 앞에 도착하면 대사 → 구름 등장
  const m = cur();
  if (m && m.type === 'boss' && !bossReady && !talkOpen && playing && flatDist(boy.group.position, bossStand(m)) < 3.2) {
    bossReady = true; moveQueue = []; faceTo(bossSpot(m));
    playLines(m.before || [], () => { spawnClouds(m); paintMission(); say(MSG.bossTip, true, 4000); });
  }
}

// 장수풍뎅이 힘겨루기 미니게임 (톡톡톡 응원)
let sumo = null;
function openSumo() {
  const ov = $('#sumo'); ov.classList.remove('hide');
  const cv = $('#sumoCanvas');
  if (!sumo) {
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); r.setPixelRatio(Math.min(devicePixelRatio, 2));
    const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.8)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(2, 4, 5); sc.add(dl);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 1.8, 5.6); cam.lookAt(0, 0.1, 0);
    const log = cyl(0.45, 0.45, 5.2, 0x7a5434, 10); log.rotation.z = Math.PI / 2; log.position.y = -0.45; sc.add(log);
    const rh = makeRhino().group; rh.rotation.y = Math.PI / 2; rh.scale.setScalar(1.9); sc.add(rh);
    const st = makeStag().group; st.rotation.y = -Math.PI / 2; st.scale.setScalar(1.9); sc.add(st);
    sumo = { r, sc, cam, rh, st };
  }
  Object.assign(sumo, { p: 0, t: 0, done: false, taps: 0, push: 0 });
  $('#sumoBar').style.width = '50%'; $('#sumoTime').textContent = '15';
  say(MSG.sumoTip, true, 2500);
}
$('#sumo').addEventListener('pointerdown', e => {
  if (!sumo || sumo.done) return;
  e.preventDefault(); sumo.p = Math.min(1, sumo.p + 0.07); sumo.push = 1; tone(500 + sumo.p * 300, 0.06, 'triangle', 0.1);
});
function updateSumo(dt, t) {
  if (!sumo || $('#sumo').classList.contains('hide')) return;
  const cv = $('#sumoCanvas'), w = cv.clientWidth, h = cv.clientHeight;
  if (w && h) { sumo.r.setSize(w, h, false); sumo.cam.aspect = w / h; sumo.cam.updateProjectionMatrix(); }
  if (!sumo.done) {
    sumo.t += dt;
    sumo.p = Math.max(-0.9, sumo.p - dt * (0.16 + 0.06 * Math.sin(sumo.t * 1.7))); // 사슴벌레도 힘껏 민다
    $('#sumoTime').textContent = Math.max(0, Math.ceil(15 - sumo.t));
    if (sumo.p >= 1 || sumo.t >= 15) {
      sumo.done = true; const win = sumo.p >= 1;
      sfx.chime(); say(win ? MSG.sumoWin : MSG.sumoDraw, true, 2500);
      setTimeout(() => { $('#sumo').classList.add('hide'); completeMission(); }, 2600);
    }
  }
  sumo.push = Math.max(0, sumo.push - dt * 6);
  const x = sumo.p * 1.1;
  sumo.rh.position.set(x - 1.15 - sumo.push * 0.06, 0, 0); sumo.st.position.set(x + 1.15, 0, 0);
  sumo.rh.rotation.z = Math.sin(t * 20) * 0.02 * (1 + sumo.push);
  $('#sumoBar').style.width = `${50 + sumo.p * 50}%`;
  sumo.r.render(sumo.sc, sumo.cam);
}

// 골디의 공
const ballMesh = (() => { const g = new THREE.Group(); g.add(ball(0.24, 0xd8f04a, { rough: 0.6 })); const seam = mesh(new THREE.TorusGeometry(0.235, 0.018, 4, 20), mat(0xffffff)); seam.rotation.x = 1.2; g.add(seam); g.visible = false; scene.add(g); return g; })();
// 바닥 화살표 (주인공 발밑에서 가야 할 쪽을 가리킨다)
const arrow = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.75); sh.lineTo(0.55, 0.1); sh.lineTo(0.2, 0.1); sh.lineTo(0.2, -0.5); sh.lineTo(-0.2, -0.5); sh.lineTo(-0.2, 0.1); sh.lineTo(-0.55, 0.1); sh.closePath();
  const geo = new THREE.ShapeGeometry(sh); geo.rotateX(-Math.PI / 2); geo.rotateY(Math.PI); // 앞쪽이 +z
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false }));
  m.renderOrder = 3; scene.add(m); return m;
})();
// 목표 빛기둥 (멀리서도 보인다)
const beacon = (() => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 12, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
  m.renderOrder = 3; scene.add(m); return m;
})();
const goldieStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), starMat); scene.add(goldieStar); goldieStar.visible = false;
const goldieHit = new THREE.Mesh(GEO.ball, hitMat); goldieHit.position.y = 0.8; goldieHit.scale.setScalar(0.9); goldie.group.add(goldieHit);

// 하트 퐁퐁
const hearts = [];
const heartMat = new THREE.MeshStandardMaterial({ color: 0xff6b8a, emissive: 0xff3366, emissiveIntensity: 0.4, flatShading: true, transparent: true });
const heartGeo = (() => { const s = new THREE.Shape(); s.moveTo(0, -0.12); s.bezierCurveTo(-0.25, 0.05, -0.12, 0.22, 0, 0.1); s.bezierCurveTo(0.12, 0.22, 0.25, 0.05, 0, -0.12); return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }); })();
function spawnHearts(p) {
  for (let i = 0; i < 5; i++) {
    const h = new THREE.Mesh(heartGeo, heartMat.clone()); h.position.copy(p).add(new V3(R(-0.4, 0.4), R(0.2, 0.5), R(-0.4, 0.4)));
    h.userData = { life: 1.6, vy: R(0.6, 1) }; scene.add(h); hearts.push(h);
  }
}
// 물보라 고리 (헤엄칠 때)
const ripples = [];
const rippleGeo = new THREE.RingGeometry(0.35, 0.45, 20);
function spawnRipple(p) {
  const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(p.x, -0.04, p.z); m.renderOrder = 3; scene.add(m); ripples.push({ m, life: 1 });
}

// ───────── 길찾기: 다른 지역은 길목을 거쳐 간다 ─────────
const DOOR = {
  valley: [new V3(0, 0, -26), new V3(0, 0, -45)], beach: [new V3(26, 0, 0), new V3(48, 0, 0)],
  cave: [new V3(-26, 0, 0), new V3(-50, 0, 0)], flat: [new V3(0, 0, 26), new V3(0, 0, 50)], snow: [new V3(60, 0, -18), new V3(60, 0, -42)],
};
function chainOf(r) { const c = []; while (r !== 'forest') { c.unshift(r); r = PARENT[r]; } return c; }
function route(from, to) {
  const a = chainOf(regionAt(from.x, from.z)), b = chainOf(regionAt(to.x, to.z));
  let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
  const pts = [];
  for (let i = a.length - 1; i >= k; i--) pts.push(...[...DOOR[a[i]]].reverse());
  for (let i = k; i < b.length; i++) pts.push(...DOOR[b[i]]);
  pts.push(to);
  return pts.map(p => new V3(p.x, 0, p.z));
}

// ───────── 입력 ─────────
//  손가락을 대고 끌면 그쪽으로 걷는다(조이스틱). 톡 = 그곳으로 걸어가기. 친구를 꾹 = 관찰.
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new V3(0, 1, 0), 0);
let moveQueue = [], pendingCreature = null;
let ptr = null, hold = null, joy = null; // joy: {x0, y0, dx, dy}
const HOLD_SEC = 1.3, JOY_R = 70;
const tapMark = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
tapMark.rotation.x = -Math.PI / 2; tapMark.renderOrder = 3; scene.add(tapMark);

function blocked() { return !playing || cardOpen || talkOpen || !$('#book').classList.contains('hide') || !$('#item').classList.contains('hide') || !$('#settings').classList.contains('hide') || !$('#sumo').classList.contains('hide') || !$('#simon').classList.contains('hide'); }
function setNdc(e) { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); }
function pickCreature() {
  const hits = ray.intersectObjects(creatures.filter(c => c.appear > 0.5).map(c => c.hit), false);
  return hits.length ? hits[0].object.userData.c : null;
}
function pickCloud() {
  const hits = ray.intersectObjects(clouds.filter(c => !c.gone).map(c => c.hit), false);
  return hits.length ? hits[0].object.userData.cloud : null;
}
function flatDist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function nearCreature(c) { return flatDist(boy.group.position, c.stand) < 1.3 || flatDist(boy.group.position, c.anchor) < flatDist(c.stand, c.anchor) + 0.6; }
function isTarget(c) { const m = cur(); return !m || (m.type === 'meet' && m.target === c.id); }

const cvEl = renderer.domElement;
cvEl.addEventListener('pointerdown', e => {
  if (blocked() || ptr) return;
  setNdc(e);
  const cl = pickCloud();
  if (cl) { puffCloud(cl); return; }
  const c = pickCreature();
  const dog = !c && ray.intersectObject(goldieHit, false).length > 0;
  ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), c, dog };
  if (c && !save.found[c.id] && isTarget(c) && nearCreature(c)) { hold = { c, t: 0 }; moveQueue = []; faceTo(c.anchor); }
});
cvEl.addEventListener('pointermove', e => {
  if (!ptr || e.pointerId !== ptr.id || hold || blocked()) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y, d = Math.hypot(dx, dy);
  if (!joy && d > 18) { joy = { x0: ptr.x, y0: ptr.y, dx: 0, dy: 0 }; moveQueue = []; pendingCreature = null; const j = $('#joy'); j.style.left = ptr.x + 'px'; j.style.top = ptr.y + 'px'; j.classList.remove('hide'); }
  if (joy) {
    const k = Math.min(1, JOY_R / Math.max(d, 1));
    joy.dx = dx * k; joy.dy = dy * k;
    $('#joyKnob').style.transform = `translate(${joy.dx}px, ${joy.dy}px)`;
  }
});
// PC 키보드: 방향키·WASD 로 걷기, 스페이스·엔터 = 대화 넘기기
const keys = new Set();
const KEYMAP = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
addEventListener('keydown', e => {
  if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); }
  if ((e.code === 'Space' || e.code === 'Enter') && talkSkip) { e.preventDefault(); talkSkip(); }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
function keyVec() { let x = 0, z = 0; for (const k of keys) { x += KEYMAP[k][0]; z += KEYMAP[k][1]; } return x || z ? { dx: x * 45, dy: z * 45 } : null; }
function endPointer(e, cancelled) {
  if (!ptr || e.pointerId !== ptr.id) return;
  const p = ptr; ptr = null;
  if (joy) { joy = null; $('#joy').classList.add('hide'); $('#joyKnob').style.transform = ''; return; }
  if (hold) { const done = hold.done; hold = null; $('#ring').classList.add('hide'); if (done) return; if (!cancelled && performance.now() - p.t < 400) say(MSG.holdHint, true, 3000); return; }
  if (cancelled || blocked()) return;
  setNdc(e);
  if (p.dog) { tapGoldie(); return; }
  if (p.c) {
    if (save.found[p.c.id] && nearCreature(p.c)) { sfx.tap(); openCard(p.c.id, false, p.c); return; }
    if (!save.found[p.c.id] && !isTarget(p.c)) { say(cur() ? [MSG.notYet, cur().text] : MSG.notYet, true, 4000); return; }
    pendingCreature = p.c; walkTo(p.c.stand.clone()); return;
  }
  const gHit = ray.intersectObject(groundMesh, false)[0];
  const pt = gHit ? gHit.point.clone() : ray.ray.intersectPlane(groundPlane, new V3());
  if (pt) { pendingCreature = null; walkTo(pt); }
}
cvEl.addEventListener('pointerup', e => endPointer(e, false));
cvEl.addEventListener('pointercancel', e => endPointer(e, true));

function walkTo(p) {
  moveQueue = route(boy.group.position, p);
  tapMark.position.set(p.x, Math.max(groundH(p.x, p.z), -0.05) + 0.05, p.z); tapMark.material.opacity = 0.9; tapMark.scale.setScalar(1);
  sfx.tap();
}
let faceAngle = Math.PI;
function faceTo(p) { faceAngle = Math.atan2(p.x - boy.group.position.x, p.z - boy.group.position.z); }

function discover(c) {
  save.found[c.id] = true; persist();
  sfx.chime(); cheer = 1;
  spawnHearts(c.holder.getWorldPosition(new V3()));
  setTimeout(() => openCard(c.id, true, c), 700);
}
function tapGoldie() {
  if (cur() && cur().type === 'fetch' && fetchState.step === 'carry') { throwBall(); return; }
  sfx.bark(); spawnHearts(goldie.group.position.clone().setY(1.4)); gState.wag = 1.5;
  say(MSG.pet[Math.floor(Math.random() * MSG.pet.length)], true, 1800);
}
function throwBall() {
  const fwd = new V3(goldie.group.position.x - boy.group.position.x, 0, goldie.group.position.z - boy.group.position.z).normalize();
  let to = null;
  for (let d = 7.5; d > 1.5; d -= 1) { const p = boy.group.position.clone().addScaledVector(fwd, d); if (walkable(p.x, p.z) && !isWater(p.x, p.z)) { to = p; break; } }
  if (!to) to = goldie.group.position.clone();
  collide(to, 0.4); to.y = 0.25;
  fetchState.step = 'thrown'; fetchState.t = 0; fetchState.from.copy(ballMesh.position); fetchState.to.copy(to);
  faceTo(to); cheer = 0.6; sfx.pop(); say(MSG.ballThrow, true, 2500);
}

// ───────── 골디: 미션 길안내 + 공 물어 오기 ─────────
const gState = { idle: 0, barkCool: 8, wag: 0 };
function goldieThink(dt) {
  gState.barkCool -= dt; gState.wag = Math.max(0, gState.wag - dt);
  const g = missionGoal();
  if (g && gState.barkCool < 0 && gState.idle > 8 && flatDist(boy.group.position, g.pos) > 4 && !blocked()) {
    sfx.bark(); say(MSG.barkCall, true, 3500); gState.barkCool = 16;
  }
}
function goldieGoal() {
  const bp = boy.group.position;
  const m = cur();
  if (m && m.type === 'fetch') {
    if (fetchState.step === 'thrown' || fetchState.step === 'chase') return { p: ballMesh.position, stopAt: 0.5, speed: 8, look: ballMesh.position };
    if (fetchState.step === 'return') return { p: bp, stopAt: 1.3, speed: 6, look: bp };
  }
  const g = missionGoal();
  if (g) {
    const d = flatDist(bp, g.pos);
    if (d > 4) { // 주인공보다 몇 걸음 앞에서 길을 보여 준다
      const next = route(bp, g.pos)[0];
      const dir = new V3(next.x - bp.x, 0, next.z - bp.z).normalize();
      return { p: bp.clone().addScaledVector(dir, Math.min(3.2, Math.max(1.5, flatDist(bp, next)))).add(new V3(dir.z, 0, -dir.x).multiplyScalar(0.8)), stopAt: 0.4, speed: 7, look: next };
    }
    const dir = new V3(g.pos.x - g.look.x, 0, g.pos.z - g.look.z); if (dir.lengthSq() < 0.01) dir.set(0, 0, 1); dir.normalize();
    return { p: g.pos.clone().add(new V3(-dir.z, 0, dir.x).multiplyScalar(1.3)), stopAt: 0.4, speed: 6, look: g.look };
  }
  return { p: bp.clone().add(new V3(1.4, 0, -0.3)), stopAt: 1.0, speed: 7, look: bp };
}
function updateFetch(dt) {
  const m = cur(); if (!m || m.type !== 'fetch') return;
  const bp = boy.group.position, gp = goldie.group.position;
  if (fetchState.step === 'find') {
    ballMesh.position.y = 0.25 + Math.abs(Math.sin(clock.elapsedTime * 2)) * 0.15;
    if (flatDist(bp, ballMesh.position) < 1.5) { fetchState.step = 'carry'; sfx.pop(); say(MSG.ballFound, true, 5000); }
  } else if (fetchState.step === 'carry') {
    const f = new V3(Math.sin(boy.group.rotation.y), 0, Math.cos(boy.group.rotation.y));
    ballMesh.position.copy(bp).addScaledVector(f, 0.45).setY(0.75 + bp.y);
  } else if (fetchState.step === 'thrown') {
    fetchState.t = Math.min(1, fetchState.t + dt / 0.9);
    ballMesh.position.lerpVectors(fetchState.from, fetchState.to, fetchState.t);
    ballMesh.position.y += Math.sin(fetchState.t * Math.PI) * 3;
    ballMesh.rotation.x += dt * 8;
    if (fetchState.t >= 1) fetchState.step = 'chase';
  } else if (fetchState.step === 'chase') {
    if (flatDist(gp, ballMesh.position) < 0.7) { fetchState.step = 'return'; sfx.bark(); }
  } else if (fetchState.step === 'return') {
    const f = new V3(Math.sin(goldie.group.rotation.y), 0, Math.cos(goldie.group.rotation.y));
    ballMesh.position.copy(gp).addScaledVector(f, 0.85).setY(0.85);
    if (flatDist(gp, bp) < 1.7) {
      fetchState.step = 'done'; ballMesh.visible = false; persist();
      spawnHearts(gp.clone().setY(1.3)); gState.wag = 3;
      say(MSG.ballDone, true, 4000);
      setTimeout(() => completeMission(), 3800);
    }
  }
}

// ───────── 이동·충돌 ─────────
function collide(p, r) {
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
    if (d < min && d > 0.0001) { p.x = c.x + dx / d * min; p.z = c.z + dz / d * min; }
  }
}
function turnToward(obj, ang, dt, k = 10) {
  let d = ang - obj.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
  obj.rotation.y += d * Math.min(1, dt * k);
}
let lockedCool = 0;
function nearLockedGate(p) { return Object.values(gates).some(g => !g.open && flatDist(p, g.pos) < 7); }

// ───────── 나무 뒤에 숨어도 보이게: 가려지면 노란 실루엣이 비친다 ─────────
function addXray(group, color, opacity = 0.5) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false });
  const list = []; group.traverse(o => { if (o.isMesh && o.material.visible !== false && !o.material.transparent) list.push(o); });
  const ghosts = [];
  for (const o of list) { const g = new THREE.Mesh(o.geometry, m); g.renderOrder = 20; g.raycast = () => {}; g.visible = false; o.add(g); ghosts.push(g); }
  group.userData.ghosts = ghosts;
  return ghosts;
}
function setGhost(group, on) { const gs = group.userData.ghosts; if (gs && gs[0] && gs[0].visible !== on) gs.forEach(g => g.visible = on); }
const segTmp = new V3();
function occluded(p) { // 카메라와 p 사이에 나무 잎·줄기가 있나
  const a = camera.position, ab = segTmp.subVectors(p, a), L = ab.length(); ab.divideScalar(L);
  for (const o of occluders) {
    if (Math.abs(o.c.x - p.x) > 16 || Math.abs(o.c.z - p.z) > 16) continue;
    const t = (o.c.x - a.x) * ab.x + (o.c.y - a.y) * ab.y + (o.c.z - a.z) * ab.z;
    if (t < 0 || t > L - 0.4) continue;
    const dx = a.x + ab.x * t - o.c.x, dy = a.y + ab.y * t - o.c.y, dz = a.z + ab.z * t - o.c.z;
    if (dx * dx + dy * dy + dz * dz < o.r * o.r * 0.8) return true;
  }
  return false;
}
addXray(boy.group, 0x5b8cff, 0.45);
for (const c of creatures) addXray(c.made.group, 0xffd23f, 0.6);
addXray(smogi.group, 0xb08cff, 0.5);

// ───────── 미니맵 (왼쪽 위, 나를 가운데에 두고 위쪽이 화면 안쪽) ─────────
const mini = $('#mini'), mctx = mini.getContext('2d');
const MV = 30;                                  // 미니맵이 보여 주는 반지름 (월드 단위)
const MB = { x0: -92, x1: 100, z0: -85, z1: 92, ppu: 4 }; // 밑그림 범위·해상도
let miniSize = 0;
const miniBase = document.createElement('canvas');
function buildMiniBase() {
  miniBase.width = (MB.x1 - MB.x0) * MB.ppu; miniBase.height = (MB.z1 - MB.z0) * MB.ppu;
  const b = miniBase.getContext('2d'), k = MB.ppu;
  const X = x => (x - MB.x0) * k, Z = z => (z - MB.z0) * k;
  const rect = (r, c) => { b.fillStyle = c; b.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * k, (r.z1 - r.z0) * k); };
  b.fillStyle = '#3f7a33'; b.fillRect(0, 0, miniBase.width, miniBase.height);   // 숲 언덕
  b.fillStyle = '#3fa9d6'; b.fillRect(X(SEA_X), 0, miniBase.width, miniBase.height);
  rect(BEACH, '#f1dca6'); rect({ x0: 60, x1: SEA_X, z0: -40, z1: 40 }, '#f1dca6');
  b.fillStyle = '#5aa6c4'; b.fillRect(X(-60), Z(FLAT_SEA_Z), 120 * k, miniBase.height);
  rect(VALLEY, '#a7d97f'); rect(STREAM, '#6cc3e6');
  rect(CAVE, '#7a7066'); rect(FLAT, '#9a8a70'); rect(SNOW, '#eef3f8');
  for (const r of ['cave', 'flat', 'snow']) rect(PATH[r], '#d9c08a');
  rect(PATH.valley, '#d9c08a'); rect(PATH.beach, '#d9c08a');
  b.fillStyle = '#a7d97f'; b.beginPath(); b.arc(X(0), Z(0), FOREST_R * k, 0, 7); b.fill();
  b.fillStyle = '#5fb3d9'; b.beginPath(); b.arc(X(SPOT.pond.x), Z(SPOT.pond.z), 3.2 * k, 0, 7); b.fill();
  b.beginPath(); b.arc(X(SPOT.pool.x), Z(SPOT.pool.z), 2 * k, 0, 7); b.fill();
  b.fillStyle = '#8a8f88'; b.beginPath(); b.arc(X(SPOT.seaBoss.x), Z(SPOT.seaBoss.z), 1.8 * k, 0, 7); b.fill();
  b.fillStyle = '#8a5a2b'; b.fillRect(X(SPOT.log.x - 0.5), Z(SPOT.log.z - 1.3), k, 2.6 * k);
  for (const c of colliders) {
    if (c.r > 1.5 || !walkable(c.x, c.z + 0.01) && Math.hypot(c.x, c.z) > FOREST_R) continue;
    b.fillStyle = c.r > 0.7 ? '#2f6b2a' : '#3f7f35';
    b.beginPath(); b.arc(X(c.x), Z(c.z), Math.max(2.5, c.r * k * 1.6), 0, 7); b.fill();
  }
}
buildMiniBase();
function drawMini(t) {
  const css = mini.clientWidth || 160, dpr = Math.min(devicePixelRatio, 2);
  if (css !== miniSize) { miniSize = css; mini.width = css * dpr; mini.height = css * dpr; mctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  const h = miniSize / 2, s = (h - 3) / MV, bp = boy.group.position;
  const M = (x, z) => [h + (x - bp.x) * s, h + (z - bp.z) * s];
  mctx.clearRect(0, 0, miniSize, miniSize);
  mctx.save(); mctx.beginPath(); mctx.arc(h, h, h, 0, 7); mctx.clip();
  mctx.fillStyle = '#3f7a33'; mctx.fillRect(0, 0, miniSize, miniSize);
  mctx.drawImage(miniBase, (bp.x - MV - MB.x0) * MB.ppu, (bp.z - MV - MB.z0) * MB.ppu, MV * 2 * MB.ppu, MV * 2 * MB.ppu, h - MV * s, h - MV * s, MV * 2 * s, MV * 2 * s);
  if (nightK > 0.01) { mctx.fillStyle = `rgba(20,30,70,${nightK * 0.45})`; mctx.fillRect(0, 0, miniSize, miniSize); }
  mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
  mctx.font = `${Math.round(miniSize * 0.12)}px sans-serif`;
  for (const g of Object.values(gates)) if (!g.open) { const [x, y] = M(g.pos.x, g.pos.z); mctx.fillText('🔒', x, y); }
  for (const a of Object.values(actors)) if (a.state !== 'off') { const [x, y] = M(a.pos.x, a.pos.z); mctx.fillText(a.icon, x, y); }
  mctx.font = `${Math.round(miniSize * 0.1)}px sans-serif`;
  for (const c of creatures) if (save.found[c.id] && c.appear > 0.5) { const [x, y] = M(c.anchor.x, c.anchor.z); mctx.fillText(c.def.emoji, x, y); }
  for (const it of items) if (!it.got) { const [x, y] = M(it.pos.x, it.pos.z); mctx.fillStyle = '#ffd23f'; mctx.beginPath(); mctx.arc(x, y, miniSize * 0.025, 0, 7); mctx.fill(); }
  // 미션 목표: 미니맵 밖이면 가장자리에 붙여 방향을 알려 준다
  const goal = missionGoal();
  if (goal) {
    let [x, y] = M(goal.look.x, goal.look.z);
    const dx = x - h, dy = y - h, dd = Math.hypot(dx, dy), lim = h - miniSize * 0.08;
    if (dd > lim) { x = h + dx / dd * lim; y = h + dy / dd * lim; }
    const r = miniSize * (0.06 + 0.012 * Math.sin(t * 3));
    mctx.fillStyle = '#ffd23f'; mctx.strokeStyle = '#c47a00'; mctx.lineWidth = 2;
    mctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; mctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    mctx.closePath(); mctx.fill(); mctx.stroke();
  }
  const [gx, gy] = M(goldie.group.position.x, goldie.group.position.z);
  mctx.fillStyle = '#e2a554'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(gx, gy, miniSize * 0.03, 0, 7); mctx.fill(); mctx.stroke();
  const a = boy.group.rotation.y, sz = miniSize * 0.055;
  mctx.save(); mctx.translate(h, h); mctx.rotate(-a + Math.PI);
  mctx.fillStyle = '#2f6fe0'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(0, -sz * 1.2); mctx.lineTo(sz * 0.85, sz * 0.8); mctx.lineTo(0, sz * 0.35); mctx.lineTo(-sz * 0.85, sz * 0.8); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
  mctx.restore();
}

// ───────── 날씨: 2부엔 먹구름·비, 눈 덮인 산엔 눈 (깜빡임 없이 천천히) ─────────
const STORM_FROM = MISSIONS.findIndex(m => m.storm);
const rain = (() => {
  const n = 420, p = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) { const x = R(-24, 24), y = R(0, 16), z = R(-28, 16); p.set([x, y, z, x - 0.08, y + 0.7, z], i * 6); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc8d4e6, transparent: true, opacity: 0, depthWrite: false })); l.frustumCulled = false; scene.add(l); return l;
})();
const flakes = (() => {
  const n = 380, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) p.set([R(-24, 24), R(0, 14), R(-28, 16)], i * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0, depthWrite: false })); pts.frustumCulled = false; scene.add(pts); return pts;
})();
let snowK = 0, lastStorm = -1;
function updateWeather(dt, t, rNow) {
  const want = STORM_FROM >= 0 && step >= STORM_FROM && step <= KING_IDX ? 1 : 0;
  stormK += (want - stormK) * Math.min(1, dt * 0.5);
  if (Math.abs(stormK - lastStorm) > 0.01) { lastStorm = stormK; applyTime(nightK); }
  const bp = boy.group.position;
  const rainOn = stormK * (rNow === 'cave' || rNow === 'snow' ? 0 : 1);
  rain.material.opacity += (rainOn * 0.35 - rain.material.opacity) * Math.min(1, dt * 2);
  rain.visible = rain.material.opacity > 0.01;
  if (rain.visible) {
    rain.position.set(bp.x, bp.y, bp.z);
    const a = rain.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i += 6) { a[i + 1] -= dt * 14; a[i + 4] -= dt * 14; if (a[i + 1] < 0) { a[i + 1] += 16; a[i + 4] += 16; } }
    rain.geometry.attributes.position.needsUpdate = true;
  }
  snowK += ((rNow === 'snow' ? 1 : 0) - snowK) * Math.min(1, dt * 1.5);
  flakes.material.opacity = snowK * 0.9; flakes.visible = snowK > 0.02;
  if (flakes.visible) {
    flakes.position.set(bp.x, bp.y, bp.z);
    const a = flakes.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) { a[i + 1] -= dt * 1.3; a[i] += Math.sin(t + i) * dt * 0.3; if (a[i + 1] < 0) a[i + 1] += 14; }
    flakes.geometry.attributes.position.needsUpdate = true;
  }
  rainbow.visible = step > KING_IDX && KING_IDX >= 0;
  if (rainbow.visible) rainbow.position.set(bp.x + 10, 0, bp.z - 70);
}
// 대마왕을 물리치면 뜨는 무지개
const rainbow = (() => {
  const g = new THREE.Group();
  [0xff4d4d, 0xff9f43, 0xffd23f, 0x5cd65c, 0x4da6ff, 0x5b5bd6, 0xa45bd6].forEach((c, i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(40 - i * 1.4, 0.7, 6, 48, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, fog: false, depthWrite: false }));
    g.add(r);
  });
  g.visible = false; scene.add(g); return g;
})();

// ───────── 박쥐 메아리 놀이 (소리 듣고 똑같이 누르기) ─────────
const SIMON_NOTES = [523, 659, 784, 988];
let simon = null;
function openSimon() { $('#simon').classList.remove('hide'); simon = { round: 0, seq: [], input: [], busy: true }; nextSimonRound(); }
function flashBtn(i) { const b = document.querySelectorAll('.sb')[i]; b.classList.add('lit'); tone(SIMON_NOTES[i], 0.4, 'triangle', 0.22); setTimeout(() => b.classList.remove('lit'), 420); }
async function playSimon() {
  simon.busy = true; simon.input = [];
  $('#simonMsg').textContent = MSG.simonListen; speak(MSG.simonListen);
  await sleep(1600);
  for (const i of simon.seq) { flashBtn(i); await sleep(750); }
  $('#simonMsg').textContent = MSG.simonYou; speak(MSG.simonYou);
  simon.busy = false;
}
function nextSimonRound() {
  simon.round++;
  $('#simonRound').textContent = `${Math.min(simon.round, 3)} / 3`;
  if (simon.round > 3) {
    simon.busy = true; sfx.chime();
    setTimeout(() => { $('#simon').classList.add('hide'); completeMission(); }, 1200);
    return;
  }
  simon.seq = Array.from({ length: simon.round + 1 }, () => Math.floor(Math.random() * 4));
  playSimon();
}
document.querySelectorAll('.sb').forEach((b, i) => b.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!simon || simon.busy) return;
  flashBtn(i); simon.input.push(i);
  const k = simon.input.length - 1;
  if (simon.seq[k] !== i) { simon.busy = true; $('#simonMsg').textContent = MSG.simonRetry; speak(MSG.simonRetry); setTimeout(playSimon, 1500); return; }
  if (simon.input.length === simon.seq.length) { simon.busy = true; $('#simonMsg').textContent = MSG.simonGood; speak(MSG.simonGood); setTimeout(nextSimonRound, 1500); }
}));

// ───────── 메인 루프 ─────────
const UP = new V3(0, 1, 0);
let camY = 0, detour = 0, detourSide = 1, stuck = 0, region = 'forest', swimPh = 0, rippleCool = 0;
let playing = false, cheer = 0, walkPh = 0, gWalkPh = 0, cicadaCool = 3;
const clock = new THREE.Clock();
const tmpV = new V3();
// 한 걸음: dir 방향(정규화)으로 step 만큼. 막히면 false
function stepMove(p, dir, step, r) {
  const before = p.clone();
  p.addScaledVector(dir, step); collide(p, r);
  if (!walkable(p.x, p.z)) { // 가장자리에선 미끄러지듯 따라간다
    p.copy(before);
    const sx = before.clone(); sx.x += dir.x * step; if (walkable(sx.x, sx.z)) p.copy(sx);
    else { const sz = before.clone(); sz.z += dir.z * step; if (walkable(sz.x, sz.z)) p.copy(sz); }
  }
  return flatDist(p, before) >= step * 0.35;
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const bp = boy.group.position;

  // 낮·밤 천천히 (깜빡임 없이)
  if (Math.abs(nightK - nightTarget) > 0.001) { nightK += Math.sign(nightTarget - nightK) * Math.min(dt / 4, Math.abs(nightTarget - nightK)); applyTime(nightK); }

  // 길막이 내려가기
  for (const g of Object.values(gates)) if (g.opening) { g.k = Math.max(0, g.k - dt / 1.8); g.mesh.position.y = (g.k - 1) * 2.2; if (g.k <= 0) { g.opening = false; g.mesh.visible = false; } }

  // 주인공 이동: 끌기(조이스틱) 또는 톡 한 곳까지
  const inWater = isWater(bp.x, bp.z);
  const speed = inWater ? 3.8 : 5.5;
  let moving = false;
  lockedCool -= dt;
  const kv = keyVec(); if (kv) { moveQueue = []; pendingCreature = null; }
  const stick = joy || kv;
  if (stick && playing && !blocked()) {
    const len = Math.hypot(stick.dx, stick.dy);
    if (len > 8) {
      const dir = new V3(stick.dx, 0, stick.dy).normalize();
      const ok = stepMove(bp, dir, speed * Math.min(1, len / 45) * dt, 0.4);
      faceAngle = Math.atan2(dir.x, dir.z); moving = true;
      if (!ok && nearLockedGate(bp) && lockedCool < 0) { say(MSG.locked, true, 3500); lockedCool = 6; }
    }
  } else if (moveQueue.length && playing) {
    const target = moveQueue[0];
    tmpV.subVectors(target, bp).setY(0);
    const d = tmpV.length();
    if (d > (moveQueue.length > 1 ? 0.8 : 0.12)) {
      const step = Math.min(d, speed * dt); tmpV.normalize();
      if (detour > 0) { detour -= dt; tmpV.applyAxisAngle(UP, detourSide * 1.1); }
      const ok = stepMove(bp, tmpV, step, 0.4);
      faceAngle = Math.atan2(tmpV.x, tmpV.z); moving = true;
      // 나무에 막히면 옆으로 비켜 돌아간다, 오래 막히면 멈춤
      if (!ok) {
        stuck += dt; if (detour <= 0) { detour = 0.45; detourSide = -detourSide; }
        if (stuck > 2.2) { moveQueue = []; stuck = 0; pendingCreature = null; if (nearLockedGate(bp) && lockedCool < 0) { say(MSG.locked, true, 3500); lockedCool = 6; } }
      } else stuck = Math.max(0, stuck - dt);
    } else moveQueue.shift();
    if (!moveQueue.length && pendingCreature) {
      const c = pendingCreature; pendingCreature = null; faceTo(c.anchor);
      if (!save.found[c.id] && nearCreature(c)) say(c.def.arrive, true, 3500);
    }
  }
  // 가만히 있으면 화면 쪽을 돌아본다 (얼굴 보이게)
  if (!moving && !hold && gState.idle > 2.5 && !pendingCreature && !inWater) turnToward(boy.group, 0, dt, 2.5);
  else turnToward(boy.group, faceAngle, dt);
  gState.idle = moving || hold ? 0 : gState.idle + dt;

  // 지역에 들어서면 알려 준다 / 물에 처음 들어가면 알려 준다
  const rNow = regionAt(bp.x, bp.z);
  if (rNow !== region && playing) { region = rNow; if (!blocked()) say(REGIONS[region].enter, true, 3000); }
  if (inWater && !save.swimTold && playing && !blocked()) { save.swimTold = true; persist(); say(MSG.swim, true, 3000); sfx.splash(); }
  updateSat();

  // 주인공 몸짓 (걷기 / 헤엄)
  const sw = moving ? 1 : 0;
  if (inWater) {
    swimPh += dt * (moving ? 7 : 2.5);
    boy.arms[0].rotation.x = -1.6 + Math.sin(swimPh) * 1.4; boy.arms[1].rotation.x = -1.6 - Math.sin(swimPh) * 1.4;
    boy.legs[0].rotation.x = Math.sin(swimPh * 2) * 0.4; boy.legs[1].rotation.x = -Math.sin(swimPh * 2) * 0.4;
    rippleCool -= dt; if (rippleCool < 0) { spawnRipple(bp); rippleCool = moving ? 0.35 : 1.1; }
  } else {
    walkPh += dt * (moving ? 11 : 0);
    const s1 = moving ? Math.sin(walkPh) : 0;
    boy.legs[0].rotation.x = s1 * 0.6; boy.legs[1].rotation.x = -s1 * 0.6;
    boy.arms[0].rotation.x = -s1 * 0.5; boy.arms[1].rotation.x = s1 * 0.5;
  }
  let by = inWater ? -0.62 + Math.sin(t * 2) * 0.04 : groundH(bp.x, bp.z) + (moving ? Math.abs(Math.sin(walkPh)) * 0.06 : Math.sin(t * 2) * 0.01);
  if (cheer > 0 && !inWater) { cheer = Math.max(0, cheer - dt * 1.2); by += Math.sin((1 - cheer) * Math.PI * 2) ** 2 * 0.35 * cheer; boy.arms.forEach(a => a.rotation.x = -2.6 * cheer); }
  boy.group.position.y += (by - boy.group.position.y) * Math.min(1, dt * 8);
  boy.head.rotation.x = hold ? 0.25 : (inWater ? -0.2 : 0);
  boy.group.scale.y = hold ? 0.9 : 1; // 살금살금 웅크리기
  void sw;

  // 꾹 관찰
  if (hold && !hold.done) {
    hold.t += dt;
    const k = Math.min(1, hold.t / HOLD_SEC);
    const sp = hold.c.holder.getWorldPosition(new V3()).project(camera);
    const ring = $('#ring'); ring.classList.remove('hide');
    ring.style.left = ((sp.x + 1) / 2 * innerWidth) + 'px'; ring.style.top = ((1 - sp.y) / 2 * innerHeight) + 'px';
    $('#ringFg').style.strokeDashoffset = 251.3 * (1 - k);
    if (k >= 1) { hold.done = true; ring.classList.add('hide'); discover(hold.c); }
  }

  // 골디
  goldieThink(dt); updateFetch(dt);
  const gg = goldieGoal(), gp = goldie.group.position;
  tmpV.subVectors(gg.p, gp).setY(0);
  const gd = tmpV.length();
  let gMoving = false;
  const gWater = isWater(gp.x, gp.z);
  if (gd > gg.stopAt) {
    const sp = Math.min(gg.speed * (gWater ? 0.75 : 1), 2 + gd * 2.2) * dt; tmpV.normalize();
    const gy = gp.y; stepMove(gp, tmpV, Math.min(sp, gd), 0.45); gp.y = gy;
    if (gd > 14) gp.copy(bp).add(new V3(1.4, 0, 0.6)); // 너무 멀어지면 옆으로 데려온다
    turnToward(goldie.group, Math.atan2(tmpV.x, tmpV.z), dt, 8); gMoving = true;
  } else {
    turnToward(goldie.group, Math.atan2(gg.look.x - gp.x, gg.look.z - gp.z), dt, 4);
  }
  gWalkPh += dt * (gMoving ? 13 : 0);
  goldie.legs.forEach((l, i) => l.rotation.x = gMoving ? Math.sin(gWalkPh + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.6 : 0);
  goldie.tail.rotation.y = Math.sin(t * (gState.wag > 0 ? 18 : 8)) * 0.6;
  goldie.head.rotation.z = gMoving ? 0 : Math.sin(t * 1.3) * 0.12;
  goldie.ears.forEach((e, i) => e.rotation.x = gMoving ? Math.sin(gWalkPh + i) * 0.25 : 0);
  const gyT = gWater ? -0.55 : groundH(gp.x, gp.z) + (gMoving ? Math.abs(Math.sin(gWalkPh)) * 0.05 : 0);
  gp.y += (gyT - gp.y) * Math.min(1, dt * 8);

  // 친구들
  const tgt = cur() && cur().type === 'meet' ? byId(cur().target) : null;
  for (const c of creatures) {
    const want = c.def.time === 'night' ? nightK : 1;
    c.appear += (want - c.appear) * Math.min(1, dt * 2);
    c.holder.visible = c.appear > 0.02;
    if (c.def.time === 'night') c.holder.scale.setScalar(Math.max(0.001, c.appear));
    if (c.hop > 0) { c.hop = Math.max(0, c.hop - dt); c.made.group.position.y = Math.sin(c.hop * Math.PI * 3) ** 2 * 0.15; }
    c.update(c, dt, t);
    const show = !save.found[c.id] && isTarget(c) && c.appear > 0.6 && playing;
    c.star.visible = show;
    if (show) { c.holder.getWorldPosition(c.star.position); c.star.position.y = Math.max(c.star.position.y, 0) + 0.85 + Math.sin(t * 2 + c.anchor.x) * 0.1; c.star.rotation.y = t * 1.2; }
  }
  // 나무 뒤에 숨은 미션 친구·주인공은 실루엣으로 비친다
  if (tgt) setGhost(tgt.made.group, tgt.appear > 0.6 && occluded(tgt.holder.getWorldPosition(tmpV.clone())));
  for (const c of creatures) if (c !== tgt) setGhost(c.made.group, false);
  setGhost(boy.group, occluded(bp.clone().setY(bp.y + 1)));
  goldieStar.visible = !!(playing && cur() && cur().type === 'fetch' && fetchState.step === 'carry');
  if (goldieStar.visible) { goldieStar.position.copy(gp).setY(1.9 + Math.sin(t * 2) * 0.1); goldieStar.rotation.y = t * 1.2; }

  // 동굴 속에 들어가면 지붕이 사라지고, 어둡고, 주인공 둘레가 은은히 밝다
  const inCave = rNow === 'cave' || (inRect(PATH.cave, bp.x, bp.z) && bp.x < -38);
  caveK += ((inCave ? 1 : 0) - caveK) * Math.min(1, dt * 2.5);
  caveRoofMat.opacity = 1 - caveK; caveRoof.visible = caveRoofMat.opacity > 0.03; caveRoofMat.depthWrite = caveK < 0.1;
  glow.intensity = Math.max(nightK * 6, caveK * 9);
  updateWeather(dt, t, rNow);

  // 미니게임·악당
  updateItems(dt, t); updateClouds(dt, t); updateSumo(dt, t);
  if (smogiHurt > 0) smogiHurt = Math.max(0, smogiHurt - dt * 0.6);
  const bossWho = cur() && cur().type === 'boss' ? (cur().villain || 'smogi') : null;
  for (const [who, v] of Object.entries(actors)) {
    if (v.state === 'off') continue;
    const sg = v.made.group;
    if (v.state === 'come') { v.k = Math.min(1, v.k + dt / 1.2); if (v.k >= 1) v.state = 'here'; }
    if (v.state === 'leave') { v.k = Math.max(0, v.k - dt / 1.5); if (v.k <= 0) { v.state = 'off'; sg.visible = false; continue; } }
    const e = v.k * v.k * (3 - 2 * v.k);
    sg.position.set(v.pos.x, Math.max(0, groundH(v.pos.x, v.pos.z)) + v.h + (1 - e) * 9 + Math.sin(t * 1.6) * 0.18, v.pos.z + (v.dz || 0));
    sg.scale.setScalar((v.scale || 1) * (0.4 + e * 0.6));
    sg.rotation.y = Math.atan2(bp.x - v.pos.x, bp.z - v.pos.z);
    const m = v.made;
    if (m.wand) m.wand.rotation.z = Math.sin(t * 3) * 0.3;
    const hurt = bossWho === who ? smogiHurt : 0;
    if (m.body) m.body.rotation.z = Math.sin(t * 18) * 0.12 * hurt; else sg.rotation.z = Math.sin(t * 12) * 0.05 * hurt;
    // 친구가 되면 눈썹이 순해진다
    const kind = who === 'smogi' ? step > P1END : who === 'jjiri' ? step > JJIRI_END : false;
    if (m.brows) m.brows.forEach(({ b, s }) => b.rotation.z = (kind ? 0.35 : -0.45) * s);
    setGhost(sg, occluded(sg.position));
    // 대화가 끝나고 할 일이 없으면 날아간다
    if (v.state === 'here' && !talkOpen && bossWho !== who) villainLeave(who);
  }
  if (stormShow > 0) { storm.visible = true; storm.position.set(bp.x + 6, 22, bp.z - 45); storm.scale.setScalar(Math.min(1, (storm.scale.x || 0.01) + dt * 0.4)); }
  else if (storm.visible) { storm.scale.multiplyScalar(1 - dt * 1.5); if (storm.scale.x < 0.05) storm.visible = false; }

  // 매미 소리: 가까이 가면 가끔 맴맴
  cicadaCool -= dt;
  const cic = byId('cicada');
  if (playing && cicadaCool < 0 && flatDist(bp, cic.anchor) < 11 && nightK < 0.5) { sfx.cicada(); cic.buzzing = 0.9; cicadaCool = R(4, 7); }

  // 길안내: 발밑 화살표(다음 길목 쪽) + 목표 빛기둥
  const goal = blocked() ? null : missionGoal();
  const gdist = goal ? flatDist(bp, goal.pos) : 0;
  arrow.visible = !!goal && gdist > 3;
  if (arrow.visible) {
    const next = route(bp, goal.pos)[0];
    const ang = Math.atan2(next.x - bp.x, next.z - bp.z);
    const ax = bp.x + Math.sin(ang) * 1.5, az = bp.z + Math.cos(ang) * 1.5;
    arrow.position.set(ax, inWater ? 0.02 : groundH(ax, az) + 0.08, az);
    arrow.rotation.y = ang; arrow.material.opacity = 0.6 + 0.25 * Math.sin(t * 2.5);
  }
  beacon.visible = !!goal && gdist > 2.5;
  if (beacon.visible) { beacon.position.set(goal.look.x, Math.max(0, groundH(goal.look.x, goal.look.z)) + 6, goal.look.z); beacon.material.opacity = 0.16 + 0.07 * Math.sin(t * 1.5); }

  // 하트·물보라·탭 표시·반딧불이·물결·갈매기·폭포
  for (let i = hearts.length - 1; i >= 0; i--) {
    const hh = hearts[i]; hh.userData.life -= dt; hh.position.y += hh.userData.vy * dt; hh.rotation.y += dt * 2;
    hh.material.opacity = Math.min(1, hh.userData.life);
    if (hh.userData.life <= 0) { scene.remove(hh); hh.material.dispose(); hearts.splice(i, 1); }
  }
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i]; r.life -= dt * 0.9; r.m.scale.setScalar(1 + (1 - r.life) * 2.2); r.m.material.opacity = Math.max(0, r.life) * 0.5;
    if (r.life <= 0) { scene.remove(r.m); r.m.material.dispose(); ripples.splice(i, 1); }
  }
  if (tapMark.material.opacity > 0) { tapMark.material.opacity = Math.max(0, tapMark.material.opacity - dt * 1.5); tapMark.scale.multiplyScalar(1 + dt * 0.8); }
  for (const f of fireflies) {
    const u = f.userData;
    f.position.set(u.x + Math.sin(t * u.sp + u.ph) * 1.2, u.y + Math.sin(t * u.sp * 1.7 + u.ph) * 0.4, u.z + Math.cos(t * u.sp * 0.8 + u.ph) * 1.2);
    f.material.opacity = nightK * (0.45 + 0.4 * Math.sin(t * 0.9 + u.ph)); // 느린 숨쉬기 (깜빡임 금지)
    f.visible = nightK > 0.02;
  }
  foam.position.x = SEA_X + 0.3 + Math.sin(t * 0.6) * 0.7; foam.material.opacity = 0.35 + 0.25 * Math.sin(t * 0.6 + 1);
  sea.position.y = -0.12 + Math.sin(t * 0.6) * 0.04;
  fallTex.offset.y = (fallTex.offset.y + dt * 0.6) % 1;
  for (const g of gulls) { const u = g.userData, a = t * u.sp + u.ph; g.position.set(u.cx + Math.cos(a) * u.r, u.h + Math.sin(t * 0.7 + u.ph) * 0.3, u.cz + Math.sin(a) * u.r); g.rotation.y = -a + (u.sp > 0 ? 0 : Math.PI); g.children[0].rotation.z = 0.35 + Math.sin(t * 3 + u.ph) * 0.2; g.children[1].rotation.z = -0.35 - Math.sin(t * 3 + u.ph) * 0.2; }

  // 카메라·그림자 따라가기
  const off = CAM_OFF.clone().multiplyScalar(camDist);
  camY += (Math.max(0, groundH(bp.x, bp.z)) - camY) * Math.min(1, dt * 3);
  camera.position.lerp(tmpV.copy(bp).setY(camY).add(off), Math.min(1, dt * 4));
  camera.lookAt(camera.position.x - off.x, camY + 1.6, camera.position.z - off.z - camAhead);
  sun.position.set(bp.x + 12, 22, bp.z + 8); sun.target.position.set(bp.x, 0, bp.z);

  renderer.render(scene, camera);
  drawMini(t);
  if (cardOpen && cardSpin) { cardSpin.rotation.y += dt * 0.6; sizeCard(); cardR.render(cardScene, cardCam); }
}
// 처음 카메라 위치
camera.position.copy(boy.group.position).add(CAM_OFF);
frame();

// ───────── 시작·설정 ─────────
refreshHud();
$('#startBtn').onclick = () => {
  initAudio(); sfx.pop(); preloadVoices();
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.speak(new SpeechSynthesisUtterance('')); } // iOS 음성 잠금 풀기
  $('#title').classList.add('hide'); playing = true;
  if (!save.found.goldie) {
    goldie.group.position.set(-6, 0, 2);
    setTimeout(() => { sfx.bark(); say(MSG.dogComing, true, 2200); }, 400);
    setTimeout(() => { save.found.goldie = true; persist(); sfx.chime(); cardBookId = 'goldie'; openCard('goldie', true, null); }, 2600);
  } else if (save.done) say(MSG.backDone);
  else { speak(MSG.back); setTimeout(() => startMission(), 2600); }
};
// 부모용 설정: 톱니를 1초 꾹
let gearT = 0;
$('#gear').addEventListener('pointerdown', () => { gearT = setTimeout(openSettings, 1000); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('#gear').addEventListener(ev, () => clearTimeout(gearT)));
function paintSettings() {
  $('#setVoice').textContent = save.voice ? '🗣️ 읽어 주기: 켬' : '🗣️ 읽어 주기: 끔';
  $('#setSound').textContent = save.sound ? '🔔 효과음: 켬' : '🔔 효과음: 끔';
}
function openSettings() { paintSettings(); $('#settings').classList.remove('hide'); }
$('#setVoice').onclick = () => { save.voice = !save.voice; persist(); if (!save.voice) hush(); paintSettings(); };
$('#setSound').onclick = () => { save.sound = !save.sound; persist(); paintSettings(); };
$('#setReset').onclick = () => { if (confirm('도감과 진행을 모두 지우고 처음부터 할까요?')) { localStorage.removeItem(SAVE_KEY); location.reload(); } };
$('#setClose').onclick = () => $('#settings').classList.add('hide');

// 시험용 (부모 확인)
window.__game = { get simonState() { return simon; }, actors, openSimon, cur, fetchState, completeMission, ballMesh, save, creatures, boy, goldie, setNight, discover, openCard, camera, THREE, gates, walkTo, startMission, items: () => items, clouds: () => clouds, puffCloud, get step() { return step; } };
