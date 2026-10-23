import { calculate, type Bank, type Settings } from './planner';
self.onmessage = (event: MessageEvent<{ banks: Bank[]; settings: Settings }>) => {
  try { self.postMessage({ plan: calculate(event.data.banks, event.data.settings) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Planning failed.' }); }
};
