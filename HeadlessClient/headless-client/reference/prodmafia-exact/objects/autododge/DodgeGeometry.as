package com.company.assembleegameclient.objects.autododge {

/** Pure collision geometry shared by projectile hit tests and dodge planning. */
public final class DodgeGeometry {
   /** Exact minimum L-infinity distance from the origin to a line segment. */
   public static function minimumChebyshevOnSegment(x0:Number, y0:Number,
                                                     x1:Number, y1:Number) : Number {
      var best:Number = Math.min(Math.max(Math.abs(x0),Math.abs(y0)),
            Math.max(Math.abs(x1),Math.abs(y1)));
      var dx:Number = x1 - x0;
      var dy:Number = y1 - y0;
      var t:Number;
      var x:Number;
      var y:Number;
      var value:Number;

      if(dx != 0) {
         t = -x0 / dx;
         if(t > 0 && t < 1) {
            y = y0 + dy * t;
            value = Math.abs(y);
            if(value < best) best = value;
         }
      }
      if(dy != 0) {
         t = -y0 / dy;
         if(t > 0 && t < 1) {
            x = x0 + dx * t;
            value = Math.abs(x);
            if(value < best) best = value;
         }
      }
      if(dx != dy) {
         t = (y0 - x0) / (dx - dy);
         if(t > 0 && t < 1) {
            x = x0 + dx * t;
            y = y0 + dy * t;
            value = Math.max(Math.abs(x),Math.abs(y));
            if(value < best) best = value;
         }
      }
      if(dx != -dy) {
         t = (-y0 - x0) / (dx + dy);
         if(t > 0 && t < 1) {
            x = x0 + dx * t;
            y = y0 + dy * t;
            value = Math.max(Math.abs(x),Math.abs(y));
            if(value < best) best = value;
         }
      }
      return best;
   }

   public static function pointToSegmentDistance(pointX:Number, pointY:Number,
                                                  startX:Number, startY:Number,
                                                  endX:Number, endY:Number) : Number {
      var segmentX:Number = endX - startX;
      var segmentY:Number = endY - startY;
      var lengthSq:Number = segmentX * segmentX + segmentY * segmentY;
      if(lengthSq <= 0.0000001) {
         segmentX = pointX - startX;
         segmentY = pointY - startY;
         return Math.sqrt(segmentX * segmentX + segmentY * segmentY);
      }
      var t:Number = ((pointX - startX) * segmentX +
            (pointY - startY) * segmentY) / lengthSq;
      t = Math.max(0,Math.min(1,t));
      var dx:Number = pointX - (startX + segmentX * t);
      var dy:Number = pointY - (startY + segmentY * t);
      return Math.sqrt(dx * dx + dy * dy);
   }
}
}
