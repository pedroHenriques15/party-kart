// The others in a round, as fighters (braga-map's task 074): the CC0 figure (render/models.ts) in the
// colours of the friend they picked, its legs walking and running on its own clips, crouched by
// bending its knees, its body turned up and down to where they look, both hands on their weapon (the
// arms reaching for it, two-bone IK), a shot kicking it, a reload's hand going to the magazine, a hit
// jerking them away from it, falling on its death clip and fading; in a round of two teams, its vest in
// the team's colour. Until the figure's loaded, the driver on legs (drivers.ts' buildWalker) stands in.
import * as THREE from 'three';
import { GUNS, isGun, isNade, type WeaponId } from '../game/arsenal.ts';
import { TEAMS } from '../hud.ts';
import { buildGun, lookOf } from './guns.ts';
import { buildWalker, type Driver } from './drivers.ts';
import { cloneFighter, fighterModel, repaint, weaponModel, type FighterModel, type Painter } from './models.ts';

// How they stand this frame: their pace, how far they look up, how far they're crouched, what's in
// their hands (null when down), whether they're scoped or reloading, on the ground, and their team.
export interface FighterPose {
  speed: number;
  pitch: number;
  crouch: number;
  hand: WeaponId | null;
  scoped: boolean;
  reloading: boolean;
  grounded: boolean;
  team: number | null;
}

export interface Fighter {
  group: THREE.Group;
  update: (dt: number, p: FighterPose) => void;
  // A shot or a cut of theirs.
  fired: (w: WeaponId) => void;
  // Down from 0 standing to 1, and faded from 0 to gone.
  fall: (down: number, fade: number) => void;
  // Hit by a shot going the way d, as hard as k from 0 to 1.
  hit: (d: { x: number; y: number; z: number }, k: number) => void;
  // Where their weapon's muzzle is, for their shots' flash and tracers.
  muzzle: (out: THREE.Vector3) => THREE.Vector3;
}

// The figure's file is 1.82 m to its helmet's top; the hitboxes (fight.ts) are a body 1.76 m tall,
// its head's middle at 1.58.
const SCALE = 0.97;
// How far crouching drops the hips (the head from 1.58 to 1.12).
const DROP = 0.44;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Quaternion();

// Turns a bone by q in the world's frame.
function turn(b: THREE.Object3D, q: THREE.Quaternion): void {
  b.parent!.getWorldQuaternion(_p);
  b.quaternion.premultiply(_q.copy(_p).invert().multiply(q).multiply(_p));
  b.updateMatrixWorld(true);
}

// Turns bone b about its own joint so the point `from` (in the world) goes to `to`'s direction.
function aim(b: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  const o = b.getWorldPosition(_t);
  const u = from.clone().sub(o).normalize();
  const v = to.clone().sub(o).normalize();
  turn(b, new THREE.Quaternion().setFromUnitVectors(u, v));
}

