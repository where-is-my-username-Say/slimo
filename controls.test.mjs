import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./slimo-game.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('one touch cannot release another touch’s charged spit', () => {
  let shots = 0;
  const c = vm.createContext({ abilityPointers: new Map([['spit', 3]]), spitHold: 100, spitCharge: .7, held: new Set(['spit']), releaseSpitHold: () => shots++ });
  vm.runInContext(fn('releaseAbility'), c);
  vm.runInContext("releaseAbility('spit', { pointerId: 4, type: 'pointerup' })", c);
  assert.equal(shots, 0); assert.equal(c.spitHold, 100);
  vm.runInContext("releaseAbility('spit', { pointerId: 3, type: 'pointercancel' })", c);
  assert.equal(shots, 0); assert.equal(c.spitHold, null); assert.equal(c.spitCharge, 0);
  assert.equal(c.held.size, 0);
});

test('pointerup followed by lost capture fires only one spit', () => {
  let shots = 0;
  const c = vm.createContext({ abilityPointers: new Map([['spit', 3]]), held: new Set(['spit']), releaseSpitHold: () => shots++ });
  vm.runInContext(fn('releaseAbility'), c);
  vm.runInContext("releaseAbility('spit', {pointerId: 3, type: 'pointerup'}); releaseAbility('spit', {pointerId: 3, type: 'lostpointercapture'})", c);
  assert.equal(shots, 1); assert.equal(c.abilityPointers.size, 0);
});

test('reset clears keyboard, charge, joystick and captured ability state', () => {
  const c = vm.createContext({ spitHold: 10, spitCharge: .9, keys: new Set(['w']), held: new Set(['slap']), abilityPointers: new Map([['slap', 2]]), drag: {}, stickPointer: 9, stickCenter: {}, joystick: {x: 1, z: 1}, nub: {style: {transform: 'x'}}, stick: {classList: {remove() {}}} });
  vm.runInContext(fn('resetInputs') + '\nresetInputs()', c);
  assert.equal(c.spitCharge, 0); assert.equal(c.spitHold, null);
  assert.equal(c.keys.size + c.held.size + c.abilityPointers.size, 0);
  assert.equal(c.drag, null); assert.equal(c.stickPointer, null);
  assert.equal(c.joystick.x + c.joystick.z, 0);
});

test('Meadow and duels reject actions while overlays or graphics loss block play', () => {
  let ready = false, predictions = 0;
  const c = vm.createContext({
    actions: ['slap', 'spit', 'dash', 'nova', 'jump'], mode: 'public', state: {phase: 'fight', p: [{hp: 100}]},
    gameReady: () => ready, publicRoom: {id: 1}, roomCanFight: () => true,
    inputCounts: {slap: 0}, lastRepeat: {}, clock: 1,
    predictPublicAttack: () => predictions++, sendRoomInput() {}
  });
  vm.runInContext(fn('trigger'), c);
  vm.runInContext("trigger('slap')", c); assert.equal(c.inputCounts.slap, 0);
  ready = true;
  vm.runInContext("trigger('slap'); trigger('unknown')", c);
  assert.equal(c.inputCounts.slap, 1); assert.equal(predictions, 1);
  assert.equal(Object.hasOwn(c.inputCounts, 'unknown'), false);
});

test('dialogs include dropdowns and links, exclude hidden and inert controls', () => {
  const selector = source.match(/const FOCUSABLE = (.*);/)[1];
  let observed = '';
  const visible = {tabIndex: 0, matches: () => false, getClientRects: () => [1], closest: () => null};
  const hidden = {...visible, getClientRects: () => []};
  const inert = {...visible, closest: () => ({})};
  const c = vm.createContext({ element: {querySelectorAll: value => {observed = value; return [visible, hidden, inert];}} });
  const result = vm.runInContext('const FOCUSABLE = ' + selector + ';\n' + fn('overlayFocusables') + '\noverlayFocusables(element)', c);
  assert.ok(observed.includes('select:not(:disabled)'));
  assert.ok(observed.includes('a[href]'));
  assert.equal(result.length, 1); assert.equal(result[0], visible);
});

test('HUD lookups reuse connected nodes and recover when a node is replaced', () => {
  let queries = 0, element = {isConnected: true};
  const c = vm.createContext({document: {getElementById: () => {queries++; return element;}}});
  const cacheCode = source.slice(source.indexOf('const elementCache'), source.indexOf('const T ='));
  vm.runInContext(cacheCode, c);
  vm.runInContext("for(let i=0;i<6000;i++) $('myHp')", c);
  assert.equal(queries, 1);
  element.isConnected = false; element = {isConnected: true};
  assert.equal(vm.runInContext("$('myHp')", c), element);
  assert.equal(queries, 2);
});
