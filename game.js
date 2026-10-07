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
// 새로운 하루: 별과 보물상자가 다시 생긴다 (옷은 아직 없는 것만 상자에서 나온다)
if (save.tutDone === undefined && (save.step > 0 || (save.found && save.found.goldie))) save.tutDone = true;
const TODAY = new Date().toDateString();
const NEW_DAY = !!save.day && save.day !== TODAY;
if (save.day !== TODAY) { save.day = TODAY; save.stars = ''; save.chests = ''; save.toldVisitors = false; }

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
  vSrc = src; musicDuck(true); src.start();
  await new Promise(r => { src.onended = r; setTimeout(r, buf.duration * 1000 + 400); });
  if (vSrc === src) { vSrc = null; musicDuck(false); }
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
  if (vSrc) { try { vSrc.stop(); } catch (e) {} vSrc = null; musicDuck(false); }
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
// 고를 수 있는 주인공들 (첫째는 아이를 닮은 소년: 바가지 머리, 흰 깃 파란 셔츠, 남색 소매, 노란 소맷단·밑단)
const HEROES = {
  explorer: { name: '탐험가 소년', shirt: 0x6f93d8, sleeve: 0x2c3a66, trim: 0xf3c64a, pants: 0x7596d2, hair: 'bowl', collar: true, sun: true },
  taekwon: { name: '태권 소년', shirt: 0xf7f7f2, sleeve: 0xf7f7f2, trim: null, pants: 0xf7f7f2, hair: 'bowl', dobok: true, belt: 0x1a1a1a },
  girl: { name: '탐험가 소녀', shirt: 0xff8fb1, sleeve: 0xff8fb1, trim: 0xffffff, pants: 0x6f93d8, hair: 'pony', collar: true },
  doctor: { name: '곤충 박사', shirt: 0x8aa860, sleeve: 0x8aa860, trim: 0xe8d8a8, pants: 0x7a6040, hair: 'bowl', glasses: true, backpack: true },
};
function makeBoy(o = HEROES.explorer) {
  const g = new THREE.Group();
  const SKIN = 0xf6cfb2, HAIR = o.hair === 'pony' ? 0x3a2418 : 0x1f1919, WHITE = 0xf7f5ee;
  const legs = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(0.13 * s, 0.56, 0);
    p.add(at(cyl(0.1, o.dobok ? 0.13 : 0.11, 0.46, o.pants), 0, -0.22, 0));
    p.add(at(blob(0.12, 0.08, 0.17, o.dobok ? SKIN : WHITE), 0, -0.48, 0.04));
    g.add(p); legs.push(p);
  }
  g.add(at(cyl(0.3, 0.36, 0.56, o.shirt, 10), 0, 0.83, 0));
  if (o.trim) g.add(at(cyl(0.365, 0.37, 0.1, o.trim, 10), 0, 0.58, 0));
  if (o.collar) {
    const collar = mesh(new THREE.TorusGeometry(0.16, 0.055, 6, 12), mat(WHITE));
    collar.rotation.x = Math.PI / 2; collar.position.y = 1.1; g.add(collar);
    for (const s of [-1, 1]) { const f = at(blob(0.1, 0.03, 0.08, WHITE), 0.09 * s, 1.06, 0.2); f.rotation.z = 0.45 * s; f.rotation.x = 0.5; g.add(f); }
    g.add(at(blob(0.03, 0.12, 0.02, WHITE), 0, 0.98, 0.3)); // 단추줄
  }
  if (o.sun) { const sun = cyl(0.07, 0.07, 0.03, o.trim, 10); sun.rotation.x = Math.PI / 2; sun.position.set(0.15, 0.88, 0.315); g.add(sun); }
  if (o.dobok) { // 태권도 도복: 브이넥 깃 + 띠
    for (const s of [-1, 1]) { const v = blob(0.035, 0.2, 0.02, 0x1a1a1a); v.position.set(0.07 * s, 0.97, 0.3); v.rotation.z = 0.5 * s; v.rotation.x = 0.2; g.add(v); }
    const belt = mesh(new THREE.TorusGeometry(0.345, 0.045, 5, 16), mat(o.belt)); belt.rotation.x = Math.PI / 2; belt.position.y = 0.62; g.add(belt);
    g.add(at(blob(0.07, 0.05, 0.04, o.belt), 0, 0.62, 0.36));
    for (const s of [-1, 1]) { const t = blob(0.03, 0.12, 0.02, o.belt); t.position.set(0.05 * s, 0.5, 0.37); t.rotation.z = 0.25 * s; g.add(t); }
  }
  if (o.backpack) { g.add(at(mesh(new THREE.BoxGeometry(0.42, 0.42, 0.18), mat(0xc9733a)), 0, 0.88, -0.36)); g.add(at(mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), mat(0xe8a060)), 0, 0.78, -0.47)); }
  const arms = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(0.37 * s, 1.02, 0);
    p.add(at(cyl(0.085, o.dobok ? 0.11 : 0.09, 0.4, o.sleeve), 0, -0.2, 0));
    if (o.trim) p.add(at(cyl(0.097, 0.097, 0.07, o.trim), 0, -0.41, 0));
    p.add(at(blob(0.08, 0.08, 0.08, SKIN), 0, -0.49, 0));
    p.rotation.z = 0.12 * s; g.add(p); arms.push(p);
  }
  const head = new THREE.Group(); head.position.y = 1.5; g.add(head);
  head.add(blob(0.46, 0.44, 0.44, SKIN, {}, true));
  const hair = mesh(new THREE.SphereGeometry(0.485, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.56), mat(HAIR, { double: true }));
  hair.rotation.x = -0.32; hair.position.y = 0.03; head.add(hair);
  if (o.hair === 'pony') { // 소녀: 긴 옆머리 + 묶은 머리
    for (const s of [-1, 1]) head.add(at(blob(0.12, 0.3, 0.16, HAIR), 0.38 * s, -0.12, -0.08));
    const tail = at(blob(0.16, 0.34, 0.14, HAIR), 0, 0.05, -0.55); tail.rotation.x = 0.5; head.add(tail);
    head.add(at(blob(0.09, 0.07, 0.07, 0xff6fa8), 0, 0.22, -0.46));
  }
  if (o.glasses) for (const s of [-1, 1]) { const gl = mesh(new THREE.TorusGeometry(0.1, 0.018, 5, 14), mat(0x3a2a1a)); gl.position.set(0.155 * s, -0.03, 0.43); head.add(gl); }
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
  for (const [x, z] of [[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]]) {
    g.add(at(cyl(0.08, 0.08, 0.24, DARK, 6), x, 0.12, z));
    for (const c of [-0.04, 0, 0.04]) { const cl = at(cone(0.015, 0.08, 0xe8e0d0, 4), x + c, 0.02, z + 0.08); cl.rotation.x = Math.PI / 2; g.add(cl); }
  }
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
// ───────── 손님 친구 (날마다 다른 곳에 놀러 온다) ─────────
function wingPair(g, color, w, h, y, z, opacity) {
  const wings = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(0.04 * s, y, z); g.add(p);
    const wm = new THREE.Mesh(GEO.ico, mat(color, opacity ? { opacity, double: true } : { double: true })); wm.scale.set(w, 0.012, h); wm.position.x = w * s; p.add(wm);
    wings.push({ p, s });
  }
  return wings;
}
function makeButterfly() {
  const g = new THREE.Group();
  g.add(at(blob(0.04, 0.04, 0.22, 0x1a1a1a), 0, 0, 0));
  const wings = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(0.03 * s, 0.02, 0); g.add(p);
    const f = blob(0.2, 0.012, 0.16, 0xf6d23a, { double: true }); f.position.set(0.18 * s, 0, 0.08); p.add(f);
    const b = blob(0.14, 0.012, 0.12, 0xf6d23a, { double: true }); b.position.set(0.13 * s, 0, -0.12); p.add(b);
    for (const [x, z] of [[0.14, 0.12], [0.24, 0.05], [0.12, -0.12]]) p.add(at(blob(0.05, 0.015, 0.018, 0x1a1a1a), x * s, 0.005, z));
    wings.push({ p, s });
  }
  for (const s of [-1, 1]) { g.add(at(eye(0.03), 0.03 * s, 0.03, 0.12)); const a = cyl(0.006, 0.006, 0.18, 0x1a1a1a, 3); a.position.set(0.04 * s, 0.08, 0.2); a.rotation.x = 0.8; g.add(a); }
  return { group: g, wings };
}
function makeBee() {
  const g = new THREE.Group();
  g.add(at(blob(0.12, 0.11, 0.17, 0xf3c23a, {}, true), 0, 0, -0.03));
  for (const z of [-0.08, 0.02]) g.add(at(blob(0.122, 0.112, 0.03, 0x1a1a1a), 0, 0, z));
  g.add(at(blob(0.09, 0.08, 0.08, 0x1a1a1a, {}, true), 0, 0.02, 0.15));
  for (const s of [-1, 1]) g.add(at(eye(0.04), 0.05 * s, 0.05, 0.2));
  { const _m = at(cone(0.02, 0.06, 0x1a1a1a, 4), 0, -0.01, -0.22); _m.rotation.x = -Math.PI / 2; g.add(_m); }
  const wings = wingPair(g, 0xe8f6ff, 0.1, 0.07, 0.11, -0.02, 0.6);
  return { group: g, wings };
}
function makeMantis() {
  const g = new THREE.Group(); const GR = 0x7fbf3a;
  g.add(at(blob(0.06, 0.06, 0.26, GR), 0, 0.14, -0.12));
  const thorax = cyl(0.03, 0.035, 0.28, GR, 5); thorax.position.set(0, 0.24, 0.1); thorax.rotation.x = -0.9; g.add(thorax);
  const head = new THREE.Group(); head.position.set(0, 0.36, 0.2); g.add(head);
  head.add(blob(0.07, 0.05, 0.05, GR)); for (const s of [-1, 1]) head.add(at(eye(0.035), 0.06 * s, 0.02, 0.02));
  const arms = [];
  for (const s of [-1, 1]) { const a = new THREE.Group(); a.position.set(0.04 * s, 0.28, 0.18); g.add(a); a.add(at(blob(0.025, 0.1, 0.025, GR), 0, -0.08, 0.03)); const f = at(blob(0.02, 0.025, 0.08, GR), 0, -0.16, 0.08); a.add(f); arms.push(a); }
  insectLegs(g, GR, 0.05, [0.02, -0.1], 0.2).forEach(l => l.position.y = 0.14);
  return { group: g, head, arms };
}
function makeHedgehog() {
  const g = new THREE.Group();
  g.add(at(blob(0.22, 0.17, 0.26, 0x6e5a48, {}, true), 0, 0.17, -0.02));
  for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2, b = (i % 3) * 0.35 + 0.2; const sp = cone(0.025, 0.12, 0x4a3a2e, 3); sp.position.set(Math.cos(a) * 0.17 * Math.sin(b + 0.6), 0.2 + Math.cos(b + 0.6) * 0.12, Math.sin(a) * 0.2 - 0.04); sp.lookAt(sp.position.clone().multiplyScalar(2).setY(sp.position.y * 2 - 0.1)); sp.rotateX(Math.PI / 2); g.add(sp); }
  const face = at(blob(0.11, 0.09, 0.12, 0xd9c4a8, {}, true), 0, 0.13, 0.2); g.add(face);
  g.add(at(ball(0.028, 0x1a1a1a), 0, 0.12, 0.32)); for (const s of [-1, 1]) g.add(at(eye(0.03), 0.05 * s, 0.17, 0.27));
  return { group: g };
}
function makeWoodpecker() {
  const g = new THREE.Group();
  g.add(at(blob(0.14, 0.2, 0.14, 0x1c1c1c), 0, 0.22, 0));
  g.add(at(blob(0.1, 0.15, 0.08, 0xf2f0e8), 0, 0.2, 0.08));
  for (const s of [-1, 1]) g.add(at(blob(0.03, 0.12, 0.1, 0xf2f0e8), 0.13 * s, 0.24, -0.02));
  g.add(at(blob(0.06, 0.05, 0.06, 0xd83a3a), 0, 0.05, 0.02));
  const head = new THREE.Group(); head.position.set(0, 0.44, 0.03); g.add(head);
  head.add(blob(0.1, 0.09, 0.1, 0x1c1c1c, {}, true)); head.add(at(blob(0.06, 0.04, 0.06, 0xd83a3a), 0, 0.02, -0.07));
  for (const s of [-1, 1]) { head.add(at(blob(0.03, 0.04, 0.04, 0xffffff), 0.08 * s, -0.01, 0.03)); head.add(at(eye(0.03), 0.06 * s, 0.03, 0.07)); }
  const bill = cone(0.025, 0.14, 0x3a3a3a, 4); bill.rotation.x = Math.PI / 2; bill.position.set(0, 0, 0.15); head.add(bill);
  g.add(at(blob(0.04, 0.1, 0.03, 0x1c1c1c), 0, 0.05, -0.1));
  const wings = wingPair(g, 0x1c1c1c, 0.01, 0.01, 0.3, 0); // 접은 날개 (흔들림만)
  return { group: g, head, wings };
}
function makeFirefly() {
  const g = new THREE.Group();
  g.add(at(blob(0.06, 0.05, 0.13, 0x2a2a2a), 0, 0, 0.02));
  g.add(at(blob(0.05, 0.04, 0.04, 0xe25a3a), 0, 0.02, 0.15));
  const glow = new THREE.Mesh(GEO.ico2, new THREE.MeshBasicMaterial({ color: 0xeaff7a })); glow.scale.set(0.065, 0.05, 0.07); glow.position.z = -0.12; g.add(glow);
  for (const s of [-1, 1]) g.add(at(eye(0.025), 0.035 * s, 0.04, 0.18));
  const wings = wingPair(g, 0xdde8f0, 0.07, 0.06, 0.05, 0, 0.5);
  return { group: g, wings, glow };
}
function makeTreefrog() {
  const g = new THREE.Group(); const GR = 0x6fd14a;
  g.add(at(blob(0.16, 0.12, 0.17, GR, {}, true), 0, 0.12, 0));
  g.add(at(blob(0.12, 0.05, 0.1, 0xeaf6c8), 0, 0.06, 0.06));
  for (const s of [-1, 1]) {
    g.add(at(eye(0.05), 0.08 * s, 0.24, 0.07));
    g.add(at(blob(0.05, 0.04, 0.12, GR), 0.15 * s, 0.05, -0.08));
    g.add(at(blob(0.03, 0.06, 0.03, GR), 0.1 * s, 0.05, 0.12));
    g.add(at(ball(0.022, 0xd8f0a0), 0.11 * s, 0.01, 0.16));
  }
  const mouth = mesh(new THREE.TorusGeometry(0.06, 0.008, 4, 10, Math.PI), mat(0x2f6b2a)); mouth.rotation.z = Math.PI; mouth.position.set(0, 0.13, 0.16); g.add(mouth);
  return { group: g };
}
function makeOtter() {
  const g = new THREE.Group(); const FUR = 0x6b4a32;
  g.add(at(blob(0.2, 0.18, 0.45, FUR, {}, true), 0, 0.2, 0));
  const head = new THREE.Group(); head.position.set(0, 0.28, 0.42); g.add(head);
  head.add(blob(0.16, 0.14, 0.15, FUR, {}, true)); head.add(at(blob(0.11, 0.07, 0.08, 0xc9b49a), 0, -0.04, 0.1));
  head.add(at(ball(0.03, 0x1a1a1a), 0, -0.01, 0.17));
  for (const s of [-1, 1]) { head.add(at(eye(0.035), 0.07 * s, 0.05, 0.11)); head.add(at(blob(0.03, 0.03, 0.02, FUR), 0.13 * s, 0.07, -0.02)); }
  const tail = blob(0.07, 0.05, 0.3, FUR); tail.position.set(0, 0.12, -0.5); g.add(tail);
  for (const [x, z] of [[-0.14, 0.25], [0.14, 0.25], [-0.14, -0.22], [0.14, -0.22]]) g.add(at(blob(0.05, 0.05, 0.07, 0x4a3222), x, 0.04, z));
  return { group: g, head };
}
function makeDamselfly() {
  const g = new THREE.Group();
  { const _m = at(cyl(0.015, 0.012, 0.5, 0x2fbf6a, 5, { rough: 0.3 }), 0, 0, -0.15); _m.rotation.x = Math.PI / 2; g.add(_m); }
  g.add(at(blob(0.04, 0.035, 0.06, 0x2fbf6a, { rough: 0.3 }), 0, 0, 0.12));
  for (const s of [-1, 1]) g.add(at(eye(0.03), 0.04 * s, 0.02, 0.17));
  const wings = [];
  for (const s of [-1, 1]) for (const z of [0.06, -0.02]) { const p = new THREE.Group(); p.position.set(0.02 * s, 0.03, z); g.add(p); const w = blob(0.16, 0.01, 0.035, 0x1a1a1a, { opacity: 0.85, double: true }); w.position.x = 0.16 * s; p.add(w); wings.push({ p, s }); }
  return { group: g, wings };
}
function makeStrider() {
  const g = new THREE.Group();
  g.add(at(blob(0.04, 0.03, 0.2, 0x3a3226), 0, 0.06, 0));
  for (const s of [-1, 1]) g.add(at(eye(0.025), 0.03 * s, 0.08, 0.17));
  for (const [z, len, ang] of [[0.1, 0.18, 0.7], [0, 0.4, 0.2], [-0.05, 0.38, -0.5]]) for (const s of [-1, 1]) {
    const l = cyl(0.006, 0.006, len, 0x2a2218, 3); l.rotation.z = Math.PI / 2; l.rotation.y = ang * s; l.position.set(len / 2 * Math.cos(ang) * s, 0.03, z + len / 2 * Math.sin(ang)); g.add(l);
  }
  return { group: g };
}
function makeGull() {
  const g = new THREE.Group();
  g.add(at(blob(0.16, 0.15, 0.3, 0xffffff), 0, 0.25, 0));
  const head = new THREE.Group(); head.position.set(0, 0.44, 0.2); g.add(head);
  head.add(blob(0.11, 0.1, 0.11, 0xffffff, {}, true));
  for (const s of [-1, 1]) head.add(at(eye(0.03), 0.07 * s, 0.03, 0.07));
  const bill = cone(0.03, 0.13, 0xf3c64a, 4); bill.rotation.x = Math.PI / 2; bill.position.set(0, -0.01, 0.15); head.add(bill);
  head.add(at(blob(0.032, 0.012, 0.02, 0xe2533f), 0, -0.02, 0.2));
  const wings = [];
  for (const s of [-1, 1]) { const p = new THREE.Group(); p.position.set(0.12 * s, 0.32, 0); g.add(p); const w = blob(0.3, 0.025, 0.13, 0x9aa3ad); w.position.x = 0.28 * s; p.add(w); p.add(at(blob(0.08, 0.026, 0.1, 0x1a1a1a), 0.54 * s, 0, -0.02)); wings.push({ p, s }); }
  for (const s of [-1, 1]) g.add(at(cyl(0.015, 0.015, 0.14, 0xf3c64a, 4), 0.06 * s, 0.07, 0));
  g.add(at(blob(0.08, 0.03, 0.12, 0x1a1a1a), 0, 0.27, -0.3));
  return { group: g, head, wings };
}
function makeJellyfish() {
  const g = new THREE.Group();
  const bell = mesh(new THREE.SphereGeometry(0.28, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd9b6ff, transparent: true, opacity: 0.7, roughness: 0.2, emissive: 0x7a4ad0, emissiveIntensity: 0.25 }));
  bell.scale.y = 0.8; g.add(bell);
  for (const s of [-1, 1]) g.add(at(eye(0.045), 0.09 * s, 0.1, 0.22));
  const legs = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const t = cyl(0.012, 0.006, 0.45, 0xe8d0ff, 3, { opacity: 0.8 }); t.position.set(Math.cos(a) * 0.17, -0.22, Math.sin(a) * 0.17); g.add(t); legs.push(t); }
  return { group: g, legs };
}
function makeEgret() {
  const g = new THREE.Group(); const W = 0xffffff;
  g.add(at(blob(0.2, 0.2, 0.32, W), 0, 0.85, 0));
  for (const s of [-1, 1]) g.add(at(cyl(0.02, 0.02, 0.65, 0x1a1a1a, 4), 0.07 * s, 0.38, 0));
  const neck = cyl(0.05, 0.06, 0.5, W, 6); neck.position.set(0, 1.18, 0.18); neck.rotation.x = 0.35; g.add(neck);
  const head = new THREE.Group(); head.position.set(0, 1.43, 0.27); g.add(head);
  head.add(blob(0.08, 0.08, 0.1, W, {}, true)); for (const s of [-1, 1]) head.add(at(eye(0.028), 0.05 * s, 0.02, 0.06));
  const bill = cone(0.025, 0.24, 0xf3c64a, 4); bill.rotation.x = Math.PI / 2; bill.position.set(0, -0.01, 0.2); head.add(bill);
  return { group: g, head };
}
function makeRoedeer() {
  const g = new THREE.Group(); const FUR = 0x9a6a42;
  g.add(at(blob(0.24, 0.24, 0.45, FUR), 0, 0.8, 0));
  g.add(at(blob(0.13, 0.13, 0.06, 0xffffff), 0, 0.84, -0.42)); // 하얀 엉덩이
  for (const [x, z] of [[-0.13, 0.28], [0.13, 0.28], [-0.13, -0.28], [0.13, -0.28]]) g.add(at(cyl(0.035, 0.03, 0.6, 0x7a5232, 5), x, 0.32, z));
  const neck = cyl(0.07, 0.09, 0.38, FUR, 6); neck.position.set(0, 1.08, 0.36); neck.rotation.x = 0.5; g.add(neck);
  const head = new THREE.Group(); head.position.set(0, 1.28, 0.48); g.add(head);
  head.add(blob(0.11, 0.12, 0.18, FUR, {}, true)); head.add(at(ball(0.03, 0x1a1a1a), 0, -0.04, 0.18));
  for (const s of [-1, 1]) {
    head.add(at(eye(0.035), 0.08 * s, 0.03, 0.08));
    const ear = at(blob(0.04, 0.1, 0.02, FUR), 0.1 * s, 0.13, -0.04); ear.rotation.z = -0.5 * s; head.add(ear);
    const an = cyl(0.012, 0.018, 0.2, 0x5a3a20, 4); an.position.set(0.04 * s, 0.2, 0); an.rotation.z = -0.2 * s; head.add(an);
  }
  return { group: g, head };
}
function makeMarten() {
  const g = new THREE.Group(); const FUR = 0x5a3a24;
  g.add(at(blob(0.15, 0.14, 0.4, FUR, {}, true), 0, 0.22, 0));
  g.add(at(blob(0.12, 0.1, 0.1, 0xf3c23a), 0, 0.24, 0.3)); // 노란 목도리
  const head = new THREE.Group(); head.position.set(0, 0.3, 0.42); g.add(head);
  head.add(blob(0.12, 0.11, 0.14, 0x2a1a10, {}, true)); head.add(at(ball(0.025, 0x111111), 0, -0.02, 0.14));
  for (const s of [-1, 1]) { head.add(at(eye(0.035), 0.06 * s, 0.04, 0.1)); head.add(at(blob(0.04, 0.04, 0.02, 0x2a1a10), 0.1 * s, 0.1, -0.02)); }
  const tail = blob(0.06, 0.06, 0.35, 0x2a1a10); tail.position.set(0, 0.24, -0.6); tail.rotation.x = 0.3; g.add(tail);
  for (const [x, z] of [[-0.1, 0.2], [0.1, 0.2], [-0.1, -0.2], [0.1, -0.2]]) g.add(at(cyl(0.035, 0.03, 0.18, 0x2a1a10, 4), x, 0.09, z));
  return { group: g, head };
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
// 숨은 보물상자 자리 (언덕 꼭대기, 지역 구석구석)
const CHEST_SPOTS = [[17, -17], [21, 18], [-26, -11], [-28, -45], [27, -44], [73, -19], [72, 19], [-76, 14], [-64, 14.5], [23, 72], [72, -66], [48, -64]];
const keepOut = [[SPOT.start, 7], [new V3(0, 0, 14), 5], [SPOT.bigOak, 4.5], [SPOT.cicadaTree, 3.5], [SPOT.log, 3.5], [SPOT.bush, 3], [SPOT.pond, 5.5], [SPOT.ball, 3], [new V3(0, 0, 0), 3],
  [SPOT.minnow, 5], [SPOT.crayRock, 4], [SPOT.kfTree, 4], [SPOT.crab, 5], [SPOT.hermit, 4], [SPOT.pool, 5],
  [SPOT.oakBoss, 5], [SPOT.fallBoss, 5], [SPOT.kingBoss, 7], [SPOT.mudMound, 5], [SPOT.fiddler, 4], [SPOT.spoonPuddle, 5], [SPOT.flatBoss, 6],
  [SPOT.hare, 4], [SPOT.goralRock, 5], [SPOT.owlTree, 4], [SPOT.snowBoss, 6], ...CHEST_SPOTS.map(([x, z]) => [new V3(x, 0, z), 2]), ...Object.values(ITEM_SPOTS).flat().map(([x, z]) => [new V3(x, 0, z), 1.6])];
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
const boy = { group: new THREE.Group(), model: null, legs: null, arms: null, head: null };
let heroHook = null; // 옷장·실루엣이 준비되면 주인공을 바꿀 때 다시 붙인다
function setHero(id) {
  if (!HEROES[id]) id = 'explorer';
  const m = makeBoy(HEROES[id]);
  if (boy.model) boy.group.remove(boy.model);
  boy.model = m.group; boy.legs = m.legs; boy.arms = m.arms; boy.head = m.head;
  boy.group.add(m.group);
  if (heroHook) heroHook();
}
setHero(save.hero);
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
    else if (t === 1) { const c = cyl(0.1, 0.1, 0.24, 0xe2533f, 8); c.rotation.x = Math.PI / 2; c.position.y = 0.1; g.add(c); { const _m = at(cyl(0.101, 0.101, 0.06, 0xd8d8d8, 8), 0, 0.1, 0); _m.rotation.x = Math.PI / 2; g.add(_m); } }
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
  const lv = lvlOf(save.xp || 0); $('#lvlText').textContent = `${(STORY.ranks || ['탐험가'])[Math.min((STORY.ranks || [1]).length - 1, Math.floor((lv - 1) / 2))]} Lv.${lv}`;
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
  const bb = $('#cardBuddy'); bb.classList.toggle('hide', isNew || def.companion || !save.found[id]);
  bb.textContent = save.buddy === id ? '🏠 돌려보내기' : '🐾 데리고 다니기'; bb.onclick = () => { sfx.pop(); setBuddy(id); bb.textContent = save.buddy === id ? '🏠 돌려보내기' : '🐾 데리고 다니기'; };
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
  if (!wasNew && c && cur() && cur().type === 'meet' && cur().target === c.id && save.found[c.id]) setTimeout(() => { if (cur() && cur().target === c.id) completeMission(); }, 600);
  if (wasNew && !c) setTimeout(() => save.tutDone ? startMission() : startTutorial(() => startMission()), 400); // 골디 첫 인사 뒤 튜토리얼 → 이야기
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
  const vh = document.createElement('div'); vh.className = 'bookHead'; vh.textContent = '🌟 손님 친구 (날마다 다른 곳에 놀러 와요)'; grid.appendChild(vh);
  for (const f of VISITORS) {
    const found = !!save.found[f.id], here = visitorCs.find(c => c.vis.id === f.id)?.vis.active;
    const el = document.createElement('div'); el.className = 'slot ' + (found ? 'found' : 'locked');
    el.innerHTML = `<div class="ic">${f.emoji}</div><div>${found ? f.name : '???'}</div><div class="tag">${here ? '✨ 오늘 ' + REGIONS[f.region].name + '에 왔어요' : REGIONS[f.region].icon + ' ' + REGIONS[f.region].name}${f.time === 'night' ? ' 🌙' : ''}</div>`;
    if (found) el.onclick = () => { $('#book').classList.add('hide'); cardBookId = f.id; openCard(f.id, false, null); };
    grid.appendChild(el);
  }
  const fh = document.createElement('div'); fh.className = 'bookHead'; fh.textContent = '🎣 낚시 기록'; grid.appendChild(fh);
  for (const kind of ['pond', 'stream', 'sea']) for (const f of FISH[kind]) {
    const got = save.fishLog[f.id];
    const el = document.createElement('div'); el.className = 'slot ' + (got ? 'found' : 'locked');
    el.innerHTML = `<div class="ic">${f.emoji}</div><div>${got ? f.name : '???'}</div><div class="tag">${got ? '최고 ' + got + 'cm' : { pond: '연못', stream: '계곡', sea: '바다' }[kind]}</div>`;
    if (got) el.onclick = () => speak([f.got, f.fact]);
    grid.appendChild(el);
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
  if (tut && tut.goal) return tut.goal;
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
  if (m.type === 'meet' && save.found[m.target]) { setTimeout(() => { if (cur() === m) completeMission(); }, 1200); return; } // 만난 뒤 완료 저장 전에 꺼졌던 경우
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
  if (!quiet) { addXP(5); buddyCheer(); }
  if (!quiet) { sfx.chime(); cheer = 1; addStars(3, boy.group.position.clone().setY(boy.group.position.y + 1.6)); }
  const next = () => {
    if (m.reward === 'flashlight') { save.flashlight = true; persist(); addItem('flashlight', 1, false); showItem('🔦', MSG.flashTitle, MSG.flashText, () => startMission()); return; }
    if (m.type === 'boss') { chapterDone(m); return; }
    startMission();
  };
  const after = () => m.after ? playLines(m.after, next) : next();
  if (quiet) next();
  else { say(MSG.success, true, 2200); setTimeout(after, 2300); }
}
function chapterDone(m) {
  const ch = chapterOf(m);
  const gemOf = { ch1: 'gem_green', ch2: 'gem_blue', ch3: 'gem_yellow', ch4: 'sun', ch5: 'sun', ch6: 'sun' };
  if (gemOf[ch.id]) addItem(gemOf[ch.id], 1, false);
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
  // 끄기 전에 주운 것은 이미 주운 것으로
  if (save.collect && save.collect.step === step) items.forEach((it, i) => { if (save.collect.got.includes(i)) { it.got = true; it.k = 0; it.mesh.visible = false; } });
  else save.collect = { step, got: [] };
  if (items.length && items.every(it => it.got)) setTimeout(() => { if (cur() && cur().type === 'collect') completeMission(); }, 1200);
}
function updateItems(dt, t) {
  if (!items.length) return;
  const bp = boy.group.position;
  for (const it of items) {
    if (it.got) { if (it.k > 0) { it.k -= dt * 2; it.mesh.position.y += dt * 2; it.mesh.scale.setScalar(Math.max(0.01, it.k)); if (it.k <= 0) it.mesh.visible = false; } continue; }
    if (!it.flat) { it.mesh.rotation.y += dt * 0.8; it.mesh.position.y = it.base + (it.water ? 0 : 0.05) + Math.abs(Math.sin(t * 2 + it.ph)) * 0.12; }
    else it.mesh.children.forEach((b, k) => { if (k > 0 && b.geometry === GEO.ball) b.position.y = 0.08 + ((t * 0.5 + k * 0.25) % 1) * 0.45; });
    if (flatDist(bp, it.pos) < 1.3) {
      it.got = true; it.k = 1; sfx.pop(); save.collect = { step, got: items.map((x, i) => x.got ? i : -1).filter(i => i >= 0) }; persist();
      if (['acorn', 'mushroom', 'shell'].includes(cur() && cur().item)) addItem(cur().item, 1, false); tone(1100, 0.15, 'triangle', 0.12, 0.06);
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
  if (clouds.every(c => c.gone)) setTimeout(startFinisher, 700);
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

function blocked() { return !playing || cardOpen || talkOpen || !$('#book').classList.contains('hide') || !$('#item').classList.contains('hide') || !$('#settings').classList.contains('hide') || !$('#sumo').classList.contains('hide') || !$('#simon').classList.contains('hide') || !$('#closet').classList.contains('hide') || !$('#fish').classList.contains('hide') || !$('#board').classList.contains('hide') || !$('#bag').classList.contains('hide'); }
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
function isTarget(c) { if (c.vis) return true; const m = cur(); return !m || (m.type === 'meet' && m.target === c.id); }

const cvEl = renderer.domElement;
cvEl.addEventListener('pointerdown', e => {
  if (blocked() || ptr) return;
  setNdc(e);
  const cl = pickCloud();
  if (cl) { puffCloud(cl); return; }
  const c = pickCreature();
  const dog = !c && ray.intersectObject(goldieHit, false).length > 0;
  ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), c, dog };
  if (c && !save.found[c.id] && isTarget(c) && nearCreature(c)) { if (riding) dismount(); hold = { c, t: 0 }; moveQueue = []; faceTo(c.anchor); }
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
  addXP(10); if (c.vis) questEvent('find', c.id); buddyCheer();
  setTimeout(() => addStars(5, c.holder.getWorldPosition(new V3())), 300);
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
    if (flatDist(bp, ballMesh.position) < 1.5) { if (riding) dismount(); fetchState.step = 'carry'; sfx.pop(); say(MSG.ballFound, true, 5000); }
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
      fetchState.step = 'done'; ballMesh.visible = false; persist(); addItem('ball', 1, false);
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
  for (const c of visitorCs) if (c.vis.active && c.appear > 0.5) { const [x, y] = M(c.anchor.x, c.anchor.z); mctx.fillText(save.found[c.vis.id] ? c.vis.emoji : '❔', x, y); }
  for (const sp of FISH_SPOTS) { const [x, y] = M(sp.x, sp.z); mctx.fillText('🎣', x, y); }
  for (const c of chests) if (!c.opened) { const [x, y] = M(c.x, c.z); mctx.fillText('🎁', x, y); }
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

// ───────── 놀거리: 반짝 별 · 보물상자 · 옷장 · 골디 타기 · 점프 · 배경음악 ─────────
const seeded = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
// 반지 별: 지역마다 뿌려 둔다. 30% 는 공중에 떠 있어서 점프(또는 골디 타기)로 잡는다
const starRand = seeded(777), SR = (a, b) => a + starRand() * (b - a);
const starSpots = [];
function addStarsIn(test, x0, x1, z0, z1, n, water = false) {
  for (let tries = 0; n > 0 && tries < n * 80; tries++) {
    const x = SR(x0, x1), z = SR(z0, z1);
    if (!test(x, z)) continue;
    if (colliders.some(c => Math.hypot(x - c.x, z - c.z) < c.r + 0.9)) continue;
    if (starSpots.some(s => Math.hypot(s.x - x, s.z - z) < 3.2)) continue;
    const fl = !water && starRand() < 0.3;
    const base = water ? -0.15 : groundH(x, z);
    starSpots.push({ x, z, y: base + (fl ? 1.95 : 0.65), k: 0 }); n--;
  }
}
addStarsIn((x, z) => Math.hypot(x, z) < 29 && !isWater(x, z), -29, 29, -29, 29, 32);
addStarsIn((x, z) => inRect(VALLEY, x, z, -0.6), VALLEY.x0, VALLEY.x1, VALLEY.z0, VALLEY.z1, 12);
addStarsIn((x, z) => isWater(x, z), -27, 27, -63, -57.6, 6, true);
addStarsIn((x, z) => inRect(BEACH, x, z, -0.6), BEACH.x0, BEACH.x1, BEACH.z0, BEACH.z1, 14);
addStarsIn((x, z) => isWater(x, z), 77, 86, -18, 18, 5, true);
addStarsIn((x, z) => inRect(CAVE, x, z, -0.8), CAVE.x0, CAVE.x1, CAVE.z0, CAVE.z1, 14);
addStarsIn((x, z) => inRect(FLAT, x, z, -0.6), FLAT.x0, FLAT.x1, FLAT.z0, FLAT.z1, 14);
addStarsIn((x, z) => inRect(SNOW, x, z, -0.8), SNOW.x0, SNOW.x1, SNOW.z0, SNOW.z1, 14);
const starGeo = (() => {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.13 : 0.3; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }); g.center(); return g;
})();
const starIM = new THREE.InstancedMesh(starGeo, new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb800, emissiveIntensity: 0.6, roughness: 0.4, flatShading: true }), starSpots.length);
starIM.frustumCulled = false; scene.add(starIM);
save.stars = (save.stars || '').padEnd(starSpots.length, '0');
save.wallet = save.wallet || 0;
const starGot = i => save.stars[i] === '1';
const dummy = new THREE.Object3D();
function paintWallet(bump) {
  $('#wallet').textContent = `⭐ ${save.wallet}`; $('#closetWallet').textContent = `⭐ ${save.wallet}`;
  if (bump) { const w = $('#wallet'); w.classList.remove('bump'); w.offsetHeight; w.classList.add('bump'); }
}
function addStars(n, at) {
  save.wallet += n; persist(); paintWallet(true);
  if (at) spawnSparks(at, [0xffd23f, 0xffe680, 0xffffff], 6 + n * 2);
}
function sfxStar() { const n = [784, 880, 1047, 1175, 1319][Math.floor(Math.random() * 5)]; tone(n, 0.18, 'sine', 0.14); tone(n * 1.5, 0.22, 'sine', 0.08, 0.07); }
function updateStars(dt, t) {
  const bp = boy.group.position, low = bp.y - 0.3, high = bp.y + (riding ? 1.9 : 1.45); // 걸으면 공중 별은 점프해야 닿는다
  for (let i = 0; i < starSpots.length; i++) {
    const s = starSpots[i];
    if (starGot(i)) {
      if (s.k > 0) { s.k = Math.max(0, s.k - dt * 3); dummy.position.set(s.x, s.y + (1 - s.k) * 1.2, s.z); dummy.rotation.set(0, t * 8, 0); dummy.scale.setScalar(Math.max(0.001, s.k)); }
      else { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0.001); }
      dummy.updateMatrix(); starIM.setMatrixAt(i, dummy.matrix); continue;
    }
    dummy.position.set(s.x, s.y + Math.sin(t * 2 + i) * 0.08, s.z); dummy.rotation.set(0, t * 1.5 + i, 0); dummy.scale.setScalar(1);
    dummy.updateMatrix(); starIM.setMatrixAt(i, dummy.matrix);
    if (playing && Math.abs(bp.x - s.x) < 1.0 && Math.abs(bp.z - s.z) < 1.0) {
      if (s.y > low && s.y < high) {
        const a = save.stars.split(''); a[i] = '1'; save.stars = a.join(''); s.k = 1;
        sfxStar(); addStars(1, new V3(s.x, s.y, s.z)); addXP(1); questEvent('stars', regionAt(s.x, s.z));
      } else if (!save.toldFloat && !blocked()) { save.toldFloat = true; persist(); say(MSG.starFloat, true, 3000); }
    }
  }
  starIM.instanceMatrix.needsUpdate = true;
}
// 반짝 가루 (별·상자)
const sparks = [];
const sparkGeo = new THREE.OctahedronGeometry(0.08, 0);
function spawnSparks(p, colors, n = 10) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }));
    m.position.copy(p); scene.add(m);
    sparks.push({ m, v: new V3(R(-2, 2), R(2, 4.5), R(-2, 2)), life: 1 });
  }
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.life -= dt * 1.2; s.v.y -= 9 * dt; s.m.position.addScaledVector(s.v, dt); s.m.rotation.y += dt * 6;
    s.m.material.opacity = Math.max(0, s.life);
    if (s.life <= 0) { scene.remove(s.m); s.m.material.dispose(); sparks.splice(i, 1); }
  }
}