// Two bones (a shoulder and an elbow, a hip and a knee) bent so the third's joint reaches t, the middle
// joint bending towards `pole`.
function reach(a: THREE.Object3D, b: THREE.Object3D, c: THREE.Object3D, t: THREE.Vector3, pole: THREE.Vector3): void {
  const A = a.getWorldPosition(_a).clone();
  const B = b.getWorldPosition(_b).clone();
  const C = c.getWorldPosition(_c).clone();
  const l1 = A.distanceTo(B);
  const l2 = B.distanceTo(C);
  const d = t.clone().sub(A);
  const L = Math.min(Math.max(d.length(), Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999);
  d.normalize();
  const cos = Math.min(1, Math.max(-1, (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L)));
  const n = pole.clone().sub(A);
  n.addScaledVector(d, -n.dot(d)).normalize();
  const B2 = A.clone().addScaledVector(d, cos * l1).addScaledVector(n, Math.sqrt(1 - cos * cos) * l1);
  aim(a, B, B2);
  aim(b, c.getWorldPosition(new THREE.Vector3()), A.clone().addScaledVector(d, L));
}

// The figure's colours: the friend's clothes and skin, their kart's paint on the vest, or their team's.
function painter(d: Driver, team: number | null): Painter {
  const clothes = new THREE.Color(d.outfit);
  const trousers = clothes.clone().multiplyScalar(0.5);
  // A kart painted near black gives its driver's vest the trim's colour instead, to be seen.
  const paint = new THREE.Color(d.color);
  const vest = new THREE.Color(team !== null ? TEAMS[team].color : paint.r + paint.g + paint.b < 0.06 ? d.trim : d.color);
  if (team === null) vest.lerp(new THREE.Color('#202226'), 0.25);
  const skin = new THREE.Color(d.skin);
  const gear = new THREE.Color('#2a2c2f');
  const boots = new THREE.Color('#1b1b1d');
  const helmet = new THREE.Color(team === null ? '#33363a' : TEAMS[team].color).lerp(new THREE.Color('#2a2c2f'), team === null ? 0 : 0.45);
  const visor = new THREE.Color('#111a20');
  return (name, x, y) => {
    switch (name) {
      case 'Swat_Body_1':
        return clothes;
      case 'Swat_Legs_1':
        return trousers;
      case 'Swat_Feet':
        return boots;
      case 'Swat_Body_3':
        return skin;
      case 'Swat_Head_2':
        return helmet;
      case 'Swat_Head_3':
        return visor;
      case 'Swat_Body_2':
        // The vest on the body; the gloves out at the hands.
        return Math.abs(x) > 0.24 && y < 1.15 ? gear : vest;
      default:
        return gear;
    }
  };
}

// The figure itself, once it's in.
interface Figure {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  mixer: THREE.AnimationMixer;
  fall: THREE.AnimationMixer;
  death: THREE.AnimationAction;
  acts: Record<'idle' | 'walk' | 'run' | 'calm', THREE.AnimationAction>;
  bone: (n: string) => THREE.Object3D;
  // Every bone as the clips last posed it, put back before they pose it again: three's mixer writes a
  // bone only when its pose has changed, so the turns made after it (the aim, the crouch, the arms)
  // would otherwise stay, or pile up.
  posed: { b: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[];
  dead: boolean;
}

function buildFigure(fm: FighterModel, d: Driver, team: number | null): Figure {
  const { root, mesh } = cloneFighter(fm, painter(d, team));
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.08 });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Its file faces +z; a fighter faces +x.
  root.scale.setScalar(SCALE);
  root.rotation.y = Math.PI / 2;
  const mixer = new THREE.AnimationMixer(root);
  const clip = (n: string) => fm.clips.find((c) => c.name === n) ?? fm.clips[0];
  const act = (n: string) => {
    const a = mixer.clipAction(clip(n));
    a.play();
    a.setEffectiveWeight(0);
    return a;
  };
  const acts = { idle: act('Idle_Gun'), walk: act('Walk'), run: act('Run'), calm: act('Idle') };
  // The fall is posed by hand, from how far down they are: the clip's time set, never run, on a
  // mixer of its own.
  const fall = new THREE.AnimationMixer(root);
  const death = fall.clipAction(clip('Death'));
  death.setLoop(THREE.LoopOnce, 1);
  death.clampWhenFinished = true;
  death.timeScale = 0;
  death.play();
  const bones = new Map<string, THREE.Object3D>();
  const posed: Figure['posed'] = [];
  root.traverse((o) => {
    bones.set(o.name, o);
    if ((o as THREE.Bone).isBone) posed.push({ b: o, p: o.position.clone(), q: o.quaternion.clone() });
  });
  return { root, mesh, mixer, fall, death, acts, bone: (n) => bones.get(n)!, posed, dead: false };
}

