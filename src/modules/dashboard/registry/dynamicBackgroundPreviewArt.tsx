// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// dynamicBackgroundPreviewArt.tsx  —  accurate still+animated previews for the
// "Dynamic background preview" dialog. Each entry is an inline SVG that mimics
// the real canvas/CSS background (same palette + composition). Layers tagged
// `.anim …` stay paused until the hosting card is hovered, so hovering a tile
// plays the scene from exactly what the still thumbnail shows. The selected tile
// keeps mounting <DashboardDynamicBackground active/>; because the SVG matches
// the canvas first frame, the swap is seamless.
//
// WIRE-UP (SharedBackgroundPopover.tsx, DynamicBackgroundPreviewDialog):
//   import { DynamicBackgroundPreviewArt } from "../registry/dynamicBackgroundPreviewArt";
//   // replace the paused <span style={dynamicBackgroundStaticPreviewStyle(...)}/>
//   // with:
//   <DynamicBackgroundPreviewArt id={backgroundOption.id} />
// and paste DYNAMIC_BG_PREVIEW_ART_CSS into dashboard.css (or inject once).
// ─────────────────────────────────────────────────────────────────────────────

import type { DynamicBackgroundId } from "./dynamicBackgrounds";

function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let s = h >>> 0;
  return () => { s = Math.imul(s ^ (s >>> 15), 2246822507); s = Math.imul(s ^ (s >>> 13), 3266489909); return ((s ^= s >>> 16) >>> 0) / 4294967296; };
}
const f2 = (n) => Math.round(n * 100) / 100;
function svgWrap(id, inner, defs) {
  return `<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><defs>${defs || ''}</defs>${inner}</svg>`;
}
function lg(id, stops, x1, y1, x2, y2) {
  return `<linearGradient id="${id}" x1="${x1 ?? 0}" y1="${y1 ?? 0}" x2="${x2 ?? 0}" y2="${y2 ?? 1}">${stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"${s[2] != null ? ` stop-opacity="${s[2]}"` : ''}/>`).join('')}</linearGradient>`;
}
function rg(id, stops, cx, cy, r) {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">${stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"${s[2] != null ? ` stop-opacity="${s[2]}"` : ''}/>`).join('')}</radialGradient>`;
}
function blurFilter(id, amt) { return `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${amt}"/></filter>`; }
function loopY(inner, dir) { const off = dir === 'rise' ? 100 : -100; return `<g>${inner}<g transform="translate(0,${off})">${inner}</g></g>`; }
function loopX(inner) { return `<g>${inner}<g transform="translate(-160,0)">${inner}</g></g>`; }

const BUILDERS: Record<string, (id: string) => string> = {};



/* 1. 富士山 — graded sky, sun glow UR, snow-capped cone, forest shore, lake+reflection */
BUILDERS.fuji = (id) => {
  const d = lg(id+'sky',[[0,'#2f6fb8'],[.55,'#6ba6dd'],[1,'#cfe3ef']])
    + rg(id+'sun',[[0,'#fff6e2',.85],[.5,'#fff6e2',.2],[1,'#fff6e2',0]],115,24,70)
    + lg(id+'lake',[[0,'#6ba6cf'],[.5,'#3f6e96'],[1,'#26506f']],0,.62,0,1)
    + lg(id+'rock',[[0,'#828ea3'],[1,'#5d6880']],0,.12,0,.62)
    + blurFilter(id+'cl',3);
  // mountain cone path (concave), peak ~ y12, base y62
  const cone = `M48,62 C66,48 72,22 79,14 L81,14 C88,22 94,48 112,62 Z`;
  const snow = `M68,30 C72,24 76,17 79,14 L81,14 C84,17 88,24 92,30 C88,33 84,30 80,33 C76,30 72,33 68,30 Z`;
  const clouds = `<g fill="#ffffff" filter="url(#${id}cl)" opacity=".9">
    <ellipse cx="35" cy="26" rx="20" ry="5"/><ellipse cx="120" cy="40" rx="16" ry="4"/></g>`;
  const inner = `
    <rect width="160" height="100" fill="url(#${id}sky)"/>
    <rect width="160" height="62" fill="url(#${id}sun)"/>
    <g class="anim drift" style="--d:34s">${loopX(clouds)}</g>
    <circle cx="115" cy="24" r="6" fill="#fffaf0" class="anim br" style="--d:6s; transform-box:fill-box; transform-origin:center"/>
    <path d="${cone}" fill="url(#${id}rock)"/>
    <path d="${snow}" fill="#fdfeff"/>
    <rect y="58" width="160" height="6" fill="#3e6a30"/>
    <rect y="62" width="160" height="38" fill="url(#${id}lake)"/>
    <g opacity=".5"><path d="${cone}" fill="url(#${id}rock)" transform="translate(0,124) scale(1,-1)"/></g>
    <g stroke="#dfeaf3" stroke-width="1" opacity=".35" class="anim br" style="--d:5s">
      <line x1="20" y1="74" x2="55" y2="74"/><line x1="95" y1="84" x2="135" y2="84"/></g>`;
  return svgWrap(id, inner, d);
};

