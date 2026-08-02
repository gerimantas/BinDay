/* ------------------------------------------------------------------
   Saved addresses in localStorage.

   Both accessors swallow their errors on purpose. Storage is unavailable in
   private mode and can hold corrupt JSON from an older build; neither is worth
   breaking the app for, because the schedule still renders from the shipped
   default without it.
------------------------------------------------------------------ */
const STORE = 'binday.addresses';

function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (raw && Array.isArray(raw.list)) return raw;
  } catch (e) { /* corrupt or unavailable storage — fall through to the default */ }
  return { active: 0, list: [] };
}
function persist(state) {
  try { localStorage.setItem(STORE, JSON.stringify(state)); }
  catch (e) { /* private mode: the app still works for this session */ }
}
let saved = loadSaved();
