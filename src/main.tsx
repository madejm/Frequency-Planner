import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { parseSettings, readBanks, type Bank, type Plan, type Settings } from './planner';
import './style.css';
import { Spectrum } from './Spectrum';

const STORAGE = 'frequency-distribution:v1';
const defaults: Settings = { occupied: '', spacing: '350', intermod: '100', min: '542', max: '580' };
function restore(): Settings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (saved && typeof saved === 'object' && Object.keys(defaults).every(k => typeof (saved as Record<string, unknown>)[k] === 'string')) {
      return Object.fromEntries(Object.keys(defaults).map(k => [k, (saved as Record<string, string>)[k]])) as Settings;
    }
  } catch { /* A blocked or unavailable store must not prevent planning. */ }
  return { ...defaults };
}
const mhz = (f: number) => (f / 1000).toFixed(3);

function App() {
  const [settings, setSettings] = useState(restore);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [dataError, setDataError] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null | undefined>();
  const [copyStatus, setCopyStatus] = useState('');
  const worker = useRef<Worker>();

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(['PTM-10', 'PTM-33'].map(async name => {
      const response = await fetch(`${import.meta.env.BASE_URL}data/${name}.csv`, { signal: controller.signal });
      if (!response.ok) throw new Error('Frequency charts are unavailable. Reload the page to try again.');
      return response.text();
    })).then(([a, b]) => setBanks(readBanks(a, b))).catch(e => {
      if (!controller.signal.aborted) setDataError(e instanceof Error ? e.message : 'Could not load frequency charts.');
    });
    return () => { controller.abort(); worker.current?.terminate(); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(settings)); setSaved(true); }
    catch { setSaved(false); }
  }, [settings]);

  function change(key: keyof Settings, value: string) {
    worker.current?.terminate();
    setBusy(false); setPlan(undefined); setError(''); setCopyStatus(''); setSaved(false);
    setSettings(previous => ({ ...previous, [key]: value }));
  }
  function generate(event: Event) {
    event.preventDefault();
    setError(''); setPlan(undefined); setCopyStatus('');
    try {
      parseSettings(settings);
      worker.current?.terminate();
      const task = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
      worker.current = task; setBusy(true);
      task.onmessage = e => {
        setBusy(false); task.terminate();
        if (e.data.error) setError(e.data.error);
        else setPlan(e.data.plan);
      };
      task.onerror = () => { setBusy(false); task.terminate(); setError('The planner could not finish. Please try again.'); };
      task.postMessage({ banks, settings });
    } catch (e) { setBusy(false); setError(e instanceof Error ? e.message : 'Unable to start the planner.'); }
  }
  async function copy() {
    if (!plan) return;
    const text = ['IEM frequency plan', ...plan.channels.map(c => `${c.name}: ${mhz(c.frequency)} MHz · Group ${c.group}, Channel ${c.channel}`),
      `Occupied MHz: ${settings.occupied || 'none entered'}`, `Spacing: ${settings.spacing} kHz; IM3 guard: ${settings.intermod} kHz`,
      'Planning suggestion only. Verify with a venue RF scan.'].join('\n');
    try { await navigator.clipboard.writeText(text); setCopyStatus('Copied'); }
    catch { setCopyStatus('Copy unavailable. Select the frequencies below to copy manually.'); }
  }

  return <main>
    <div class="layout">
      <form class="panel controls" onSubmit={generate}>
        <div class="panel-heading"><span class="step">01</span><h2>Set the stage</h2><span class="save-state" role="status">{saved ? 'Saved on device' : 'Not saved yet'}</span></div>
        {!saved && <p class="small">If browser storage is unavailable, inputs remain usable for this visit.</p>}
        <div class="rig"><span>YOUR RIG</span><strong>2 × PTM-10 <i>stereo</i></strong><strong>1 × PTM-33 <i>4 mono</i></strong><p>6 RF carriers · 8 mono monitor feeds</p></div>
        <label for="occupied">Occupied frequencies <span>MHz</span></label>
        <textarea id="occupied" value={settings.occupied} onInput={e => change('occupied', e.currentTarget.value)} placeholder={'550.250, 561.500\n575.000'} rows={3} spellcheck={false} aria-describedby="occupied-help" />
        <p id="occupied-help" class="hint">Add wireless mics and other active transmitters. Separate with spaces, commas, or new lines. Decimal point only.</p>
        <div class="field-pair">
          <div><label for="spacing">Channel spacing <span>kHz</span></label><input id="spacing" type="number" min="25" max="2000" step="1" required value={settings.spacing} onInput={e => change('spacing', e.currentTarget.value)} /></div>
          <div><label for="intermod">IM3 guard <span>kHz</span></label><input id="intermod" type="number" min="25" max="2000" step="1" required value={settings.intermod} onInput={e => change('intermod', e.currentTarget.value)} /></div>
        </div>
        <details><summary>Frequency range & method</summary>
          <div class="field-pair"><div><label for="min">Minimum <span>MHz</span></label><input id="min" type="number" min="1" max="10000" step="0.001" required value={settings.min} onInput={e => change('min', e.currentTarget.value)} /></div><div><label for="max">Maximum <span>MHz</span></label><input id="max" type="number" min="1" max="10000" step="0.001" required value={settings.max} onInput={e => change('max', e.currentTarget.value)} /></div></div>
          <p class="hint">Checks carrier spacing and third-order products (2f₁ − f₂ and f₁ + f₂ − f₃), including occupied transmitters. Guards are adjustable starting assumptions, not manufacturer-certified values. The bounded search may miss feasible plans.</p>
          <p class="hint">The range filters the supplied charts; it does not establish which frequencies are permitted at your location.</p>
        </details>
        {(error || dataError) && <p role="alert" class="error">{error || dataError}</p>}
        <button class="primary" type="submit" disabled={busy || !banks.length || !!dataError}>{busy ? 'Finding some space…' : 'Find frequencies'}<span aria-hidden="true">↗</span></button>
        <p class="local-note">Your inputs stay in this browser. No account needed.</p>
      </form>
      <section class="panel results" aria-label="Frequency plan" aria-busy={busy}>
        <div class="panel-heading"><span class="step">02</span><h2>Your frequency plan</h2></div>
        <div aria-live="polite" aria-atomic="true">
          {busy ? <div class="empty"><div class="signal animated" aria-hidden="true">▂ ▅ ▇ ▅ ▂</div><h3>Coordinating your rig</h3><p>Checking channel spacing and intermodulation.</p></div> : plan === undefined ? <div class="empty"><div class="signal" aria-hidden="true">▂ ▅ ▇ ▅ ▂</div><h3>Room for every mix</h3><p>Add the venue’s occupied frequencies,<br />then find a plan for your six transmitters.</p><span class="empty-tag">PTM-10 + PTM-33</span></div> : plan === null ? <div class="empty"><div class="signal" aria-hidden="true">∿</div><h3>No plan found</h3><p>The search found no assignment with these settings. Check occupied frequencies and the allowed range. Change guards only if appropriate for your equipment.</p></div> : <>
            <div class="result-summary"><span class="dot" /><strong>Plan found</strong><span>6 / 6 carriers</span></div>
            <Spectrum plan={plan} settings={settings} />
            <p class="margin">Smallest surplus above your guards: <strong>{Math.round(plan.margin)} kHz</strong></p>
            <button type="button" class="secondary" onClick={copy}>Copy frequency plan <span aria-hidden="true">↗</span></button><p role="status" class="hint">{copyStatus}</p>
          </>}
        </div>
        <div class="venue-note"><span aria-hidden="true">ⓘ</span><p><strong>Check the room before the show.</strong> This tool cannot detect local TV, interference, or receiver overload. Confirm local frequency rules and verify your plan with an RF scan and listening check.</p></div>
      </section>
    </div>
  </main>;
}

render(<App />, document.getElementById('app')!);