/* 2. 極光 — navy bg, 3 blurred screen blobs cyan/violet/green */
BUILDERS.aurora = (id) => {
  const d = lg(id+'bg',[[0,'#0b1023'],[.6,'#131a36'],[1,'#0a0f24']]) + blurFilter(id+'b',16);
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <g filter="url(#${id}b)" style="mix-blend-mode:screen">
      <ellipse class="anim blob" style="--d:11s" cx="44" cy="30" rx="46" ry="30" fill="#4dd0e1" opacity=".85"/>
      <ellipse class="anim blob" style="--d:14s; animation-direction:alternate-reverse" cx="120" cy="36" rx="50" ry="32" fill="#a78bfa" opacity=".8"/>
      <ellipse class="anim blob" style="--d:13s" cx="70" cy="86" rx="44" ry="28" fill="#34d399" opacity=".7"/>
    </g>`;
  return svgWrap(id, inner, d);
};

/* 3. 雲朵 — blue sky, warm sun UR, white drifting puffs */
BUILDERS.clouds = (id) => {
  const d = lg(id+'sky',[[0,'#4ea8e8'],[.55,'#a3d3f0'],[1,'#dcecf6']])
    + rg(id+'sun',[[0,'#fff0c8',.7],[.4,'#ffebb4',.25],[1,'#ffebb4',0]],125,22,80)
    + blurFilter(id+'c',2.5);
  const puff = cx => `<g fill="#ffffff" filter="url(#${id}c)"><ellipse cx="${cx}" cy="34" rx="13" ry="7"/><ellipse cx="${cx+10}" cy="36" rx="10" ry="6"/><ellipse cx="${cx-9}" cy="37" rx="9" ry="5"/></g>`;
  const set = `${puff(30)}${puff(95)}<g transform="translate(60,22)">${puff(0)}</g>`;
  const inner = `<rect width="160" height="100" fill="url(#${id}sky)"/>
    <rect width="160" height="100" fill="url(#${id}sun)"/>
    <circle cx="125" cy="22" r="8" fill="#fff5d2" class="anim br" style="--d:5s; transform-box:fill-box; transform-origin:center"/>
    <g class="anim drift" style="--d:30s">${loopX(set)}</g>`;
  return svgWrap(id, inner, d);
};

/* 4. 海洋 — warm sunset sky, sea, reflection column, wave bands+foam */
BUILDERS.ocean = (id) => {
  const d = lg(id+'sky',[[0,'#f6e9c8'],[.6,'#f0c79a'],[1,'#dba488']],0,0,0,1)
    + lg(id+'sea',[[0,'#3d6b80'],[.5,'#1f4a63'],[1,'#0b2a3c']],0,0,0,1)
    + rg(id+'ref',[[0,'#ffd28c',.55],[1,'#ffd28c',0]],80,38,80);
  let waves='';
  for(let i=0;i<6;i++){ const y=42+i*9.5; const op=.2+i*.1;
    waves += `<path class="anim" style="animation:driftX ${10-i}s linear infinite" d="M-20,${y} q20,-3 40,0 t40,0 t40,0 t40,0 t40,0" fill="none" stroke="rgba(220,235,245,${op})" stroke-width="1.1"/>`; }
  const inner = `<rect width="160" height="38" fill="url(#${id}sky)"/>
    <circle cx="80" cy="34" r="9" fill="#fff0cf"/>
    <rect y="38" width="160" height="62" fill="url(#${id}sea)"/>
    <rect width="160" height="100" fill="url(#${id}ref)"/>
    ${waves}`;
  return svgWrap(id, inner, d);
};

/* Misty Sea — low sunset, layered haze, dark perspective waves and broken reflection */
BUILDERS.mistySea = (id) => {
  const d = lg(id+'sky',[[0,'#281426'],[.58,'#87404d'],[1,'#ef8b65']],0,0,0,1)
    + lg(id+'sea',[[0,'#351521'],[.45,'#190b15'],[1,'#08070e']],0,0,0,1)
    + rg(id+'sun',[[0,'#fff7d6',1],[.16,'#ffd29b',.9],[.48,'#f09a7b',.22],[1,'#f09a7b',0]],80,50,35)
    + blurFilter(id+'mist',2.8);
  let waves = '';
  for(let i=0;i<8;i++){
    const y=54+i*6.7, amp=1.2+i*.34, op=.18+i*.065;
    waves += `<path class="anim" style="animation:driftX ${12-i*.7}s linear infinite" d="M-24,${y} q18,-${amp} 36,0 t36,0 t36,0 t36,0 t36,0" fill="none" stroke="rgba(244,205,197,${op})" stroke-width="${.65+i*.08}"/>`;
  }
  const clouds = `<g filter="url(#${id}mist)" fill="#d7868e" opacity=".3">
    <ellipse cx="24" cy="28" rx="34" ry="6"/><ellipse cx="103" cy="23" rx="43" ry="7"/><ellipse cx="148" cy="38" rx="31" ry="5"/></g>`;
  const inner = `<rect width="160" height="51" fill="url(#${id}sky)"/>
    <rect width="160" height="100" fill="url(#${id}sun)"/>
    <g class="anim drift" style="--d:42s">${loopX(clouds)}</g>
    <circle cx="80" cy="49" r="6.5" fill="#fff7dc" class="anim br" style="--d:5s; transform-box:fill-box; transform-origin:center"/>
    <rect y="51" width="160" height="49" fill="url(#${id}sea)"/>
    <path d="M75,52 L85,52 L97,100 L63,100 Z" fill="#f7a17d" opacity=".13"/>
    ${waves}
    <rect width="160" height="100" fill="none" stroke="rgba(255,255,255,.06)"/>`;
  return svgWrap(id, inner, d);
};

/* Waters — tropical Gerstner ocean: blue sky, cumulus, sun glitter path, turquoise shallows, foam crests */
BUILDERS.waters = (id) => {
  const d = lg(id+'sky',[[0,'#1b4a94'],[.62,'#4d7fb6'],[1,'#9dbdd6']],0,0,0,1)
    + lg(id+'sea',[[0,'#0d4f68'],[.42,'#0a3550'],[1,'#062a45']],0,0,0,1)
    + rg(id+'glit',[[0,'#fff6d8',.75],[.35,'#ffe2a4',.3],[1,'#ffe2a4',0]],104,40,58)
    + blurFilter(id+'cu',2.4);
  const clouds = `<g filter="url(#${id}cu)"><ellipse cx="34" cy="14" rx="21" ry="6" fill="#f4f8fc" opacity=".85"/>
    <ellipse cx="46" cy="17" rx="15" ry="5" fill="#dfe8f2" opacity=".7"/>
    <ellipse cx="122" cy="10" rx="24" ry="6" fill="#f4f8fc" opacity=".8"/>
    <ellipse cx="86" cy="22" rx="18" ry="4" fill="#e6eef6" opacity=".6"/></g>`;
  let waves = '';
  for(let i=0;i<9;i++){
    const y=42+i*6.6, amp=1+i*.4, op=.14+i*.06;
    waves += `<path class="anim" style="animation:driftX ${13-i*.8}s linear infinite" d="M-24,${y} q17,-${amp} 34,0 t34,0 t34,0 t34,0 t34,0" fill="none" stroke="rgba(226,244,248,${op})" stroke-width="${.6+i*.09}"/>`;
  }
  const inner = `<rect width="160" height="40" fill="url(#${id}sky)"/>
    <g class="anim drift" style="--d:38s">${loopX(clouds)}</g>
    <circle cx="104" cy="15" r="5" fill="#fffbe8" class="anim br" style="--d:6s; transform-box:fill-box; transform-origin:center"/>
    <rect y="40" width="160" height="60" fill="url(#${id}sea)"/>
    <path d="M40,40 L160,40 L160,100 L92,100 Z" fill="#2f9a9a" opacity=".16"/>
    <rect y="40" width="160" height="60" fill="url(#${id}glit)"/>
    ${waves}
    <g fill="#f2fbff" opacity=".55" class="anim br" style="--d:4s">
      <ellipse cx="52" cy="82" rx="11" ry="1.8"/><ellipse cx="118" cy="93" rx="14" ry="2.2"/></g>`;
  return svgWrap(id, inner, d);
};

/* 5. 雨滴 — dark blue, slanted rain streaks, ripples bottom */
BUILDERS.raindrops = (id) => {
  const d = lg(id+'bg',[[0,'#0e1a2a'],[.6,'#162638'],[1,'#0a1422']]);
  const r=rng(id); let lines='';
  for(let i=0;i<46;i++){ const x=r()*180-10, y=r()*100, len=4+r()*7;
    lines+=`<line x1="${f2(x)}" y1="${f2(y)}" x2="${f2(x-len*0.18)}" y2="${f2(y+len)}" stroke="#c8e1ff" stroke-width="1" stroke-opacity="${f2(.25+r()*.5)}"/>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <g class="anim fall" style="--d:1.1s">${loopY(lines,'fall')}</g>
    <g fill="none" stroke="#c8e1ff" stroke-opacity=".4">
      <ellipse class="anim" style="animation:dwbg_pulseR 1.4s ease-out infinite" cx="40" cy="97" rx="9" ry="3" transform-origin="40px 97px"/>
      <ellipse class="anim" style="animation:dwbg_pulseR 1.4s ease-out infinite .7s" cx="110" cy="98" rx="9" ry="3" transform-origin="110px 98px"/></g>`;
  return svgWrap(id, inner, d);
};

/* 6. 雨窗 — blurred city bokeh on dark teal, lens droplets, a sliding trail */
BUILDERS.rainywindow = (id) => {
  const d = lg(id+'bg',[[0,'#0a1320'],[.5,'#0c1a2a'],[1,'#0f2436']]) + blurFilter(id+'b',5);
  const r=rng(id); const hues=['#ffc271','#ffb14a','#7dd0ff','#9fd2ff','#ff8ad0'];
  let bok='';
  for(let i=0;i<14;i++){ const x=r()*160,y=20+r()*78,rr=4+r()*12,c=hues[Math.floor(r()*hues.length)];
    bok+=`<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(rr)}" fill="${c}" opacity="${f2(.25+r()*.4)}"/>`; }
  // crisp droplet lenses (sharper bright dots)
  let lens='';
  for(let i=0;i<6;i++){ const x=r()*160,y=20+r()*70,rr=2+r()*2.4;
    lens+=`<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(rr)}" fill="#dfeefc" opacity=".85"/>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <g filter="url(#${id}b)" class="anim br" style="--d:4s">${bok}</g>
    ${lens}
    <g class="anim fall" style="--d:3.2s"><circle cx="62" cy="-8" r="2.6" fill="#dfeefc"/>
      <path d="M62,-8 q2,30 0,60" stroke="#cfe2f2" stroke-width="2.2" fill="none" opacity=".5"/></g>`;
  return svgWrap(id, inner, d);
};

/* 7. 霜花窗 — frosty night, moon glow, pine silhouettes, frost ferns from corners */
BUILDERS.frostedWindow = (id) => {
  const d = lg(id+'bg',[[0,'#0a1426'],[.5,'#13243d'],[.78,'#1f3a58'],[1,'#2b4a6b']])
    + rg(id+'moon',[[0,'#dceaff',.55],[1,'#dceaff',0]],118,24,46)
    + blurFilter(id+'fz',1.4);
  let trees=''; const r=rng(id); for(let x=2;x<160;x+=12){ const h=10+r()*14; trees+=`<path d="M${f2(x)},72 L${f2(x+5)},${f2(72-h)} L${f2(x+10)},72 Z" fill="#0c1a26"/>`; }
  // frost fern from a corner
  function fern(x,y,a,len,depth){ if(depth<=0||len<3) return ''; const x2=x+Math.cos(a)*len, y2=y+Math.sin(a)*len; let s=`<line x1="${f2(x)}" y1="${f2(y)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="#eaf3ff" stroke-width="${f2(depth*0.3)}" stroke-opacity=".5"/>`; for(let i=1;i<2+depth;i++){const fr=i/(2+depth);const bx=x+Math.cos(a)*len*fr,by=y+Math.sin(a)*len*fr; s+=fern(bx,by,a-0.7,len*0.5*(1-fr*0.4),depth-1)+fern(bx,by,a+0.7,len*0.5*(1-fr*0.4),depth-1);} return s; }
  const ferns = `<g filter="url(#${id}fz)">${fern(2,2,0.9,26,4)}${fern(158,2,2.25,24,4)}${fern(4,98,-0.9,22,3)}</g>`;
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <rect width="160" height="100" fill="url(#${id}moon)"/>
    <circle cx="118" cy="24" r="6" fill="#eef8ff"/>
    ${trees}<rect y="72" width="160" height="28" fill="#7e97b4"/>
    <g class="anim br" style="--d:5s">${ferns}</g>`;
  return svgWrap(id, inner, d);
};

/* 8. 降雪 — slate gradient, falling snow, drift at bottom */
BUILDERS.snow = (id) => {
  const d = lg(id+'bg',[[0,'#2a3340'],[.5,'#3e4a5c'],[1,'#6b7a8e']]);
  const r=rng(id); let flakes='';
  for(let i=0;i<40;i++){ flakes+=`<circle cx="${f2(r()*160)}" cy="${f2(r()*100)}" r="${f2(.8+r()*1.8)}" fill="#f5faff" opacity="${f2(.5+r()*.5)}"/>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <g class="anim fall" style="--d:5s">${loopY(flakes,'fall')}</g>
    <rect y="86" width="160" height="14" fill="#f0f5fc" opacity=".5"/>`;
  return svgWrap(id, inner, d);
};

/* 9. 櫻花 — pink sky, soft sun UL, falling petals */
BUILDERS.sakura = (id) => {
  const d = lg(id+'sky',[[0,'#fce4ec'],[.55,'#fff1f4'],[1,'#fde2cf']])
    + rg(id+'sun',[[0,'#fff0dc',.55],[1,'#fff0dc',0]],32,16,64);
  const r=rng(id); let petals='';
  for(let i=0;i<26;i++){ const x=r()*160,y=r()*100,a=r()*360;
    petals+=`<ellipse cx="${f2(x)}" cy="${f2(y)}" rx="2" ry="4" fill="#ff9bbe" opacity="${f2(.6+r()*.4)}" transform="rotate(${f2(a)} ${f2(x)} ${f2(y)})"/>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}sky)"/>
    <rect width="160" height="100" fill="url(#${id}sun)"/>
    <g class="anim fall" style="--d:6.5s">${loopY(petals,'fall')}</g>`;
  return svgWrap(id, inner, d);
};

/* 10. 螢火蟲 — dark green, floor glow, yellow-green glowing dots */
BUILDERS.fireflies = (id) => {
  const d = lg(id+'bg',[[0,'#0b1a14'],[.5,'#13261c'],[1,'#08130e']])
    + rg(id+'fl',[[0,'#8c6e28',.25],[1,'#8c6e28',0]],80,110,90);
  const r=rng(id); let bugs='';
  for(let i=0;i<14;i++){ const x=r()*160,y=10+r()*80;
    bugs+=`<g class="anim tw" style="--d:${f2(1.5+r()*2)}s; animation-delay:${f2(-r()*3)}s"><circle cx="${f2(x)}" cy="${f2(y)}" r="7" fill="#cfff7a" opacity=".25"/><circle cx="${f2(x)}" cy="${f2(y)}" r="1.6" fill="#f4ffd0"/></g>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <rect width="160" height="100" fill="url(#${id}fl)"/>
    <g style="mix-blend-mode:screen">${bugs}</g>`;
  return svgWrap(id, inner, d);
};

/* 11. 氣泡 — teal water, caustic top, rising bubbles w/ highlight */
BUILDERS.bubbles = (id) => {
  const d = lg(id+'bg',[[0,'#1a6b8c'],[.45,'#0e4263'],[1,'#051c30']]);
  const r=rng(id); let bub='';
  for(let i=0;i<18;i++){ const x=r()*160,y=r()*100,rr=2.5+r()*9;
    bub+=`<g><circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(rr)}" fill="#bfe4f5" opacity="${f2(.18+r()*.22)}"/><circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(rr)}" fill="none" stroke="#dff2ff" stroke-width=".6" opacity=".5"/><circle cx="${f2(x-rr*.4)}" cy="${f2(y-rr*.4)}" r="${f2(rr*.18)}" fill="#fff" opacity=".8"/></g>`; }
  let caustic=''; for(let i=0;i<3;i++){ caustic+=`<path d="M0,${8+i*5} q40,-4 80,0 t80,0" fill="none" stroke="#b4e1ff" stroke-width="2" opacity=".1"/>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>${caustic}
    <g class="anim rise" style="--d:6s">${loopY(bub,'rise')}</g>`;
  return svgWrap(id, inner, d);
};

