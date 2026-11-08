// Level Up field layout in inches, from the Game Manual's Appendix A drawings.
// x runs along the long side (0-97) with the red Pyramid Goal at x=0.
// z runs along the short side (0-73). Everything is point-symmetric about the center.

export const FIELD = { x: 97, z: 73, wall: 0.5, wallHeight: 2.5, gridStart: 6.5, tile: 12 };
export const BAG = { x: 4, z: 3, y: 1.1 };

export const POINTS = { floor: 1, L1: 3, L2: 6, L3: 12, L4: 16 };
export const LEVELS = [
  { id: 'L1', size: 20.5, height: 2.5 },
  { id: 'L2', size: 14.5, height: 5 },
  { id: 'L3', size: 8.5, height: 8 },
];
export const L4_HEIGHT = 24;
export const L4_RADIUS = 3.5;

export const mirror = ([x, z]) => [FIELD.x - x, FIELD.z - z];

const BLUE = [[30.5, 6.5], [12.5, 24.5], [12.5, 36.5], [12.5, 48.5], [30.5, 36.5], [48.5, 30.5], [18.5, 66.5], [30.5, 66.5]];
const YELLOW = [[42.5, 30.5], [54.5, 30.5], [42.5, 42.5], [54.5, 42.5]];
export const FIELD_BAGS = [
  ...BLUE.map((p) => ({ color: 'blue', pos: p })),
  ...BLUE.map((p) => ({ color: 'red', pos: mirror(p) })),
  ...YELLOW.map((p) => ({ color: 'yellow', pos: p })),
];

// Match Loads waiting beside each Driver Station.
const STATION = [[-10, 57.5], [-5, 57.5], [-10, 62], [-5, 62], [-10, 66.5], [-5, 66.5], [-10, 71], [-5, 71]];
export const LOAD_BAGS = {
  teamwork: [
    ...STATION.map((p) => ({ color: 'blue', pos: p })),
    ...STATION.map((p) => ({ color: 'red', pos: mirror(p) })),
  ],
  // Robot Skills: 4 red and 4 blue all start in the red Driver Station (RSC3).
  skills: STATION.map((p, i) => ({ color: i < 4 ? 'red' : 'blue', pos: mirror(p) })),
};

export const START_ZONES = [
  { id: 'nearRed', x: [43, 54], z: [0.5, 22], wall: 'red', label: 'Start: wall shared with red Pyramid' },
  { id: 'nearBlue', x: [43, 54], z: [51, 72.5], wall: 'blue', label: 'Start: wall shared with blue Pyramid' },
];

export const L4_POSTS = [{ x: 36.5, z: 42.5 }, { x: 60.5, z: 30.5 }];
export const SHORT_POSTS = [{ x: 36.5, z: 30.5 }, { x: 60.5, z: 42.5 }];
export const RAILS = [{ x: 36.5, z: [0.5, 42.5] }, { x: 60.5, z: [30.5, 72.5] }];
export const BARRIERS = [{ x: [35.84, 38.84], z: [0.5, 27] }, { x: [58.16, 61.16], z: [46, 72.5] }];

export const ZONES = {
  floorRed: { x: [0.5, 7], z: [20.5, 54.5], color: 'red', type: 'floor' },
  floorBlue: { x: [90, 96.5], z: [18.5, 52.5], color: 'blue', type: 'floor' },
  loadBlue: { x: [0.5, 7], z: [54.5, 72.5], color: 'blue', type: 'load' },
  loadRed: { x: [90, 96.5], z: [0.5, 18.5], color: 'red', type: 'load' },
};

const inRect = (x, z, r) => x - BAG.x / 2 >= r.x[0] && x + BAG.x / 2 <= r.x[1]
  && z - BAG.z / 2 >= r.z[0] && z + BAG.z / 2 <= r.z[1];

// Which goal does a bag resting at (x, z) sit in? Returns null for open floor.
export function locate(x, z) {
  for (const p of L4_POSTS) {
    if (Math.hypot(x - p.x, z - p.z) <= L4_RADIUS) return { goal: 'L4', color: null, height: L4_HEIGHT };
  }
  for (const [color, cx, cz] of [['red', x, z], ['blue', FIELD.x - x, FIELD.z - z]]) {
    if (cx >= 0 && cz >= 0) {
      for (const lvl of [...LEVELS].reverse()) {
        if (cx < lvl.size && cz < lvl.size) return { goal: lvl.id, color, height: lvl.height };
      }
    }
  }
  if (inRect(x, z, ZONES.floorRed)) return { goal: 'floor', color: 'red', height: 0 };
  if (inRect(x, z, ZONES.floorBlue)) return { goal: 'floor', color: 'blue', height: 0 };
  return null;
}

