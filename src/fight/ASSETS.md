# Fight mode assets

Third-party CC0 (public domain) models and sounds for the deathmatch mode. Every file below was checked against its own source page, which states CC0. No attribution is required, but the authors are credited here. Nothing CC-BY or of unknown licence is shipped.

## Models (`models/`)

### Conventions for the weapon files

- Units are metres, at real size. The model is upright (+Y up) and the **barrel points along −Z**, the way a three.js camera looks. The bore axis is near y = 0 (except deagle, famas and aug, see below) and on x = 0.
- Every gun has two empty marker nodes at the scene root, in model space: `muzzle` and `trigger`. `muzzle` is the tip of whatever is on the bore axis (flash hider, brake or suppressor), so use it for muzzle flash and tracers. `trigger` is the trigger, with the firing hand's grip just behind and below it. Use `getObjectByName('muzzle')`. The marker coordinates are in the tables below.
- The Pichuliru guns (every gun except deagle, famas and aug) are **one SkinnedMesh with a bone rig**. The bones include `Body`, `Magazine`, `Bolt`, `Charging Handle`, `Trigger`, `Slide` (pistols), `Stock` and others, depending on the gun. Move a bone to animate a reload or a slide, e.g. `getObjectByName('Magazine').position.y -= …`. The bone frames are Blender's: a bone's local +Y is the model's −Z. The `Attach_*` bones are the author's mount points.
- Attachments (suppressor, scopes, bipod) are plain meshes, parented to the matching `Attach_*` bone, so they follow the gun.
- Materials are flat colours (`M_PCL_Flat_*`, metal 0, rough 1), with no textures. Clone a material to tint it.
- The meshes are stored with KHR_mesh_quantization (16-bit positions, 8-bit normals and weights). Three.js's GLTFLoader reads this natively, with no decoder. Draco and meshopt are not used.
- What was done to every gun: the unused UV sets were dropped, then dedup, weld, prune and quantize (gltf-transform). Attachments were merged in where listed. The `muzzle` and `trigger` markers were added.

### Sources

| Key | Source page | Author | Licence on page |
|---|---|---|---|
| PW | https://opengameart.org/content/cc0-flat-guns-west | Pichuliru | CC0 (the OGA "License(s)" field and the description both say CC0. The itch.io mirror's licence dropdown says CC-BY 4.0, but its own description says "Licensed under CC0"; the OGA page and Poly Pizza (poly.pizza/m/ss1nz3gJnx etc., "CC0 1.0") agree on CC0) |
| PE | https://opengameart.org/content/cc0-flat-guns-east | Pichuliru | CC0 |
| PA | https://opengameart.org/content/cc0-flat-gun-attachments | Pichuliru | CC0 |
| PG | https://opengameart.org/content/cc0-flat-grenades | Pichuliru | CC0 |
| PM | https://opengameart.org/content/cc0-flat-shaded-melee-weapons | Pichuliru | CC0 |
| RD | https://poly.pizza/m/VfYq08LCGm ("Rigged Deagle Gun") | Rafael | CC0 1.0 |
| QB | https://poly.pizza/m/iKAlIbHUFD ("Bullpup", from the Ultimate Gun Pack, https://quaternius.com/packs/ultimategun.html, "License CC0") | Quaternius | CC0 1.0 |
| QP | https://poly.pizza/m/Ugy8tjR3Ju ("Bipod") | Quaternius | CC0 1.0 |
| QS | https://poly.pizza/m/Btfn3G5Xv4 ("SWAT", from the Ultimate Animated Character Pack, https://quaternius.com/packs/ultimatedanimatedcharacter.html, "License CC0") | Quaternius | CC0 1.0 |

### Weapons

Bbox is the size x × y × z in metres, as shipped. Muzzle and trigger are the marker positions (x, y, z).