// 보물상자: 다가가면 열린다 → 별 10개 + 아직 없는 옷 하나
function makeChest() {
  const g = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), mat(0x9a5b2a)); box.position.y = 0.25; g.add(box);
  for (const x of [-0.3, 0.3]) g.add(at(mesh(new THREE.BoxGeometry(0.08, 0.52, 0.62), mat(0xf3c64a, { rough: 0.3 })), x, 0.25, 0));
  const lid = new THREE.Group(); lid.position.set(0, 0.5, -0.3); g.add(lid);
  const top = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10, 1, false, 0, Math.PI), mat(0xa8652f)); top.rotation.z = Math.PI / 2; top.rotation.y = Math.PI / 2; top.position.z = 0.3; lid.add(top);
  for (const x of [-0.3, 0.3]) { const b = mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 10, 1, false, 0, Math.PI), mat(0xf3c64a, { rough: 0.3 })); b.rotation.z = Math.PI / 2; b.rotation.y = Math.PI / 2; b.position.set(x, 0, 0.3); lid.add(b); }
  g.add(at(mesh(new THREE.BoxGeometry(0.14, 0.16, 0.05), mat(0xf3c64a, { rough: 0.3 })), 0, 0.45, 0.31));
  g.userData.lid = lid;
  return g;
}
save.chests = (save.chests || '').padEnd(CHEST_SPOTS.length, '0');
const chests = CHEST_SPOTS.map(([x, z], i) => {
  const g = makeChest(); g.position.set(x, groundH(x, z), z); g.rotation.y = Math.atan2(-x, -z) * 0 + (i % 3 - 1) * 0.4; scene.add(g);
  const opened = save.chests[i] === '1';
  if (opened) g.userData.lid.rotation.x = -1.9;
  const glint = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), starMat); glint.position.set(x, groundH(x, z) + 1.25, z); glint.visible = !opened; scene.add(glint);
  return { g, x, z, opened, open: opened ? 1 : 0, glint };
});
function updateChests(dt, t) {
  const bp = boy.group.position;
  chests.forEach((c, i) => {
    if (c.opened) { if (c.open < 1) { c.open = Math.min(1, c.open + dt * 2); c.g.userData.lid.rotation.x = -1.9 * c.open; } return; }
    c.glint.position.y = groundH(c.x, c.z) + 1.2 + Math.sin(t * 2 + i) * 0.1; c.glint.rotation.y = t * 1.5;
    if (playing && !blocked() && flatDist(bp, c.g.position) < 1.4) {
      c.opened = true; c.glint.visible = false;
      const a = save.chests.split(''); a[i] = '1'; save.chests = a.join('');
      sfx.chime(); cheer = 1;
      spawnSparks(c.g.position.clone().setY(c.g.position.y + 0.8), [0xff6b6b, 0xffd23f, 0x5cd65c, 0x4da6ff, 0xc08cff], 26);
      addStars(10); addXP(5); questEvent('chest'); chestTreasure(c.x, c.z);
      const left = CLOSET.filter(it => !save.owned[it.id]);
      if (left.length) {
        const it = left[Math.floor(Math.random() * left.length)]; save.owned[it.id] = true; persist();
        setTimeout(() => showItem('🎁', MSG.chestTitle, `별 10개와 「${it.name}」 ${it.icon} 을(를) 얻었어요! 옷장에서 입어 봐요.`, null, [MSG.chestTitle, MSG.chestText]), 700);
      } else setTimeout(() => say(MSG.chestStars, true, 2500), 500);
    }
  });
}

