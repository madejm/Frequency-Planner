import { useMemo, useState } from 'preact/hooks';
import { parseSettings, type Plan, type Settings } from './planner';

export const carrierColors = ['#2478b5', '#db6635', '#8b52b3', '#27876a', '#c14376', '#948016'];
type Carrier = { frequency: number; name: string; color: string };
type Ghost = { frequency: number; weight: number; expression: string; color: string; count: number; sources: string[] };
const mhz = (frequency: number) => (frequency / 1000).toFixed(3);

function products(carriers: Carrier[], min: number, max: number, enabled: Record<string, boolean>): Ghost[] {
  const ghosts = new Map<number, Ghost>();
  function add(frequency: number, weight: number, expression: string, sources: Carrier[]) {
    if (frequency < min || frequency > max) return;
    const owner = sources.find(source => enabled[source.name]);
    if (!owner) return;
    const previous = ghosts.get(frequency);
    // Coincident products are not summed: their phase and actual levels are unknown.
    if (!previous || weight > previous.weight) {
      ghosts.set(frequency, { frequency, weight, expression, color: owner.color, count: (previous?.count ?? 0) + 1,
        sources: [...new Set([...(previous?.sources ?? []), ...sources.map(s => s.name)])] });
    } else {
      previous.count++;
      previous.sources = [...new Set([...previous.sources, ...sources.map(s => s.name)])];
    }
  }
  carriers.forEach((a, i) => carriers.forEach((b, j) => {
    if (i === j) return;
    add(2 * a.frequency - b.frequency, 1, `2 × ${mhz(a.frequency)} − ${mhz(b.frequency)}`, [a, b]);
    for (let k = i + 1; k < carriers.length; k++) {
      if (k === j) continue;
      const c = carriers[k];
      add(a.frequency + c.frequency - b.frequency, 2,
        `${mhz(a.frequency)} + ${mhz(c.frequency)} − ${mhz(b.frequency)}`, [a, c, b]);
    }
  }));
  return [...ghosts.values()].sort((a, b) => a.frequency - b.frequency);
}