| File | What it is | Source (file) | Stand-in? | Bbox m | Muzzle | Trigger | Tris | Size |
|---|---|---|---|---|---|---|---|---|
| glock.glb | Glock-18 | PE Pistol_Full_East | polymer service pistol (MP-443-like) | 0.029 × 0.148 × 0.207 | 0, 0.024, −0.127 | 0, 0.004, −0.017 | 1216 | 59 KB |
| usp.glb | USP-S | PW Pistol_Full_West + PA Suppressor_West on Attach_Muzzle | hammer pistol (M9-like) + suppressor | 0.036 × 0.155 × 0.351 | 0, 0.026, −0.270 | 0, −0.005, −0.008 | 1626 | 77 KB |
| p250.glb | P250 | PW Pistol_Compact_West | P320/P250-like compact | 0.027 × 0.135 × 0.192 | 0, 0.025, −0.117 | 0, 0.001, −0.011 | 1244 | 62 KB |
| deagle.glb | Desert Eagle | RD | real Deagle. Rescaled ×0.0846 (on the `Armature` node) from 3.19 to 0.27 m long. Not skinned: the parts are meshes under bones `Bone_Base`, `Bone_Top` (slide) and `Bone_Trigger`. **Origin at the grip bottom**, bore at y ≈ 0.12 | 0.039 × 0.147 × 0.270 | 0, 0.119, −0.221 | 0, 0.089, −0.055 | 1374 | 37 KB |
| mac10.glb | MAC-10 | PW SMG_Compact_West | MAC/MPX-like box SMG, mag in grip | 0.042 × 0.212 × 0.443 | 0, 0.013, −0.181 | 0, −0.007, −0.025 | 2201 | 102 KB |
| mp9.glb | MP9 | PE SMG_Compact_East | compact SMG, mag in grip, folding stock | 0.051 × 0.248 × 0.516 | 0, 0.022, −0.191 | 0, −0.001, −0.037 | 1685 | 80 KB |
| ump.glb | UMP-45 | PW SMG_Full_West | MP5/MPX-like full SMG | 0.046 × 0.250 × 0.561 | 0, 0.018, −0.222 | 0, −0.020, 0.045 | 2030 | 94 KB |
| p90.glb | P90 | PE SMG_Full_East | **stand-in**: Vityaz-like conventional SMG (no CC0 P90 found) | 0.059 × 0.266 × 0.543 | 0, 0.014, −0.223 | 0, −0.011, 0.063 | 2146 | 101 KB |
| galil.glb | Galil AR | PE Rifle_Battle_East | AK-derived rifle with folding stock | 0.079 × 0.263 × 0.755 | 0, 0.018, −0.359 | 0, −0.020, 0.106 | 3143 | 145 KB |
| famas.glb | FAMAS | QB Bullpup | **stand-in**: generic bullpup. Rotated +90° about Y and rescaled (on the `Bullpup_1` node) to 0.757 m. Not skinned, 3 materials. **Bore at y ≈ 0.117**. The trigger is estimated from the grip | 0.045 × 0.222 × 0.757 | 0, 0.117, −0.392 | 0, 0.009, −0.033 | 2778 | 78 KB |
| ak47.glb | AK-47 | PE Rifle_Assault_East | AK-platform rifle (AK-12-ish) | 0.068 × 0.268 × 0.723 | 0, 0.005, −0.341 | 0, −0.009, 0.077 | 3271 | 149 KB |
| m4a4.glb | M4A4 | PW Rifle_Assault_West | M4/HK416-like | 0.053 × 0.253 × 0.697 | 0, 0.016, −0.339 | 0, −0.028, 0.064 | 4353 | 193 KB |
| m4a1s.glb | M4A1-S | PW Rifle_Assault_West + PA Suppressor_West | as m4a4, plus suppressor | 0.053 × 0.253 × 0.802 | 0, 0.016, −0.443 | 0, −0.028, 0.064 | 4545 | 202 KB |
| sg553.glb | SG 553 | PW Rifle_Battle_West + PA Magnified_West on Attach_Scope | **stand-in**: SCAR-like rifle + compact magnified optic | 0.058 × 0.277 × 0.844 | 0, 0.012, −0.453 | 0, −0.041, 0.076 | 3655 | 164 KB |
| aug.glb | AUG | QB Bullpup (same source as famas, scaled to 0.73 m) + PA Magnified_East on top (at z −0.10) | **stand-in**: generic bullpup + magnified optic. Bore at y ≈ 0.113 | 0.045 × 0.276 × 0.730 | 0, 0.113, −0.378 | 0, 0.011, −0.032 | 3280 | 100 KB |
| ssg08.glb | SSG 08 | PE Sniper_Rifle_East + PA Scope_East on Attach_Scope | light bolt sniper + scope | 0.070 × 0.258 × 0.864 | 0, 0.017, −0.425 | 0, −0.013, 0.117 | 3883 | 173 KB |
| awp.glb | AWP | PW Sniper_Rifle_West + PA Scope_West | heavier chassis sniper + long scope | 0.079 × 0.263 × 0.961 | 0, 0.015, −0.545 | 0, −0.036, 0.120 | 4118 | 178 KB |
| nova.glb | Nova | PE Shotgun_Pump_East | black tactical pump shotgun | 0.039 × 0.174 × 0.883 | 0, 0.004, −0.459 | 0, 0.001, 0.125 | 1508 | 73 KB |
| xm1014.glb | XM1014 | PE Shotgun_Auto_East | **stand-in**: Saiga-12-style semi-auto shotgun (box magazine, not a tube) | 0.069 × 0.290 × 0.714 | 0, 0.031, −0.323 | 0, −0.005, 0.091 | 1930 | 91 KB |
| negev.glb | Negev | PW Sniper_Material_West + QP Bipod (scaled to 0.20 m legs, turned 90°) on Attach_Rail.Bottom | **stand-in**: no CC0 LMG found. A heavy .50-style rifle with a deployed bipod | 0.183 × 0.313 × 1.167 | 0, 0.018, −0.634 | 0, −0.042, 0.216 | 4152 | 174 KB |
| knife.glb | Combat knife | PM KABAR | KA-BAR. **Blade points +Y**, flat of the blade in the YZ plane, origin at about the guard (handle −0.13…0, blade 0…+0.22). 8 × 8 px palette texture. Not skinned | 0.041 × 0.353 × 0.075 | | | 536 | 22 KB |
| he.glb | HE frag | PG Frag_West | upright +Y, origin near the centre | 0.067 × 0.099 × 0.078 | | | 536 | 18 KB |
| flash.glb | Flashbang | PG Flashbang_West | upright +Y | 0.051 × 0.149 × 0.065 | | | 600 | 20 KB |
| smoke.glb | Smoke grenade | PG Smoke_West | upright +Y | 0.051 × 0.160 × 0.065 | | | 520 | 18 KB |
| molotov.glb | Molotov | PG Incendiary_East | bottle with rag, upright +Y | 0.060 × 0.247 × 0.066 | | | 368 | 14 KB |
| incendiary.glb | Incendiary grenade (CT molotov, extra) | PG Incendiary_West | upright +Y | 0.051 × 0.147 × 0.065 | | | 504 | 17 KB |