/* 12. 水族箱 — teal tank, fish, plants, pebbles, bubbles */
BUILDERS.aquarium = (id) => {
  const d = lg(id+'bg',[[0,'#0b6f8f'],[.5,'#0e4f6e'],[1,'#063248']]);
  function fish(x,y,s,c,fin,dir){ const k=dir; return `<g transform="translate(${x},${y}) scale(${k*s},${s})">
    <path d="M0,0 q8,-5 16,0 q-8,5 -16,0 Z" fill="${c}"/>
    <path d="M16,0 l6,-4 l0,8 Z" fill="${fin}"/>
    <circle cx="3" cy="-1" r="1" fill="#0a2230"/></g>`; }
  const plants = `<g class="anim sway" style="--d:5s">
      <path d="M22,100 q-4,-22 2,-40" stroke="#5da33d" stroke-width="4" fill="none"/>
      <path d="M30,100 q5,-18 0,-32" stroke="#7fc35a" stroke-width="3.5" fill="none"/>
      <path d="M138,100 q5,-24 -1,-42" stroke="#5da33d" stroke-width="4" fill="none"/></g>`;
  const r=rng(id); let peb=''; for(let i=0;i<10;i++){ peb+=`<ellipse cx="${f2(r()*160)}" cy="${f2(94+r()*6)}" rx="${f2(4+r()*5)}" ry="${f2(2+r()*2)}" fill="${['#3a4654','#4a5868','#2f3b48'][Math.floor(r()*3)]}"/>`; }
  let bub=''; for(let i=0;i<8;i++){ bub+=`<circle cx="${f2(r()*160)}" cy="${f2(r()*100)}" r="${f2(1+r()*1.6)}" fill="#cfeeff" opacity=".5"/>`; }
  const fishes = `<g class="anim driftr" style="--d:18s">${loopX(fish(40,40,1.1,'#ff8a3d','#ff6a14',1))}</g>
                  <g class="anim drift" style="--d:24s">${loopX(fish(60,60,0.9,'#3fb6f0','#1f8fd6',-1))}</g>
                  <g class="anim drift" style="--d:30s">${loopX(fish(120,30,0.8,'#ffce3a','#f3a200',-1))}</g>`;
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    ${fishes}
    <g class="anim rise" style="--d:7s">${loopY(bub,'rise')}</g>
    <rect y="92" width="160" height="8" fill="#0a3346"/>${peb}${plants}`;
  return svgWrap(id, inner, d);
};

/* 28. 燈塔 — night coast, rotating beam, tower on rock, wave glints */
BUILDERS.lighthouse = (id) => {
  const d = lg(id+'sky',[[0,'#040814'],[.7,'#0a1428'],[1,'#152540']])
    + lg(id+'sea',[[0,'#182a41'],[.5,'#0d1b2e'],[1,'#050c16']],0,.62,0,1)
    + lg(id+'beam',[[0,'#fff4c6',.5],[.6,'#fff4c6',.12],[1,'#fff4c6',0]],126,26,40,26);
  const r=rng(id); let stars='';
  for(let i=0;i<26;i++){ stars+=`<circle class="anim tw" style="--d:${f2(1.5+r()*2)}s; animation-delay:${f2(-r()*3)}s" cx="${f2(r()*160)}" cy="${f2(r()*52)}" r="${f2(.4+r()*.7)}" fill="#d7e4ff"/>`; }
  let waves=''; for(let i=0;i<4;i++){ const y=70+i*8;
    waves+=`<path class="anim" style="animation:driftX ${9-i}s linear infinite" d="M-20,${y} q20,-2 40,0 t40,0 t40,0 t40,0 t40,0" fill="none" stroke="rgba(150,190,225,${f2(.08+i*.05)})" stroke-width="1"/>`; }
  const inner = `<rect width="160" height="62" fill="url(#${id}sky)"/>${stars}
    <rect y="62" width="160" height="38" fill="url(#${id}sea)"/>${waves}
    <g class="anim" style="animation:sweep 6s linear infinite; transform-origin:126px 26px; transform-box:view-box">
      <path d="M126,26 L-40,10 L-40,42 Z" fill="url(#${id}beam)"/>
      <path d="M126,26 L292,10 L292,42 Z" fill="url(#${id}beam)" transform="rotate(180 126 26)"/>
    </g>
    <path d="M100,72 Q112,58 126,57 L146,58 Q156,60 160,70 L160,100 L100,100 Z" fill="#060a12"/>
    <path d="M122,57 L124,33 L128,33 L130,57 Z" fill="#0a0f1a" stroke="rgba(140,170,210,.35)" stroke-width=".7"/>
    <rect x="121" y="31.5" width="10" height="1.6" fill="#0a0f1a"/>
    <rect x="123" y="27" width="6" height="4.5" fill="#0a0f1a" stroke="rgba(160,200,240,.4)" stroke-width=".6"/>
    <path d="M122,27 L126,23.5 L130,27 Z" fill="#0a0f1a"/>
    <circle cx="126" cy="29" r="4" fill="#fff0b4" opacity=".35" class="anim br" style="--d:3s; transform-box:fill-box; transform-origin:center"/>
    <circle cx="126" cy="29" r="1.4" fill="#fff8dc"/>`;
  return svgWrap(id, inner, d);
};

/* 30. 深海水母 — abyss gradient, glowing pulsing jellies, marine snow */
BUILDERS.jellyfish = (id) => {
  const d = lg(id+'bg',[[0,'#04121f'],[.5,'#041627'],[1,'#010710']])
    + rg(id+'g1',[[0,'#7de0f0',.4],[1,'#7de0f0',0]],46,40,22)
    + rg(id+'g2',[[0,'#d08af5',.35],[1,'#d08af5',0]],112,60,18)
    + rg(id+'g3',[[0,'#8ab4ff',.3],[1,'#8ab4ff',0]],86,26,12);
  const r=rng(id); let snow='';
  for(let i=0;i<30;i++){ snow+=`<rect x="${f2(r()*160)}" y="${f2(r()*100)}" width="1" height="1" fill="#bed7eb" opacity="${f2(.15+r()*.3)}"/>`; }
  function jelly(x,y,sc,hue){ let tent='';
    for(let k=0;k<4;k++){ const bx=x-sc*6+k*sc*4;
      tent+=`<path d="M${f2(bx)},${f2(y+sc*1)} q${f2(sc*2)},${f2(sc*8)} ${f2((k%2?1:-1)*sc*2.5)},${f2(sc*16)}" fill="none" stroke="hsla(${hue},85%,72%,.35)" stroke-width="${f2(sc*.5)}" stroke-linecap="round"/>`; }
    return `<g class="anim br" style="--d:${f2(2.5+sc)}s; transform-box:fill-box; transform-origin:center">
      ${tent}
      <path d="M${f2(x-sc*9)},${f2(y)} C${f2(x-sc*9)},${f2(y-sc*10)} ${f2(x+sc*9)},${f2(y-sc*10)} ${f2(x+sc*9)},${f2(y)} C${f2(x+sc*5.5)},${f2(y+sc*1.5)} ${f2(x-sc*5.5)},${f2(y+sc*1.5)} ${f2(x-sc*9)},${f2(y)} Z" fill="hsla(${hue},85%,70%,.5)" stroke="hsla(${hue},90%,80%,.5)" stroke-width=".7"/></g>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <g class="anim fall" style="--d:9s">${loopY(snow,'fall')}</g>
    <g style="mix-blend-mode:screen">
      <rect width="160" height="100" fill="url(#${id}g1)"/>
      <rect width="160" height="100" fill="url(#${id}g2)"/>
      <rect width="160" height="100" fill="url(#${id}g3)"/>
      <g class="anim rise" style="--d:14s">${loopY(jelly(46,40,2.2,'190')+jelly(112,60,1.7,'285')+jelly(86,26,1.1,'220'),'rise')}</g>
    </g>`;
  return svgWrap(id, inner, d);
};

/* 31. 熱氣球 — dawn gradient, misty ridgelines, striped balloons rising */
BUILDERS.balloons = (id) => {
  const d = lg(id+'sky',[[0,'#8894c8'],[.42,'#c9a3b4'],[.72,'#eec39a'],[1,'#f7d98f']])
    + rg(id+'sun',[[0,'#ffecb4',.7],[.4,'#ffdc96',.25],[1,'#ffdc96',0]],38,68,55);
  function balloon(x,y,sc,c1,c2){
    const r1=sc*9;
    return `<g transform="translate(${x},${y})">
      <path d="M${f2(-r1*.26)},${f2(r1*1.3)} C${f2(-r1)},${f2(r1*.5)} ${f2(-r1)},${f2(-r1*.7)} 0,${f2(-r1)} C${f2(r1)},${f2(-r1*.7)} ${f2(r1)},${f2(r1*.5)} ${f2(r1*.26)},${f2(r1*1.3)} Z" fill="${c1}"/>
      <path d="M${f2(-r1*.18)},${f2(r1*1.3)} C${f2(-r1*.7)},${f2(r1*.5)} ${f2(-r1*.7)},${f2(-r1*.7)} 0,${f2(-r1)} C${f2(r1*.7)},${f2(-r1*.7)} ${f2(r1*.7)},${f2(r1*.5)} ${f2(r1*.18)},${f2(r1*1.3)} Z" fill="${c2}"/>
      <path d="M${f2(-r1*.09)},${f2(r1*1.3)} C${f2(-r1*.36)},${f2(r1*.5)} ${f2(-r1*.36)},${f2(-r1*.7)} 0,${f2(-r1)} C${f2(r1*.36)},${f2(-r1*.7)} ${f2(r1*.36)},${f2(r1*.5)} ${f2(r1*.09)},${f2(r1*1.3)} Z" fill="${c1}"/>
      <rect x="${f2(-r1*.15)}" y="${f2(r1*1.62)}" width="${f2(r1*.3)}" height="${f2(r1*.22)}" fill="#6b4a2f"/>
      <line x1="${f2(-r1*.2)}" y1="${f2(r1*1.32)}" x2="${f2(-r1*.1)}" y2="${f2(r1*1.62)}" stroke="#463024" stroke-width=".5"/>
      <line x1="${f2(r1*.2)}" y1="${f2(r1*1.32)}" x2="${f2(r1*.1)}" y2="${f2(r1*1.62)}" stroke="#463024" stroke-width=".5"/></g>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}sky)"/>
    <rect width="160" height="100" fill="url(#${id}sun)"/>
    <path d="M0,72 Q30,66 60,71 T120,69 T160,71 L160,100 L0,100 Z" fill="#a8afc4"/>
    <path d="M0,80 Q40,73 85,79 T160,77 L160,100 L0,100 Z" fill="#82909f"/>
    <path d="M0,90 Q45,82 95,89 T160,86 L160,100 L0,100 Z" fill="#4d686a"/>
    <g class="anim rise" style="--d:12s">${loopY(
      balloon(40,34,1.5,'#e2543e','#f2cf5b')+balloon(104,58,1.05,'#3f7fae','#e8e3d3')+balloon(134,22,.7,'#8a5aa8','#f0b95a'),'rise')}</g>`;
  return svgWrap(id, inner, d);
};

/* 13. 稻田 — green-gold sky, sun UR, distant mountain, golden field, swaying stalks */
BUILDERS.ricefield = (id) => {
  const d = lg(id+'sky',[[0,'#e8f0d4'],[.5,'#f4e2b0'],[1,'#f6cc88']],0,0,0,.5)
    + rg(id+'sun',[[0,'#ffebb4',.55],[1,'#ffebb4',0]],112,22,80)
    + lg(id+'field',[[0,'#caa64a'],[.4,'#d8b54a'],[1,'#7a6020']],0,.42,0,1);
  const r=rng(id);
  let stalks='';
  for(let i=0;i<70;i++){ const x=r()*160; const k=r(); const baseY=58+k*42; const len=4+(1-k)*12; const dx=(r()-.5)*3;
    const hue=38+k*6;
    stalks+=`<g class="anim sway" style="--d:${f2(2.5+r()*2)}s; animation-delay:${f2(-r()*3)}s"><line x1="${f2(x)}" y1="${f2(baseY)}" x2="${f2(x+dx)}" y2="${f2(baseY-len)}" stroke="hsl(${f2(hue)},68%,${f2(58-k*22)}%)" stroke-width="${f2(.8+(1-k))}"/><circle cx="${f2(x+dx)}" cy="${f2(baseY-len)}" r="${f2(.7+(1-k)*.6)}" fill="hsl(${f2(hue+8)},88%,76%)"/></g>`; }
  const inner = `<rect y="0" width="160" height="50" fill="url(#${id}sky)"/>
    <rect width="160" height="100" fill="url(#${id}sun)"/>
    <circle cx="112" cy="22" r="9" fill="#fff5d2" class="anim br" style="--d:5s; transform-box:fill-box; transform-origin:center"/>
    <path d="M0,40 q30,-4 60,0 t60,0 t60,0 L160,50 L0,50 Z" fill="#788e6e" opacity=".55"/>
    <rect y="42" width="160" height="58" fill="url(#${id}field)"/>
    ${stalks}
    <rect y="50" width="160" height="14" fill="#ffebaa" opacity=".15" class="anim br" style="--d:6s"/>`;
  return svgWrap(id, inner, d);
};

/* 14. 天燈 — night purple, moon UR, stars, rising sky lanterns, mountain bottom */
BUILDERS.lanterns = (id) => {
  const d = lg(id+'bg',[[0,'#0a0a1c'],[.45,'#1c1a3a'],[.75,'#3a2a4a'],[1,'#5a3a4a']])
    + rg(id+'moon',[[0,'#ffebc8',.3],[1,'#ffebc8',0]],136,18,70);
  const r=rng(id); let stars=''; for(let i=0;i<24;i++){ stars+=`<rect x="${f2(r()*160)}" y="${f2(r()*55)}" width="1.2" height="1.2" fill="#fffae6" opacity="${f2(.4+r()*.4)}"/>`; }
  function lan(x,y,s){ return `<g transform="translate(${x},${y})"><circle r="${f2(s*2.4)}" fill="#ff8c3c" opacity=".22"/>
    <path d="M${f2(-s*.6)},${f2(-s*.5)} L${f2(s*.6)},${f2(-s*.5)} L${f2(s*.8)},0 L${f2(s*.6)},${f2(s*.5)} L${f2(-s*.6)},${f2(s*.5)} L${f2(-s*.8)},0 Z" fill="#ff9b3a"/>
    <circle r="${f2(s*.22)}" fill="#ffe9b0"/></g>`; }
  let lans=''; for(let i=0;i<10;i++){ const x=r()*160,y=r()*100,s=3+r()*4; lans+=`<g class="anim tw" style="--d:${f2(1.5+r()*1.5)}s; animation-delay:${f2(-r()*2)}s">${lan(x,y,s)}</g>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <rect width="160" height="100" fill="url(#${id}moon)"/>${stars}
    <circle cx="136" cy="18" r="5" fill="#fff0d2"/>
    <g class="anim rise" style="--d:9s">${loopY(lans,'rise')}</g>
    <path d="M0,100 L0,82 Q40,76 80,80 T160,80 L160,100 Z" fill="#0c0a1a"/>`;
  return svgWrap(id, inner, d);
};

/* 15. 星空 — dark, purple nebula, multi-size stars, shooting star */
BUILDERS.starfield = (id) => {
  const d = lg(id+'bg',[[0,'#070a1c'],[.55,'#0c1230'],[1,'#05081a']])
    + rg(id+'neb',[[0,'#5028a0',.4],[.5,'#283ca0',.12],[1,'#000',0]],60,55,90);
  const r=rng(id); let stars='';
  for(let i=0;i<70;i++){ const big=r()<.12; const c=big?'#ffe7b0':'#ffffff';
    stars+=`<circle class="anim tw" style="--d:${f2(1.5+r()*2.5)}s; animation-delay:${f2(-r()*3)}s" cx="${f2(r()*160)}" cy="${f2(r()*100)}" r="${f2(big?1.4:.7)}" fill="${c}"/>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <rect width="160" height="100" fill="url(#${id}neb)"/>${stars}
    <g class="anim" style="animation:dwbg_shoot 5s ease-in infinite"><line x1="0" y1="0" x2="-16" y2="-5" stroke="#dbeaff" stroke-width="1.4" stroke-linecap="round"/></g>`;
  const defs = d;
  // shooting star keyframe injected globally below
  return svgWrap(id, inner, defs);
};

/* 16. 星雲 — black, colored nebula clouds, stars */
BUILDERS.nebula = (id) => {
  const d = rg(id+'c1',[[0,'#b155ff',.5],[1,'#b155ff',0]],45,55,55)
    + rg(id+'c2',[[0,'#ff5bd0',.4],[1,'#ff5bd0',0]],95,42,50)
    + rg(id+'c3',[[0,'#4bb9ff',.35],[1,'#4bb9ff',0]],120,70,55)
    + blurFilter(id+'b',6);
  const r=rng(id); let stars=''; for(let i=0;i<55;i++){ stars+=`<circle cx="${f2(r()*160)}" cy="${f2(r()*100)}" r="${f2(.3+r()*.8)}" fill="#fff" opacity="${f2(.4+r()*.5)}"/>`; }
  const inner = `<rect width="160" height="100" fill="#070617"/>
    <g filter="url(#${id}b)" style="mix-blend-mode:screen" class="anim br" style="--d:6s">
      <rect width="160" height="100" fill="url(#${id}c1)"/><rect width="160" height="100" fill="url(#${id}c2)"/><rect width="160" height="100" fill="url(#${id}c3)"/></g>
    ${stars}`;
  return svgWrap(id, inner, d);
};

/* 17. 餘燼 — dark, warm bottom glow, rising amber embers */
BUILDERS.embers = (id) => {
  const d = rg(id+'g',[[0,'#ff8a28',.32],[.5,'#a0280a',.18],[1,'#140a06',0]],80,108,120);
  const r=rng(id); let em='';
  for(let i=0;i<30;i++){ const x=r()*160,y=r()*100,rr=.8+r()*2,hue=12+r()*28;
    em+=`<g class="anim tw" style="--d:${f2(1+r()*1.5)}s; animation-delay:${f2(-r()*2)}s"><circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(rr*3)}" fill="hsl(${f2(hue)},95%,55%)" opacity=".25"/><circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(rr)}" fill="hsl(${f2(hue)},95%,68%)"/></g>`; }
  const inner = `<rect width="160" height="100" fill="#120a06"/>
    <rect width="160" height="100" fill="url(#${id}g)"/>
    <g style="mix-blend-mode:screen" class="anim rise" style="--d:6s">${loopY(em,'rise')}</g>`;
  return svgWrap(id, inner, d);
};

/* 18. 熔岩燈 — dark red, floating blobs */
BUILDERS.lava = (id) => {
  const d = lg(id+'bg',[[0,'#2a0a06'],[1,'#180605']]);
  let defs=d; let blobs='';
  const cfg=[[40,70,22,8],[70,40,18,24],[110,60,24,40],[95,30,16,16],[130,80,20,48],[55,45,14,32]];
  cfg.forEach((c,i)=>{ const gid=id+'lb'+i;
    defs+=rg(gid,[[0,`hsl(${c[3]+5},95%,60%)`,.75],[.5,`hsl(${c[3]},85%,50%)`,.3],[1,`hsl(${c[3]-5},80%,35%)`,0]],c[0],c[1],c[2]);
    blobs+=`<circle class="anim blob" style="--d:${10+i*2}s; animation-delay:${-i}s" cx="${c[0]}" cy="${c[1]}" r="${c[2]}" fill="url(#${gid})"/>`; });
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/><g style="mix-blend-mode:screen">${blobs}</g>`;
  return svgWrap(id, inner, defs);
};