// 옷장: 아이 모자 · 골디 꾸미기
const CLOSET = [
  { id: 'straw', who: 'boy', name: '밀짚모자', icon: '👒', price: 10 },
  { id: 'party', who: 'boy', name: '고깔모자', icon: '🥳', price: 15 },
  { id: 'bunny', who: 'boy', name: '토끼 귀', icon: '🐰', price: 20 },
  { id: 'explorer', who: 'boy', name: '탐험가 모자', icon: '🧭', price: 25 },
  { id: 'pirate', who: 'boy', name: '해적 모자', icon: '🏴‍☠️', price: 30 },
  { id: 'crown', who: 'boy', name: '왕관', icon: '👑', price: 40 },
  { id: 'beetle', who: 'boy', name: '장수풍뎅이 모자', icon: '🪲', price: 50 },
  { id: 'scarf', who: 'goldie', name: '빨간 스카프', icon: '🧣', price: 10 },
  { id: 'bow', who: 'goldie', name: '리본', icon: '🎀', price: 15 },
  { id: 'flowers', who: 'goldie', name: '꽃 왕관', icon: '🌼', price: 20 },
  { id: 'glasses', who: 'goldie', name: '선글라스', icon: '🕶️', price: 25 },
  { id: 'cape', who: 'goldie', name: '영웅 망토', icon: '🦸', price: 35 },
];
save.owned = save.owned || {}; save.wear = save.wear || { boy: null, goldie: null };
const hatSlot = new THREE.Group(); hatSlot.position.set(0, 0.3, 0); boy.head.add(hatSlot);
heroHook = () => { boy.head.add(hatSlot); applyWear(); addXray(boy.group, 0x5b8cff, 0.45); };
const dogHeadSlot = new THREE.Group(); dogHeadSlot.position.set(0, 0.2, 0); goldie.head.add(dogHeadSlot);
const dogBodySlot = new THREE.Group(); goldie.group.add(dogBodySlot);
const WEAR = {
  straw: () => { const g = new THREE.Group(); g.add(at(cyl(0.62, 0.62, 0.04, 0xe8c66a, 14), 0, 0.02, 0)); g.add(at(cyl(0.3, 0.34, 0.24, 0xe8c66a, 12), 0, 0.14, 0)); g.add(at(cyl(0.345, 0.345, 0.06, 0xe2533f, 12), 0, 0.06, 0)); return g; },
  party: () => { const g = new THREE.Group(); const c = cone(0.22, 0.6, 0xff8fb1, 10); c.position.y = 0.28; g.add(c); for (const y of [0.12, 0.3]) g.add(at(cyl(0.2 - y * 0.35, 0.21 - y * 0.35, 0.05, 0xffd23f, 10), 0, y, 0)); g.add(at(blob(0.08, 0.08, 0.08, 0xffffff), 0, 0.6, 0)); return g; },
  bunny: () => { const g = new THREE.Group(); for (const s of [-1, 1]) { const e = new THREE.Group(); e.position.set(0.14 * s, 0, 0); e.rotation.z = -0.15 * s; e.add(at(blob(0.09, 0.32, 0.05, 0xffffff), 0, 0.3, 0)); e.add(at(blob(0.05, 0.24, 0.02, 0xffb6c8), 0, 0.3, 0.04)); g.add(e); } return g; },
  explorer: () => { const g = new THREE.Group(); g.add(at(cyl(0.58, 0.58, 0.04, 0xc9b27a, 14), 0, 0.02, 0)); g.add(at(blob(0.42, 0.3, 0.42, 0xd9c48a, {}, true), 0, 0.05, 0)); g.add(at(cyl(0.43, 0.43, 0.06, 0x6b4a2a, 14), 0, 0.06, 0)); return g; },
  pirate: () => { const g = new THREE.Group(); const h = blob(0.6, 0.18, 0.36, 0x1f1f24); h.position.y = 0.12; g.add(h); g.add(at(blob(0.4, 0.22, 0.3, 0x1f1f24, {}, true), 0, 0.2, 0)); g.add(at(blob(0.07, 0.07, 0.02, 0xffffff), 0, 0.22, 0.33)); return g; },
  crown: () => { const g = new THREE.Group(); g.add(at(cyl(0.34, 0.34, 0.16, 0xf3c64a, 12, { rough: 0.25 }), 0, 0.08, 0)); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(at(cone(0.07, 0.18, 0xf3c64a, 5, { rough: 0.25 }), Math.cos(a) * 0.3, 0.24, Math.sin(a) * 0.3)); } for (const [a, c] of [[0, 0xe2533f], [2.1, 0x4da6ff], [4.2, 0x5cd65c]]) g.add(at(blob(0.05, 0.05, 0.03, c, { emissive: c, ei: 0.3 }), Math.sin(a) * 0.345, 0.09, Math.cos(a) * 0.345)); return g; },
  beetle: () => { const g = new THREE.Group(); g.add(at(blob(0.48, 0.3, 0.48, 0x55301b, { rough: 0.3 }, true), 0, 0.02, 0)); const h1 = cyl(0.05, 0.09, 0.42, 0x55301b, 6, { rough: 0.3 }); h1.position.set(0, 0.32, 0.22); h1.rotation.x = 0.5; g.add(h1); for (const s of [-1, 1]) { const tip = cone(0.04, 0.16, 0x55301b, 5, { rough: 0.3 }); tip.position.set(0.05 * s, 0.56, 0.34); tip.rotation.z = -0.5 * s; g.add(tip); } for (const s of [-1, 1]) g.add(at(eye(0.06), 0.2 * s, 0.14, 0.4)); return g; },
  scarf: () => { const g = new THREE.Group(); const r = mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 14), mat(0xe2533f)); r.position.set(0, 0.92, 0.42); r.rotation.x = 1.3; g.add(r); const tl = blob(0.07, 0.2, 0.04, 0xe2533f); tl.position.set(0.12, 0.78, 0.6); tl.rotation.z = 0.3; g.add(tl); return g; },
  bow: () => { const g = new THREE.Group(); for (const s of [-1, 1]) { const b = blob(0.12, 0.08, 0.05, 0xff6fa8); b.position.set(0.11 * s, 0.06, 0); b.rotation.z = 0.4 * s; g.add(b); } g.add(at(blob(0.05, 0.05, 0.05, 0xff3d8a), 0, 0.06, 0)); return g; },
  flowers: () => { const g = new THREE.Group(); for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const c = [0xffd23f, 0xff8fb1, 0xffffff][i % 3]; g.add(at(blob(0.07, 0.04, 0.07, c), Math.cos(a) * 0.22, 0.02, Math.sin(a) * 0.22)); g.add(at(blob(0.03, 0.03, 0.03, 0xff9f43), Math.cos(a) * 0.22, 0.05, Math.sin(a) * 0.22)); } return g; },
  glasses: () => { const g = new THREE.Group(); for (const s of [-1, 1]) { const l = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 12), mat(0x111111, { rough: 0.2 })); l.rotation.x = Math.PI / 2; l.position.set(0.12 * s, -0.13, 0.25); g.add(l); } g.add(at(blob(0.06, 0.012, 0.012, 0x111111), 0, -0.12, 0.27)); return g; },
  cape: () => { const g = new THREE.Group(); const c = blob(0.38, 0.05, 0.5, 0xd63c3c); c.position.set(0, 0.98, -0.05); c.rotation.x = -0.1; g.add(c); g.add(at(blob(0.06, 0.06, 0.06, 0xffd23f), 0, 0.98, 0.42)); return g; },
};
function applyWear() {
  for (const slot of [hatSlot, dogHeadSlot, dogBodySlot]) while (slot.children.length) slot.remove(slot.children[0]);
  const b = save.wear.boy, d = save.wear.goldie;
  if (b && WEAR[b]) hatSlot.add(WEAR[b]());
  if (d && WEAR[d]) (d === 'scarf' || d === 'cape' ? dogBodySlot : dogHeadSlot).add(WEAR[d]());
}
applyWear();
let closetWho = 'boy';
function paintCloset() {
  paintWallet();
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.who === closetWho));
  const grid = $('#closetGrid'); grid.innerHTML = '';
  for (const it of CLOSET.filter(i => i.who === closetWho)) {
    const owned = !!save.owned[it.id], worn = save.wear[it.who] === it.id;
    const el = document.createElement('button');
    el.className = 'citem' + (owned ? ' owned' : '') + (worn ? ' worn' : '') + (!owned && save.wallet < it.price ? ' poor' : '');
    el.innerHTML = `<div class="ic">${it.icon}</div><div>${it.name}</div><div class="pr">${worn ? '입었어요 ✓' : owned ? '입기' : '⭐ ' + it.price}</div>`;
    el.onclick = () => {
      if (owned) { save.wear[it.who] = worn ? null : it.id; persist(); applyWear(); sfx.pop(); if (!worn) speak(MSG.wear); paintCloset(); return; }
      if (save.wallet < it.price) { sfx.tap(); speak(MSG.needStars); return; }
      save.wallet -= it.price; save.owned[it.id] = true; save.wear[it.who] = it.id; persist(); applyWear();
      sfx.chime(); speak(MSG.bought); paintCloset();
    };
    grid.appendChild(el);
  }
}
$('#closetBtn').onclick = () => { if (!playing) return; sfx.pop(); hush(); closetWho = 'boy'; paintCloset(); $('#closet').classList.remove('hide'); };
document.querySelectorAll('.tab').forEach(t => t.onclick = () => { sfx.tap(); closetWho = t.dataset.who; paintCloset(); });
$('#closetClose').onclick = () => { sfx.pop(); $('#closet').classList.add('hide'); };