export function Spectrum({ plan, settings }: { plan: Plan; settings: Settings }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('frequency-distribution:im3-rows') || '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        return Object.fromEntries(Object.entries(stored).filter(([, value]) => value === true));
      }
    } catch { /* A blocked store must not prevent use. */ }
    return {};
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const candidate = hovered ?? focused ?? selected;
  const active = candidate === dismissed ? null : candidate;
  const [storageError, setStorageError] = useState(false);
  const { min, max, occupied } = parseSettings(settings);
  const carriers: Carrier[] = [
    ...plan.channels.map((c, i) => ({ ...c, color: carrierColors[i] })),
    ...occupied.map((frequency, i) => ({ frequency, name: `Occupied ${i + 1}`, color: `hsl(${(i * 137.508 + 195) % 360} 52% 40%)` })),
  ];
  const showProducts = plan.channels.some(c => enabled[c.name]);
  const ghosts = useMemo(() => products(carriers, min, max, enabled), [plan, settings, enabled]);
  const x = (frequency: number) => 12 + (frequency - min) / (max - min) * 676;
  function toggle(name: string, checked: boolean) {
    const next = { ...enabled, [name]: checked };
    setEnabled(next);
    try { localStorage.setItem('frequency-distribution:im3-rows', JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  }

  return <div class="spectrum-section">
    <svg class="spectrum-plot" viewBox="0 0 700 150" role="img" aria-labelledby="spectrum-title spectrum-description">
      <title id="spectrum-title">Carrier and intermodulation frequency chart</title>
      <desc id="spectrum-description">Equal-height colored carriers from {mhz(min)} to {mhz(max)} MHz. {active ? `${active} is highlighted. ` : ''}{showProducts ? `${ghosts.length} smaller third-order product poles. Heights are an illustrative equal-input cubic amplitude model, not predicted RF strength.` : 'Intermodulation products hidden. Enable them for individual channels below.'}</desc>
      {Array.from({ length: 11 }, (_, i) => <line key={i} x1={12 + i * 67.6} x2={12 + i * 67.6} y1="10" y2="115" stroke="#e7ecdf" />)}
      <line x1="12" x2="688" y1="115" y2="115" stroke="#cbd5c0" />
      {ghosts.map(g => <line key={g.frequency} x1={x(g.frequency)} x2={x(g.frequency)} y1={115 - g.weight * 22} y2="115" stroke={g.color} stroke-width={active && g.sources.includes(active) ? 2.5 : 1.75} vector-effect="non-scaling-stroke" stroke-opacity={active && g.sources.includes(active) ? .85 : .45} stroke-dasharray="3 2"><title>{mhz(g.frequency)} MHz · {g.expression} MHz{g.count > 1 ? ` · ${g.count} coincident products (not summed)` : ''} · illustrative amplitude only</title></line>)}
      {carriers.filter(c => c.frequency >= min && c.frequency <= max).sort((a, b) => Number(a.name === active) - Number(b.name === active)).map(c => <line key={c.name} x1={x(c.frequency)} x2={x(c.frequency)} y1="15" y2="115" stroke={c.color} stroke-width={c.name === active ? 12 : 7} vector-effect="non-scaling-stroke" stroke-linecap="round"><title>{c.name}: {mhz(c.frequency)} MHz</title></line>)}
      <text x="12" y="141">{mhz(min)} MHz</text><text x="688" y="141" text-anchor="end">{mhz(max)} MHz</text>
    </svg>
    {occupied.length > 0 && <div class="occupied-legend">{carriers.slice(plan.channels.length).map(c => <span key={c.name}><i style={{ background: c.color }} />{c.name}: {mhz(c.frequency)} MHz{c.frequency < min || c.frequency > max ? ' (off chart)' : ''}</span>)}</div>}
    <p id="ghost-help" class="hint ghost-help">Hover, focus, or tap a channel to highlight its carrier. Enable IM3 products per channel below. <span class="im3-count">{ghosts.length}</span> unique IM3 frequencies shown, including interactions with occupied transmitters. Dashed pole heights illustrate equal-input cubic amplitudes (two-tone 1, three-tone 2), not actual RF strength. Color matches an enabled source; hover a pole for its formula.</p>
    <p class="switch-save-error" role="status" style={{ visibility: storageError ? 'visible' : 'hidden' }}>The switch settings could not be saved.</p>
    <div class="channel-list">{plan.channels.map((c, i) => <article class={`channel channel-row ${active === c.name ? 'is-highlighted' : ''}`} key={c.name}>
      <button type="button" class="channel-select" aria-pressed={selected === c.name} aria-label={`Highlight ${c.name}, ${mhz(c.frequency)} MHz`}
        onMouseEnter={() => { setHovered(c.name); setDismissed(null); }} onMouseLeave={() => setHovered(null)}
        onFocus={() => { setFocused(c.name); setDismissed(null); }} onBlur={() => setFocused(null)}
        onClick={() => {
          if (selected === c.name) {
            setSelected(null);
            setHovered(null);
            setFocused(null);
            setDismissed(c.name);
          } else {
            setSelected(c.name);
            setDismissed(null);
          }
        }}>
        <span class="channel-index" style={{ background: carrierColors[i], color: '#fff' }}>{i + 1}</span>
        <span class="channel-name"><strong>{c.name}</strong><span class="channel-meta">Group {c.group} · Channel {c.channel}</span></span>
        <span class="frequency">{mhz(c.frequency)}<small>MHz</small></span>
      </button>
      <label class="ghost-toggle row-im3"><span>Show intermodulation products <span class="im3-abbr">(IM3)</span></span><input type="checkbox" role="switch" checked={!!enabled[c.name]}
        aria-label={`Show intermodulation products for ${c.name}`} aria-describedby="ghost-help" onChange={e => toggle(c.name, e.currentTarget.checked)} /><span class="switch-track" aria-hidden="true" /></label>
    </article>)}</div>
  </div>;
}
