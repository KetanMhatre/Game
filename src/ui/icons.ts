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

const ICONS: Record<string, string> = {
  cannon: svg(
    `<circle cx="32" cy="34" r="22" fill="#7a4a24" stroke="${INK}" stroke-width="4"/>
     <path d="M17 29c3-8 11-12 19-11" stroke="#b07d46" stroke-width="4" fill="none" stroke-linecap="round"/>
     <circle cx="25" cy="38" r="4" fill="#2a170a"/><circle cx="39" cy="38" r="4" fill="#2a170a"/><circle cx="32" cy="48" r="4" fill="#2a170a"/>`,
  ),
  torpedo: svg(
    `<polygon points="${spikes(30, 33, 17, 26, 12)}" fill="#fff0c0" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <circle cx="30" cy="33" r="18" fill="#ffcf3a" stroke="${INK}" stroke-width="3.5"/>
     <path d="M47 33l11-8v16z" fill="#ff9a2e" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <circle cx="24" cy="28" r="6.5" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="22.5" cy="28.5" r="3.2" fill="${INK}"/>
     <circle cx="17" cy="39" r="3" fill="#ff7a2e" stroke="${INK}" stroke-width="2.5"/>`,
  ),
  mine: svg(
    `<polygon points="${spikes(32, 32, 15, 29, 14)}" fill="#6a3d9a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <circle cx="32" cy="32" r="16" fill="#4a2a6e" stroke="${INK}" stroke-width="3.5"/>
     <circle cx="26" cy="26" r="4" fill="#ff6fb0"/><circle cx="37" cy="36" r="2.5" fill="#ff6fb0"/>`,
  ),
  tidal: svg(
    `<path d="M5 46c5-22 27-33 42-24 9 5 9 18-1 20-7 1-10-6-5-10-11-2-17 8-15 18H5z" fill="#3fa9ff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
     <path d="M13 42c4-11 15-17 25-15" stroke="#c8f2ff" stroke-width="4" fill="none" stroke-linecap="round"/>
     <path d="M5 56h54" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  ),
  shield: svg(
    `<circle cx="32" cy="32" r="25" fill="#a8ecff" stroke="${INK}" stroke-width="4"/>
     <circle cx="32" cy="32" r="18" fill="#d6f7ff"/>
     <path d="M17 27c2-7 8-11 14-12" stroke="#fff" stroke-width="5.5" fill="none" stroke-linecap="round"/>
     <circle cx="44" cy="43" r="4" fill="#fff"/>`,
  ),
  turbo: svg(
    `<g stroke="${INK}" stroke-width="3.5" stroke-linejoin="round">
       <path d="M6 14h17l13 18-13 18H6l13-18z" fill="#ff8c2e"/>
       <path d="M27 14h17l13 18-13 18H27l13-18z" fill="#ffc93c"/></g>`,
  ),
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