// 골디 타기 · 점프
let riding = false, jumpY = 0, jumpV = 0;
function canRide() { const m = cur(); return !(m && m.type === 'fetch' && fetchState.step !== 'find' && fetchState.step !== 'done'); }
function dismount() { riding = false; $('#rideBtn').classList.remove('on'); boy.legs.forEach(l => l.rotation.z = 0); }
function setRide(on) {
  if (on && !canRide()) { say(MSG.rideNo, true, 2000); return; }
  riding = on; $('#rideBtn').classList.toggle('on', on); tutEvent('ride', on);
  if (on) { goldie.group.position.x = boy.group.position.x; goldie.group.position.z = boy.group.position.z; sfx.bark(); }
  boy.legs.forEach((l, i) => l.rotation.z = on ? (i ? -0.9 : 0.9) : 0);
  say(on ? MSG.rideOn : MSG.rideOff, true, 2200);
}
function doJump() {
  if (!playing || blocked() || jumpY > 0.02) return;
  jumpV = riding ? 7.2 : 6.6; questEvent('jump'); tutEvent('jump'); tone(420, 0.18, 'sine', 0.13, 0, 900);
}
$('#rideBtn').addEventListener('pointerdown', e => { e.preventDefault(); if (!playing || blocked()) return; setRide(!riding); });
$('#jumpBtn').addEventListener('pointerdown', e => { e.preventDefault(); doJump(); });
addEventListener('keydown', e => { if (e.code === 'Space' && !talkSkip && !e.repeat) { e.preventDefault(); doJump(); } if (e.code === 'KeyR' && playing && !blocked()) setRide(!riding); });

// 발소리 (지역마다 다르게, 아주 작게)
function stepSound(r) {
  if (!ac || !save.sound) return;
  if (r === 'snow') tone(260 + Math.random() * 60, 0.06, 'square', 0.018);
  else if (r === 'beach' || r === 'flat') tone(160 + Math.random() * 40, 0.05, 'triangle', 0.03);
  else if (r === 'cave') tone(300 + Math.random() * 80, 0.05, 'sine', 0.03);
  else tone(200 + Math.random() * 50, 0.04, 'triangle', 0.025);
}

// 배경음악: 지역마다 다른 곡을 그 자리에서 만들어(합성) 되풀이한다. 저작권 걱정 없음
const MUSIC_CFG = {
  forest: { bpm: 100, root: 60, mode: 'maj', inst: 'pluck', drums: 1, seed: 11 },
  night: { bpm: 74, root: 60, mode: 'maj', inst: 'harp', drums: 0, seed: 12 },
  valley: { bpm: 88, root: 65, mode: 'maj', inst: 'harp', drums: 0, seed: 13 },
  beach: { bpm: 112, root: 67, mode: 'maj', inst: 'marimba', drums: 1, seed: 14 },
  cave: { bpm: 70, root: 57, mode: 'min', inst: 'bell', drums: 0, seed: 15 },
  flat: { bpm: 104, root: 62, mode: 'maj', inst: 'marimba', drums: 1, seed: 16 },
  snow: { bpm: 82, root: 64, mode: 'maj', inst: 'bell', drums: 0, seed: 17 },
  boss: { bpm: 128, root: 57, mode: 'min', inst: 'pluck', drums: 2, seed: 18 },
};
function renderMusic(cfg) {
  const sr = 22050, spb = 60 / cfg.bpm, bars = 8, dur = bars * 4 * spb;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new OAC(1, Math.ceil(sr * dur), sr);
  const out = oc.createGain(); out.gain.value = 0.9; out.connect(oc.destination);
  const r = seeded(cfg.seed);
  const f = n => 440 * Math.pow(2, (n - 69) / 12);
  const note = (t, n, d, type, vol, atk = 0.01) => {
    const o = oc.createOscillator(), g = oc.createGain(); o.type = type; o.frequency.value = f(n);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
  };
  const INST = {
    pluck: (t, n) => { note(t, n, 0.35, 'triangle', 0.16); note(t, n + 12, 0.15, 'sine', 0.04); },
    harp: (t, n) => { note(t, n, 0.9, 'sine', 0.15); note(t, n, 0.5, 'triangle', 0.05); },
    marimba: (t, n) => { note(t, n, 0.28, 'sine', 0.2); note(t, n + 24, 0.06, 'sine', 0.05); },
    bell: (t, n) => { note(t, n, 1.3, 'sine', 0.12); note(t, n + 19, 0.6, 'sine', 0.035); },
  };
  const prog = cfg.mode === 'maj' ? [0, 7, 9, 5] : [0, 8, 3, 10];
  const scale = cfg.mode === 'maj' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
  const pitches = []; for (let o = 0; o < 2; o++) for (const s of scale) pitches.push(cfg.root + o * 12 + s);
  // 4마디 가락을 만들어 두 번 (끝은 으뜸음으로)
  const phrase = []; let idx = 4;
  for (let i = 0; i < 32; i++) { if (r() < (cfg.inst === 'bell' || cfg.inst === 'harp' ? 0.45 : 0.32)) { phrase.push(null); continue; } idx = Math.max(0, Math.min(pitches.length - 1, idx + Math.floor(r() * 5) - 2)); phrase.push(pitches[idx]); }
  phrase[31] = null; phrase[28] = pitches[5];
  let noise = null;
  if (cfg.drums) { noise = oc.createBuffer(1, sr * 0.1, sr); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); }
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * spb, root = cfg.root - 12 + prog[bar % 4];
    note(t0, root - 12, spb * 1.8, 'triangle', 0.22); note(t0 + 2 * spb, root - 12 + (bar % 2 ? 7 : 0), spb * 1.8, 'triangle', 0.18);
    for (const iv of [0, cfg.mode === 'maj' && ![9].includes(prog[bar % 4]) ? 4 : 3, 7]) note(t0, root + iv, spb * 4, 'sine', 0.035, 0.4);
    for (let k = 0; k < 8; k++) { const n = phrase[(bar % 4) * 8 + k]; if (n != null) INST[cfg.inst](t0 + k * spb / 2, n); }
    if (cfg.drums) for (let b = 0; b < 4; b++) {
      const tb = t0 + b * spb;
      if (b % 2 === 0) { const o = oc.createOscillator(), g = oc.createGain(); o.frequency.setValueAtTime(130, tb); o.frequency.exponentialRampToValueAtTime(45, tb + 0.12); g.gain.setValueAtTime(0.28, tb); g.gain.exponentialRampToValueAtTime(0.0001, tb + 0.15); o.connect(g); g.connect(out); o.start(tb); o.stop(tb + 0.2); }
      const hs = oc.createBufferSource(), hf = oc.createBiquadFilter(), hg = oc.createGain(); hs.buffer = noise; hf.type = 'highpass'; hf.frequency.value = 6000; hg.gain.value = cfg.drums === 2 ? 0.07 : 0.04;
      hs.connect(hf); hf.connect(hg); hg.connect(out); hs.start(tb + spb / 2);
    }
  }
  return oc.startRendering();
}
let musicBus = null, musicNow = null, musicKey = null;
const musicBufs = {};
function musicDuck(on) { if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.07 : 0.2, ac.currentTime, 0.15); }
function wantMusic() {
  if (save.music === false) return null;
  const m = cur(); if (m && m.type === 'boss' && bossReady) return 'boss';
  if (region === 'forest' && nightK > 0.5) return 'night';
  return MUSIC_CFG[region] ? region : 'forest';
}
function updateMusic() {
  if (!ac || !playing) return;
  const key = wantMusic();
  if (key === musicKey) return;
  musicKey = key;
  if (!musicBus) { musicBus = ac.createGain(); musicBus.gain.value = 0.2; musicBus.connect(ac.destination); }
  if (musicNow) { const o = musicNow; o.g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.5); setTimeout(() => { try { o.src.stop(); } catch (e) {} }, 3000); musicNow = null; }
  if (!key) return;
  if (!musicBufs[key]) musicBufs[key] = renderMusic(MUSIC_CFG[key]).catch(() => null);
  musicBufs[key].then(buf => {
    if (!buf || musicKey !== key) return;
    const g = ac.createGain(); g.gain.value = 0.0001; g.connect(musicBus);
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(g); src.start();
    g.gain.setTargetAtTime(1, ac.currentTime, 0.6);
    musicNow = { src, g };
  });
}

