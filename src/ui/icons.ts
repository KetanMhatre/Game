// Inline SVG icons: crisp at any size, identical on every OS (emoji are not).
const INK = '#0b2a45';

function spikes(cx: number, cy: number, rIn: number, rOut: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? rIn : rOut;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

const svg = (body: string) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

/** Archimedean spiral as a polyline path. */
function spiral(cx: number, cy: number, turns: number, r0: number, r1: number): string {
  const steps = Math.round(turns * 28);
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return 'M' + pts.join(' L');
}

const torpedoBody = (y: number) =>
  `<rect x="5" y="${y}" width="38" height="12" rx="6" fill="#b8c4cf"/>
   <path d="M40 ${y}h5c6 0 10 2.7 10 6s-4 6-10 6h-5z" fill="#ff7a2e"/>
   <path d="M9 ${y}L3 ${y - 5}v22l6-5z" fill="#6c7a88"/>`;

const ICONS: Record<string, string> = {
  // ---- weapons (keys match WeaponId) ----
  torpedoes: svg(
    `<g transform="rotate(-32 32 32)">
       <g stroke="${INK}" stroke-width="3" stroke-linejoin="round">${torpedoBody(13)}${torpedoBody(38)}</g>
       <path d="M12 16.5h24M12 41.5h24" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".75"/></g>
     <circle cx="8" cy="54" r="3" fill="#c8f2ff" stroke="${INK}" stroke-width="2"/>
     <circle cx="15" cy="59" r="2" fill="#c8f2ff" stroke="${INK}" stroke-width="1.6"/>
     <circle cx="4" cy="46" r="2" fill="#c8f2ff" stroke="${INK}" stroke-width="1.6"/>`,
  ),
  broadside: svg(
    `<circle cx="51" cy="12" r="6" fill="#eef2f5" stroke="${INK}" stroke-width="2.5"/>
     <circle cx="58" cy="17" r="4" fill="#eef2f5" stroke="${INK}" stroke-width="2.5"/>
     <path d="M10 44h28l4 10H6z" fill="#a0683a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M8 40l35-14c3-1 6 0 7 3s0 6-3 7L12 50z" fill="#3b4450" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
     <path d="M16 41l25-10" stroke="#8a96a3" stroke-width="2.5" stroke-linecap="round"/>
     <circle cx="56" cy="26" r="5" fill="#2a2f36" stroke="${INK}" stroke-width="3"/>
     <circle cx="14" cy="54" r="5.5" fill="#6d4526" stroke="${INK}" stroke-width="3"/>
     <circle cx="34" cy="54" r="5.5" fill="#6d4526" stroke="${INK}" stroke-width="3"/>`,
  ),
  mines: svg(
    `<path d="M46.7 29.5L52.8 26M17.3 29.5L11.2 26M49 38h7M15 38H8M46.7 46.5L52.8 50M17.3 46.5L11.2 50" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
     <path d="M46.7 29.5L52.8 26M17.3 29.5L11.2 26M49 38h7M15 38H8M46.7 46.5L52.8 50M17.3 46.5L11.2 50" stroke="#3b4450" stroke-width="3.5" stroke-linecap="round"/>
     <circle cx="32" cy="38" r="17" fill="#5f6b78" stroke="${INK}" stroke-width="4"/>
     <path d="M15.5 41c10 4 23 4 33 0" stroke="${INK}" stroke-width="3" fill="none"/>
     <ellipse cx="25" cy="31" rx="5" ry="3" fill="#fff" opacity=".45" transform="rotate(-30 25 31)"/>
     <path d="M27 21.5h10V18a5 5 0 0 0-10 0z" fill="#ff3b3b" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
     <path d="M23 11l-3-3M41 11l3-3M32 8V4" stroke="#ff5a5a" stroke-width="3" stroke-linecap="round"/>`,
  ),
  barrier: svg(
    `<circle cx="32" cy="32" r="26" fill="#8fe6ff" stroke="${INK}" stroke-width="4"/>
     <path d="M12 28l4-7h8l4 7-4 7h-8zM36 46l4-7h8l4 7-4 7h-8z" fill="none" stroke="#e8fbff" stroke-width="2" opacity=".85"/>
     <path d="M32 14l13 5v10c0 10-6 16-13 20-7-4-13-10-13-20V19z" fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M24 30c2.7-2.6 5.3-2.6 8 0s5.3 2.6 8 0M26 37c2-2 4-2 6 0s4 2 6 0" stroke="#3fa9ff" stroke-width="3.2" fill="none" stroke-linecap="round"/>
     <path d="M13 21c3-6 8-9 13-10" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  ),
  fakeCrate: svg(
    `<rect x="8" y="11" width="48" height="44" rx="5" fill="#b8743c" stroke="${INK}" stroke-width="4"/>
     <rect x="14" y="17" width="36" height="32" rx="2" fill="none" stroke="#7a4a22" stroke-width="2.5"/>
     <path d="M20 21l24 24M44 21L20 45" stroke="${INK}" stroke-width="7.5" stroke-linecap="round"/>
     <path d="M20 21l24 24M44 21L20 45" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
     <path d="M32 20c-7 0-11 4.5-11 10 0 3.5 2 6 4 7v4h14v-4c2-1 4-3.5 4-7 0-5.5-4-10-11-10z" fill="#fff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
     <circle cx="27.5" cy="30" r="2.8" fill="${INK}"/><circle cx="36.5" cy="30" r="2.8" fill="${INK}"/>
     <path d="M32 34l-1.6 2.6h3.2z" fill="${INK}"/><path d="M28.5 41v-3M32 41v-3M35.5 41v-3" stroke="${INK}" stroke-width="1.6"/>`,
  ),
  mortar: svg(
    `<polygon points="${spikes(39, 16, 5, 11, 8)}" fill="#ffd23f" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
     <g transform="rotate(38 52 9)"><rect x="48" y="1" width="8" height="15" rx="4" fill="#ffb41f" stroke="${INK}" stroke-width="2.5"/></g>
     <path d="M14 46L29 21l12 7-15 25z" fill="#4b5663" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
     <path d="M27 20l15 8" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M27 20l15 8" stroke="#6c7a88" stroke-width="3" stroke-linecap="round"/>
     <path d="M8 57h40l-6-9H14z" fill="#a0683a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M5 51c2-3 4-3 6 0M51 53c2-3 4-3 6 0" stroke="#3fa9ff" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  ),
  deckGun: svg(
    `<path d="M15 43c-3 6-1 12 6 15" stroke="${INK}" stroke-width="9" fill="none" stroke-linecap="round"/>
     <path d="M15 43c-3 6-1 12 6 15" stroke="#ffc93c" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="3 2"/>
     <polygon points="${spikes(58, 32, 3, 7, 6)}" fill="#ffd23f" stroke="${INK}" stroke-width="2"/>
     <rect x="26" y="21" width="26" height="6" rx="3" fill="#aab6c2" stroke="${INK}" stroke-width="2.5"/>
     <rect x="26" y="29" width="28" height="6" rx="3" fill="#c7d0d9" stroke="${INK}" stroke-width="2.5"/>
     <rect x="26" y="37" width="26" height="6" rx="3" fill="#aab6c2" stroke="${INK}" stroke-width="2.5"/>
     <rect x="45" y="19" width="5" height="26" rx="2" fill="#3b4450" stroke="${INK}" stroke-width="2.5"/>
     <rect x="7" y="23" width="21" height="19" rx="4" fill="#5f6b78" stroke="${INK}" stroke-width="3"/>
     <path d="M11 27h12" stroke="#8a96a3" stroke-width="2.5" stroke-linecap="round"/>`,
  ),
  maelstrom: svg(
    `<circle cx="32" cy="32" r="27" fill="#1d6fa8" stroke="${INK}" stroke-width="4"/>
     <circle cx="32" cy="32" r="7" fill="${INK}"/>
     <path d="${spiral(32, 32, 2.6, 3, 23)}" stroke="#d6f6ff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
     <rect x="44" y="12" width="8" height="3.5" rx="1" fill="#a0683a" stroke="${INK}" stroke-width="1.5" transform="rotate(35 48 14)"/>
     <rect x="9" y="42" width="7" height="3" rx="1" fill="#a0683a" stroke="${INK}" stroke-width="1.5" transform="rotate(-20 12 43)"/>`,
  ),
  depthCharges: svg(
    `<polygon points="${spikes(32, 47, 8, 16, 9)}" fill="#ffb347" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <circle cx="32" cy="47" r="7" fill="#fff1a8"/>
     <g transform="rotate(-18 19 21)" stroke="${INK}" stroke-width="3">
       <rect x="11" y="7" width="16" height="25" rx="5" fill="#7d8996"/><path d="M11 14h16M11 25h16" stroke="#ffc93c" stroke-width="3.5"/></g>
     <g transform="rotate(20 45 21)" stroke="${INK}" stroke-width="3">
       <rect x="37" y="7" width="16" height="25" rx="5" fill="#7d8996"/><path d="M37 14h16M37 25h16" stroke="#ffc93c" stroke-width="3.5"/></g>
     <circle cx="8" cy="40" r="2.5" fill="#c8f2ff" stroke="${INK}" stroke-width="1.6"/>
     <circle cx="57" cy="42" r="3" fill="#c8f2ff" stroke="${INK}" stroke-width="1.8"/>`,
  ),
  harpoon: svg(
    `<path d="M12 53c-6-4 3-9-2-14" stroke="#7a5a3a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
     <path d="M13 52L44 21" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
     <path d="M13 52L44 21" stroke="#c8925a" stroke-width="4" stroke-linecap="round"/>
     <path d="M59 6L39 16l3 3-6 2 8 8 2-6 3 3z" fill="#d7dee6" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <circle cx="13" cy="52" r="4.5" fill="#6d4526" stroke="${INK}" stroke-width="3"/>`,
  ),
  flail: svg(
    `<path d="M5 7l7 7" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M5 7l7 7" stroke="#a0683a" stroke-width="4" stroke-linecap="round"/>
     <circle cx="17" cy="19" r="3.4" fill="none" stroke="${INK}" stroke-width="2.6"/>
     <circle cx="22" cy="24" r="3.4" fill="none" stroke="${INK}" stroke-width="2.6"/>
     <circle cx="27" cy="29" r="3.4" fill="none" stroke="${INK}" stroke-width="2.6"/>
     <path d="M8 49c6 6 14 9 22 10M5 39c2 6 6 10 11 13" stroke="#bfefff" stroke-width="3.5" fill="none" stroke-linecap="round"/>
     <polygon points="${spikes(41, 41, 12, 21, 10)}" fill="#6c7a88" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <circle cx="41" cy="41" r="13" fill="#4b5663" stroke="${INK}" stroke-width="3"/>
     <ellipse cx="36" cy="36" rx="4" ry="2.5" fill="#fff" opacity=".45" transform="rotate(-35 36 36)"/>`,
  ),
  drone: svg(
    `<path d="M27 10a7 7 0 0 1 0 9M31 6a13 13 0 0 1 0 17" stroke="#4cd97b" stroke-width="3" fill="none" stroke-linecap="round"/>
     <path d="M22 30V16" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
     <circle cx="22" cy="15" r="3.2" fill="#ff3b3b" stroke="${INK}" stroke-width="2"/>
     <rect x="15" y="28" width="19" height="11" rx="2" fill="#9aa6b2" stroke="${INK}" stroke-width="3"/>
     <rect x="18" y="31" width="11" height="4" rx="1" fill="#1d2a38"/>
     <path d="M44 33h13" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
     <rect x="36" y="29" width="10" height="8" rx="2" fill="#5f6b78" stroke="${INK}" stroke-width="2.5"/>
     <path d="M5 40h51l-7 11H13z" fill="#e9eef3" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M10 45h42" stroke="#3fa9ff" stroke-width="3"/>
     <path d="M3 57c5 0 5-3 10-3s5 3 10 3 5-3 10-3 5 3 10 3 5-3 10-3" stroke="#3fa9ff" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
  ),
  user: svg(
    `<circle cx="32" cy="23" r="11" fill="#fff" stroke="${INK}" stroke-width="4"/>
     <path d="M11 56c0-12 9-19 21-19s21 7 21 19z" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
  ),
  google: svg(
    `<path d="M57.6 32.6c0-1.9-.2-3.7-.5-5.4H32v10.3h14.4c-.6 3.3-2.5 6.1-5.4 8v6.6h8.7c5.1-4.7 7.9-11.6 7.9-19.5z" fill="#4285F4"/>
     <path d="M32 59c7.3 0 13.4-2.4 17.8-6.5l-8.7-6.7c-2.4 1.6-5.5 2.6-9.1 2.6-7 0-12.9-4.7-15.1-11.1H7.9v6.9C12.3 52.9 21.5 59 32 59z" fill="#34A853"/>
     <path d="M16.9 37.3c-.6-1.6-.9-3.4-.9-5.3s.3-3.7.9-5.3v-6.9H7.9C6 23.6 5 27.7 5 32s1 8.4 2.9 12.2z" fill="#FBBC05"/>
     <path d="M32 15.6c4 0 7.5 1.4 10.3 4l7.7-7.7C45.4 7.6 39.3 5 32 5 21.5 5 12.3 11.1 7.9 19.8l9 6.9c2.2-6.4 8.1-11.1 15.1-11.1z" fill="#EA4335"/>`,
  ),
  cloud: svg(
    `<path d="M18 48h30a11 11 0 0 0 1-22 15 15 0 0 0-29-2 12 12 0 0 0-2 24z" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
  ),
  close: svg(`<path d="M18 18l28 28M46 18L18 46" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`),
  question: svg(
    `<circle cx="32" cy="32" r="25" fill="#ffd23f" stroke="${INK}" stroke-width="4"/>
     <path d="M24 25c0-5 4-8 8.5-8s8.5 3 8.5 7.5c0 6-8 6.5-8 12.5" stroke="${INK}" stroke-width="5.5" fill="none" stroke-linecap="round"/>
     <circle cx="33" cy="46" r="3.6" fill="${INK}"/>`,
  ),
  heart: svg(
    `<path d="M32 57S5 41 5 22C5 13 11 7 19 7c6 0 10 4 13 8 3-4 7-8 13-8 8 0 14 6 14 15 0 19-27 35-27 35z" fill="#ff4d6d" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
     <ellipse cx="19" cy="21" rx="6" ry="4" fill="#fff" fill-opacity=".65" transform="rotate(-30 19 21)"/>`,
  ),
  clock: svg(
    `<circle cx="32" cy="32" r="25" fill="#fff" stroke="${INK}" stroke-width="4.5"/>
     <path d="M32 17v16l10 6" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  soundOn: svg(
    `<path d="M9 24h10l14-12v40L19 40H9z" fill="${INK}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
     <path d="M41 22c4 5 4 15 0 20M48 15c8 9 8 25 0 34" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  ),
  soundOff: svg(
    `<path d="M9 24h10l14-12v40L19 40H9z" fill="${INK}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
     <path d="M42 24l14 16M56 24L42 40" stroke="#ff4d6d" stroke-width="5.5" stroke-linecap="round"/>`,
  ),
  pause: svg(`<rect x="16" y="12" width="11" height="40" rx="4" fill="${INK}"/><rect x="37" y="12" width="11" height="40" rx="4" fill="${INK}"/>`),
  left: svg(`<path d="M38 14L20 32l18 18" stroke="${INK}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  right: svg(`<path d="M26 14l18 18-18 18" stroke="${INK}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  crown: svg(
    `<path d="M8 22l12 10 12-18 12 18 12-10-5 28H13z" fill="#ffc93c" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
     <circle cx="32" cy="38" r="4" fill="#ff5a5f" stroke="${INK}" stroke-width="2.5"/>`,
  ),
  trophy: svg(
    `<path d="M18 8h28v14c0 9-6 16-14 16S18 31 18 22z" fill="#ffc93c" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
     <path d="M18 14H9c0 9 5 13 11 13M46 14h9c0 9-5 13-11 13" stroke="${INK}" stroke-width="4" fill="none"/>
     <path d="M27 38h10l2 10H25z" fill="#f5a623" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
     <rect x="18" y="48" width="28" height="8" rx="3" fill="#8a5a33" stroke="${INK}" stroke-width="4"/>`,
  ),
  sink: svg(
    `<path d="M8 30h48l-6 16H14z" fill="#b5763c" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
     <path d="M6 52c5 0 5-3 10-3s5 3 10 3 5-3 10-3 5 3 10 3 5-3 10-3" stroke="#3fa9ff" stroke-width="4.5" fill="none" stroke-linecap="round"/>
     <path d="M26 14l12 10M38 14L26 24" stroke="#ff4d6d" stroke-width="5" stroke-linecap="round"/>`,
  ),
  pond: svg(
    `<circle cx="32" cy="34" r="24" fill="#4cbf5a" stroke="${INK}" stroke-width="4"/>
     <path d="M32 34L44 12" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
     <circle cx="24" cy="38" r="8" fill="#ff9ec7" stroke="${INK}" stroke-width="3"/><circle cx="24" cy="38" r="3" fill="#ffe066"/>`,
  ),
  lake: svg(
    `<path d="M32 6l14 22h-7l11 16H14l11-16h-7z" fill="#2f8f4e" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
     <rect x="28" y="44" width="8" height="12" rx="2" fill="#8a5a33" stroke="${INK}" stroke-width="3.5"/>`,
  ),
  sea: svg(
    `<circle cx="47" cy="17" r="9" fill="#ffd23f" stroke="${INK}" stroke-width="3.5"/>
     <path d="M30 58c0-14 2-24 6-32" stroke="#8a5a33" stroke-width="6" fill="none" stroke-linecap="round"/>
     <path d="M36 26c-6-8-16-8-24-2 8 0 13 2 17 6M36 26c4-9 14-11 21-6-8 0-12 3-15 8M36 26c-2 8-10 12-18 12" stroke="${INK}" stroke-width="3" fill="#45a849" stroke-linejoin="round"/>`,
  ),
};

/** Rank medal: gold / silver / bronze for the podium, blue otherwise. */
export function medal(rank: number): string {
  const fill = rank === 1 ? '#ffc93c' : rank === 2 ? '#d7dee6' : rank === 3 ? '#e0975a' : '#6cc8ff';
  return svg(
    `<path d="M19 3h11l4 19H23zM45 3H34l-4 19h11z" fill="#ff5a5f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <circle cx="32" cy="40" r="19" fill="${fill}" stroke="${INK}" stroke-width="4"/>
     <path d="M32 29l3.2 6.6 7.3.9-5.4 5 1.4 7.2L32 45.3l-6.5 3.4 1.4-7.2-5.4-5 7.3-.9z" fill="#fff" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`,
  );
}

export function icon(name: string): string {
  return ICONS[name] ?? ICONS.question;
}