/* 27. 沙丘 — bleached sky, sun, layered dunes w/ crest lines, blowing sand */
BUILDERS.dunes = (id) => {
  const d = lg(id+'sky',[[0,'#8fbdd6'],[.6,'#d9e2d6'],[1,'#f4ddab']])
    + rg(id+'sun',[[0,'#fffbe8',.9],[.3,'#fff2cb',.3],[1,'#fff2cb',0]],115,16,55)
    + lg(id+'d1',[[0,'#eecd92'],[1,'#dcab63']],0,.45,0,1)
    + lg(id+'d2',[[0,'#e4b26d'],[1,'#c78c46']],0,.55,0,1)
    + lg(id+'d3',[[0,'#d09550'],[1,'#a06428']],0,.7,0,1);
  const r=rng(id); let wisps='';
  for(let i=0;i<12;i++){ const x=r()*160,y=45+r()*50,len=10+r()*16;
    wisps+=`<path d="M${f2(x)},${f2(y)} q${f2(len*.5)},-2 ${f2(len)},0" fill="none" stroke="#ffeecd" stroke-width="1" stroke-opacity="${f2(.2+r()*.3)}" stroke-linecap="round"/>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}sky)"/>
    <rect width="160" height="56" fill="url(#${id}sun)"/>
    <circle cx="115" cy="16" r="5.5" fill="#fffdf0"/>
    <path d="M0,52 Q40,44 80,50 T160,48 L160,100 L0,100 Z" fill="url(#${id}d1)"/>
    <path d="M0,52 Q40,44 80,50 T160,48" fill="none" stroke="#fff0cd" stroke-opacity=".5" stroke-width="1"/>
    <path d="M0,68 Q50,58 95,66 T160,62 L160,100 L0,100 Z" fill="url(#${id}d2)"/>
    <path d="M0,68 Q50,58 95,66 T160,62" fill="none" stroke="#ffe9bd" stroke-opacity=".45" stroke-width="1"/>
    <path d="M0,86 Q45,76 90,84 T160,80 L160,100 L0,100 Z" fill="url(#${id}d3)"/>
    <path d="M0,86 Q45,76 90,84 T160,80" fill="none" stroke="#ffe3ad" stroke-opacity=".4" stroke-width="1"/>
    <g class="anim drift" style="--d:5s">${loopX(wisps)}</g>`;
  return svgWrap(id, inner, d);
};

/* 29. 草原夕陽 — plum→orange sky, huge sun, acacia + grass silhouettes, birds */
BUILDERS.savanna = (id) => {
  const d = lg(id+'sky',[[0,'#2d1436'],[.45,'#7a2340'],[.78,'#c9502e'],[1,'#f5913c']])
    + lg(id+'sun',[[0,'#ffe3ae'],[.55,'#ffb45e'],[1,'#ff8438']],0,.22,0,.74)
    + rg(id+'halo',[[0,'#ffaa50',.45],[1,'#ffaa50',0]],62,72,48);
  const r=rng(id); let grass='';
  for(let i=0;i<40;i++){ const x=r()*160, len=4+r()*6, sw=(r()-.5)*4;
    grass+=`<path class="anim sway" style="--d:${f2(2.5+r()*2)}s; animation-delay:${f2(-r()*3)}s" d="M${f2(x)},${f2(78+r()*22)} q${f2(sw*.4)},${f2(-len*.6)} ${f2(sw)},${f2(-len)}" stroke="#170b06" stroke-width="${f2(1+r())}" fill="none" stroke-linecap="round"/>`; }
  const birds = `<g stroke="#20101c" stroke-width="1.2" fill="none" stroke-linecap="round">
      <path class="anim sway" style="--d:.9s" d="M30,22 q3,3 6,0 M36,22 q3,3 6,0" transform="translate(-3,0)"/>
      <path class="anim sway" style="--d:1.1s" d="M52,16 q2.5,2.5 5,0 M57,16 q2.5,2.5 5,0"/>
      <path class="anim sway" style="--d:1s" d="M44,30 q2,2 4,0 M48,30 q2,2 4,0"/></g>`;
  const inner = `<rect width="160" height="76" fill="url(#${id}sky)"/>
    <rect width="160" height="76" fill="url(#${id}halo)"/>
    <circle cx="62" cy="72" r="16" fill="url(#${id}sun)"/>
    <g class="anim drift" style="--d:26s">${loopX(birds)}</g>
    <path d="M0,77 Q80,73 160,77 L160,100 L0,100 Z" fill="#1c0d08"/>
    <g fill="#150a06" stroke="#150a06" stroke-linecap="round">
      <path d="M124,78 Q122,68 116,60" stroke-width="2.4" fill="none"/>
      <path d="M123,71 Q129,65 133,61" stroke-width="1.6" fill="none"/>
      <ellipse cx="122" cy="57" rx="22" ry="4.5"/>
      <ellipse cx="110" cy="60" rx="9" ry="3"/>
      <ellipse cx="136" cy="60" rx="8" ry="2.6"/></g>
    ${grass}`;
  return svgWrap(id, inner, d);
};

/* 19. 矩陣 — black, green falling katakana columns */
BUILDERS.matrix = (id) => {
  const chars='アイウエオカキクサシスセタチツテナニ0123456789@#$'.split('');
  const r=rng(id); let cols='';
  const colW=8;
  for(let c=0;c<20;c++){ const x=c*colW+1; const n=4+Math.floor(r()*5); let col='';
    for(let i=0;i<n;i++){ const op=i===0?1:Math.max(.15,.8-i*.18); const fill=i===0?'#beffd2':'#3cd25a';
      col+=`<text x="${x}" y="${i*9}" font-family="monospace" font-size="8" fill="${fill}" opacity="${f2(op)}">${chars[Math.floor(r()*chars.length)]}</text>`; }
    const dur=f2(2+r()*2);
    cols+=`<g class="anim fall" style="--d:${dur}s; animation-delay:${f2(-r()*dur)}s"><g transform="translate(0,${f2(-r()*40)})">${loopY(col,'fall')}</g></g>`; }
  const inner = `<rect width="160" height="100" fill="#050a08"/>${cols}`;
  return svgWrap(id, inner, '');
};

/* 20. 地形圖 — dark blue, concentric topo contours */
BUILDERS.topo = (id) => {
  const d = lg(id+'bg',[[0,'#0a1322'],[1,'#0d1a2e']]);
  let rings='';
  const centers=[[64,52],[110,40]];
  centers.forEach((c,ci)=>{ for(let i=1;i<=7;i++){ rings+=`<ellipse class="anim br" style="--d:${5+ci}s; animation-delay:${f2(-i*.2)}s" cx="${c[0]}" cy="${c[1]}" rx="${i*9}" ry="${i*6}" fill="none" stroke="#82f0d2" stroke-width="1" opacity="${f2(.5-i*.04)}"/>`; } });
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>${rings}`;
  return svgWrap(id, inner, d);
};

/* 21. 合成波 — purple sky, gradient sun w/ slits, mountains, perspective grid */
BUILDERS.synthwave = (id) => {
  const d = lg(id+'sky',[[0,'#0a0420'],[.6,'#2c0a4a'],[1,'#5b1268']],0,0,0,.6)
    + lg(id+'sun',[[0,'#ffb84d'],[.5,'#ff5e9c'],[1,'#c026d3']],0,0,0,1);
  let grid='';
  for(let i=0;i<7;i++){ const y=58+i*7; grid+=`<line x1="0" y1="${y}" x2="160" y2="${y}" stroke="#ff5e9c" stroke-width=".8" opacity="${f2(.7-i*.07)}"/>`; }
  for(let i=-6;i<=6;i++){ grid+=`<line x1="80" y1="58" x2="${80+i*40}" y2="100" stroke="#ff5e9c" stroke-width=".8" opacity=".5"/>`; }
  let slits=''; for(let i=0;i<4;i++){ slits+=`<rect x="64" y="${40+i*4}" width="32" height="2" fill="#0a0420"/>`; }
  const inner = `<rect width="160" height="58" fill="url(#${id}sky)"/>
    <circle cx="80" cy="40" r="22" fill="url(#${id}sun)"/>${slits}
    <path d="M0,58 L18,42 L30,52 L46,38 L60,50 L80,40 L100,52 L120,40 L140,52 L160,42 L160,58 Z" fill="#1a0838"/>
    <rect y="58" width="160" height="42" fill="#0a0420"/>
    <g class="anim" style="animation:dwbg_scan 1.4s linear infinite">${grid}</g>`;
  return svgWrap(id, inner, d);
};

/* 22. 賽博龐克 — purple/magenta sky, skyline w/ neon windows, streaks, rain */
BUILDERS.cyberpunk = (id) => {
  const d = lg(id+'bg',[[0,'#08020e'],[.45,'#1a0820'],[.75,'#3a0a3a'],[1,'#5e1444']]);
  const r=rng(id); let city=''; let x=0;
  while(x<160){ const w=8+r()*16, h=24+r()*46, y=100-h; city+=`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="#0a0512"/>`;
    for(let wy=y+4;wy<98;wy+=6){ for(let wx=x+2;wx<x+w-2;wx+=5){ if(r()<.5){ const hue=[320,195,50][Math.floor(r()*3)]; city+=`<rect class="anim tw" style="--d:${f2(1+r()*2)}s; animation-delay:${f2(-r()*2)}s" x="${f2(wx)}" y="${f2(wy)}" width="2" height="2.5" fill="hsl(${hue},90%,65%)"/>`; } } }
    x+=w-1; }
  const streaks = `<g class="anim drift" style="--d:6s">${loopX(`<rect x="20" y="70" width="40" height="1.6" fill="#00e6ff" opacity=".6"/>`)}</g>
                   <g class="anim driftr" style="--d:5s">${loopX(`<rect x="90" y="82" width="46" height="1.6" fill="#ff28a0" opacity=".6"/>`)}</g>`;
  let rain=''; for(let i=0;i<24;i++){ const rx=r()*160,ry=r()*100,len=5+r()*6; rain+=`<line x1="${f2(rx)}" y1="${f2(ry)}" x2="${f2(rx-len*.18)}" y2="${f2(ry+len)}" stroke="#b4d2f0" stroke-width=".7" opacity=".3"/>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>${city}${streaks}
    <g class="anim fall" style="--d:1s">${loopY(rain,'fall')}</g>`;
  return svgWrap(id, inner, d);
};

/* 23. 台北101 — night, skyline, segmented 101 tower w/ cyan outlines, fireworks */
BUILDERS.taipei101 = (id) => {
  const d = lg(id+'bg',[[0,'#03050d'],[.55,'#070d22'],[1,'#0c1432']]);
  const cx=82; const segH=7.5; const baseTop=100-13;
  let tower='';
  // base
  tower+=`<path d="M${cx-13},100 L${cx+13},100 L${cx+10},${baseTop} L${cx-10},${baseTop} Z" fill="#03070e" stroke="#8cbeeb" stroke-width=".8"/>`;
  // 8 trapezoid segments (pagoda, flare outwards going up)
  for(let i=0;i<8;i++){ const mb=baseTop-i*segH; const mt=mb-segH*1.05; const hb=6.5; const ht=8;
    tower+=`<path d="M${cx-hb},${f2(mb)} L${cx+hb},${f2(mb)} L${cx+ht},${f2(mt)} L${cx-ht},${f2(mt)} Z" fill="#040a14" stroke="rgba(140,200,255,.6)" stroke-width=".7"/>`; }
  const topY=baseTop-8*segH;
  // crown + spire
  tower+=`<path d="M${cx-6},${f2(topY)} L${cx+6},${f2(topY)} L${cx+7},${f2(topY-6)} L${cx-7},${f2(topY-6)} Z" fill="#081326" stroke="rgba(160,215,255,.7)" stroke-width=".7"/>`;
  tower+=`<line x1="${cx}" y1="${f2(topY-6)}" x2="${cx}" y2="${f2(topY-16)}" stroke="#dbeeff" stroke-width="1.4"/>`;
  tower+=`<circle cx="${cx}" cy="${f2(topY-16)}" r="2.2" fill="#ffcd5f" class="anim br" style="--d:2s; transform-box:fill-box; transform-origin:center"/>`;
  // skyline
  const r=rng(id); let city=''; for(let sx=0;sx<160;sx+=7){ const h=8+r()*18; city+=`<rect x="${f2(sx)}" y="${f2(100-h)}" width="6" height="${f2(h)}" fill="#06090f"/>`; }
  // fireworks bursts
  function fw(x,y,c,delay){ let s=`<g class="anim" style="animation:dwbg_burst 2.4s ease-out infinite; animation-delay:${delay}s; transform-box:fill-box; transform-origin:${x}px ${y}px">`;
    for(let a=0;a<12;a++){ const ang=a/12*6.283; s+=`<line x1="${x}" y1="${y}" x2="${f2(x+Math.cos(ang)*12)}" y2="${f2(y+Math.sin(ang)*12)}" stroke="${c}" stroke-width="1" stroke-linecap="round"/>`; }
    return s+'</g>'; }
  const fws = fw(40,28,'#ff5b8a',0)+fw(120,34,'#5bd0ff',0.8)+fw(96,18,'#ffd166',1.5);
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>${city}${tower}
    <g style="mix-blend-mode:screen">${fws}</g>`;
  return svgWrap(id, inner, d);
};

/* 24. 雷雨 — dark storm, gray clouds, lightning bolt, slanted rain */
BUILDERS.thunderstorm = (id) => {
  const d = lg(id+'bg',[[0,'#0d1018'],[.55,'#1a2230'],[1,'#0a1018']]) + blurFilter(id+'c',4);
  let clouds=''; const r=rng(id); for(let i=0;i<5;i++){ clouds+=`<ellipse cx="${f2(r()*160)}" cy="${f2(8+r()*14)}" rx="${f2(26+r()*16)}" ry="14" fill="#3a4456" opacity=".7"/>`; }
  let rain=''; for(let i=0;i<40;i++){ const rx=r()*180,ry=r()*100,len=6+r()*8; rain+=`<line x1="${f2(rx)}" y1="${f2(ry)}" x2="${f2(rx-len*.22)}" y2="${f2(ry+len)}" stroke="#b4c8e1" stroke-width="1" opacity=".5"/>`; }
  const bolt = `<polyline points="84,12 76,40 86,42 72,82" fill="none" stroke="#e6ebff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <g filter="url(#${id}c)" class="anim drift" style="--d:40s">${loopX(clouds)}</g>
    <rect width="160" height="100" fill="#dde6ff" class="anim" style="animation:dwbg_flash 4s linear infinite" opacity="0"/>
    <g class="anim" style="animation:dwbg_flash 4s linear infinite" filter="drop-shadow(0 0 3px #9fc0ff)">${bolt}</g>
    <g class="anim fall" style="--d:.9s">${loopY(rain,'fall')}</g>`;
  return svgWrap(id, inner, d);
};

/* 25. 五彩紙屑 — light bg, colorful spinning confetti */
BUILDERS.confetti = (id) => {
  const d = lg(id+'bg',[[0,'#fdf2f8'],[1,'#eef2ff']],0,0,1,1);
  const pal=['#ff5b8a','#ffd166','#06d6a0','#118ab2','#a78bfa','#ff8c42','#ef476f','#7be0ad'];
  const r=rng(id); let bits='';
  for(let i=0;i<34;i++){ const x=r()*160,y=r()*100,a=r()*360,c=pal[Math.floor(r()*pal.length)],s=4+r()*4;
    bits+=`<g class="anim" style="animation:dwbg_spin ${f2(1+r())}s linear infinite; transform-box:fill-box; transform-origin:center"><rect x="${f2(x)}" y="${f2(y)}" width="${f2(s)}" height="${f2(s*.6)}" fill="${c}" transform="rotate(${f2(a)} ${f2(x)} ${f2(y)})"/></g>`; }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/>
    <g class="anim fall" style="--d:4s">${loopY(bits,'fall')}</g>`;
  return svgWrap(id, inner, d);
};

/* 26. 粒子游標 — dark red vignette, grid of red dots brighter at center, pulse waves */
BUILDERS.particleCursor = (id) => {
  const d = rg(id+'bg',[[0,'#7e1812',.6],[.4,'#300c12',.86],[1,'#08080e',1]],80,50,86);
  const cx=80,cy=50, maxD=Math.hypot(6,4);
  let glow='', core='';
  for(let row=0;row<9;row++){ for(let col=0;col<13;col++){ const gx=col-6, gy=row-4;
    const x=cx+gx*12, y=cy+gy*10.5;
    const k=Math.max(0,1-Math.hypot(gx,gy)/maxD);
    const cr=.6+k*2.2;
    const L=34+k*46, op=.12+k*.85;
    glow+=`<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(cr*2.6)}" fill="hsl(4,78%,${f2(L)}%)" opacity="${f2(op*.32)}"/>`;
    core+=`<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(cr)}" fill="hsl(4,76%,${f2(Math.min(88,L+10))}%)" opacity="${f2(op)}"/>`;
  } }
  const inner = `<rect width="160" height="100" fill="#08080e"/>
    <rect width="160" height="100" fill="url(#${id}bg)"/>
    <g style="mix-blend-mode:screen"><g class="anim br" style="--d:3.4s">${glow}</g>${core}</g>`;
  return svgWrap(id, inner, d);
};