// ───────── 낚시: 연못 · 계곡 · 바다 (잡으면 특징을 듣고 놓아준다) ─────────
const FISH = STORY.fish;
const FISH_SPOTS = [
  { kind: 'pond', x: 15, z: 17.7, face: 0, name: '연못' },
  { kind: 'stream', x: -18, z: -55.8, face: 0, name: '계곡' },
  { kind: 'sea', x: 74.5, z: 10, face: -Math.PI / 2, name: '바다' },
];
save.fishLog = save.fishLog || {};
// 나무 발판 + 낚시 이정표
for (const sp of FISH_SPOTS) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) { const pl = mesh(new THREE.BoxGeometry(1.6, 0.08, 0.36), mat(0xb98a55)); pl.position.set(0, 0.05, -0.2 - i * 0.42); g.add(pl); }
  for (const x of [-0.7, 0.7]) g.add(at(cyl(0.06, 0.06, 0.7, 0x8a5a2b, 5), x, -0.15, -1.5));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshStandardMaterial({ map: signTex('🎣'), side: THREE.DoubleSide }));
  sign.position.set(0.95, 1.2, 0.3); g.add(sign); g.add(at(cyl(0.05, 0.05, 1.2, 0x8a5a2b, 5), 0.95, 0.6, 0.3));
  g.position.set(sp.x, Math.max(0, groundH(sp.x, sp.z)), sp.z); g.rotation.y = sp.face; scene.add(g);
  sp.told = false;
}
function nearFishSpot() {
  const bp = boy.group.position;
  return FISH_SPOTS.find(sp => flatDist(bp, sp) < 2.4 && walkable(sp.x, sp.z)) || null;
}
const fishCv = $('#fishCanvas'), fctx = fishCv.getContext('2d');
let fishing = null; // { spot, state, t, wait, bx, by, ripples[], reel, catch }
function openFishing(sp) {
  if (riding) dismount();
  fishing = { spot: sp, state: 'ready', t: 0, bx: 0.6, by: 0.62, ripples: [], reel: 0, nibble: 0 };
  $('#fishCatch').classList.add('hide'); $('#reelWrap').classList.add('hide');
  $('#fish').classList.remove('hide'); paintFishCount();
  fishMsg(MSG.fishReady, true);
}
function paintFishCount() {
  const all = ['pond', 'stream', 'sea'].flatMap(k => FISH[k]);
  $('#fishCount').textContent = `잡아 본 물고기 ${all.filter(f => save.fishLog[f.id]).length} / ${all.length}`;
}
function fishMsg(text, voice) { $('#fishMsg').textContent = text; if (voice) speak(text); }
function pickFish(kind) {
  const list = [...FISH[kind], FISH.junk];
  let tot = list.reduce((a, f) => a + f.w, 0), r = Math.random() * tot;
  for (const f of list) { r -= f.w; if (r <= 0) return f; }
  return list[0];
}
function fishTap() {
  const f = fishing; if (!f) return;
  if (f.state === 'ready') {
    f.state = 'cast'; f.t = 0; f.bx = 0.45 + Math.random() * 0.35; f.by = 0.55 + Math.random() * 0.15;
    f.wait = 1.8 + Math.random() * 2.8; tone(500, 0.25, 'sine', 0.1, 0, 220);
    fishMsg(MSG.fishCast, !save.toldCast); save.toldCast = true; return;
  }
  if (f.state === 'cast' || f.state === 'wait') { f.state = 'ready'; fishMsg(MSG.fishEarly, true); return; }
  if (f.state === 'bite') {
    f.state = 'reel'; f.t = 0; f.reel = 0.15; f.catch = pickFish(f.spot.kind);
    $('#reelWrap').classList.remove('hide'); fishMsg(MSG.fishReel, true); sfx.pop(); return;
  }
  if (f.state === 'reel') {
    f.reel = Math.min(1, f.reel + 0.13); tone(700 + f.reel * 500, 0.06, 'triangle', 0.1);
    if (f.reel >= 1) landFish();
  }
}
function landFish() {
  const f = fishing, c = f.catch;
  f.state = 'caught'; $('#reelWrap').classList.add('hide');
  sfx.splash(); sfx.chime();
  const isJunk = c.id === 'junk';
  const size = isJunk ? 0 : Math.round(c.min + Math.random() * (c.max - c.min));
  const isNew = !isJunk && !save.fishLog[c.id];
  if (!isJunk) save.fishLog[c.id] = Math.max(save.fishLog[c.id] || 0, size);
  persist(); paintFishCount();
  $('#fcEmoji').textContent = c.emoji; $('#fcName').textContent = (isNew ? '🆕 ' : '') + c.name;
  $('#fcSize').textContent = isJunk ? '물이 깨끗해졌어요 ✨' : `${size}cm`;
  $('#fcFact').textContent = c.fact;
  $('#fcRelease').textContent = isJunk ? '🗑️ 버리기' : '💚 놓아주기';
  $('#fishCatch').classList.remove('hide');
  speak(isNew ? [MSG.fishNew, c.got, c.fact] : [c.got, c.fact]);
  addStars(isNew ? 5 : isJunk ? 1 : 2); if (!isJunk) { addXP(3); questEvent('fish', f.spot.kind); }
  fishMsg(c.got);
}
$('#fcRelease').addEventListener('click', e => {
  e.stopPropagation(); sfx.pop(); hush();
  const junk = fishing && fishing.catch && fishing.catch.id === 'junk';
  $('#fishCatch').classList.add('hide');
  if (!junk) { fishing.ripples.push({ x: 0.5, y: 0.7, r: 0, a: 1 }); fishMsg(MSG.fishRelease, true); }
  fishing.state = 'ready';
  setTimeout(() => { if (fishing && fishing.state === 'ready') fishMsg(MSG.fishReady); }, 2200);
});
$('#fish').addEventListener('pointerdown', e => {
  if (e.target.closest('#fishClose') || e.target.closest('#fishCatch')) return;
  e.preventDefault(); fishTap();
});
$('#fishClose').addEventListener('click', () => { sfx.pop(); hush(); $('#fish').classList.add('hide'); fishing = null; });
$('#fishBtn').addEventListener('pointerdown', e => { e.preventDefault(); const sp = nearFishSpot(); if (sp && !blocked()) { sfx.pop(); openFishing(sp); } });

function updateFishing(dt, t) {
  // 낚시터 근처면 낚시 버튼
  const sp = playing && !blocked() ? nearFishSpot() : null;
  $('#fishBtn').classList.toggle('hide', !sp);
  if (sp && !sp.told) { sp.told = true; say(MSG.fishSpot, true, 3000); }
  const f = fishing; if (!f) return;
  f.t += dt;
  if (f.state === 'cast' && f.t > 0.6) { f.state = 'wait'; f.t = 0; f.ripples.push({ x: f.bx, y: f.by, r: 0, a: 1 }); tone(300, 0.15, 'sine', 0.08); }
  if (f.state === 'wait') {
    if (Math.random() < dt * 0.8) { f.nibble = 0.25; tone(900, 0.04, 'sine', 0.05); }
    if (f.t > f.wait) { f.state = 'bite'; f.t = 0; f.ripples.push({ x: f.bx, y: f.by, r: 0, a: 1 }, { x: f.bx, y: f.by, r: 0.03, a: 1 }); sfx.splash(); fishMsg(MSG.fishNow, true); }
  }
  if (f.state === 'bite' && f.t > 1.5) { f.state = 'ready'; fishMsg(MSG.fishMiss, true); }
  if (f.state === 'reel') {
    f.reel = Math.max(0, f.reel - dt * 0.12); // 물고기가 살살 당긴다
    $('#reelBar').style.width = (f.reel * 100) + '%';
    if (f.t > 9) { f.state = 'ready'; $('#reelWrap').classList.add('hide'); fishMsg(MSG.fishMiss, true); }
  }
  f.nibble = Math.max(0, f.nibble - dt);
  drawFishing(t);
}
function drawFishing(t) {
  const f = fishing, w = fishCv.clientWidth, h = fishCv.clientHeight; if (!w || !h) return;
  const dpr = Math.min(devicePixelRatio, 2);
  if (fishCv.width !== Math.round(w * dpr)) { fishCv.width = Math.round(w * dpr); fishCv.height = Math.round(h * dpr); }
  const c = fctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const kind = f.spot.kind, horizon = h * (kind === 'sea' ? 0.3 : 0.34);
  // 하늘
  let g = c.createLinearGradient(0, 0, 0, horizon); g.addColorStop(0, nightK > 0.5 ? '#2b3560' : '#9fd8ff'); g.addColorStop(1, nightK > 0.5 ? '#4a5585' : '#d8f0ff');
  c.fillStyle = g; c.fillRect(0, 0, w, horizon);
  // 건너편 둑
  if (kind === 'pond') { c.fillStyle = '#6fae4a'; c.beginPath(); c.moveTo(0, horizon); for (let x = 0; x <= w; x += 20) c.lineTo(x, horizon - 18 - Math.sin(x * 0.02) * 10); c.lineTo(w, horizon); c.fill(); c.fillStyle = '#3f7f35'; for (let x = 20; x < w; x += 70) { c.beginPath(); c.arc(x, horizon - 30, 16, 0, 7); c.fill(); } }
  else if (kind === 'stream') { c.fillStyle = '#5b8f4a'; c.fillRect(0, horizon - 26, w, 26); c.fillStyle = '#9aa09a'; for (let x = 10; x < w; x += 46) { c.beginPath(); c.ellipse(x, horizon - 4, 18, 10, 0, 0, 7); c.fill(); } }
  else { c.fillStyle = '#7fc3e6'; c.fillRect(0, horizon - 2, w, 2); }
  // 물
  g = c.createLinearGradient(0, horizon, 0, h); g.addColorStop(0, kind === 'sea' ? '#4aa3d1' : '#6cbfd9'); g.addColorStop(1, kind === 'sea' ? '#1f6f9e' : '#3a8fb0');
  c.fillStyle = g; c.fillRect(0, horizon, w, h - horizon);
  c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2;
  for (let i = 0; i < 7; i++) { const y = horizon + 18 + i * (h - horizon) / 7, off = (t * 20 + i * 37) % 80; c.beginPath(); for (let x = -80 + off; x < w; x += 80) { c.moveTo(x, y); c.quadraticCurveTo(x + 20, y - 4, x + 40, y); } c.stroke(); }
  // 고리 물결
  for (let i = f.ripples.length - 1; i >= 0; i--) { const r = f.ripples[i]; r.r += 0.0011; r.a -= 0.018; if (r.a <= 0) { f.ripples.splice(i, 1); continue; } c.strokeStyle = `rgba(255,255,255,${r.a})`; c.lineWidth = 2; c.beginPath(); c.ellipse(r.x * w, r.y * h, r.r * w, r.r * w * 0.35, 0, 0, 7); c.stroke(); }
  // 낚싯대 · 줄 · 찌
  const tipX = w * 0.14, tipY = h * 0.22;
  c.strokeStyle = '#7a4a1f'; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(w * 0.02, h * 1.02); c.lineTo(tipX, tipY); c.stroke();
  const out = f.state !== 'ready' && f.state !== 'caught';
  if (out) {
    let bx = f.bx * w, by = f.by * h;
    if (f.state === 'cast') { const k = Math.min(1, f.t / 0.6); bx = tipX + (bx - tipX) * k; by = tipY + (by - tipY) * k - Math.sin(k * Math.PI) * h * 0.25; }
    let dip = 0;
    if (f.state === 'wait') dip = Math.sin(t * 3) * 1.5 + (f.nibble > 0 ? Math.sin(f.nibble * 40) * 4 : 0);
    if (f.state === 'bite') dip = 12;
    if (f.state === 'reel') { dip = 8 + Math.sin(t * 14) * 3; bx += Math.sin(t * 2.3) * w * 0.08 * (1 - f.reel); by += (h * 0.92 - by) * f.reel * 0.6; }
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(tipX, tipY); c.quadraticCurveTo((tipX + bx) / 2, Math.min(tipY, by) + 30, bx, by + dip - 8); c.stroke();
    if (f.state === 'reel') { c.fillStyle = 'rgba(20,40,60,.45)'; c.beginPath(); c.ellipse(bx + 10, by + 22, 34, 11, Math.sin(t * 3) * 0.3, 0, 7); c.fill(); }
    // 찌 (빨강·흰색), 물에 잠기면 아래가 가려진다
    c.save(); c.beginPath(); c.rect(0, 0, w, by + 4); c.clip();
    c.fillStyle = '#e2533f'; c.beginPath(); c.arc(bx, by + dip - 8, 8, Math.PI, 0); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(bx, by + dip - 8, 8, 0, Math.PI); c.fill();
    c.restore();
    if (f.state === 'bite') { c.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 6; i++) { const a = t * 6 + i; c.beginPath(); c.arc(bx + Math.cos(a) * 16, by - 6 - Math.abs(Math.sin(a * 1.3)) * 14, 3, 0, 7); c.fill(); } }
  }
}

// ───────── 끝없는 탐험: 손님 친구 · 친구 데리고 다니기 · 탐험 게시판 · 탐험가 등급 ─────────
const VISITORS = STORY.visitors || [];
const VMAKE = { butterfly: makeButterfly, bee: makeBee, mantis: makeMantis, hedgehog: makeHedgehog, woodpecker: makeWoodpecker, firefly: makeFirefly, treefrog: makeTreefrog,
  otter: makeOtter, damselfly: makeDamselfly, strider: makeStrider, gull: makeGull, jellyfish: makeJellyfish, egret: makeEgret, roedeer: makeRoedeer, marten: makeMarten };
