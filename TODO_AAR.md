# After Action summary and report framework for OCAP
expand the data summarizationa and exploration of OCAP web app to facilitate better after action reviews. Prime motivation is for Antistasi Ultimate missions, but functionality should be useful for any mission

### TODO for initial release

### Roadmap for future features
    - [ ] add per side AAR summary to recording select page summary (requires backend work)
    - [ ] classify AI groups by vehicle, aircraft, infantry based on weapon used
    - [ ] feature to select timefame + geofence to specify multiple separate actions in a single mission
    - [ ] feature for generating "what happened" part of AAR, should work at group and command level, group level=movement of individuals, command level=movement of groups
        e.x. Command level: Alpha 1-2 (8infantry) moved NE, @t+2min engaged 10 enemy infantry at grid 123456, 2KIA, 10EKIA, hold at that position. @t+10min engaged by enemy APC, Tank, 8 infantry, 5KIA, APC destroyed, 7EKIA.
    - [ ] toggle between map symbol for group vs individuals
    - [ ] DEFERRED: proximity-based side inference for vehicles that spawn empty (no crew in first N frames) — assign initial ownership to the nearest unit (within ~100m) in the first 60s of the vehicle's life; requires positions-format data and a spatial search per vehicle at startup
    - [ ] DEFERRED: full streaming/chunk-format support for ownership scanning — processVehicleOwnership currently only processes vehicles with a positions array (JSON recording format); streaming format uses mutable vehicle.crew updated at render time and would need a separate per-frame crew scan or a crew-change event stream

### Completed
    - [x] BUG summary on recording select page is missing in dev
    - [x] KNOWN BUG vehicles spawned from the garage and possible by game logic are counting as captures because they start as empty with no side (even if for 1 frame), the proximity based side inference would fix this but we may want a work around for now, possibly time base inference, if side changes from empty in first 30s of existence, don't count as a capture, just set initial side.
    - [x] BUG new vehicle logic for captures does not seem to be working properly. not counting captures of civ vehicles, captures of enemy vehicles revert back.
    - [x] count vehicle captures, and split Lost to Lost (cap), Lost (destroyed)
    - [x] BUG lost vehicle counts don't match Destroyed by other sides
    - [x] BUG unit names do not match between map and lists (exists pre-fork)
    - [x] BUG death summary is counting despawns
    - [x] go back and look at original code, how does it do force summary, can that be reused for group summary instead of the new function (before fixing the bug)
    - [x] include kill counts for AI groups
    - [x] summary of vehicle kills by side/vehicle class