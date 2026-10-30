// ---------- Threats ----------
// Pure data, no imports: every number for zombie types and modifiers lives here.
// A zombie has exactly one type; modifiers roll independently and stack on any type
// (an armored, explosive spitter is possible). Behaviour is in zombies.js and specials.js.
//
// Unlocks: City 1 has THREAT_BASE. Each later city introduces the next entry of THREAT_POOL
// (shuffled per run when SHUFFLE_INTRO), and every earlier threat keeps appearing.
// chance = [base, perCity, max]: spawn odds in the city it's introduced, + perCity for each
// city after that, capped at max. Types without `chance` (walker) fill the remaining odds.
// name/tip = the "New threat" banner shown the first time one comes within SPOT_RANGE.
export const THREAT_BASE = ['walker','runner'];
export const THREAT_POOL = ['screamer','explosive','spitter','armored','brute'];
export const SHUFFLE_INTRO = true;
export const INTRO_FORCED = 2;   // the newly introduced threat is forced onto this many early spawns
export const SPOT_RANGE = 20;    // units from the player before a new threat's banner shows
export const SCALE = { hp:0.3, speed:0.04 };  // per city after the first: +30% HP, +4% speed

// hp, speed [min,max], r = collision radius, dmg per hit, bleed = chance a hit causes bleeding,
// kb = knockback taken, heal = extra health-drop chance, maxAlive = cap on how many exist at once.
export const ZTYPES = {
  walker:   { hp:3,  speed:[2.0,2.8], r:0.42, dmg:10, bleed:0.25, scale:1,    skin:0x7d9468, kb:3.5, heal:0 },
  runner:   { hp:2,  speed:[4.3,5.1], r:0.38, dmg:8,  bleed:0.3,  scale:0.92, skin:0xa3a777, kb:3.5, heal:0, chance:[0.1,0.07,0.38] },
  brute:    { hp:12, speed:[1.6,1.9], r:0.7,  dmg:22, bleed:0.5,  scale:1.5,  skin:0x5e7052, kb:1.2, heal:0.1, chance:[0.05,0.04,0.2],
              name:'Brutes', tip:'Huge, slow and hard to stop. Back off and keep shooting' },
  // Sees the player (line of sight within `sight`), roots for `windup` s with a glowing head,
  // then screams once: alerts everything within alertR and spawns `spawn` zombies spawnR away.
  screamer: { hp:2,  speed:[2.4,3.0], r:0.4,  dmg:6,  bleed:0.15, scale:0.95, skin:0xc9c3b2, kb:3.5, heal:0, chance:[0.05,0.015,0.1], maxAlive:2,
              sight:16, windup:1.5, alertR:45, spawn:[6,10], spawnR:[3,9],
              name:'Screamers', tip:'When a head starts glowing, kill it fast or its scream brings more' },
  // Keeps between range[0] and range[1] from the player and lobs acid: windup s, then a shot that
  // lands after `flight` s at the player's position + lead*velocity*flight ± spread.
  spitter:  { hp:3,  speed:[1.9,2.4], r:0.45, dmg:6,  bleed:0.1,  scale:1.05, skin:0x8aa83a, kb:3,   heal:0, chance:[0.06,0.02,0.15], maxAlive:4,
              sight:20, range:[7,13], backSpeed:0.85, windup:0.55, cooldown:[2.6,3.8], flight:[0.8,1.1], lead:0.5, spread:1.2,
              puddleR:1.5, puddleTime:4, puddleDps:7,
              name:'Spitters', tip:'They lob acid from range. Get off the green marker before it lands' }
};

export const ZMODS = {
  // Glows orange. Explodes on death (after `chain` s, so blasts can chain) or `fuse` s after
  // getting within `trigger` of the player. dmgZombie scales with the city like pipe bombs.
  explosive: { chance:[0.06,0.02,0.15], radius:4, dmgZombie:10, dmgPlayer:30, trigger:0.8, fuse:0.45, chain:0.12,
               name:'Exploders', tip:'The orange ones blow up when they die or reach you. Shoot them in a crowd' },
  // Riot gear: hits within frontArc rad of where it faces deal frontMul damage and stop piercing
  // bullets. guard = extra chance on police-station guards.
  armored:   { chance:[0.06,0.02,0.15], guard:0.3, frontArc:1.0, frontMul:0.3, kbMul:0.4, speedMul:0.9,
               name:'Riot zombies', tip:'Shields soak shots from the front and stop piercing rounds. Flank them, or use fire' }
};

// The Crystal. From city pulseFrom on, the first hit that takes it to pulseAt of its HP or below
// makes it lash out once: a wave that alerts everything within pulseR and raises
// pulseSpawn = [base, perCity, max] zombies pulseDist units from it (counted from pulseFrom).
// Breaking it starts the takeover: `takeover` s of violet sky in which everything spawns alert.
// First a surge of surge[0] + surge[1]*(city-1) rises 15–30 units away, then one more every
// interval = [base, perCity, min] s (shrinking by up to `ramp` as the clock runs down) while fewer
// than cap[0] + cap[1]*city of them are alive. ammoDrop replaces the usual ammo-box chance.
export const CRYSTAL = { pulseFrom:3, pulseAt:0.5, pulseR:60, pulseSpawn:[8,2,18], pulseDist:[4,12],
  takeover:180, surge:[10,3], interval:[1.8,0.15,0.8], ramp:0.4, cap:[10,4], ammoDrop:0.14 };
