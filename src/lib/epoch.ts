// One-time purge of legacy test sessions: browsers that never recorded this epoch are signed out once.
// A successful sign-in or sign-up on this release must record it first, otherwise a brand-new
// visitor would be signed out the moment they reach the app.
export const PROD_CLEAN_SLATE_EPOCH = "v4_production_clean_20261104";
export const EPOCH_STORAGE_KEY = "myplan_production_epoch";

export function markCleanSlateEpoch() {
  try {
    localStorage.setItem(EPOCH_STORAGE_KEY, PROD_CLEAN_SLATE_EPOCH);
  } catch {
    // storage unavailable: nothing to protect
  }
}