/* 32. Circuit — dark PCB traces with cyan signal pulses */
BUILDERS.circuit = (id) => {
  const r = rng(id);
  let traces = '';
  let pads = '';
  let pulses = '';
  for (let i = 0; i < 20; i++) {
    const sx = Math.floor(r() * 8) * 22 - 8;
    const sy = Math.floor(r() * 6) * 20;
    const midX = sx + (r() > .5 ? 22 : 44);
    const midY = sy + (r() > .5 ? 20 : -20);
    const ex = midX + (r() > .5 ? 44 : -22);
    const ey = midY + (r() > .5 ? 20 : -20);
    traces += `<path d="M${sx},${sy} L${midX},${sy} L${midX},${midY} L${ex},${midY} L${ex},${ey}" fill="none" stroke="rgba(38,74,78,.58)" stroke-width="1.2" stroke-linejoin="round"/>`;
    pads += `<circle cx="${sx}" cy="${sy}" r="2.4" fill="rgba(60,110,112,.72)"/><circle cx="${ex}" cy="${ey}" r="2.4" fill="rgba(60,110,112,.72)"/>`;
    if (i % 4 === 0) {
      pulses += `<circle class="anim tw" style="--d:${f2(1.2 + r() * 1.4)}s; animation-delay:${f2(-r() * 2)}s" cx="${midX}" cy="${midY}" r="6" fill="hsl(${r() > .25 ? 160 : 205},95%,65%)" opacity=".8"/>`;
    }
  }
  const inner = `<rect width="160" height="100" fill="#080d12"/>${traces}${pads}<g style="mix-blend-mode:screen">${pulses}</g>`;
  return svgWrap(id, inner, '');
};