// What's in a fighter's hands, at a person's size: its model, or its stand-in until that's in.
interface Item {
  id: WeaponId;
  mesh: THREE.Object3D;
  model: boolean;
  muzzle: THREE.Vector3;
  grip: THREE.Vector3; // the right hand's place on it
  fore: THREE.Vector3 | null; // the left's
}
function itemOf(w: WeaponId): Item {
  const m = weaponModel(w);
  if (m) {
    const mesh = new THREE.Mesh(m.still, m.material);
    mesh.castShadow = true;
    const one = !isGun(w);
    const f = isGun(w) ? GUNS[w].family : null;
    const k = f === 'sniper' ? 0.42 : f === 'pistol' ? 0 : 0.48;
    const fore = one || f === 'pistol' ? null : V(0, m.muzzle.y - 0.03, m.trigger.z + (m.muzzle.z - m.trigger.z) * k);
    const grip = isGun(w) ? m.trigger.clone().add(V(0, -0.04, 0.03)) : w === 'knife' ? V(0, -0.075, 0) : V(0, 0, 0);
    return { id: w, mesh, model: true, muzzle: m.muzzle.clone(), grip, fore };
  }
  const g = buildGunStandIn(w);
  return { id: w, mesh: g.group, model: false, muzzle: g.muzzle, grip: V(0, 0, 0.02), fore: isGun(w) && GUNS[w].family !== 'pistol' ? V(0, 0.02, -0.25) : null };
}
// The stand-in made in code, turned to the models' frame (barrel along -z).
function buildGunStandIn(w: WeaponId): { group: THREE.Group; muzzle: THREE.Vector3 } {
  const g = buildGun(lookOf(w));
  const group = new THREE.Group();
  g.group.rotation.y = Math.PI / 2;
  group.add(g.group);
  return { group, muzzle: V(g.muzzle.z, g.muzzle.y, -g.muzzle.x) };
}
export function buildFighter(d: Driver): Fighter {
  const group = new THREE.Group();
  // The stand-in, till the figure's in.
  const walker = buildWalker(d);
  group.add(walker.group);
  let fig: Figure | null = null;
  let team: number | null = null;
  let item: Item | null = null;
  const items = new Map<WeaponId, Item>();
  // A shot's kick, a hit's jerk (about a world axis), and the death's fall and fade.
  let kick = 0;
  let cut = 0;
  const jerk = new THREE.Vector3();
  let down = 0;
  let fade = 0;
  let reloadT = 0;
  let t = 0;
  let crouch = 0;
  const own = { faded: false };

  const hold = (w: WeaponId | null) => {
    if (item?.id === w && (item.model || !weaponModel(w!))) return;
    if (item) item.mesh.removeFromParent();
    item = null;
    if (!w || !fig) return;
    let it = items.get(w);
    if (!it || (!it.model && weaponModel(w))) {
      it = itemOf(w);
      items.set(w, it);
    }
    group.add(it.mesh);
    item = it;
  };

  const pose = (dt: number, p: FighterPose) => {
    const f = fig!;
    t += dt;
    // The legs: still, walking or running, as fast as they go.
    const s = p.speed;
    const wWalk = Math.min(1, s / 1.2) * (1 - Math.min(1, Math.max(0, (s - 2.6) / 1.4)));
    const wRun = Math.min(1, Math.max(0, (s - 2.6) / 1.4));
    const dead = down > 0;
    const armed = !!p.hand && !isNade(p.hand) && p.hand !== 'knife';
    f.acts.idle.setEffectiveWeight(dead ? 0 : (1 - Math.min(1, s / 1.2)) * (armed ? 1 : 0));
    f.acts.calm.setEffectiveWeight(dead ? 0 : (1 - Math.min(1, s / 1.2)) * (armed ? 0 : 1));
    f.acts.walk.setEffectiveWeight(dead ? 0 : wWalk);
    f.acts.run.setEffectiveWeight(dead ? 0 : wRun);
    f.acts.walk.timeScale = Math.min(1.7, Math.max(0.5, s / 1.6));
    f.acts.run.timeScale = Math.min(1.5, Math.max(0.6, s / 4.6));
    for (const r of f.posed) {
      r.b.position.copy(r.p);
      r.b.quaternion.copy(r.q);
    }
    // Down, or up again: the other mixer's actions started afresh, so they write every bone.
    if (dead !== f.dead) {
      f.dead = dead;
      const acts = dead ? [f.death] : Object.values(f.acts);
      for (const a of acts) {
        a.stop();
        a.play();
      }
    }
    if (dead) {
      f.death.time = Math.min(1, down) * f.death.getClip().duration * 0.97;
      f.fall.update(0);
    } else f.mixer.update(dt);
    for (const r of f.posed) {
      r.p.copy(r.b.position);
      r.q.copy(r.b.quaternion);
    }
    f.root.position.set(0, 0, 0);
    group.updateMatrixWorld(true);
    if (dead) {
      if (item) item.mesh.visible = false;
      return;
    }

    // Crouched: the hips down, the feet where they were, the knees bent forward.
    crouch += (p.crouch - crouch) * Math.min(1, dt * 14);
    const fwd = V(1, 0, 0).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
    const up = V(0, 1, 0);
    const right = V(0, 0, 1).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
    if (crouch > 0.01) {
      const feet = ['L', 'R'].map((k) => f.bone(`Foot${k}`).getWorldPosition(new THREE.Vector3()));
      f.root.position.y = -DROP * crouch;
      group.updateMatrixWorld(true);
      ['L', 'R'].forEach((k, i) => {
        const knee = f.bone(`LowerLeg${k}`).getWorldPosition(new THREE.Vector3());
        reach(f.bone(`UpperLeg${k}`), f.bone(`LowerLeg${k}`), f.bone(`Foot${k}`), feet[i], knee.addScaledVector(fwd, 0.6));
      });
      // Leaning into it.
      turn(f.bone('Abdomen'), new THREE.Quaternion().setFromAxisAngle(right, -0.28 * crouch));
    }

    // Looking up or down: the body bends, the more the higher up the spine; a shot rocks it back, a
    // hit jerks it.
    kick = Math.max(0, kick - dt * 7);
    cut = Math.max(0, cut - dt * 3);
    jerk.multiplyScalar(Math.exp(-dt * 9));
    const pitch = Math.max(-1.1, Math.min(1.1, p.pitch));
    const pull = (crouch > 0.01 ? 0.28 * crouch : 0);
    turn(f.bone('Torso'), new THREE.Quaternion().setFromAxisAngle(right, pitch * 0.35 + pull * 0.5 + kick * 0.05));
    turn(f.bone('Chest'), new THREE.Quaternion().setFromAxisAngle(right, pitch * 0.35 + kick * 0.06));
    turn(f.bone('Neck'), new THREE.Quaternion().setFromAxisAngle(right, pitch * 0.3));
    if (jerk.lengthSq() > 1e-6) {
      const a = jerk.length();
      turn(f.bone('Torso'), new THREE.Quaternion().setFromAxisAngle(jerk.clone().divideScalar(a), a));
    }

    // The weapon, held up to the shoulder (a pistol out at arm's length), the way they look, and
    // the arms reaching for it.
    hold(p.hand);
    const it = item as Item | null;
    if (!it) return;
    it.mesh.visible = fade < 1;
    const shoulder = f.bone('UpperArmR').getWorldPosition(new THREE.Vector3());
    const chest = f.bone('Chest').getWorldPosition(new THREE.Vector3());
    const dir = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
    const fam = isGun(it.id) ? GUNS[it.id].family : it.id === 'knife' ? 'knife' : 'nade';
    reloadT += ((p.reloading ? 1 : 0) - reloadT) * Math.min(1, dt * 6);
    const at = new THREE.Vector3();
    const q = new THREE.Quaternion();
    if (fam === 'knife' || fam === 'nade') {
      // Low and ready in the right hand; a cut swings it forward.
      const sw = Math.sin(Math.PI * Math.min(1, cut * 1.5));
      at.copy(chest).addScaledVector(fwd, 0.32 + 0.2 * sw).addScaledVector(right, 0.2 - 0.15 * sw).addScaledVector(up, -0.22 + 0.12 * sw);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd.clone().addScaledVector(up, -1.2), up);
      q.setFromRotationMatrix(m);
      if (fam === 'knife') q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.5, 0, 0)));
    } else {
      const pistol = fam === 'pistol';
      const out = pistol ? 0.5 : 0.3;
      // The gun's anchor (its trigger), from the shoulder along the look, a little in and down.
      at.copy(shoulder).addScaledVector(dir, out - kick * 0.05).addScaledVector(right, pistol ? -0.15 : -0.05).addScaledVector(up, pistol ? -0.02 : -0.08);
      // Its barrel (-z) along the look, its top up; tilted for a reload.
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, up);
      q.setFromRotationMatrix(m);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(kick * 0.15 - 0.25 * reloadT, 0, 0.5 * reloadT)));
      if (p.scoped) at.addScaledVector(up, 0.06).addScaledVector(right, -0.04);
    }
    it.mesh.position.copy(at).sub(group.getWorldPosition(new THREE.Vector3()));
    // The group's own turn taken out: the item's a child of the group.
    const gq = group.getWorldQuaternion(new THREE.Quaternion());
    it.mesh.position.applyQuaternion(gq.clone().invert());
    it.mesh.quaternion.copy(gq.clone().invert().multiply(q));
    it.mesh.position.sub(it.grip.clone().applyQuaternion(it.mesh.quaternion));
    it.mesh.updateMatrixWorld(true);
    const world = (v: THREE.Vector3) => v.clone().applyMatrix4(it.mesh.matrixWorld);
    // The wrists a hand's breadth back from where the hands close.
    const rw = world(it.grip.clone().add(V(0.01, -0.03, 0.07)));
    reach(f.bone('UpperArmR'), f.bone('LowerArmR'), f.bone('WristR'), rw, shoulder.clone().addScaledVector(up, -0.6).addScaledVector(right, 0.5).addScaledVector(fwd, -0.2));
    aim(f.bone('WristR'), f.bone('Middle1R').getWorldPosition(new THREE.Vector3()), world(it.grip.clone().add(V(-0.02, 0, -0.02))));
    if (it.fore || fam === 'pistol') {
      const lp = it.fore ? it.fore.clone() : it.grip.clone().add(V(-0.03, -0.01, 0));
      // A reload: the left hand down to the magazine and back.
      const r = reloadT * (0.5 + 0.5 * Math.sin(t * 5));
      const target = world(lp.add(V(-0.05, -0.04, 0.05)).lerp(it.grip.clone().add(V(-0.05, -0.12, -0.03)), r));
      const ls = f.bone('UpperArmL').getWorldPosition(new THREE.Vector3());
      reach(f.bone('UpperArmL'), f.bone('LowerArmL'), f.bone('WristL'), target, ls.addScaledVector(up, -0.6).addScaledVector(right, -0.5));
      aim(f.bone('WristL'), f.bone('Middle1L').getWorldPosition(new THREE.Vector3()), world(lp.clone().add(V(0.03, 0, 0))));
    }
  };

  return {
    group,
    update(dt, p) {
      if (!fig) {
        const fm = fighterModel();
        if (fm) {
          team = p.team;
          fig = buildFigure(fm, d, team);
          walker.group.removeFromParent();
          group.add(fig.root);
        }
      }
      if (!fig) {
        walker.arm(p.hand ? lookOf(p.hand) : null);
        walker.update(p.speed, dt, p.pitch + kick * 0.1);
        kick = Math.max(0, kick - dt * 8);
        walker.group.scale.y = 1 - 0.26 * p.crouch;
        return;
      }
      if (p.team !== team) {
        team = p.team;
        repaint(fighterModel()!, fig.mesh, painter(d, team));
      }
      pose(dt, p);
    },
    fired(w) {
      if (w === 'knife') cut = 1;
      else kick = 1;
    },
    fall(dn, fd) {
      down = dn;
      if (!fig) {
        walker.fall(dn, fd);
        return;
      }
      if (fd !== fade) {
        fade = fd;
        const m = fig.mesh.material as THREE.MeshStandardMaterial;
        const want = fd > 0;
        if (want !== own.faded) {
          own.faded = want;
          m.transparent = want;
          m.depthWrite = !want;
          m.needsUpdate = true;
        }
        m.opacity = 1 - fd;
      }
      group.visible = fd < 1;
      // Standing again (back for the next life): the death clip let go.
      if (dn <= 0 && fig) fig.death.time = 0;
    },
    hit(dir, k) {
      // The body turned away from the shot: about the axis across the way it came.
      const a = Math.min(0.5, 0.15 + 0.3 * Math.min(1, k));
      const axis = V(0, 1, 0).cross(V(dir.x, 0, dir.z).normalize());
      jerk.addScaledVector(axis, a).clampLength(0, 0.55);
    },
    muzzle(out) {
      if (!fig) return walker.muzzle(out);
      if (!item) return group.getWorldPosition(out).add(V(0, 1.4, 0));
      group.updateMatrixWorld(true);
      return out.copy(item.muzzle).applyMatrix4(item.mesh.matrixWorld);
    },
  };
}
