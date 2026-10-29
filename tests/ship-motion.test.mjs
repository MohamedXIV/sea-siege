import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceShipOnRoute, boundedDeltaSeconds, SHIP_MOTION_RULES } from '../spacetimedb/src/sim/ship-motion.ts';

const ship = (x=1.5, y=1.5, heading=0) => ({x,y,velocityX:0,velocityY:0,hullAngleDeg:heading});
const route = (size, ...pairs) => pairs.map(([x,y]) => y*size+x);

test('bounded real dt avoids burst catch-up and ignores repeated/earlier ticks', () => {
  assert.equal(boundedDeltaSeconds(0n,100_000n),.1);
  assert.equal(boundedDeltaSeconds(0n,5_000_000n),.25);
  assert.equal(boundedDeltaSeconds(10n,10n),0);
  assert.equal(boundedDeltaSeconds(20n,10n),0);
  assert.equal(SHIP_MOTION_RULES.tickMicroseconds,100_000n);
});

test('moves between adjacent cell centers at a bounded rate, never teleports', () => {
  const path = route(8,[2,1],[3,1]);
  const one = advanceShipOnRoute(ship(),path,0,8,.1);
  assert.ok(one.ship.x>1.5 && one.ship.x<=1.7);
  assert.equal(one.ship.y,1.5);
  assert.equal(one.cursor,0);
  const two = advanceShipOnRoute(one.ship,path,one.cursor,8,.1);
  assert.ok(two.ship.x>one.ship.x);
  assert.ok(two.ship.x<2.5);
});

test('arrives at the final waypoint without overshoot or idle DB churn', () => {
  let state = ship(); let cursor=0;
  const path=route(8,[2,1],[3,1]);
  for(let i=0;i<100;i++) {
    const out=advanceShipOnRoute(state,path,cursor,8,.1);
    state=out.ship;cursor=out.cursor;
    if(out.arrived)break;
  }
  assert.equal(cursor,path.length);
  assert.equal(state.x,3.5);
  assert.equal(state.y,1.5);
  assert.equal(state.velocityX,0);
  const final=advanceShipOnRoute(state,path,cursor,8,.1);
  assert.equal(final.changed,false);
});

test('turns via shortest arc and slows forward travel on sharp turns', () => {
  const path=route(8,[1,2]);
  const result=advanceShipOnRoute(ship(1.5,1.5,270),path,0,8,.1);
  assert.equal(result.ship.hullAngleDeg,255);
  assert.equal(result.ship.x,1.5);
  assert.equal(result.ship.y,1.5);
  assert.ok(result.changed);
  const wrap=advanceShipOnRoute(ship(1.5,1.5,359),route(8,[2,1]),0,8,.1);
  assert.equal(wrap.ship.hullAngleDeg,0);
});

test('diagonal segments never pass an intermediate waypoint within one step', () => {
  const path=route(8,[2,2],[3,2]);
  const first=advanceShipOnRoute(ship(1.5,1.5,0),path,0,8,.1);
  assert.ok(first.ship.x<2.5 && first.ship.y<2.5);
  assert.equal(first.cursor,0);
  let state=first.ship, cursor=first.cursor;
  for(let i=0;i<30;i++) {
    const next=advanceShipOnRoute(state,path,cursor,8,.1);
    if(next.cursor>0){assert.equal(next.ship.y,2.5);break;}
    state=next.ship;cursor=next.cursor;
  }
});

test('rejects invalid positions, corrupted routes and invalid budgets', () => {
  assert.throws(()=>advanceShipOnRoute(ship(),[99],0,8,.1),RangeError);
  assert.throws(()=>advanceShipOnRoute(ship(),[2],-1,8,.1),RangeError);
  assert.throws(()=>advanceShipOnRoute(ship(),[2],0,8,-1),RangeError);
  assert.throws(()=>advanceShipOnRoute({...ship(),x:NaN},[2],0,8,.1),RangeError);
  assert.equal(advanceShipOnRoute(ship(),[2],0,8,0).changed,false);
});

test('5, 10 and 20 Hz server stepping give matching constant-velocity travel', () => {
  const path=route(16,[2,1],[3,1],[4,1],[5,1],[6,1]);
  const endpoints=[];
  for(const hz of [5,10,20]) {
    let state=ship();let cursor=0;
    for(let i=0;i<hz;i++) {
      const result=advanceShipOnRoute(state,path,cursor,16,1/hz);
      state=result.ship;cursor=result.cursor;
    }
    endpoints.push(state.x);
  }
  for(const end of endpoints)assert.ok(Math.abs(end-3.5)<1e-9);
});

test('a five-second scheduling stall moves no farther than the capped dt', () => {
  const path=route(16,[2,1],[3,1],[4,1]);
  const seconds=boundedDeltaSeconds(0n,5_000_000n);
  const result=advanceShipOnRoute(ship(),path,0,16,seconds);
  assert.ok(result.ship.x <= 2.0+1e-9);
  assert.ok(result.ship.x > 1.5);
});


test('trace records each physical leg when one tick turns at a waypoint', () => {
  const result = advanceShipOnRoute(ship(2.4, 1.5, 0),
    route(8, [2,1], [2,2]), 0, 8, .25);
  assert.equal(result.traversedSegments.length, 2);
  const [first, second] = result.traversedSegments;
  assert.deepEqual(first.from, { x: 2.4, y: 1.5 });
  assert.deepEqual(first.to, { x: 2.5, y: 1.5 });
  assert.deepEqual(second.from, first.to);
  assert.equal(second.to.x, 2.5);
  assert.ok(second.to.y > 1.5);
  assert.deepEqual(second.to, {x: result.ship.x, y: result.ship.y});
  // Start/end CHORD is diagonal, but neither travelled leg is.
  assert.ok(result.ship.x !== first.from.x && result.ship.y !== first.from.y);
  assert.equal(first.from.y, first.to.y);
  assert.equal(second.from.x, second.to.x);
});

test('an idle or turning-only step produces no phantom collision segments', () => {
  const zero = advanceShipOnRoute(ship(), route(8,[2,1]), 0,8,0);
  assert.deepEqual(zero.traversedSegments, []);
  const turn = advanceShipOnRoute(ship(1.5,1.5,270),route(8,[1,2]),0,8,.1);
  assert.deepEqual(turn.traversedSegments, []);
});

test('all swept legs form a contiguous path ending at the server position', () => {
  const result = advanceShipOnRoute(ship(2.45,1.5,0),
    route(8,[2,1],[2,2],[2,3]),0,8,.25);
  for(let i=1;i<result.traversedSegments.length;i++)
    assert.deepEqual(result.traversedSegments[i].from,
      result.traversedSegments[i-1].to);
  const final=result.traversedSegments.at(-1);
  assert.deepEqual(final?.to,{x:result.ship.x,y:result.ship.y});
});