/* 33. Halftone — warm paper with pulsing interference dots */
BUILDERS.halftone = (id) => {
  let dots = '';
  for (let y = 10; y < 100; y += 13) {
    for (let x = 10; x < 160; x += 13) {
      const d = Math.hypot(x - 80, y - 50);
      const k = .5 + .5 * Math.sin(x * .11 + y * .07 + d * .08);
      const rr = f2(.9 + k * 4.1);
      const hi = k > .94 ? '#0a84ff' : '#2b3340';
      dots += `<circle class="anim br" style="--d:${f2(2.4 + k)}s; animation-delay:${f2(-k)}s" cx="${x}" cy="${y}" r="${rr}" fill="${hi}" opacity="${f2(hi === '#0a84ff' ? .85 : .22 + k * .5)}"/>`;
    }
  }
  const inner = `<rect width="160" height="100" fill="#efeeea"/>${dots}`;
  return svgWrap(id, inner, '');
};

/* 34. Orbitals — concentric tilted rings with glowing particles */
BUILDERS.orbitals = (id) => {
  const d = rg(id+'bg',[[0,'#0d1122',1],[1,'#04060c',1]],80,50,96)
    + rg(id+'core',[[0,'#d2e1ff',.85],[.42,'#8caaff',.25],[1,'#8caaff',0]],80,50,24);
  let rings = '';
  for (let i = 0; i < 7; i++) {
    const rx = 15 + i * 9;
    const ry = rx * (.34 + (i % 3) * .05);
    const rot = -24 + i * 8;
    const hue = 198 + i * 9;
    rings += `<g transform="rotate(${rot} 80 50)">
      <ellipse cx="80" cy="50" rx="${rx}" ry="${f2(ry)}" fill="none" stroke="rgba(150,180,255,.1)" stroke-width="1"/>
      <ellipse class="anim" style="animation:dwbg_spin ${f2(10 + i * 1.5)}s linear infinite; transform-box:view-box; transform-origin:80px 50px" cx="80" cy="50" rx="${rx}" ry="${f2(ry)}" fill="none" stroke="hsla(${hue},80%,70%,.35)" stroke-width="1.3" stroke-dasharray="10 58"/>
      <circle class="anim tw" style="--d:${f2(2 + i * .2)}s" cx="${f2(80 + rx)}" cy="50" r="3" fill="hsl(${hue},90%,78%)"/></g>`;
  }
  const inner = `<rect width="160" height="100" fill="url(#${id}bg)"/><g style="mix-blend-mode:screen">${rings}<circle cx="80" cy="50" r="24" fill="url(#${id}core)"/></g>`;
  return svgWrap(id, inner, d);
};

