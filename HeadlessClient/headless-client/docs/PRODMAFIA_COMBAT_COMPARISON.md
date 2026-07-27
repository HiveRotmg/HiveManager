# Headless vs ProdMafia combat comparison

References audited:

- local archive: `C:\Users\trump\Downloads\ProdMafia-master\prodmafia`;
- commit `780329c5314ba867eb5ec27448f5b9bc9e39b612` and its two
  combat predecessors (`c9cb0c8`, `1446c84`); and
- remote `main` at `b2cd9f05c5561b88856f1e8b8dae98eead05634d`.

## 2026-07-27 burst-fire and protocol parity

The linked commit itself adds a findings document. Its source-code prerequisites
are the preceding burst-cadence and PLAYERSHOOT commits. Headless now ports
those behaviors:

- PLAYERSHOOT's trailing bytes are serialized and parsed as
  `burstIndex`, `patternIndex`, `attackType`;
- `BurstCount`, `BurstDelay`, and `BurstMinDelay` are loaded from both root
  attacks and `<Subattack>` definitions;
- a burst has a `BurstCount * NumProjectiles` projectile budget;
- `burstIndex` advances once per projectile and resets for the next burst;
- burst cooldown is measured from burst start and interpolates from
  `BurstDelay` to `BurstMinDelay` by `min(1, dex / 75)`;
- Berserk shortens the minimum-delay endpoint by 25%;
- the per-subattack fire gate includes the reference client's 5 ms allowance;
  and
- equipped weapon `<MultiplyRateOfFire>` enchantments are folded into both
  weapon-level and subattack-level gates.

The loader was checked against production XML: B.O.W. (`0x3d8d`) resolves to
five projectiles, `BurstCount=3`, `BurstDelay=1000 ms`, and
`BurstMinDelay=600 ms`; Overwhelming Strikes (`0x632`) resolves to a `0.8`
rate-of-fire multiplier.

The three source commits after the linked commit on current ProdMafia `main`
are AIR renderer/GC scheduling and Moonlight Village lantern-follow changes.
Headless has no AIR renderer, ActionScript GC pump, or lantern-follow feature,
so they have no equivalent code path to port.

## Partial Godmode and AoE acknowledgement protection

Commit `a7f33a327d0f438bc6c03f6e6667519f4c453a15` moves ProdMafia's
Partial Godmode decision to the projectile-collision boundary. Headless now
does the same: enabling it consumes an enemy projectile before predicted HP is
charged and before `PLAYERHIT` is sent. It is off by default and exposed
through `Hive.combat.setPartialGodMode(enabled)`, enable/disable helpers, and a
status getter.

No named AoE-spoof implementation or 500-tile coordinate offset exists in the
referenced commit, the fetched `main` head, or the fetched repository history.
Current ProdMafia instead has strategic suppression that withholds selected
`AOEACK` packets. For the separately requested 500-tile behavior, Headless
implements a default-off SDK toggle that sends `AOEACK` at local
`x + 500, y + 500` and symmetrically skips local AoE HP/debuff application.
The real AoE remains available to viewer and dodge tracking.

## Projectile information and motion

| Area | Headless | ProdMafia | Result |
|---|---|---|---|
| Core fields | Speed, lifetime, damage, armor piercing, multihit, cover, status effects | Same | Broad match |
| Nonlinear paths | Wavy, parametric, boomerang, amplitude/frequency/magnitude, acceleration and turning | Same families | Broad match |
| Turning units | Loader converts `TurnAcceleration` to radians and leaves delay values in their raw numeric form | Keeps `TurnAcceleration` raw; converts turn delays from ms to seconds | Divergent |
| `SpeedClamp` default | `-1` means unclamped | Missing/non-positive clamp resolves to `0` | Divergent |
| Laser projectiles | No first-class laser-distance/beam collision model | `<Laser>` is a world-space beam length and has beam collision | Missing in Headless |
| Damage range | Loader reads only `<Damage>` | Supports `<Damage>` or `<MinDamage>/<MaxDamage>` | Missing in Headless data |
| Damage multiplier | Not represented | Parses timed `<DamageMultiplier>` target debuff | Missing in Headless |
| Local projectile effects | Parsed into game data, but player-hit prediction only reports damage | Locally applies supported projectile debuffs before acknowledgement | Partial in Headless |
| Collision multiplier | Shared `0.5 * CollisionMult` half-extent in hit resolver and dodge planner | Same | Match |
| Player multipliers | Own shots and aim use projectile speed/lifetime multipliers | Same | Match |
| Packet pattern | Tracks subattack projectile id, bullet id and shot offsets; preserves local projectile on server echo | Same behavior | Match |
| Known internal drift | Combat and aim intentionally retain different boomerang/clamping behavior | One `ProjectileProperties` distance implementation | Headless still has documented drift |

## Auto Aim

| Area | Headless | ProdMafia | Result |
|---|---|---|---|
| Modes | Closest, max HP, lowest HP, random, fixed object/position | Mouse-bounded, max HP, closest, random | Headless lacks mouse-bounded mode; adds lowest-HP/fixed modes |
| Max-HP tie break | Higher current HP, then distance | Lower current HP, then distance | Divergent |
| Boss priority | Quest object with at least 5,000 max HP | Explicit boss/custom-boss metadata | Divergent classification |
| Filtering | Dead, stasis, paused, invincible and optionally invulnerable | Adds ignored/excepted/wall and O3 shield filters | Headless is less specialized |
| Target leading | Server-tick history, stop/turn prediction, projectile path and next shot-pattern offset | Current velocity/turn rate plus projectile average speed | Different models; Headless is trajectory-aware |
| Extend Shot | Not implemented | Can advance the shot origin and converge multi-shot fans | Missing in Headless |

## Auto Ability

| Area | Headless | ProdMafia | Result |
|---|---|---|---|
| General gates | Safe map, MP percentage, cooldown, target count/HP/range and teleport opt-in | Safe map, MP percentage, ability usability and 550 ms attempt gate | Broad match |
| Class behavior | Generic target-or-self cast | Class-specific priest, necromancer, ninja, druid, kensei, prism, spell, skull, trap, poison, waki and other paths | Missing in Headless |
| Self-buff recast | No active-buff inspection | Holds while all granted self buffs remain active | Missing in Headless |
| Server rejection | Cooldown only | Exponential suppression after repeated rejected uses | Missing in Headless |
| Target thresholds | Generic minimum target HP/count | Spellbomb/skull HP thresholds, prism crowd threshold and heal-specific logic | Missing in Headless |

## Auto Nexus port

The prior Headless implementation had the damage formula, safe-map gate and
three HP values, but permanently retained unacknowledged local damage and used a
20% default.

The replacement now follows ProdMafia's current behavior:

- 15% default and a zero-percent Off setting;
- authoritative `serverHp`, synced baseline and predicted HP;
- a bounded 64-entry pending-damage ledger;
- 600 ms projectile and 1,200 ms environment prediction expiry;
- oldest-first acknowledgement of predicted damage by server HP loss;
- predicted-recovery reconciliation support;
- same-batch max-HP capacity-loss exclusion;
- optional two-second unattributed-damage rate, 350 ms reaction margin and 12%
  max-HP cap;
- safe-map suppression using ProdMafia's map list;
- immediate handling of authoritative `DAMAGE` packets;
- local projectile, AOE, ground and bleeding pre-acknowledgement checks; and
- the 180 ms predictive check using damage that still intersects Auto Dodge's
  committed safest timed route, including learned thrown-AOE damage.
