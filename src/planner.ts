export type Channel = { frequency: number; group: number; channel: number };
export type Bank = { name: string; channels: Channel[] };
export type Settings = { occupied: string; spacing: string; intermod: string; min: string; max: string };
export type Plan = { channels: (Channel & { name: string })[]; margin: number };

// All calculations use integer kHz, including the 25 kHz PTM-10 steps.
export function readBanks(ptm10: string, ptm33: string): Bank[] {
  const stereo: Channel[] = [];
  for (const row of ptm10.trim().split(/\r?\n/).slice(1)) {
    const cells = row.split(';');
    const group = Number(cells[1].replace('Group ', ''));
    cells.slice(2).forEach((value, index) => {
      if (value.trim()) stereo.push({ frequency: Math.round(Number(value) * 1000), group, channel: index + 1 });
    });
  }
  const mono: Bank[] = [];
  let bank: Bank | undefined;
  for (const row of ptm33.trim().split(/\r?\n/)) {
    const cells = row.split(';');
    if (cells[1]) { bank = { name: `PTM-33 ${cells[1]}`, channels: [] }; mono.push(bank); }
    const group = Number(cells[2].replace('Group ', ''));
    const start = Math.round(Number(cells[3]) * 1000);
    const end = Math.round(Number(cells[4]) * 1000);
    // Groups 3 and 8 are split across A/B and C/D: retain channels 6–10.
    const offset = (group === 3 || group === 8) && cells[1] ? 5 : 0;
    for (let f = start, i = 0; f <= end; f += 250, i++) {
      bank?.channels.push({ frequency: f, group, channel: offset + i + 1 });
    }
  }
  const banks = [{ name: 'PTM-10 · Unit 1', channels: stereo }, { name: 'PTM-10 · Unit 2', channels: stereo }, ...mono];
  if (banks.length !== 6 || banks.some(b => !b.channels.length || b.channels.some(c => !Number.isFinite(c.frequency)))) {
    throw new Error('The supplied frequency charts could not be read.');
  }
  return banks;
}

export function parseSettings(settings: Settings) {
  const values = settings.occupied.trim() ? settings.occupied.trim().replace(/\s*[-–]\s*/g, '-').split(/[\s,;]+/) : [];
  const occupied: number[] = [];
  const occupiedRanges: { start: number; end: number }[] = [];
  for (const value of values) {
    const match = /^(\d+(?:\.\d{1,3})?)(?:-(\d+(?:\.\d{1,3})?))?$/.exec(value);
    const start = match ? Math.round(Number(match[1]) * 1000) : 0;
    const end = match?.[2] ? Math.round(Number(match[2]) * 1000) : start;
    if (!match || start <= 0 || end > 10000000 || end < start) {
      throw new Error('Enter occupied MHz as frequencies or ascending ranges, for example 550.250, 555.0-557.5. Use a decimal point and up to 3 decimal places.');
    }
    if (start === end) {
      if (!occupied.includes(start)) occupied.push(start);
    } else if (!occupiedRanges.some(range => range.start === start && range.end === end)) {
      occupiedRanges.push({ start, end });
    }
  }
  if (occupied.length + occupiedRanges.length > 24) throw new Error('Use at most 24 occupied frequencies or ranges.');
  const spacing = Number(settings.spacing), intermod = Number(settings.intermod);
  const min = Number(settings.min), max = Number(settings.max);
  if (!settings.spacing.trim() || !settings.intermod.trim() || !settings.min.trim() || !settings.max.trim() ||
      ![spacing, intermod, min, max].every(Number.isFinite) || spacing < 25 || intermod < 25 ||
      spacing > 2000 || intermod > 2000 || min < 1 || max > 10000 || min >= max) {
    throw new Error('Use guards of 25–2000 kHz and a valid minimum/maximum MHz range.');
  }
  return { occupied, occupiedRanges, spacing, intermod, min: Math.round(min * 1000), max: Math.round(max * 1000) };
}

// Only newly introduced interactions count; pre-existing occupied/occupied conflicts
// cannot be fixed by our assignment. Occupied transmitters still participate in IM3.
function clearance(existing: number[], added: number, spacing: number, intermod: number): number {
  const f = [...existing, added], last = f.length - 1;
  let margin = 10000;
  for (const other of existing) margin = Math.min(margin, Math.abs(other - added) - spacing);
  if (margin < 0) return margin;
  for (let a = 0; a < f.length; a++) {
    for (let b = 0; b < f.length; b++) {
      if (a === b) continue;
      const product = 2 * f[a] - f[b];
      for (let victim = 0; victim < f.length; victim++) {
        if (a !== last && b !== last && victim !== last) continue;
        margin = Math.min(margin, Math.abs(product - f[victim]) - intermod);
        if (margin < 0) return margin;
      }
      for (let c = a + 1; c < f.length; c++) {
        if (c === b) continue;
        const mixed = f[a] + f[c] - f[b];
        for (let victim = 0; victim < f.length; victim++) {
          if (a !== last && b !== last && c !== last && victim !== last) continue;
          margin = Math.min(margin, Math.abs(mixed - f[victim]) - intermod);
          if (margin < 0) return margin;
        }
      }
    }
  }
  return margin;
}

export function calculate(banks: Bank[], settings: Settings): Plan | null {
  const p = parseSettings(settings);
  // Assign the most constrained banks first. A bounded beam keeps mobile work finite.
  const ordered = banks.map(b => ({ ...b, channels: b.channels.filter(c => c.frequency >= p.min && c.frequency <= p.max) }))
    .sort((a, b) => a.channels.length - b.channels.length);
  let beam: Plan[] = [{ channels: [], margin: 10000 }];
  for (const bank of ordered) {
    const next: Plan[] = [];
    for (const state of beam) {
      const existing = [...p.occupied, ...state.channels.map(c => c.frequency)];
      for (const channel of bank.channels) {
        // Bands are exclusions, not discrete transmitters for IM3 calculations.
        const bandMargin = p.occupiedRanges.reduce((margin, range) => Math.min(margin,
          Math.max(range.start - channel.frequency, channel.frequency - range.end) - p.spacing), 10000);
        if (bandMargin < 0) continue;
        const margin = Math.min(bandMargin, clearance(existing, channel.frequency, p.spacing, p.intermod));
        if (margin >= 0) next.push({ channels: [...state.channels, { ...channel, name: bank.name }], margin: Math.min(state.margin, margin) });
      }
    }
    next.sort((a, b) => b.margin - a.margin);
    // Frequency-equivalent group/channel choices need only one search branch.
    const seen = new Set<string>();
    beam = next.filter(s => {
      const key = s.channels.map(c => c.frequency).sort((a, b) => a - b).join(',');
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 48);
    if (!beam.length) return null;
  }
  const best = beam[0];
  best.channels.sort((a, b) => banks.findIndex(x => x.name === a.name) - banks.findIndex(x => x.name === b.name));
  return best;
}