Object.assign(MAKERS, VMAKE);
for (const v of VISITORS) DEF[v.id] = v;
const VSCALE = { butterfly: 1.4, bee: 1.6, mantis: 1.5, hedgehog: 1.3, woodpecker: 1.3, firefly: 2, treefrog: 1.5, otter: 1.1, damselfly: 1.4, strider: 2, gull: 1, jellyfish: 1.3, egret: 1, roedeer: 0.85, marten: 1.1 };
function regionOpen(r) { return r === 'forest' || !!gates[r]?.open; }
const visitorCs = VISITORS.map(v => {
  const holder = new THREE.Group();
  const c = addCreature(v.id, holder, new V3(), new V3(), VSCALE[v.id] || 1, (c, dt, t) => {
    const m = c.made, k = c.vis.move;
    if (m.wings) m.wings.forEach(({ p, s }, i) => p.rotation.z = Math.sin(t * (v.id === 'butterfly' ? 9 : 26) + i) * 0.7 * s);
    if (k === 'fly') { m.group.position.set(Math.cos(t * 0.6 + c.ph) * 0.8, Math.sin(t * 1.7 + c.ph) * 0.2, Math.sin(t * 0.6 + c.ph) * 0.6); m.group.rotation.y = -t * 0.6 - c.ph; }
    else if (k === 'water') { m.group.position.set(Math.cos(t * 0.4 + c.ph) * 0.6, Math.sin(t * 1.3) * 0.04, Math.sin(t * 0.4 + c.ph) * 0.6); m.group.rotation.y = -t * 0.4 - c.ph; if (m.legs) m.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 2 + i) * 0.2); }
    else { m.group.position.x = Math.sin(t * 0.35 + c.ph) * 0.5; m.group.rotation.y = Math.cos(t * 0.35 + c.ph) > 0 ? Math.PI / 2 - 0.3 : -Math.PI / 2 + 0.3; }
    if (m.head) m.head.rotation.y = Math.sin(t * 0.8 + c.ph) * 0.4;
    if (m.glow) m.glow.material.color.setScalar(0.75 + 0.25 * Math.sin(t * 1.5 + c.ph)); // 느린 숨쉬기
  });
  c.vis = v; c.ph = Math.random() * 6; c.appear = 0; holder.visible = false;
  if (v.move === 'fly') c.hit.scale.setScalar(1.3);
  return c;
});
function visTimeOK(v) { return v.time === 'night' ? nightK > 0.5 : v.time === 'day' ? nightK < 0.5 : true; }
function placeVisitor(c) {
  const v = c.vis, [x, z] = v.spots[Math.floor(Math.random() * v.spots.length)];
  const water = v.move === 'water';
  const y = water ? (v.id === 'jellyfish' ? -0.3 : -0.06) : Math.max(0, groundH(x, z)) + (v.move === 'fly' ? 1.5 : 0);
  c.holder.position.set(x, y, z); c.anchor.set(x, 0, z);
  // 관찰하러 서는 자리: 남쪽(화면 쪽) 걸을 수 있는 곳
  let st = new V3(x, 0, z + 2.8);
  for (let d = 2.8; d < 7 && (!walkable(st.x, st.z) || isWater(st.x, st.z) && !water); d += 0.8) st.set(x, 0, z + d);
  if (v.id === 'jellyfish') st.set(x - 2.6, 0, z);
  c.stand.copy(st);
  c.vis.active = true;
}
let visitorRollAt = 0;
function rollVisitors() {
  visitorCs.forEach(c => { c.vis.active = false; });
  const open = visitorCs.filter(c => regionOpen(c.vis.region));
  const unfound = open.filter(c => !save.found[c.vis.id]).sort(() => Math.random() - 0.5);
  const found = open.filter(c => save.found[c.vis.id]).sort(() => Math.random() - 0.5);
  [...unfound.slice(0, 4), ...found.slice(0, 2), ...unfound.slice(4, 5)].slice(0, 6).forEach(placeVisitor);
  visitorRollAt = clock.elapsedTime;
}

// 친구 데리고 다니기
const FLY_BUDDY = new Set(['bat', 'kingfisher', 'owl', 'cicada', 'ladybug', 'butterfly', 'bee', 'firefly', 'damselfly', 'woodpecker', 'gull']);
const BUBBLE_BUDDY = new Set(['minnow', 'jellyfish', 'strider']);
let buddy = null;
function makeBuddy(id) {
  if (buddy) { scene.remove(buddy.root); buddy = null; }
  if (!id) return;
  const made = MAKERS[id]();
  if (id === 'bat' && made.body) made.body.rotation.z = 0; // 데리고 다닐 땐 바로 서서 난다
  const root = new THREE.Group(); root.add(made.group);
  const box = new THREE.Box3().setFromObject(made.group), size = box.getSize(new V3());
  const fly = FLY_BUDDY.has(id), bubble = BUBBLE_BUDDY.has(id);
  made.group.scale.multiplyScalar((fly || bubble ? 0.5 : 0.7) / Math.max(size.x, size.y, size.z));
  box.setFromObject(made.group); made.group.position.y -= box.min.y;
  if (bubble) { const b = new THREE.Mesh(GEO.ball, new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false })); b.scale.setScalar(0.42); b.position.y = 0.2; b.renderOrder = 4; root.add(b); }
  const bp = boy.group.position; root.position.set(bp.x - 1, bp.y, bp.z + 1);
  scene.add(root);
  buddy = { id, root, made, fly, bubble, hop: 0, ph: 0 };
}
function setBuddy(id) {
  save.buddy = save.buddy === id ? null : id; persist();
  makeBuddy(save.buddy);
  if (save.buddy) { sfx.chime(); spawnHearts(buddy.root.position.clone().setY(buddy.root.position.y + 0.8)); say(MSG.buddyOn, true, 2500); }
  else say(MSG.buddyOff, true, 2500);
}
function updateBuddy(dt, t, moving) {
  if (!buddy) return;
  const bp = boy.group.position, r = buddy.root.position;
  const fwd = new V3(Math.sin(boy.group.rotation.y), 0, Math.cos(boy.group.rotation.y)), side = new V3(fwd.z, 0, -fwd.x);
  const goal = bp.clone().addScaledVector(fwd, -1.1).addScaledVector(side, -0.9);
  const d = new V3(goal.x - r.x, 0, goal.z - r.z), dist = d.length();
  let walk = false;
  if (dist > 0.25) { const sp = Math.min(dist, (2 + dist * 2.4) * dt); d.normalize(); r.x += d.x * sp; r.z += d.z * sp; buddy.root.rotation.y += (Math.atan2(d.x, d.z) - buddy.root.rotation.y) * 0; turnToward(buddy.root, Math.atan2(d.x, d.z), dt, 6); walk = true; }
  if (dist > 12) r.set(goal.x, r.y, goal.z);
  buddy.ph += dt * (walk ? 10 : 2);
  const water = isWater(r.x, r.z), gy = water ? -0.25 : Math.max(-0.2, groundH(r.x, r.z));
  let y = gy;
  if (buddy.fly) y = Math.max(gy, 0) + 1.5 + Math.sin(t * 2.2) * 0.15;
  else if (buddy.bubble) y = Math.max(gy, 0) + 0.45 + Math.sin(t * 1.8) * 0.12;
  else y = gy + (walk ? Math.abs(Math.sin(buddy.ph)) * 0.12 : 0);
  if (buddy.hop > 0) { buddy.hop = Math.max(0, buddy.hop - dt * 1.6); y += Math.sin(buddy.hop * Math.PI) * 0.6; }
  r.y += (y - r.y) * Math.min(1, dt * 8);
  const m = buddy.made;
  if (m.wings) m.wings.forEach(({ p, s }, i) => p.rotation.z = Math.sin(t * 20 + i) * 0.6 * s);
  if (m.tail && m.tail.rotation) m.tail.rotation.y = Math.sin(t * 5) * 0.3;
  if (m.legs) m.legs.forEach((l, i) => { if (l.rotation) l.rotation.x = walk ? Math.sin(buddy.ph + i) * 0.4 : 0; });
}
function buddyCheer() { if (buddy) buddy.hop = 1; }

// 탐험가 등급 (경험치는 끝없이 쌓인다)
save.xp = save.xp || 0;
const RANKS = STORY.ranks || ['탐험가'];
const lvlOf = xp => 1 + Math.floor(Math.sqrt(xp / 8));
const rankOf = lvl => Math.min(RANKS.length - 1, Math.floor((lvl - 1) / 2));
function addXP(n) {
  const before = lvlOf(save.xp); save.xp += n; persist();
  const after = lvlOf(save.xp);
  if (after > before) {
    refreshHud();
    const r0 = rankOf(before), r1 = rankOf(after);
    setTimeout(() => { sfx.item(); spawnSparks(boy.group.position.clone().setY(boy.group.position.y + 1.8), [0xffd23f, 0xff8fb1, 0x7dd3fc], 18); say(r1 > r0 ? MSG['rank_' + r1] : MSG.rankUp, true, 3000); }, 1200);
  }
}

// 탐험 게시판: 의뢰 3개, 하나를 끝내면 새 의뢰가 생긴다 (끝없이)
const QUESTS = STORY.quests || [];
save.board = save.board || { offers: [], active: null, prog: 0, done: {} };
function questOK(q) {
  if (q.type === 'find') { const c = visitorCs.find(c => c.vis.id === q.target); return c && c.vis.active && !save.found[q.target] && visTimeOK(c.vis); }
  if (q.type === 'stars') return regionOpen(q.region) && starSpots.some((s, i) => !starGot(i) && regionAt(s.x, s.z) === q.region);
  if (q.type === 'fish') return q.place === 'pond' || (q.place === 'stream' ? regionOpen('valley') : regionOpen('beach'));
  if (q.type === 'buddy') return regionOpen(q.region) && Object.keys(save.found).some(k => k !== 'goldie');
  if (q.type === 'chest') return chests.some(c => !c.opened && regionOpen(regionAt(c.x, c.z)));
  return true;
}
function refillBoard() {
  const b = save.board;
  b.offers = b.offers.filter(id => { const q = QUESTS.find(x => x.id === id); return q && questOK(q); });
  const pool = QUESTS.filter(q => !b.offers.includes(q.id) && questOK(q)).sort((a, z) => (b.done[a.id] || 0) - (b.done[z.id] || 0) + (Math.random() - 0.5) * 2);
  while (b.offers.length < 3 && pool.length) b.offers.push(pool.shift().id);
  if (b.active && !b.offers.includes(b.active)) { b.active = null; b.prog = 0; }
  persist(); paintQuest();
}
const curQuest = () => QUESTS.find(q => q.id === save.board.active) || null;
function paintQuest() {
  const q = curQuest(), el = $('#questTrack');
  if (!q) { el.textContent = '📜 탐험 게시판'; el.classList.remove('on'); return; }
  const need = q.count || 1, shown = q.type === 'ride' ? Math.floor(save.board.prog) : save.board.prog;
  el.textContent = `${q.icon} ${q.text} (${Math.min(shown, need)}/${need})`; el.classList.add('on');
}
function openBoard() {
  sfx.pop(); hush(); refillBoard();
  const list = $('#boardList'); list.innerHTML = '';
  for (const id of save.board.offers) {
    const q = QUESTS.find(x => x.id === id);
    const el = document.createElement('button');
    el.className = 'qitem' + (save.board.active === id ? ' on' : '');
    el.innerHTML = `<div class="qi">${q.icon}</div><div class="qt">${q.text}</div><div class="qr">⭐ ${q.reward}</div>`;
    el.onclick = () => { sfx.tap(); save.board.active = id; save.board.prog = 0; persist(); paintQuest(); speak([MSG.questPick, q.text]); openBoard(); };
    list.appendChild(el);
  }
  $('#board').classList.remove('hide');
}
function questEvent(type, data, amount = 1) {
  const q = curQuest(); if (!q || q.type !== type) return;
  if (type === 'find' && data !== q.target) return;
  if ((type === 'stars' || type === 'buddy') && data !== q.region) return;
  if (type === 'fish' && data !== q.place) return;
  save.board.prog += amount;
  if (save.board.prog >= (q.count || 1)) questDone(q); else { persist(); paintQuest(); }
}
function questDone(q) {
  const b = save.board; b.done[q.id] = (b.done[q.id] || 0) + 1; b.active = null; b.prog = 0;
  b.offers = b.offers.filter(id => id !== q.id);
  sfx.chime(); cheer = 1; buddyCheer();
  addStars(q.reward, boy.group.position.clone().setY(boy.group.position.y + 1.6)); addXP(q.reward * 2);
  say([MSG.questDone, MSG.questNew], true, 4000);
  refillBoard();
}
$('#boardBtn').onclick = () => { if (playing && !blocked()) openBoard(); };
$('#questTrack').onclick = () => { if (playing && !blocked()) openBoard(); };
$('#boardClose').onclick = () => { sfx.pop(); $('#board').classList.add('hide'); };

function updateEndless(dt, t, moving) {
  if (playing && clock.elapsedTime - visitorRollAt > 720) { rollVisitors(); refillBoard(); } // 12분마다 손님이 바뀐다
  updateBuddy(dt, t, moving);
  if (!playing) return;
  const q = curQuest();
  if (q && q.type === 'ride' && riding && moving) { save.board.prog += dt; if (save.board.prog >= q.count) questDone(q); else if (Math.floor(save.board.prog) !== Math.floor(save.board.prog - dt)) paintQuest(); }
  if (q && q.type === 'buddy' && buddy && region === q.region) questEvent('buddy', region);
}

// ───────── 시작 화면: 주인공 고르기 (빙글 도는 3D 미리보기) ─────────
const HERO_IDS = Object.keys(HEROES);
let heroSel = HEROES[save.hero] ? save.hero : 'explorer';
let heroPrev = null;
function setupHeroPreview() {
  const cv = $('#heroCanvas');
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); r.setPixelRatio(Math.min(devicePixelRatio, 2));
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x9ab88a, 1.8)); const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(2, 4, 4); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 30); cam.position.set(0, 1.2, 4.3); cam.lookAt(0, 0.95, 0);
  const spin = new THREE.Group(); sc.add(spin);
  heroPrev = { r, sc, cam, spin, cv };
  showHeroPreview();
}
function showHeroPreview() {
  if (!heroPrev) return;
  while (heroPrev.spin.children.length) heroPrev.spin.remove(heroPrev.spin.children[0]);
  heroPrev.spin.add(makeBoy(HEROES[heroSel]).group);
  $('#heroName').textContent = HEROES[heroSel].name;
}
function pickHero(d) {
  heroSel = HERO_IDS[(HERO_IDS.indexOf(heroSel) + d + HERO_IDS.length) % HERO_IDS.length];
  showHeroPreview(); initAudio(); sfx.pop();
  speak(STORY.heroes[heroSel].line);
}
$('#heroPrev').onclick = () => pickHero(-1);
$('#heroNext').onclick = () => pickHero(1);
function updateHeroPreview(dt) {
  if (!heroPrev) return;
  const { r, sc, cam, spin, cv } = heroPrev, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * r.getPixelRatio())) { r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  spin.rotation.y += dt * 0.9; r.render(sc, cam);
}
function closeHeroPreview() { if (heroPrev) { heroPrev.r.dispose(); heroPrev.r.forceContextLoss(); heroPrev = null; } }
setupHeroPreview();

