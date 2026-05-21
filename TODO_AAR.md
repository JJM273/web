# After Action summary and report framework for OCAP
expand the data summarizationa and exploration of OCAP web app to facilitate better after action reviews. Prime motivation is for Antistasi Ultimate missions, but functionality should be useful for any mission

### TODO for initial release
    - [ ] BUG lost vehicle counts don't match Destroyed by other sides
    - [ ] classify AI groups by vehicle, aircraft, infantry based on weapon used
    - [ ] BUG summary on recording select page is missing in dev
    - [ ] add per side AAR summary to recording select page summary

### Roadmap for future features
    - [ ] feature to select timefame + geofence to specify multiple separate actions in a single mission
    - [ ] feature for generating "what happened" part of AAR, should work at group and command level, group level=movement of individuals, command level=movement of groups
        e.x. Command level: Alpha 1-2 (8infantry) moved NE, @t+2min engaged 10 enemy infantry at grid 123456, 2KIA, 10EKIA, hold at that position. @t+10min engaged by enemy APC, Tank, 8 infantry, 5KIA, APC destroyed, 7EKIA.
    - [ ] toggle between map symbol for group vs individuals
    - [ ] count vehicle captures, and split Lost to Lost (cap), Lost (destroyed)

### Completed
    - [x] BUG unit names do not match between map and lists (exists pre-fork)
    - [x] BUG death summary is counting despawns
    - [x] go back and look at original code, how does it do force summary, can that be reused for group summary instead of the new function (before fixing the bug)
    - [x] include kill counts for AI groups
    - [x] summary of vehicle kills by side/vehicle class