Shared sources: m4a4 and m4a1s share PW Rifle_Assault_West, and m4a1s adds a suppressor. famas and aug share QB Bullpup, and aug adds an optic and is scaled 4 % shorter. Each of these ids still has its own file.

### Fighter (third-person character)

| File | What it is | Source | Done | Bbox m | Tris | Size |
|---|---|---|---|---|---|---|
| fighter.glb | Rigged, animated SWAT officer, realistic-ish proportions, 1.85 m | QS | Dropped 7 clips (Interact, Kick_L/R, Punch_Left, Sword_Slash, Idle_Sword, Wave). Stripped the `CharacterArmature\|` prefix from the clip names. Resample, dedup, prune, weld, quantize. The 4 skins were merged into 1 | 1.675 × 1.854 × 0.362 (A-pose, arms out) | 7752 | 754 KB |

- The character faces +Z, with +Y up and its feet at y = 0. Its right hand is on −X.
- There are 62 joints. The hand bones are `Wrist.R` and `Wrist.L` (rest positions about (−0.23, 1.04, 0.15) and (0.26, 1.02, 0.04)). Fingers are `Index1-4.R`, `Thumb1-3.R` and so on. Other bones: `Root`, `Body`, `Hips`, `Abdomen`, `Torso`, `Chest`, `Neck`, `Head`, `Shoulder.*`, `UpperArm.*`, `LowerArm.*`, `UpperLeg.*`, `LowerLeg.*`, `Foot.*`.
- The materials are `Swat` (the blue-grey uniform: tint this per player), `Swat_Black` (vest, boots, gloves, helmet), `Skin` and `Visor`. The mesh nodes are `Swat_Legs`, `Swat_Feet`, `Swat_Body` and `Swat_Head`.
- Clips, with durations in seconds: Death 1.04, Gun_Shoot 0.58, HitRecieve 0.54, HitRecieve_2 0.54, Idle 1.67, Idle_Gun 1.67, Idle_Gun_Pointing 1.67, Idle_Gun_Shoot 0.67, Idle_Neutral 1.67, Punch_Right 0.83, Roll 1.33, Run 0.79, Run_Back 0.83, Run_Left 0.79, Run_Right 0.79, Run_Shoot 0.83, Walk 1.33.
- The gun clips are **one-handed, pistol-style**: the right arm points forward. There is no two-handed rifle hold, crouch, jump or reload.