// ───────── 가방: 모은 물건 ─────────
const ITEMS = STORY.items || [];
const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));
if (!save.bag) { // 이전 진행에서 이미 얻었을 것들을 채워 둔다
  save.bag = {};
  if (save.flashlight) save.bag.flashlight = 1;
  if (save.step > MISSIONS.findIndex(m => m.type === 'fetch')) save.bag.ball = 1;
  const gemOf = { ch1: 'gem_green', ch2: 'gem_blue', ch3: 'gem_yellow', ch4: 'sun', ch5: 'sun', ch6: 'sun' };
  for (const ch of CHAPTERS) if (gemOf[ch.id] && gemDone(ch)) save.bag[gemOf[ch.id]] = (save.bag[gemOf[ch.id]] || 0) + 1;
  persist();
}
function addItem(id, n = 1, announce = true) {
  if (!ITEM[id]) return;
  save.bag[id] = (save.bag[id] || 0) + n; persist();
  const b = $('#bagBtn'); b.classList.remove('bump'); b.offsetHeight; b.classList.add('bump');
  if (announce) say(ITEM[id].got, true, 2200);
}
function openBag() {
  sfx.pop(); hush(); $('#bagWallet').textContent = `⭐ ${save.wallet}`;
  const grid = $('#bagGrid'); grid.innerHTML = '';
  const groups = [['🏅 소중한 것', ['gem', 'tool']], ['🌿 자연 보물', ['nature', 'treasure']], ['🥋 발차기 전리품', ['loot']]];
  let any = false;
  for (const [title, kinds] of groups) {
    const h = document.createElement('div'); h.className = 'bagHead'; h.textContent = title; grid.appendChild(h);
    for (const it of ITEMS.filter(i => kinds.includes(i.kind))) {
      const n = save.bag[it.id] || 0; if (n) any = true;
      const el = document.createElement('button'); el.className = 'bitem' + (n ? '' : ' none');
      el.innerHTML = `<div class="ic">${it.emoji}</div><div>${n ? it.name : '???'}</div>` + (n > 1 ? `<span class="ct">×${n}</span>` : '');
      el.onclick = () => { if (!n) return; sfx.tap(); $('#bagDesc').textContent = `${it.emoji} ${it.name} — ${it.desc}`; speak(it.desc); };
      grid.appendChild(el);
    }
  }
  $('#bagDesc').textContent = any ? '물건을 톡 하면 설명을 들려줘요.' : MSG.bagEmpty;
  if (!any) speak(MSG.bagEmpty);
  $('#bag').classList.remove('hide');
  tutEvent('bagOpen');
}
$('#bagBtn').onclick = () => { if (playing && !blocked()) openBag(); };
$('#bagClose').onclick = () => { sfx.pop(); hush(); $('#bag').classList.add('hide'); tutEvent('bagClose'); };
const TREASURE_BY = { forest: ['pinecone', 'clover', 'feather', 'petal'], valley: ['pebble', 'feather'], beach: ['pebble', 'petal'], cave: ['crystal'], flat: ['pebble'], snow: ['pinecone', 'feather'] };
function chestTreasure(x, z) { const list = TREASURE_BY[regionAt(x, z)] || ['pebble']; addItem(list[Math.floor(Math.random() * list.length)], 1, false); }

// ───────── 태권도 발차기 · 심술 구름 ─────────
let kickT = 0, kickKind = 0, finisher = null;
const KICK_DUR = 0.5;
function doKick() {
  if (!playing || blocked() || kickT > 0.05) return;
  kickT = KICK_DUR; kickKind = (kickKind + 1) % 3;
  tone(300, 0.18, 'sawtooth', 0.05, 0, 900); tone(160, 0.1, 'triangle', 0.08, 0.12);
  if (!vSrc && !talkOpen) speak(MSG.kickYap[Math.floor(Math.random() * MSG.kickYap.length)]);
  if (riding) dismount();
  tutEvent('kick');
  const bp = boy.group.position;
  const foot = bp.clone().add(new V3(Math.sin(boy.group.rotation.y) * 0.9, 0.9, Math.cos(boy.group.rotation.y) * 0.9));
  spawnSparks(foot, [0xffffff, 0xffe680], 6);
  // 마무리 발차기
  if (finisher) { finishBoss(); return; }
  // 가까운 심술 구름
  let hit = false;
  for (const g of grumps) if (!g.gone && flatDist(bp, g.pos) < 2.8) { poofGrump(g); hit = true; }
  // 악당의 연기 구름도 발차기로 날린다
  if (!hit) { const near = clouds.filter(c => !c.gone).sort((a, b) => flatDist(a.mesh.position, bp) - flatDist(b.mesh.position, bp))[0]; if (near && flatDist(near.mesh.position, bp) < 5) puffCloud(near); }
}
$('#kickBtn').addEventListener('pointerdown', e => { e.preventDefault(); doKick(); });
addEventListener('keydown', e => { if ((e.code === 'KeyF' || e.code === 'KeyK') && !e.repeat) doKick(); });
function updateKick(dt) {
  if (kickT <= 0) { if (boy.model) { boy.model.rotation.y = 0; boy.model.rotation.x = 0; } return; }
  kickT = Math.max(0, kickT - dt);
  const k = 1 - kickT / KICK_DUR, sw = Math.sin(k * Math.PI);
  if (kickKind === 0) { boy.legs[1].rotation.x = -1.8 * sw; boy.legs[0].rotation.x = 0.2 * sw; boy.arms.forEach(a => a.rotation.x = -1.0 * sw); boy.model.rotation.x = -0.15 * sw; }        // 앞차기
  else if (kickKind === 1) { boy.model.rotation.y = k * Math.PI * 2; boy.legs[0].rotation.x = -1.5 * sw; boy.arms[0].rotation.x = -1.2 * sw; }                                                     // 돌려차기
  else { boy.arms[1].rotation.x = -1.7 * sw; boy.arms[0].rotation.x = 0.3 * sw; boy.legs[0].rotation.x = 0.3 * sw; boy.legs[1].rotation.x = -0.3 * sw; }                                           // 지르기
}
function makeGrump() {
  const g = new THREE.Group();
  const m = new THREE.Group(); g.add(m);
  for (const [x, y, z, r] of [[0, 0, 0, 0.42], [-0.34, -0.06, 0, 0.3], [0.34, -0.06, 0, 0.3], [0, 0.26, -0.05, 0.3]]) m.add(at(blob(r, r * 0.85, r, 0x6d7380, {}, true), x, y, z));
  for (const s of [-1, 1]) { m.add(at(eye(0.08), 0.14 * s, 0.04, 0.34)); const b = at(blob(0.09, 0.022, 0.025, 0x22262e), 0.14 * s, 0.17, 0.4); b.rotation.z = -0.45 * s; m.add(b); }
  const mo = mesh(new THREE.TorusGeometry(0.07, 0.018, 5, 10, Math.PI), mat(0x22262e)); mo.position.set(0, -0.1, 0.4); m.add(mo);
  return { group: g, m };
}
const grumps = [];
let grumpCool = 20;
function spawnGrump() {
  const bp = boy.group.position, r0 = regionAt(bp.x, bp.z);
  for (let tries = 0; tries < 30; tries++) {
    const a = Math.random() * Math.PI * 2, d = 7 + Math.random() * 7, x = bp.x + Math.cos(a) * d, z = bp.z + Math.sin(a) * d;
    if (!walkable(x, z) || isWater(x, z) || regionAt(x, z) !== r0) continue;
    if (colliders.some(c => Math.hypot(x - c.x, z - c.z) < c.r + 0.6)) continue;
    const made = makeGrump(); scene.add(made.group);
    const pos = new V3(x, 0, z);
    made.group.position.set(x, groundH(x, z) + 1.1, z);
    addXray(made.group, 0xb0b8c8, 0.5);
    grumps.push({ made, pos, gone: false, k: 1, ph: Math.random() * 6, home: pos.clone() });
    return;
  }
}
function poofGrump(g) {
  g.gone = true; g.k = 1;
  tone(800, 0.25, 'sine', 0.14, 0, 200); tone(400, 0.2, 'triangle', 0.08, 0.05, 1200);
  spawnSparks(g.made.group.position.clone(), [0x9aa3b5, 0xffffff, 0xd8dee8], 14);
  addStars(2); addXP(2); addItem('fluff', 1, false); questEvent('kick');
  if (!save.toldPoof) { save.toldPoof = true; persist(); say(MSG.cloudPoof, true, 2200); }
}
function updateGrumps(dt, t) {
  const bp = boy.group.position;
  grumpCool -= dt;
  const alive = grumps.filter(g => !g.gone).length;
  if (playing && !talkOpen && !finisher && save.found.goldie && save.tutDone && grumpCool < 0 && alive < 3 && !(cur() && cur().type === 'boss')) { spawnGrump(); grumpCool = 35 + Math.random() * 25; }
  for (let i = grumps.length - 1; i >= 0; i--) {
    const g = grumps[i], gr = g.made.group;
    if (g.gone) { g.k -= dt * 2.5; gr.scale.setScalar(Math.max(0.01, 1 + (1 - g.k) * 0.8)); gr.position.y += dt * 2; gr.traverse(o => { if (o.material && o.material.opacity !== undefined) { o.material.transparent = true; } }); if (g.k <= 0) { scene.remove(gr); grumps.splice(i, 1); } continue; }
    // 둥실둥실 떠다니며 주인공 쪽을 기웃
    const d = flatDist(bp, g.pos);
    if (d < 9 && d > 2) { const dir = new V3(bp.x - g.pos.x, 0, bp.z - g.pos.z).normalize(); g.pos.addScaledVector(dir, dt * 0.6); }
    else g.pos.x = g.home.x + Math.sin(t * 0.3 + g.ph) * 1.5;
    gr.position.set(g.pos.x, Math.max(0, groundH(g.pos.x, g.pos.z)) + 1.1 + Math.sin(t * 1.8 + g.ph) * 0.15, g.pos.z);
    gr.rotation.y = Math.atan2(bp.x - g.pos.x, bp.z - g.pos.z);
    if (d < 9 && !save.toldGrump && !blocked()) { save.toldGrump = true; persist(); say(MSG.minionHere, true, 3500); }
  }
  // 얍 버튼 반짝: 가까이 심술 구름이나 마무리 차례
  const ready = !!finisher || grumps.some(g => !g.gone && flatDist(bp, g.pos) < 2.8);
  $('#kickBtn').classList.toggle('ready', ready);
}
// 악당 마무리: 구름을 다 날리면 얍! 한 번으로 어질어질
function startFinisher() {
  const m = cur(); if (!m || m.type !== 'boss') return;
  finisher = { t: 0, who: m.villain || 'smogi' };
  say(MSG.bossFinish, true, 4000);
}
function finishBoss() {
  const f = finisher; finisher = null;
  smogiHurt = 1; sfx.chime();
  const a = actors[f.who]; if (a) spawnSparks(a.made.group.position.clone(), [0xffd23f, 0xffffff, 0xff8fb1], 22);
  addItem(f.who === 'jjiri' ? 'bolt' : 'fluff', 1, false);
  say(MSG.bossDizzy, true, 2000);
  setTimeout(() => { const m = cur(); if (m && m.type === 'boss') completeMission(); }, 1800);
}
function updateFinisher(dt) {
  if (!finisher) return;
  finisher.t += dt;
  if (finisher.t > 18) finishBoss(); // 버튼을 못 찾아도 막히지 않게
}

// ───────── 튜토리얼 (처음 시작할 때 손가락이 하나씩 짚어 준다) ─────────
let tut = null;
const tutRing = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 }));
tutRing.rotation.x = -Math.PI / 2; tutRing.visible = false; scene.add(tutRing);
const tutStar = new THREE.Mesh(starGeo, new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb800, emissiveIntensity: 0.6, flatShading: true })); tutStar.visible = false; tutStar.scale.setScalar(1.4); scene.add(tutStar);
const TUT_STEPS = ['move', 'jump', 'star', 'ride', 'kick', 'bag', 'done'];
function startTutorial(then) {
  tut = { i: -1, then, wait: 0 };
  say(MSG.tutHello, true, 3000);
  setTimeout(() => nextTut(), 2800);
}
function tutCard(text, n) {
  const box = $('#mission'); box.classList.remove('hide');
  $('#mIcon').textContent = '🎓'; $('#mText').textContent = text; $('#mStep').textContent = `연습 ${n} / ${TUT_STEPS.length - 1}`;
}
function nextTut() {
  if (!tut) return;
  tut.i++; tut.sub = 0;
  const s = TUT_STEPS[tut.i], bp = boy.group.position;
  tutRing.visible = false; tutStar.visible = false; tut.goal = null;
  if (s === 'move') {
    let p = new V3(bp.x, 0, bp.z - 6); if (!walkable(p.x, p.z)) p = new V3(bp.x + 5, 0, bp.z);
    tut.target = p; tutRing.position.set(p.x, groundH(p.x, p.z) + 0.08, p.z); tutRing.visible = true; tut.goal = { pos: p, look: p };
    tutCard('끌어서 반짝이는 동그라미까지 가요', 1); say(MSG.tutMove, true, 6000);
  } else if (s === 'jump') { tutCard('점프 버튼을 눌러요', 2); say(MSG.tutJump, true, 4000); }
  else if (s === 'star') {
    const p = new V3(bp.x + 2.5, 0, bp.z - 2.5); tut.target = p; tutStar.position.set(p.x, groundH(p.x, p.z) + 0.7, p.z); tutStar.visible = true; tut.goal = { pos: p, look: p };
    tutCard('반짝이는 별을 주워요', 3); say(MSG.tutStar, true, 4000);
  } else if (s === 'ride') { tutCard('타기 버튼으로 골디를 타요', 4); say(MSG.tutRide, true, 4000); }
  else if (s === 'kick') { tutCard('얍 버튼으로 발차기!', 5); say(MSG.tutKick, true, 4000); }
  else if (s === 'bag') { tutCard('가방을 열어 봐요', 6); say(MSG.tutBag, true, 4000); }
  else {
    $('#tutHand').classList.add('hide');
    sfx.chime(); spawnSparks(bp.clone().setY(bp.y + 1.6), [0xff6b6b, 0xffd23f, 0x5cd65c, 0x4da6ff], 24); addStars(3);
    say(MSG.tutDone, true, 3000);
    save.tutDone = true; persist();
    const then = tut.then; tut = null;
    setTimeout(() => then && then(), 2800);
  }
}
function tutEvent(type, v) {
  if (!tut) return;
  const s = TUT_STEPS[tut.i];
  if (s === 'jump' && type === 'jump') setTimeout(nextTut, 900);
  else if (s === 'ride' && type === 'ride') { if (v && tut.sub === 0) { tut.sub = 1; setTimeout(() => { if (tut) say(MSG.tutRideOff, true, 3000); }, 1500); } else if (!v && tut.sub === 1) { tut.sub = 2; setTimeout(nextTut, 700); } }
  else if (s === 'kick' && type === 'kick') setTimeout(nextTut, 1000);
  else if (s === 'bag' && type === 'bagOpen' && tut.sub === 0) { tut.sub = 1; setTimeout(() => { if (tut) say(MSG.tutBagClose, true, 3000); }, 2500); }
  else if (s === 'bag' && type === 'bagClose' && tut.sub >= 1) setTimeout(nextTut, 500);
}
function handAt(el) { const h = $('#tutHand'); h.classList.remove('hide', 'swipe'); const r = el.getBoundingClientRect(); h.style.left = (r.left + r.width / 2) + 'px'; h.style.top = (r.top + r.height * 0.55) + 'px'; }
function updateTutorial(dt, t) {
  if (!tut || tut.i < 0) { if (!tut) $('#tutHand').classList.add('hide'); return; }
  const s = TUT_STEPS[tut.i], bp = boy.group.position;
  const busy = cardOpen || talkOpen;
  if (s === 'move') {
    tutRing.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    const h = $('#tutHand'); h.classList.remove('hide'); h.classList.add('swipe'); h.style.left = (innerWidth * 0.5) + 'px'; h.style.top = (innerHeight * 0.78) + 'px';
    if (flatDist(bp, tut.target) < 1.4 && tutRing.visible) { tutRing.visible = false; sfx.pop(); nextTut(); }
  } else if (s === 'jump') handAt($('#jumpBtn'));
  else if (s === 'star') {
    $('#tutHand').classList.add('hide');
    tutStar.rotation.y = t * 2; tutStar.position.y = groundH(tut.target.x, tut.target.z) + 0.7 + Math.sin(t * 2) * 0.1;
    if (tutStar.visible && flatDist(bp, tut.target) < 1.2) { tutStar.visible = false; sfxStar(); addStars(1, tut.target.clone().setY(0.8)); nextTut(); }
  } else if (s === 'ride') handAt($('#rideBtn'));
  else if (s === 'kick') handAt($('#kickBtn'));
  else if (s === 'bag') handAt(tut.sub === 0 ? $('#bagBtn') : $('#bagClose'));
  if (busy) $('#tutHand').classList.add('hide');
}
$('#setTut').onclick = () => { $('#settings').classList.add('hide'); if (playing && !tut) startTutorial(() => paintMission()); };

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