// SC3-SC5: yellow scores anywhere; L4 takes yellow only; otherwise colors must match.
export function scoreBag(bagColor, spot) {
  if (!spot) return { points: 0, reason: 'Not in a Goal' };
  if (spot.goal === 'L4') {
    return bagColor === 'yellow'
      ? { points: POINTS.L4, reason: 'Yellow on L4' }
      : { points: 0, reason: 'L4 only scores yellow Bean Bags' };
  }
  if (bagColor === 'yellow' || bagColor === spot.color) {
    return { points: POINTS[spot.goal], reason: `${bagColor} in ${spot.color} ${spot.goal === 'floor' ? 'Floor Goal' : spot.goal}` };
  }
  return { points: 0, reason: `${bagColor} does not match the ${spot.color} Goal` };
}

export function tally(bags) {
  const counts = { floor: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  let total = 0;
  for (const b of bags) {
    const r = scoreBag(b.color, b.spot);
    if (r.points) { counts[b.spot.goal]++; total += r.points; }
  }
  return { total, counts };
}

export const INFO = {
  pyramid: {
    title: 'Pyramid Goal', rules: ['SC4'],
    facts: ['Three stepped levels: L1 (3 pts), L2 (6 pts), L3 (12 pts)', 'Tops at 2.5", 5" and 8", with footprints of 20.5", 14.5" and 8.5"', 'Scores its own color and yellow', 'A bag touching two levels gets the higher level\'s points (since v1.0)'],
    ask: 'How does scoring in the Pyramid Goal work?',
  },
  l4: {
    title: 'L4 Goal', rules: ['SC5'],
    facts: ['16 points per Bean Bag, the highest in the game', 'Octagonal top, 7" across, 24" above the tiles', 'Yellow Bean Bags only', 'Stacked bags count if supported by a bag touching the top'],
    ask: 'What are the rules for scoring on the L4 Goal?',
  },
  floor: {
    title: 'Floor Goal', rules: ['SC3'],
    facts: ['1 point per Bean Bag', 'The bag must be entirely inside the area, not resting on the beams', 'Scores its own color and yellow', 'Boundaries were revised in manual v2.0'],
    ask: 'What counts as scored in a Floor Goal?',
  },
  load: {
    title: 'Load Zone', rules: ['SG7'],
    facts: ['Half a tile wide, 1.5 tiles long, next to the opposite alliance color Pyramid', 'One bag at a time, matching the zone color', 'Only when no other bag is touching the zone', 'Boundaries were revised in manual v2.0'],
    ask: 'How do we use the Load Zone legally?',
  },
  wall: {
    title: 'Wall structure', rules: ['SG2'],
    facts: ['Yellow tube rail with its top near 6.25" above the tiles', 'Runs from the field wall to an L4 post', 'Forces a route choice: the long way round or a tight gap'],
    ask: 'What does the manual say about route choices on the Field?',
  },
  barrier: {
    title: 'Floor barrier', rules: [],
    facts: ['Low plate under the rail, about 0.75" high and 3" wide', 'About 26" long, starting at the field wall'],
    ask: 'What are the Floor barriers on the Level Up Field?',
  },
  start: {
    title: 'Starting position', rules: ['SG1'],
    facts: ['Teamwork: Team 1 (red on RobotEvents) takes the spot sharing a wall with the blue Pyramid', 'Team 2 takes the spot sharing a wall with the red Pyramid', 'Robot Skills: start at the wall shared with the red Pyramid', 'Start size 11" × 20" × 15"'],
    ask: 'Where does each Robot have to start a Match?',
  },
  robot: {
    title: 'Robot size limits', rules: ['SG1', 'SG2', 'SG3', 'R3'],
    facts: ['Start within 11" × 20" × 15"', 'After the start: up to 24" long, always inside an 11" × 24" footprint', 'Vertical expansion is unlimited', 'The model is a generic demo robot, not a real or recommended design'],
    ask: 'What are the Robot size limits during a Match?',
  },
  bag: {
    title: 'Bean Bag', rules: ['SG5', 'SG6'],
    facts: ['About 4" × 3"', '38 total: 16 red, 16 blue, 6 yellow', 'A Robot may hold or plow only one at a time', 'Drag it onto a Goal to test its score'],
    ask: 'What are the Possession and Plowing limits for Bean Bags?',
  },
};