## Sounds (`sounds/`)

All are from Freesound HQ preview MP3s. Each sound's page shows "Creative Commons 0". Each was converted to mono, 44.1 kHz, 96 kbps, trimmed (the seconds given are positions in the source preview), faded, and peak-normalised to about −1 dBFS. The total is 44 files, 425 KB.

| File | What it is | Source page | Author | Licence | Kept / processing | Dur s | Bytes |
|---|---|---|---|---|---|---|---|
| shot-pistol.mp3 | H&K USP45, real, close | https://freesound.org/people/areniporgen/sounds/734062/ | areniporgen | CC0 | 0.020–0.950 s, fade 3/150 ms, +0.2 dB | 0.93 | 11956 |
| shot-pistol-suppressed.mp3 | Suppressed 1911 | https://freesound.org/people/areniporgen/sounds/827945/ | areniporgen | CC0 | 0.010–0.640, 3/120 ms, +0.3 dB | 0.63 | 8195 |
| shot-deagle.mp3 | Desert Eagle .50 AE | https://freesound.org/people/areniporgen/sounds/712310/ | areniporgen | CC0 | 0.000–1.000, 3/250 ms, −1.2 dB | 1.00 | 12897 |
| shot-smg.mp3 | FN P90, last shot of a burst | https://freesound.org/people/areniporgen/sounds/740896/ | areniporgen | CC0 | 2.918–3.250, 3/100 ms, −0.5 dB | 0.33 | 4747 |
| shot-rifle-ak.mp3 | Saiga MK-106 (AK platform, .308) | https://freesound.org/people/areniporgen/sounds/696023/ | areniporgen | CC0 | 0.012–1.200, 3/300 ms, −0.5 dB | 1.19 | 15091 |
| shot-rifle-m4.mp3 | M4A1 (DVIDS public-domain footage) | https://freesound.org/people/qubodup/sounds/854226/ | qubodup | CC0 | 0.000–0.760, 3/150 ms, −0.5 dB | 0.76 | 9762 |
| shot-rifle-suppressed.mp3 | Suppressed MP7 (an SMG: no CC0 suppressed rifle was found) | https://freesound.org/people/areniporgen/sounds/732250/ | areniporgen | CC0 | 0.000–0.550, 3/150 ms, −4.7 dB | 0.55 | 7568 |
| shot-shotgun.mp3 | Remington 870 | https://freesound.org/people/areniporgen/sounds/702672/ | areniporgen | CC0 | 0.012–0.920, 3/150 ms, −0.9 dB | 0.90 | 11643 |
| shot-awp.mp3 | Sauer 404 bolt rifle, close, long tail | https://freesound.org/people/moosegravy/sounds/431832/ | moosegravy | CC0 | 0.430–2.400, 3/450 ms, −3.1 dB | 1.97 | 24495 |
| shot-ssg.mp3 | M40A6 sniper (DVIDS) | https://freesound.org/people/qubodup/sounds/855602/ | qubodup | CC0 | 0.000–1.200, 3/300 ms, +2.6 dB | 1.20 | 15091 |
| shot-lmg.mp3 | IWI Negev 7.62, last shot of a burst (short: the source is gated) | https://freesound.org/people/areniporgen/sounds/725798/ | areniporgen | CC0 | 1.202–1.450, 3/80 ms, −1.5 dB | 0.25 | 3806 |
| shot-distant.mp3 | Distant rifle shot with reverb | https://freesound.org/people/moosegravy/sounds/431824/ | moosegravy | CC0 | 0.165–1.160, 5/200 ms, −1.6 dB | 1.00 | 12897 |
| reload-mag-out.mp3 | Rifle mag release and out | https://freesound.org/people/ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/674742/ | serøutōnin--deprivəd | CC0 | 0.090–0.420, 5/60 ms, +3.9 dB | 0.33 | 4747 |
| reload-mag-in.mp3 | Rifle mag in (same source, another part) | same as above | serøutōnin--deprivəd | CC0 | 0.800–1.240, 5/60 ms, −0.9 dB | 0.44 | 6000 |
| reload-bolt.mp3 | Barrett M82A1 charging handle (DVIDS) | https://freesound.org/people/qubodup/sounds/855599/ | qubodup | CC0 | 0.000–0.860, 5/80 ms, +2.5 dB | 0.86 | 11016 |
| reload-pistol-slide.mp3 | Pistol slide released | https://freesound.org/people/ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/854486/ | serøutōnin--deprivəd | CC0 | 0.180–0.560, 5/60 ms, −2.6 dB | 0.38 | 5374 |
| reload-shell-insert.mp3 | Shotgun shell insert (made in Audacity by the uploader) | https://freesound.org/people/morganpurkis/sounds/379976/ | morganpurkis | CC0 | 0.050–0.260, 3/50 ms, −0.8 dB | 0.21 | 3493 |
| reload-pump.mp3 | Winchester SXP pump rack | https://freesound.org/people/dasBUTCHER84/sounds/449614/ | dasBUTCHER84 | CC0 | 0.000–0.480, 3/40 ms, +1.0 dB | 0.48 | 6627 |
| reload-sniper-bolt.mp3 | Mauser 98k bolt cycle | https://freesound.org/people/Walking.With.Microphones/sounds/802673/ | Walking.With.Microphones | CC0 | 0.050–1.600, 5/80 ms, −3.3 dB | 1.55 | 19480 |
| weapon-draw.mp3 | Pistol drawn from holster | https://freesound.org/people/nioczkus/sounds/377145/ | nioczkus | CC0 | 0.060–0.750, 5/80 ms, −4.1 dB | 0.69 | 9135 |
| dry-fire.mp3 | Ruger 10/22 dry-fire click | https://freesound.org/people/ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/725402/ | serøutōnin--deprivəd | CC0 | 0.000–0.450, 3/80 ms, −4.8 dB | 0.45 | 6314 |
| knife-swing.mp3 | Knife whoosh | https://freesound.org/people/Joao_Janz/sounds/485266/ | Joao_Janz | CC0 | 0.000–0.280, 3/40 ms, +14.6 dB | 0.28 | 4120 |
| knife-hit-flesh.mp3 | Knife into cabbage | https://freesound.org/people/Mixedupmoviestuff/sounds/179222/ | Mixedupmoviestuff | CC0 | 0.150–0.650, 3/120 ms, +3.3 dB | 0.50 | 6941 |
| knife-hit-wall.mp3 | Knife thrust into a wall | https://freesound.org/people/NeoSpica/sounds/504618/ | NeoSpica | CC0 | 0.300–0.850, 10/150 ms, −4.4 dB | 0.54 | 7254 |
| grenade-pin.mp3 | Ring-pull flick | https://freesound.org/people/lolamadeus/sounds/144182/ | lolamadeus | CC0 | 0.000–0.120, 2/30 ms, +15.4 dB | 0.12 | 2239 |
| grenade-throw.mp3 | Staff swing whoosh | https://freesound.org/people/Nightflame/sounds/422510/ | Nightflame | CC0 | 0.040–0.280, 10/40 ms, +4.4 dB | 0.24 | 3806 |
| grenade-bounce.mp3 | Small metal object hits the ground | https://freesound.org/people/nicktermer/sounds/259553/ | nicktermer | CC0 | 0.155–0.380, 2/60 ms, −1.0 dB | 0.23 | 3493 |
| explosion-he.mp3 | M67 frag explosion (US military footage) | https://freesound.org/people/qubodup/sounds/67472/ | qubodup | CC0 | 0.000–2.000, 2/600 ms, +5.9 dB | 2.00 | 24809 |
| flashbang-bang.mp3 | Single sharp firework bang | https://freesound.org/people/Rudmer_Rotteveel/sounds/336005/ | Rudmer_Rotteveel | CC0 | 0.000–1.000, 2/300 ms, −1.0 dB | 1.00 | 12897 |
| smoke-hiss.mp3 | Gas hiss, seamless loop | https://freesound.org/people/Yin_Yang_Jake007/sounds/406089/ | Yin_Yang_Jake007 | CC0 | 0.6–4.4 s; 4.4–4.8 s crossfaded into the start, no fades, +14.5 dB | 3.80 | 46438 |
| molotov-break.mp3 | Glass bottle breaking | https://freesound.org/people/dasebr/sounds/212698/ | dasebr | CC0 | 0.505–1.200, 3/200 ms, −1.5 dB | 0.70 | 9135 |
| fire-loop.mp3 | Bushes burning, seamless loop | https://freesound.org/people/Nox_Sound/sounds/564621/ | Nox_Sound | CC0 | 2.0–5.5 s; 5.5–5.9 s crossfaded into the start, no fades, +8.1 dB | 3.50 | 42676 |
| footstep-concrete-1.mp3 | Concrete footstep, take 1 | https://freesound.org/people/Yoyodaman234/sounds/166509/ | Yoyodaman234 | CC0 | 0.000–0.450, 2/100 ms, −0.3 dB | 0.45 | 6314 |
| footstep-concrete-2.mp3 | take 2 | https://freesound.org/people/Yoyodaman234/sounds/166508/ | Yoyodaman234 | CC0 | 0.000–0.450, 2/100 ms, +0.8 dB | 0.45 | 6314 |
| footstep-concrete-3.mp3 | take 3 | https://freesound.org/people/Yoyodaman234/sounds/166507/ | Yoyodaman234 | CC0 | 0.000–0.450, 2/100 ms, −0.3 dB | 0.45 | 6314 |
| footstep-concrete-4.mp3 | take 4 | https://freesound.org/people/Yoyodaman234/sounds/166506/ | Yoyodaman234 | CC0 | 0.000–0.420, 2/100 ms, +0.8 dB | 0.42 | 6000 |
| jump-land.mp3 | Landing after a jump | https://freesound.org/people/nhill2003/sounds/572459/ | nhill2003 | CC0 | 0.065–0.420, 5/80 ms, −1.0 dB | 0.36 | 5060 |
| impact-concrete.mp3 | Hatchet striking rock | https://freesound.org/people/CamoMano/sounds/431019/ | CamoMano | CC0 | 0.030–0.300, 2/80 ms, −3.2 dB | 0.27 | 4120 |
| impact-metal.mp3 | Metallic hit | https://freesound.org/people/Anthousai/sounds/406562/ | Anthousai | CC0 | 0.000–0.450, 0.5/120 ms, −0.1 dB | 0.45 | 6314 |
| impact-wood.mp3 | Rock thrown at wood ("bullets hitting wood") | https://freesound.org/people/worthahep88/sounds/319228/ | worthahep88 | CC0 | 0.085–0.270, 2/50 ms, +4.8 dB | 0.18 | 2866 |
| impact-flesh.mp3 | Bullet hitting flesh | https://freesound.org/people/JustInvoke/sounds/138481/ | JustInvoke | CC0 | 0.000–0.220, 2/50 ms, −0.8 dB | 0.22 | 3493 |
| headshot-dink.mp3 | Light ping off metal | https://freesound.org/people/wilhellboy/sounds/351369/ | wilhellboy | CC0 | 0.080–0.280, 2/60 ms, +2.7 dB | 0.20 | 3179 |
| body-fall.mp3 | Body fall foley | https://freesound.org/people/deleted_user_2104797/sounds/325269/ | deleted_user_2104797 | CC0 | 0.550–1.200, 5/200 ms, +3.2 dB | 0.65 | 8508 |
| ui-buy.mp3 | Button click | https://freesound.org/people/Kolombooo/sounds/629020/ | Kolombooo | CC0 | 0.050–0.200, 1/40 ms, ±0 dB | 0.15 | 2552 |

