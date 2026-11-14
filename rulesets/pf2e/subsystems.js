// PF2E subsystems (GM Core chapter 4: Victory Points, Influence, Chase, Infiltration, Research): each kind's words,
// default scoring and shape, for engine/events/subsystem.js and tools/subsystem.mjs. The numbers are the rules'
// defaults (checked against GM Core on Archives of Nethys, 2026-11-14); an adventure's own subsystem gives its own
// thresholds, parts and, where it differs, scoring. Field names follow the PF2e Subsystems module for Foundry
// (WBHarry, MIT; licenses/pf2e-subsystems.md).

// Victory Points (and Influence, Chase, Research): critical success +2, success +1, failure 0, critical failure -1
const GAIN = (target) => ({ criticalSuccess: { [target]: 2 }, success: { [target]: 1 }, failure: {}, criticalFailure: { [target]: -1 } });

// Any kind takes extra `tracks` from the spec (a tally of failed approaches, a time limit counted down), merged in.
const withTracks = (make) => (o = {}) => { const s = make(o); return o.tracks ? { ...s, tracks: { ...s.tracks, ...o.tracks } } : s; };

export const PF2E_SUBSYSTEMS = Object.freeze({
  kinds: {
    victory: {
      label: 'Victory Points', short: 'VP',
      make: withTracks((o = {}) => ({ tracks: { vp: { label: o.label || 'Victory Points', value: o.start || 0, min: o.diminishing ? 0 : undefined, goal: o.goal, thresholds: o.thresholds || [] } },
        parts: o.parts || [], scoring: o.scoring || (o.diminishing
          // the diminishing structure: the PCs start with points and lose them
          ? { criticalSuccess: { vp: 1 }, success: {}, failure: { vp: -1 }, criticalFailure: { vp: -2 } }
          : GAIN('vp')) })),
    },
    influence: {
      // one part per NPC: its Influence Points, thresholds, discoveries (Discover checks), influence skills,
      // resistances and weaknesses as notes; a set number of rounds
      label: 'Influence', short: 'Influence',
      make: withTracks((o = {}) => ({ tracks: {}, parts: (o.npcs || o.parts || []).map((n) => ({ kind: 'npc', value: 0, ...n })),
        scoring: o.scoring || GAIN('part'), ...(o.rounds ? { rounds: { n: 0, limit: o.rounds } } : {}) })),
    },
    chase: {
      // obstacles in order, each needing its Chase Points; a chase may track the quarry's or pursuers' progress
      label: 'Chase', short: 'CP',
      make: withTracks((o = {}) => ({ tracks: o.opponent ? { opponent: { label: o.opponent.label || 'Opponent', value: o.opponent.start || 0, goal: o.opponent.goal } } : {},
        parts: (o.obstacles || o.parts || []).map((x) => ({ kind: 'obstacle', value: 0, ...x })), scoring: o.scoring || GAIN('part'),
        rounds: { n: 0, ...(o.opponent && o.opponent.each ? { each: { opponent: o.opponent.each } } : {}) } })),
    },
    infiltration: {
      // obstacles (individual or group) needing Infiltration Points; failures raise the party's Awareness Points,
      // which also rise by 1 at the end of each round; the usual Awareness thresholds for a 10 IP infiltration
      label: 'Infiltration', short: 'IP',
      make: withTracks((o = {}) => ({
        tracks: { awareness: { label: 'Awareness Points', value: 0, min: 0, thresholds: o.awareness || [
          { at: 5, id: 'suspicious', label: 'Suspicions raised', text: 'obstacle DCs +1; a complication the first time', dc: 1 },
          { at: 10, id: 'complication', label: 'A complication', text: 'a complication the first time' },
          { at: 15, id: 'alert', label: 'On alert', text: 'obstacle DCs +2 in all; a complication the first time', dc: 1 },
          { at: 20, id: 'found-out', label: 'Found out', text: 'the infiltration fails', end: 'failure' },
        ] }, ...(o.edge ? { edge: { label: 'Edge Points', value: o.edge } } : {}) },
        parts: (o.obstacles || o.parts || []).map((x) => ({ kind: 'obstacle', value: 0, ...x })),
        scoring: o.scoring || { criticalSuccess: { part: 2 }, success: { part: 1 }, failure: { awareness: 1 }, criticalFailure: { awareness: 2 } },
        rounds: { n: 0, each: { awareness: 1 } },
      })),
    },
    research: {
      // a library's Research Points with thresholds that reveal what is learned; sections with their checks; a time
      // limit as rounds
      label: 'Research', short: 'RP',
      make: withTracks((o = {}) => ({ tracks: { rp: { label: 'Research Points', value: 0, min: 0, goal: o.goal, thresholds: o.thresholds || [] } },
        parts: (o.sections || o.parts || []).map((x) => ({ kind: 'library', ...x })), scoring: o.scoring || GAIN('rp'),
        ...(o.rounds ? { rounds: { n: 0, limit: o.rounds } } : {}) })),
    },
  },
  /** The degree words of a check card, as the subsystem engine names them. */
  degrees: { criticalSuccess: 'Critical Success', success: 'Success', failure: 'Failure', criticalFailure: 'Critical Failure' },
});
