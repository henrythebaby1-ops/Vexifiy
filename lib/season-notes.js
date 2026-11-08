// Facts checked against the official Level Up Game Manual v2.1 (Oct 8, 2026),
// written in our own words. These stay available even if the only manual imported
// is an older one, and they outrank older text when the two disagree.

export const KNOWN_LATEST = {
  version: '2.1',
  released: '2026-10-08',
  effective: '2026-10-15',
  url: 'https://link.vex.com/docs/26-27/viqrc/game-manual',
  fullManualUrl: 'https://manuals.vex.com/manual/iq/level-up/v2.1/?autoprint=1',
  next: { version: '2.2', released: '2026-12-03', effective: '2026-12-10' },
};

const note = (id, title, rules, text) => ({
  id: `note:${id}`, source: 'Vexifiy notes (from manual v2.1)', version: '2.1', page: null,
  rule: null, title, rules, text, isNote: true,
});

export const SEASON_NOTES = [
  note('points', 'Point values', [],
    'Points per Bean Bag: Floor Goal 1, L1 3, L2 6, L3 12, L4 16. Scoring is checked after the Match ends and everything has come to rest.'),
  note('sc3', 'Floor Goal scoring', ['SC3'],
    'A Bean Bag scores in a Floor Goal when it is not touching a Robot, is entirely inside the Floor Goal area (not resting on the beams or Field Perimeter), and is yellow or matches the Goal color. The Floor Goal boundaries were revised in v2.0.'),
  note('sc4', 'L1, L2 and L3 scoring', ['SC4'],
    'A Bean Bag scores in L1, L2 or L3 when it is not touching a Robot, is touching that level\'s sheet or supported by a Bean Bag that is, touches nothing outside the Field, and is yellow or matches the Goal color. A Bean Bag that counts on more than one level gets the points of the HIGHER level. This changed in v1.0; the v0.1 text said lower and is out of date.'),
  note('sc5', 'L4 scoring', ['SC5'],
    'L4 Goals score yellow Bean Bags only, at 16 points each. A yellow Bean Bag scores when it is not touching a Robot and is touching the top sheet or supported by a Bean Bag that is.'),
  note('match', 'Match lengths', [],
    'A Teamwork Match is 1:00 with no Autonomous Period. A Driving Skills Match is 1:00 of driver control. An Autonomous Coding Skills Match is 1:00 of autonomous with no driver control.'),
  note('switch', 'Driver switch window', ['GG11'],
    'In a Teamwork Match the two Drivers switch controllers between 0:35 and 0:25 on the Match timer, and no Driver may operate the Robot for more than 35 seconds. The second Driver may not touch the controls until the controller is passed, and after that the first Driver may not touch them.'),
  note('loader', 'Can a Driver also be a Loader?', ['GG11'],
    'Yes, under certain conditions, since v1.1 (the v0.1 text said no and is out of date). On a drive team of two or three members, any member who is not actively operating the Robot may be a Loader. A one-member drive team may drive and Load for the first 35 seconds, and then the Robot must stop operating, even prewritten commands, for the rest of the Match.'),
  note('sg5', 'Preloads', ['SG5'],
    'Each Robot gets one yellow Preload, which must touch exactly one Robot before the Match and no Field Element other than the Floor, Goal or other Scoring Object.'),
  note('sg6', 'Possession and Plowing limit', ['SG6'],
    'A Robot may Possess or Plow only one Bean Bag at a time, so it cannot hold two. Pushing a Bean Bag more than about one tile length is generally Plowing; momentary incidental contact is not. The Head Referee makes the final call.'),
  note('sg7', 'Using the Load Zone', ['SG7'],
    'Bean Bags are Loaded one at a time, matching the Load Zone color, on the Floor and entirely inside the zone, and only when no other Bean Bag is touching that zone. A Robot may not touch a Bean Bag in the Load Zone while a person is touching it. Once released, the Loader may not touch it again unless the Head Referee rules it misloaded. It must stay on the Floor until a Robot touches it. Bean Bags from outside the Field may not cross the Field Perimeter until the Match begins.'),
  note('sg1', 'Robot starting size', ['SG1'],
    'Robots start the Match within 11 x 20 x 15 inches, in a legal starting position, and completely still until the Match timer starts.'),
  note('sg2', 'Horizontal expansion', ['SG2'],
    'After the Match starts a Robot may expand horizontally to 24 inches and must always fit an 11 x 24 inch footprint.'),
  note('sg3', 'Vertical expansion', ['SG3'],
    'After the Match starts a Robot may expand vertically without limit.'),
  note('field', 'The Field', [],
    'The Field is 6 by 8 tiles (6 ft by 8 ft) and has 38 Bean Bags: 16 blue and 16 red (8 of each start on the Field, 8 of each are loaded through the matching Load Zone) and 6 yellow (2 Preloads, 4 on the Field). It also has two Pyramid Goals (L1, L2, L3), two L4 Goals, two Floor Goals, two Load Zones, two wall structures and two Floor barriers.'),
  note('types', 'How Robot Skills differs from Teamwork', [],
    'A Teamwork Match is two Robots on one Alliance sharing one score, driven by people. Robot Skills is one Robot alone and comes in two kinds: Driving Skills (driven by people) and Autonomous Coding Skills (running code). Scoring uses the standard rules.'),
  note('rsc3', 'Robot Skills setup', ['RSC3'],
    'In Robot Skills the Robot starts in the position sharing a wall with the red Pyramid Goal. Eight Bean Bags (four red, four blue) start in the red Driver Station for Loading. The blue Driver Station and blue Load Zone are not used.'),
  note('rsc4', 'Robot Skills Loaders', ['RSC4'],
    'In Robot Skills any Driver not driving may also be a Loader, so a Team may have one, two or three Loaders. All Match Loads go through the red Load Zone.'),
  note('rsc5', 'Handling in Autonomous Coding Skills', ['RSC5'],
    'In Autonomous Coding Skills the Robot may be handled any number of times but must return to a legal start, with no new Preload, and any Bean Bag it holds is removed.'),
  note('rsc6', 'Starting Autonomous Coding Skills', ['RSC6'],
    'The routine must start from a Brain button or a manually triggered sensor, not the Controller.'),
  note('rsc8', 'Skills Stop Time', ['RSC8'],
    'A Team may opt in before the Match to end early and record a Skills Stop Time. It is a ranking tiebreaker and does not change the score.'),
  note('changes', 'What changed since v0.1', [],
    'v0.2 clarified start positions, SG6 and Plowing. v1.0 changed SC4 to award the higher level and clarified SC5, SG2, SG4 and SG7. v1.1 updated SC3, SG1, SG6, SG7 and GG11, and removed one General rule, renumbering the next one. v2.0 changed the Floor Goal and Load Zone boundaries (SC3, SG5, SG6, SG7), updated GG12, and made power button access under R7 a recommendation. v2.1 clarified Appendix E and fixed typos.'),
];

// Rules whose wording changed after v0.1. Used to warn when an answer leans on old text.
export const CHANGED_SINCE_V01 = new Set([
  'SC3', 'SC4', 'SC5', 'SG1', 'SG2', 'SG4', 'SG5', 'SG6', 'SG7', 'GG11', 'GG12',
  'G1', 'G2', 'G4', 'G5', 'G6', 'R3', 'R7', 'R17', 'T6', 'RSC3',
]);