Notes:

- The loops (`smoke-hiss`, `fire-loop`) are seamless in their content. MP3 encoding pads each end with a few ms, so set `loopStart` ≈ 0.025 s and `loopEnd` just short of the full length if a gap is heard.
- Several of areniporgen's shots were recorded on a phone, and some are clipped or compressed.
- Rejected for licence: qubodup's "Gun Click 1–8" (e.g. 844166) are labelled CC0, but they are cut from CC-BY 4.0 recordings.

## Props (`models/prop-*.glb`)

All props were checked as loading and on contact sheets. Each is a single joined mesh, centred in x and z, sitting on y = 0, with +Y up. All except the fence panel are untextured with no UVs: they use flat-colour materials, so tint them by setting the material colour (colour atlases were converted to a few flat materials). Metalness is 0 and roughness ≥ 0.7. No Draco or meshopt compression is used. Cars face +Z. "Scale" is the factor needed to reach real size. The total is 18 files, 1.14 MB.

| File | What | Source page | Author | Licence on page | Done | KB | Tris | Bbox as authored x×y×z m | Scale | Facing / long axis | Materials |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prop-car-sedan.glb | sedan | https://poly.pizza/m/Cz6yDaUcM9 | Quaternius | CC0 1.0 | wheels merged, materials renamed | 155 | 2954 | 1.81×1.18×4.22 | 1.0–1.07 | front +Z | paint, glass, tyre, trim, headlight, taillight |
| prop-car-hatchback.glb | hatchback | https://poly.pizza/m/unqqkULtRU | Quaternius | CC0 1.0 | as sedan | 164 | 3124 | 1.64×1.15×3.31 | ~1.2 | front +Z | paint, glass, tyre, trim, rim, headlight, taillight |
| prop-car-suv.glb | SUV with roof rails | https://poly.pizza/m/xsMtZhBkxL | Quaternius | CC0 1.0 | as sedan | 172 | 3294 | 2.11×1.53×4.21 | 1.0 | front +Z | paint, glass, tyre, trim, headlight, taillight |
| prop-car-estate.glb | estate, blocky style | https://poly.pizza/m/vTTTjDoxhV | Kay Lousberg | CC0 1.0 | 1024 px atlas converted to 12 colour materials, UVs dropped | 55 | 1234 | 0.42×0.37×0.94 | **×5** | front +Z | paint + paint_light (tint both), glass, tyre, trim, trim_light, dark, chrome, headlight, taillight, taillight_dark, indicator |
| prop-car-van.glb | panel van (toy proportions) | https://kenney.nl/assets/car-kit (van.glb) | Kenney | CC0 | colormap converted to 9 colour materials | 67 | 2082 | 1.50×1.35×2.75 | ×1.75 (or 1.35, 1.7, 1.8) | front +Z | paint, glass, tyre, rim, trim, trim_light, chrome, headlight, taillight |
| prop-skip.glb | builder's skip | https://opengameart.org/content/3d-house-construction-site-lowpoly-cc0 (Containers.fbx, "Container Green") | majadroid | CC0 | FBX→glTF, one part extracted, palette converted to one colour | 4 | 56 | 1.65×1.78×4.00 | 1.0 (y ×0.7 for a lower skip) | long Z, sloped end −Z | paint |
| prop-dumpster.glb | dumpster with lid | https://poly.pizza/m/PKsbolkZSr | Quaternius | CC0 1.0 | transforms applied | 18 | 302 | 2.44×2.03×1.30 | ~0.75 | long X | body, lid, trim |
| prop-pallet.glb | EUR pallet | https://poly.pizza/m/MwOFAOgOhg | Quaternius | CC0 1.0 | atlas converted to a colour | 14 | 240 | 0.89×0.14×1.22 | 1.0 | long Z | wood |
| prop-pallet-bricks.glb | pallet of bricks | MwOFAOgOhg + https://poly.pizza/m/c4sn88pFjP | Quaternius | CC0 1.0 | bricks scaled onto the pallet, merged | 63 | 1696 | 0.89×0.90×1.22 | 1.0 | long Z | brick, brick_dark, wood |
| prop-sandbags.glb | sandbag wall | https://poly.pizza/m/LW3jwpPfiN | Quaternius | CC0 1.0 | simplified from 7168 to 2866 tris | 52 | 2866 | 3.16×1.19×0.78 | 1.0 | long X | sack |
| prop-portaloo.glb | portable toilet | https://opengameart.org/content/porta-potty-low-poly-style | tiko479 | CC0 | FBX→glTF, door merged, recentred | 104 | 2234 | 1.41×3.19×1.55 | ~0.72 | door +Z | shell, roof, metal, dark, sign |
| prop-jersey-barrier.glb | concrete jersey barrier | https://opengameart.org/content/3d-concrete-barrier | mrmajestatisch | CC0 | FBX→glTF, 2K textures dropped, flat grey | 6 | 284 | 0.75×1.25×2.50 | ~0.75 (or 0.8, 0.7, 1.2) | long Z | concrete |
| prop-plastic-barrier.glb | yellow water-filled barrier (extra) | https://poly.pizza/m/QAiXMsbWRc | Quaternius | CC0 1.0 | atlas converted to colours | 31 | 852 | 1.04×0.60×0.33 | ~1.7 | long X | plastic, plastic_dark |
| prop-fence-panel.glb | chain-link site fence panel | https://poly.pizza/m/qWKhREFj7H | Quaternius | CC0 1.0 | texture resized to 256 px; mesh material alphaTest MASK, double-sided; keeps UVs | 16 | 218 | 3.55×2.88×0.12 | ~0.75 | panel in the XY plane | frame, mesh (textured) |
| prop-scaffold.glb | 2-lift scaffold bay with decks | https://opengameart.org/content/construction-site-kit (Scaffold_4 + Wood_Platform) | silverknot | CC0 | FBX→glTF, 3 deck pieces added, flat colours, merged | 143 | 5440 | 4.00×3.09×3.00 | 1.0 | half deck on −Z; very thin poles | steel, wood |
| prop-drum.glb | blue oil drum, rusty | https://poly.pizza/m/MraIiFnpAY | Quaternius | CC0 1.0 | atlas converted to colours | 29 | 882 | 0.70×1.15×0.70 | ~0.8 | upright | paint, rust |
| prop-crate.glb | wooden crate | https://poly.pizza/m/NlXe0ZJGUd | Quaternius | CC0 1.0 | transforms applied | 12 | 264 | 0.79×0.79×0.79 | 1.0 | n/a | wood, wood_dark |
| prop-container.glb | 20 ft shipping container | https://poly.pizza/m/vzzCNUB6Zn | Quaternius | CC0 1.0 | atlas converted to colours | 41 | 1032 | 5.71×2.60×2.56 | 1.0 (1.06 for length) | long X, doors +X | paint, paint_dark, frame |