/* 35. Ink — soft warm pigment blobs on paper */
BUILDERS.ink = (id) => {
  const cfg = [
    [50,44,38,'#e8a85c'], [76,60,34,'#d87654'], [105,42,32,'#c9943c'],
    [112,70,42,'#e05e4a'], [40,72,30,'#ba7a60'], [76,30,28,'#e9c480'],
  ];
  let defs = blurFilter(id+'b',5);
  let blobs = '';
  cfg.forEach((c, i) => {
    const gid = id+'ink'+i;
    defs += rg(gid,[[0,c[3],.52],[.65,c[3],.28],[1,c[3],0]],c[0],c[1],c[2]);
    blobs += `<circle class="anim blob" style="--d:${11 + i * 1.3}s; animation-delay:${-i}s" cx="${c[0]}" cy="${c[1]}" r="${c[2]}" fill="url(#${gid})"/>`;
  });
  const inner = `<rect width="160" height="100" fill="#f6efe6"/><g filter="url(#${id}b)" style="mix-blend-mode:multiply">${blobs}</g>`;
  return svgWrap(id, inner, defs);
};

/* 36. Crystals — dark faceted lattice with glowing seams */
BUILDERS.crystals = (id) => {
  const d = lg(id+'c1',[[0,'#0d2f31'],[1,'#031013']],0,0,1,1)
    + lg(id+'c2',[[0,'#123d3e'],[1,'#061616']],1,0,0,1)
    + lg(id+'c3',[[0,'#17464b'],[1,'#071c1f']],0,1,1,0);
  const polys = [
    'M0,0 L52,0 L38,36 L0,54 Z', 'M52,0 L105,0 L94,42 L38,36 Z',
    'M105,0 L160,0 L160,48 L94,42 Z', 'M0,54 L38,36 L58,86 L0,100 Z',
    'M38,36 L94,42 L88,100 L58,86 Z', 'M94,42 L160,48 L160,100 L88,100 Z',
  ];
  const fills = [`url(#${id}c1)`, `url(#${id}c2)`, `url(#${id}c3)`];
  const cells = polys.map((p, i) => `<path class="anim br" style="--d:${4.6 + i * .25}s; animation-delay:${-i * .2}s" d="${p}" fill="${fills[i % fills.length]}" stroke="hsl(${176 + i * 7},90%,64%)" stroke-width="1.15" stroke-opacity=".72"/>`).join('');
  const sparks = `<circle cx="38" cy="36" r="2" fill="#e1fffa"/><circle cx="94" cy="42" r="2.2" fill="#e1fffa"/><circle cx="88" cy="100" r="1.6" fill="#e1fffa"/>`;
  const inner = `<rect width="160" height="100" fill="#060b0d"/><g>${cells}</g><g class="anim tw" style="mix-blend-mode:screen; --d:2.4s">${sparks}</g>`;
  return svgWrap(id, inner, d);
};

/* 38. Componentry Hero Geometric — pale field with refracted planes */
BUILDERS.heroGeometric = (id) => {
  const defs = lg(id + 'hero', [[0, '#f8fbff'], [.52, '#dbeafe'], [1, '#7bb5ff']], 0, 0, 1, 1);
  const inner = `<rect width="160" height="100" fill="url(#${id}hero)"/>
    <path d="M-8 92 L48 12 L86 88 Z" fill="#fff" opacity=".5"/>
    <path d="M52 100 L108 5 L168 88 Z" fill="#3b82f6" opacity=".2"/>
    <path d="M84 100 L126 30 L160 70 L160 100 Z" fill="#1d4ed8" opacity=".16"/>`;
  return svgWrap(id, inner, defs);
};

