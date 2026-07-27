package com.company.assembleegameclient.objects.autododge {

import com.company.assembleegameclient.util.ConditionEffect;

/**
 * Explicit lexicographic ordering for dodge routes.
 *
 * Safety is compared before preference:
 *  1. reachable/valid route
 *  2. non-lethal route
 *  3. lower expected damage
 *  4. lower harmful-status severity
 *  5. less damaging-ground exposure
 *  6. outside rather than inside the configured clearance boundary
 *  7. later first physical impact within the same clearance tier
 *  8. later wall block and more independent exits
 *  9. greater exact minimum clearance
 * 10. smaller velocity error from player intent
 *
 * No weighted sum or sentinel constant can move a later field ahead of an
 * earlier safety fact. compare() returns -1 when candidate is preferable.
 */
public final class DodgeCost {
   private static const EPSILON:Number = 0.001;

   public static function compare(buffer:DodgeCandidateBuffer,
                                  candidate:int, incumbent:int) : int {
      var safety:int = compareSafety(buffer,candidate,incumbent);
      if(safety != 0) {
         return safety;
      }
      return compareLower(buffer.intentError[candidate],
            buffer.intentError[incumbent]);
   }

   /** Compare every safety and mobility field, deliberately excluding intent. */
   public static function compareSafety(buffer:DodgeCandidateBuffer,
                                        candidate:int, incumbent:int) : int {
      if(buffer.valid[candidate] != buffer.valid[incumbent]) {
         return buffer.valid[candidate] ? -1 : 1;
      }
      if(buffer.lethal[candidate] != buffer.lethal[incumbent]) {
         return buffer.lethal[candidate] ? 1 : -1;
      }
      var comparison:int = compareLower(buffer.expectedDamage[candidate],
            buffer.expectedDamage[incumbent]);
      if(comparison != 0) {
         return comparison;
      }
      comparison = compareLower(buffer.statusSeverity[candidate],
            buffer.statusSeverity[incumbent]);
      if(comparison != 0) {
         return comparison;
      }
      comparison = compareIntLower(buffer.groundExposureMs[candidate],
            buffer.groundExposureMs[incumbent]);
      if(comparison != 0) {
         return comparison;
      }
      var candidateSafe:Boolean = buffer.minimumClearance[candidate] >= 0;
      var incumbentSafe:Boolean = buffer.minimumClearance[incumbent] >= 0;
      if(candidateSafe != incumbentSafe) {
         return candidateSafe ? -1 : 1;
      }
      comparison = compareIntHigher(buffer.firstImpactMs[candidate],
            buffer.firstImpactMs[incumbent]);
      if(comparison != 0) {
         return comparison;
      }
      comparison = compareIntHigher(buffer.wallBlockMs[candidate],
            buffer.wallBlockMs[incumbent]);
      if(comparison != 0) {
         return comparison;
      }
      var candidateTier:int = mobilityTier(buffer.escapeOptions[candidate]);
      var incumbentTier:int = mobilityTier(buffer.escapeOptions[incumbent]);
      comparison = compareIntHigher(candidateTier,incumbentTier);
      if(comparison != 0) {
         return comparison;
      }
      comparison = compareIntHigher(buffer.escapeOptions[candidate],
            buffer.escapeOptions[incumbent]);
      if(comparison != 0) {
         return comparison;
      }
      return compareHigher(buffer.minimumClearance[candidate],
            buffer.minimumClearance[incumbent]);
   }

   /** Safety tier used before manual intent is allowed to choose geometry. */
   public static function isProtectionNoWorse(buffer:DodgeCandidateBuffer,
                                              candidate:int,
                                              reference:int,
                                              groundToleranceMs:int = 0) : Boolean {
      if(buffer.lethal[candidate] && !buffer.lethal[reference]) {
         return false;
      }
      return buffer.expectedDamage[candidate] <=
                  buffer.expectedDamage[reference] + EPSILON &&
            buffer.statusSeverity[candidate] <=
                  buffer.statusSeverity[reference] + EPSILON &&
            buffer.groundExposureMs[candidate] <=
                  buffer.groundExposureMs[reference] + groundToleranceMs;
   }

   public static function conditionSeverity(effect:int,
                                             duration:Number) : Number {
      var durationSeverity:Number = isFinite(duration) ?
            Math.min(10,Math.max(0,duration)) : 0;
      switch(effect) {
         case -1:
            return 30;
         case ConditionEffect.PARALYZED:
         case ConditionEffect.PETRIFIED:
         case ConditionEffect.STASIS:
            return 100;
         case ConditionEffect.SLOWED:
         case ConditionEffect.CONFUSED:
         case ConditionEffect.STUNNED:
            return 35 + durationSeverity * 5;
         case ConditionEffect.DAZED:
         case ConditionEffect.SICK:
         case ConditionEffect.QUIET:
         case ConditionEffect.SILENCED:
         case ConditionEffect.ARMOR_BROKEN:
         case ConditionEffect.BLEEDING:
         case ConditionEffect.CURSE:
         case ConditionEffect.EXPOSED:
         case ConditionEffect.UNSTABLE:
         case ConditionEffect.DARKNESS:
         case ConditionEffect.BLIND:
         case ConditionEffect.WEAK:
         case ConditionEffect.HALLUCINATING:
         case ConditionEffect.DRUNK:
         case ConditionEffect.HEXED:
         case ConditionEffect.HP_DEBUFF:
         case ConditionEffect.MP_DEBUFF:
         case ConditionEffect.ATT_DEBUFF:
         case ConditionEffect.DEF_DEBUFF:
         case ConditionEffect.SPD_DEBUFF:
         case ConditionEffect.VIT_DEBUFF:
         case ConditionEffect.WIS_DEBUFF:
         case ConditionEffect.DEX_DEBUFF:
            return 15 + durationSeverity * 3;
      }
      return 0;
   }

   public static function isLethalCondition(effect:int) : Boolean {
      return effect == ConditionEffect.PARALYZED ||
            effect == ConditionEffect.PETRIFIED ||
            effect == ConditionEffect.STASIS;
   }

   private static function mobilityTier(escapeOptions:int) : int {
      if(escapeOptions >= 6) {
         return 2;
      }
      return escapeOptions >= 4 ? 1 : 0;
   }

   private static function compareLower(candidate:Number,
                                        incumbent:Number) : int {
      if(candidate < incumbent - EPSILON) {
         return -1;
      }
      return candidate > incumbent + EPSILON ? 1 : 0;
   }

   private static function compareHigher(candidate:Number,
                                         incumbent:Number) : int {
      return compareLower(incumbent,candidate);
   }

   private static function compareIntLower(candidate:int, incumbent:int) : int {
      if(candidate < incumbent) {
         return -1;
      }
      return candidate > incumbent ? 1 : 0;
   }

   private static function compareIntHigher(candidate:int, incumbent:int) : int {
      return compareIntLower(incumbent,candidate);
   }
}
}