The car styles are mixed. The sedan, hatchback and SUV are realistic Quaternius models. The estate (KayKit) and van (Kenney) are chunkier and toy-like. Rejected for licence: Quaternius "Car" (poly.pizza/m/HQ0hvRM2XR) is CC-BY 3.0, and so are the "Poly by Google" cars and vans.

## Not found under CC0

- **P90, FAMAS, AUG, SG 553, XM1014 (tube-fed), Negev / any LMG:** there are no CC0 models of these. The stand-ins are listed above. CC-BY versions exist (e.g. Poly Pizza "AWP Sniper", "M4", "AKM" by various authors) and were not used.
- **First-person arms:** none was usable. The only CC0 rigged arms are "FPS arms rigged only" by para (https://opengameart.org/content/fps-arms-rigged-only). They are bare-skinned, about 8k tris, and the hands sit on IK control bones that are not parented to the forearms, so they need IK to pose. Robin Lamb's "Low poly FPS rifle and hands" (CC0) is too crude. Not shipped: make the hands procedurally.
- **Fighter animations:** there are no two-handed rifle, crouch, jump or reload clips in a CC0, realistic-proportioned rig with gun animations. Quaternius's Toon Shooter characters have rifle, crouch and jump clips but are chibi.
- **Cable reel:** none on Poly Pizza, OpenGameArt or the Kenney kits (two discs and a cylinder in code would do).
- **Sounds:** there is no CC0 suppressed-rifle recording (a suppressed SMG was used) and no real recorded shotgun shell insert (a made one was used).