/* 39. Componentry Dither Prism Hero — prismatic energy with dither specks */
BUILDERS.ditherPrismHero = (id) => {
  const defs = rg(id + 'dither', [[0, '#f472b6', .9], [.34, '#6366f1', .7], [1, '#08091d', 1]], 90, 46, 78);
  let dots = '';
  for (let y = 5; y < 100; y += 8) {
    for (let x = 4; x < 160; x += 8) {
      const opacity = .12 + ((x * 7 + y * 3) % 11) / 36;
      dots += `<circle cx="${x}" cy="${y}" r="${opacity > .3 ? 1.1 : .7}" fill="#fff" opacity="${f2(opacity)}"/>`;
    }
  }
  const inner = `<rect width="160" height="100" fill="#08091d"/><ellipse cx="92" cy="48" rx="80" ry="62" fill="url(#${id}dither)"/>${dots}`;
  return svgWrap(id, inner, defs);
};

/* 40. Componentry WebGL Liquid — deep blue cinematic flow */
BUILDERS.webglLiquid = (id) => {
  const defs = blurFilter(id + 'liquidBlur', 7)
    + rg(id + 'liquid', [[0, '#8cecff', .92], [.4, '#134d93', .7], [1, '#04050b', 0]], 104, 38, 74);
  const inner = `<rect width="160" height="100" fill="#04050b"/>
    <g filter="url(#${id}liquidBlur)"><ellipse cx="104" cy="40" rx="76" ry="38" fill="url(#${id}liquid)" transform="rotate(-12 104 40)"/>
    <path d="M-10 80 Q36 34 78 70 T170 42" fill="none" stroke="#2d8ee8" stroke-width="17" opacity=".36"/></g>`;
  return svgWrap(id, inner, defs);
};

/* 41. Componentry Silk Aurora — satin-dark pearlescent ribbons */
BUILDERS.silkAurora = (id) => {
  const defs = blurFilter(id + 'silkBlur', 3)
    + lg(id + 'silk', [[0, '#050507'], [.45, '#6ed6c9'], [.7, '#f4dfb8'], [1, '#14151d']], 0, 1, 1, 0);
  const inner = `<rect width="160" height="100" fill="#050507"/>
    <g filter="url(#${id}silkBlur)" opacity=".86"><path d="M-12 76 C28 8 56 8 82 54 C108 100 132 78 174 12" fill="none" stroke="url(#${id}silk)" stroke-width="22"/>
    <path d="M-8 98 C34 48 62 54 88 78 C112 100 140 80 168 48" fill="none" stroke="#6ed6c9" stroke-width="8" opacity=".24"/></g>`;
  return svgWrap(id, inner, defs);
};

/* 42. Componentry Closing Plasma — atmospheric blue plasma field */
BUILDERS.closingPlasma = (id) => {
  const defs = blurFilter(id + 'plasmaBlur', 9)
    + rg(id + 'plasmaA', [[0, '#b9cbff', .75], [.4, '#4a6191', .48], [1, '#0d0d14', 0]], 52, 48, 62)
    + rg(id + 'plasmaB', [[0, '#788fc9', .66], [.55, '#1f2540', .4], [1, '#0d0d14', 0]], 124, 52, 64);
  const inner = `<rect width="160" height="100" fill="#0d0d14"/><g filter="url(#${id}plasmaBlur)"><circle cx="48" cy="50" r="62" fill="url(#${id}plasmaA)"/><circle cx="124" cy="50" r="64" fill="url(#${id}plasmaB)"/></g>`;
  return svgWrap(id, inner, defs);
};

/* 43. Componentry Animated Gradient — magenta aurora checker field */
BUILDERS.animatedGradient = (id) => {
  const defs = rg(id + 'animated', [[0, '#f20089', .9], [.42, '#1a0b2e', .86], [1, '#0a001a', 1]], 104, 46, 92);
  let checks = '';
  for (let y = 0; y < 100; y += 16) {
    for (let x = 0; x < 160; x += 16) {
      if ((x / 16 + y / 16) % 2 === 0) checks += `<rect x="${x}" y="${y}" width="16" height="16" fill="#fff" opacity=".035"/>`;
    }
  }
  return svgWrap(id, `<rect width="160" height="100" fill="url(#${id}animated)"/>${checks}`, defs);
};

/* 44. Componentry Prism Gradient — electric-blue refracted checker field */
BUILDERS.prismGradient = (id) => {
  const defs = lg(id + 'prism', [[0, '#050505'], [.5, '#66b3ff'], [1, '#fff']], 0, 1, 1, 0);
  const inner = `<rect width="160" height="100" fill="#050505"/>
    <path d="M-18 100 L54 -8 L104 100 Z" fill="url(#${id}prism)" opacity=".88"/>
    <path d="M48 100 L116 -10 L174 100 Z" fill="url(#${id}prism)" opacity=".54"/>`;
  return svgWrap(id, inner, defs);
};

/* 45. Componentry Liquid Chrome — fluid monochrome metal */
BUILDERS.liquidChrome = (id) => {
  const defs = blurFilter(id + 'chromeBlur', 4)
    + lg(id + 'chrome', [[0, '#050609'], [.28, '#d5d9e2'], [.52, '#343844'], [.76, '#fff'], [1, '#090a0e']], 0, 0, 1, 1);
  const inner = `<rect width="160" height="100" fill="#08090d"/>
    <g filter="url(#${id}chromeBlur)"><path d="M-14 76 C18 4 58 8 76 54 C94 98 124 96 176 18 L176 112 L-14 112 Z" fill="url(#${id}chrome)"/>
    <path d="M-8 36 C42 84 82 0 168 62" fill="none" stroke="#fff" stroke-width="7" opacity=".56"/></g>`;
  return svgWrap(id, inner, defs);
};



export function dynamicBackgroundPreviewSvg(id: DynamicBackgroundId): string {
  const build = BUILDERS[id];
  return build ? build(id) : svgWrap(id, '<rect width="160" height="100" fill="#11151f"/>', '');
}

export function DynamicBackgroundPreviewArt({ id }: { id: DynamicBackgroundId }) {
  return (
    <span
      className="dw-bg-preview-art"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: dynamicBackgroundPreviewSvg(id) }}
    />
  );
}

/* Paste into dashboard.css. Animations run only on hover (idle tiles stay still
   to save CPU); the selected tile shows the real canvas instead. */
export const DYNAMIC_BG_PREVIEW_ART_CSS = `
.dw-bg-preview-art { position: absolute; inset: 3px; overflow: hidden; border-radius: 9px; display: block; }
.dw-bg-preview-art svg { display: block; width: 100%; height: 100%; }
.dw-bg-preview-art .anim { animation-play-state: paused !important; }
.dw-bg-preview-card:hover .dw-bg-preview-art .anim { animation-play-state: running !important; }
@media (prefers-reduced-motion: reduce) {
  .dw-bg-preview-card:hover .dw-bg-preview-art .anim { animation-play-state: paused !important; }
}
@keyframes dwbg_fallY  { to { transform: translateY(100px); } }
@keyframes dwbg_riseY  { to { transform: translateY(-100px); } }
@keyframes dwbg_driftX { to { transform: translateX(160px); } }
@keyframes dwbg_driftXr{ to { transform: translateX(-160px); } }
@keyframes dwbg_twinkle{ 0%,100% { opacity:.25 } 50% { opacity:1 } }
@keyframes dwbg_breathe{ 0%,100% { opacity:.55 } 50% { opacity:1 } }
@keyframes dwbg_sway   { 0%,100% { transform: rotate(-2.2deg) } 50% { transform: rotate(2.2deg) } }
@keyframes dwbg_scan   { to { transform: translateY(8px) } }
@keyframes dwbg_burst  { 0% { transform: scale(.1); opacity:0 } 12% { opacity:1 } 70% { opacity:.9 } 100% { transform: scale(1); opacity:0 } }
@keyframes dwbg_flash  { 0%,92%,100% { opacity:0 } 94%,97% { opacity:1 } }
@keyframes dwbg_blob   { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(8px,-6px) scale(1.12) } }
@keyframes dwbg_pulseR { 0% { transform: scale(.2); opacity:.9 } 100% { transform: scale(1); opacity:0 } }
@keyframes dwbg_spin   { to { transform: rotate(360deg) } }
@keyframes dwbg_shoot  { 0% { transform: translate(20px,8px); opacity:0 } 6% { opacity:1 } 18% { transform: translate(120px,42px); opacity:0 } 100% { opacity:0 } }
.dw-bg-preview-art .anim.fall  { animation: dwbg_fallY  var(--d,6s) linear infinite; }
.dw-bg-preview-art .anim.rise  { animation: dwbg_riseY  var(--d,7s) linear infinite; }
.dw-bg-preview-art .anim.drift { animation: dwbg_driftX var(--d,26s) linear infinite; }
.dw-bg-preview-art .anim.driftr{ animation: dwbg_driftXr var(--d,22s) linear infinite; }
.dw-bg-preview-art .anim.tw    { animation: dwbg_twinkle var(--d,2.4s) ease-in-out infinite; }
.dw-bg-preview-art .anim.br    { animation: dwbg_breathe var(--d,4s) ease-in-out infinite; }
.dw-bg-preview-art .anim.sway  { animation: dwbg_sway var(--d,5s) ease-in-out infinite; transform-origin: bottom center; transform-box: fill-box; }
.dw-bg-preview-art .anim.blob  { animation: dwbg_blob var(--d,12s) ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
`;