// 액션 버튼을 캐릭터 발밑에 (화면 밖으로는 안 나가게, 부드럽게 따라감)
let actX = -1, actY = -1;
function placeActBtns() {
  const el = $('#actBtns'); if (el.classList.contains('hide')) return;
  const bp = boy.group.position, sp = tmpV.set(bp.x, bp.y + 0.05, bp.z).project(camera);
  const w = el.offsetWidth || 300, h = el.offsetHeight || 120, short = innerHeight < 500;
  let x = (sp.x + 1) / 2 * innerWidth, y = (1 - sp.y) / 2 * innerHeight + (short ? 10 : 18);
  x = Math.max(w / 2 + 8, Math.min(innerWidth - w / 2 - 8, x));
  y = Math.max(innerHeight * 0.35, Math.min(innerHeight - h - 8, y));
  if (actX < 0) { actX = x; actY = y; } else { actX += (x - actX) * 0.25; actY += (y - actY) * 0.25; }
  el.style.left = actX.toFixed(1) + 'px'; el.style.top = actY.toFixed(1) + 'px';
}

// ───────── 메인 루프 ─────────
const UP = new V3(0, 1, 0);
let boyBaseY = 0, camY = 0, detour = 0, detourSide = 1, stuck = 0, region = 'forest', swimPh = 0, rippleCool = 0;
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
  const speed = (inWater ? 3.8 : 5.5) * (riding ? 1.7 : 1);
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

  // 주인공 몸짓 (걷기 / 헤엄 / 골디 타기)
  const sw = moving ? 1 : 0;
  if (riding) {
    boy.legs[0].rotation.x = -1.2; boy.legs[1].rotation.x = -1.2;
    boy.arms[0].rotation.x = -0.9 + (moving ? Math.sin(t * 10) * 0.18 : 0); boy.arms[1].rotation.x = -0.9 - (moving ? Math.sin(t * 10) * 0.18 : 0);
    if (inWater) { rippleCool -= dt; if (rippleCool < 0) { spawnRipple(bp); rippleCool = moving ? 0.3 : 1.1; } }
  } else if (inWater) {
    swimPh += dt * (moving ? 7 : 2.5);
    boy.arms[0].rotation.x = -1.6 + Math.sin(swimPh) * 1.4; boy.arms[1].rotation.x = -1.6 - Math.sin(swimPh) * 1.4;
    boy.legs[0].rotation.x = Math.sin(swimPh * 2) * 0.4; boy.legs[1].rotation.x = -Math.sin(swimPh * 2) * 0.4;
    rippleCool -= dt; if (rippleCool < 0) { spawnRipple(bp); rippleCool = moving ? 0.35 : 1.1; }
  } else {
    const prevStep = Math.floor(walkPh / Math.PI);
    walkPh += dt * (moving ? 11 : 0);
    if (moving && Math.floor(walkPh / Math.PI) !== prevStep) stepSound(rNow);
    const s1 = moving ? Math.sin(walkPh) : 0;
    boy.legs[0].rotation.x = s1 * 0.6; boy.legs[1].rotation.x = -s1 * 0.6;
    boy.arms[0].rotation.x = -s1 * 0.5; boy.arms[1].rotation.x = s1 * 0.5;
  }
  let by = riding ? (inWater ? -0.55 : groundH(bp.x, bp.z)) + 0.42 + (moving ? Math.abs(Math.sin(gWalkPh)) * 0.08 : 0)
    : inWater ? -0.62 + Math.sin(t * 2) * 0.04 : groundH(bp.x, bp.z) + (moving ? Math.abs(Math.sin(walkPh)) * 0.06 : Math.sin(t * 2) * 0.01);
  if (cheer > 0 && !inWater && !riding) { cheer = Math.max(0, cheer - dt * 1.2); by += Math.sin((1 - cheer) * Math.PI * 2) ** 2 * 0.35 * cheer; boy.arms.forEach(a => a.rotation.x = -2.6 * cheer); }
  // 점프 (물에서도 퐁)
  if (jumpV !== 0 || jumpY > 0) {
    jumpV -= 20 * dt; jumpY += jumpV * dt;
    if (jumpY <= 0) { jumpY = 0; jumpV = 0; if (!inWater) tone(150, 0.06, 'triangle', 0.05); else { spawnRipple(bp); sfx.splash(); } }
  }
  boyBaseY += (by - boyBaseY) * Math.min(1, dt * 8);
  boy.group.position.y = boyBaseY + jumpY;
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
  const gp = goldie.group.position;
  if (riding) { // 골디 등에 탔을 때: 주인공 밑에서 함께 달린다
    gp.x = bp.x; gp.z = bp.z; goldie.group.rotation.y = boy.group.rotation.y;
    gWalkPh += dt * (moving ? 16 : 0);
    goldie.legs.forEach((l, i) => l.rotation.x = moving ? Math.sin(gWalkPh + (i < 2 ? 0 : 2)) * 0.8 : 0);
    goldie.tail.rotation.y = Math.sin(t * 14) * 0.6;
    goldie.ears.forEach((e, i) => e.rotation.x = moving ? -0.4 + Math.sin(gWalkPh + i) * 0.2 : 0);
    goldie.head.rotation.z = 0;
    gp.y = (inWater ? -0.55 : groundH(bp.x, bp.z)) + (moving ? Math.abs(Math.sin(gWalkPh)) * 0.08 : 0) + jumpY;
    if (moving && Math.floor(gWalkPh / Math.PI) !== Math.floor((gWalkPh - dt * 16) / Math.PI) && !inWater) stepSound(rNow);
  } else {
  const gg = goldieGoal();
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
  }

  // 친구들
  const tgt = cur() && cur().type === 'meet' ? byId(cur().target) : null;
  for (const c of creatures) {
    const want = c.vis ? (c.vis.active && visTimeOK(c.vis) ? 1 : 0) : c.def.time === 'night' ? nightK : 1;
    c.appear += (want - c.appear) * Math.min(1, dt * 2);
    c.holder.visible = c.appear > 0.02;
    if (c.def.time === 'night' || c.vis) c.holder.scale.setScalar(Math.max(0.001, c.appear));
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
  updateStars(dt, t); updateChests(dt, t); updateSparks(dt); updateMusic(); updateFishing(dt, t);
  updateKick(dt); updateGrumps(dt, t); updateFinisher(dt); updateTutorial(dt, t);
  if (!playing) updateHeroPreview(dt);
  $('#actBtns').classList.toggle('hide', !playing || blocked());
  updateEndless(dt, t, moving); autoSave(dt); // 겹창이 뜨면 점프·타기 버튼은 숨긴다
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
  placeActBtns();
  drawMini(t);
  if (cardOpen && cardSpin) { cardSpin.rotation.y += dt * 0.6; sizeCard(); cardR.render(cardScene, cardCam); }
}
// 처음 카메라 위치
camera.position.copy(boy.group.position).add(CAM_OFF);
frame();

// ───────── 자동 저장 · 이어하기 ─────────
let saveT = 0;
function snapshot() {
  if (!playing) return;
  const p = boy.group.position;
  if (!isWater(p.x, p.z)) save.pos = { x: +p.x.toFixed(2), z: +p.z.toFixed(2), ry: +boy.group.rotation.y.toFixed(2) };
  save.savedAt = Date.now();
}
function autoSave(dt) { if (!playing) return; saveT += dt; if (saveT > 3) { saveT = 0; snapshot(); persist(); } }
addEventListener('pagehide', () => { snapshot(); persist(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { snapshot(); persist(); } });
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {} // 저장이 지워지지 않게 부탁
function restorePosition() {
  const p = save.pos; if (!p || !walkable(p.x, p.z)) return;
  boy.group.position.set(p.x, groundH(p.x, p.z), p.z); boy.group.rotation.y = p.ry || 0; faceAngle = p.ry || 0;
  boyBaseY = groundH(p.x, p.z); camY = Math.max(0, boyBaseY);
  goldie.group.position.set(p.x + 1.4, groundH(p.x + 1.4, p.z), p.z + 0.4);
  camera.position.copy(boy.group.position).add(CAM_OFF);
  region = regionAt(p.x, p.z);
}
// 시작 화면: 저장이 있으면 '이어서 탐험하기'
const hasSave = !!(save.found && save.found.goldie);
if (hasSave) {
  $('#startBtn').textContent = '▶ 이어서 탐험하기';
  const mNow = MISSIONS[Math.min(step, MISSIONS.length - 1)];
  $('#saveInfo').textContent = `${HEROES[heroSel].name} · ${save.done ? '모든 이야기 완료!' : `미션 ${Math.min(step + 1, MISSIONS.length)}/${MISSIONS.length} ${mNow.icon}`} · ⭐ ${save.wallet || 0} · 친구 ${Object.keys(save.found).length}`;
  $('#saveInfo').classList.remove('hide'); $('#newGameBtn').classList.remove('hide');
}
$('#newGameBtn').onclick = () => { if (confirm('지금까지의 진행을 모두 지우고 처음부터 새로 할까요?')) { localStorage.removeItem(SAVE_KEY); location.reload(); } };
// 저장 코드: 다른 브라우저·기기로 옮기기
$('#setExport').onclick = async () => {
  snapshot(); persist();
  const code = 'FF1:' + btoa(unescape(encodeURIComponent(JSON.stringify(save))));
  try { await navigator.clipboard.writeText(code); alert('저장 코드를 복사했어요. 다른 기기의 게임에서 「저장 코드 넣기」에 붙여 넣으세요.'); }
  catch (e) { prompt('아래 저장 코드를 길게 눌러 복사하세요.', code); }
};
$('#setImport').onclick = () => {
  const code = (prompt('복사해 둔 저장 코드를 붙여 넣으세요.') || '').trim();
  if (!code) return;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(code.replace(/^FF1:/, '')))));
    if (!data || !data.found) throw 0;
    localStorage.setItem(SAVE_KEY, JSON.stringify(data)); alert('불러왔어요! 게임을 다시 시작해요.'); location.reload();
  } catch (e) { alert('저장 코드가 올바르지 않아요. 다시 복사해 주세요.'); }
};

// ───────── 시작·설정 ─────────
refreshHud();
// 시작할 때 전체 화면 + 가로 고정 (안드로이드 크롬 등에서 됨. 아이폰 사파리는 홈 화면 추가로)
function goFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const p = req.call(el, { navigationUI: 'hide' });
    if (p && p.then) p.then(() => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => {});
  } catch (e) {}
}
$('#startBtn').onclick = () => {
  if (document.body.classList.contains('phone')) goFullscreen();
  initAudio(); sfx.pop(); preloadVoices();
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.speak(new SpeechSynthesisUtterance('')); } // iOS 음성 잠금 풀기
  save.hero = heroSel; persist(); setHero(heroSel); closeHeroPreview();
  restorePosition();
  $('#title').classList.add('hide'); playing = true; $('#actBtns').classList.remove('hide'); paintWallet();
  rollVisitors(); refillBoard(); makeBuddy(save.buddy); refreshHud();
  const tellVisitors = () => { if (talkOpen || blocked()) { setTimeout(tellVisitors, 3000); return; } save.toldVisitors = true; persist(); say(NEW_DAY ? [MSG.newDay, MSG.visitorsHere] : MSG.visitorsHere, true, 5000); };
  if (save.found.goldie && (NEW_DAY || !save.toldVisitors)) setTimeout(tellVisitors, 9000);
  if (!save.found.goldie) {
    goldie.group.position.set(-6, 0, 2);
    setTimeout(() => { sfx.bark(); say(MSG.dogComing, true, 2200); }, 400);
    setTimeout(() => { save.found.goldie = true; persist(); sfx.chime(); cardBookId = 'goldie'; openCard('goldie', true, null); }, 2600);
  } else if (save.done) say(MSG.backDone);
  else if (!save.toldFun) { save.toldFun = true; persist(); say(MSG.newFun, true, 6000); setTimeout(() => startMission(), 6500); }
  else if (!save.tutDone) { setTimeout(() => startTutorial(() => startMission()), 600); } // 튜토리얼 도중에 껐으면 다시
  else { speak(MSG.back); setTimeout(() => startMission(), 2600); }
};
// 부모용 설정: 톱니를 1초 꾹
let gearT = 0;
$('#gear').addEventListener('pointerdown', () => { gearT = setTimeout(openSettings, 1000); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('#gear').addEventListener(ev, () => clearTimeout(gearT)));
function paintSettings() {
  $('#setVoice').textContent = save.voice ? '🗣️ 읽어 주기: 켬' : '🗣️ 읽어 주기: 끔';
  $('#setSound').textContent = save.sound ? '🔔 효과음: 켬' : '🔔 효과음: 끔';
  $('#setMusic').textContent = save.music !== false ? '🎵 배경음악: 켬' : '🎵 배경음악: 끔';
}
function openSettings() { paintSettings(); $('#settings').classList.remove('hide'); }
$('#setVoice').onclick = () => { save.voice = !save.voice; persist(); if (!save.voice) hush(); paintSettings(); };
$('#setSound').onclick = () => { save.sound = !save.sound; persist(); paintSettings(); };
$('#setMusic').onclick = () => { save.music = save.music === false; persist(); paintSettings(); };
$('#setReset').onclick = () => { if (confirm('도감과 진행을 모두 지우고 처음부터 할까요?')) { localStorage.removeItem(SAVE_KEY); location.reload(); } };
$('#setClose').onclick = () => $('#settings').classList.add('hide');

// 시험용 (부모 확인)
window.__game = { get tut() { return tut; }, doKick, get grumps() { return grumps; }, spawnGrump, get finisher() { return finisher; }, openBag, pickHero,  visitorCs, rollVisitors, setBuddy, get buddy() { return buddy; }, questEvent, openBoard,  openFishing, FISH_SPOTS, get fishing() { return fishing; }, fishTap,  renderMusic, MUSIC_CFG, get musicKey() { return musicKey; }, get riding() { return riding; }, setRide, doJump, starSpots, chests,  get simonState() { return simon; }, actors, openSimon, cur, fetchState, completeMission, ballMesh, save, creatures, boy, goldie, setNight, discover, openCard, camera, THREE, gates, walkTo, startMission, items: () => items, clouds: () => clouds, puffCloud, get step() { return step; } };
