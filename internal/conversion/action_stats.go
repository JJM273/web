package conversion

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/OCAP2/web/internal/server"
	"github.com/OCAP2/web/internal/storage"
	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
	"google.golang.org/protobuf/proto"
)

// ActionParticipationThresholdMs is the minimum time (in ms) a unit must be
// inside the polygon during the action window to count as a participant.
const ActionParticipationThresholdMs = 5000 // 5 seconds

// ComputeActionStats calculates per-group statistics for the given action by
// scanning the relevant chunk files for entity positions and correlating with
// the manifest event list.
func ComputeActionStats(ctx context.Context, engine storage.Engine, dataDir string, filename string, action server.Action) ([]server.ActionStats, error) {
	manifest, err := engine.GetManifest(ctx, filename)
	if err != nil {
		return nil, fmt.Errorf("get manifest: %w", err)
	}

	// Determine chunk size (default 300 if not set)
	chunkSize := manifest.ChunkSize
	if chunkSize == 0 {
		chunkSize = storage.DefaultChunkSize
	}

	inFrame := uint32(action.InFrame)
	outFrame := uint32(action.OutFrame)

	firstChunk := inFrame / chunkSize
	lastChunk := outFrame / chunkSize

	// Build index: entityID -> EntityDef
	entityByID := make(map[uint32]storage.EntityDef, len(manifest.Entities))
	for _, ent := range manifest.Entities {
		entityByID[ent.ID] = ent
	}

	// Count frames-in-polygon per entity across all relevant chunks
	frameInPolygonCount := make(map[uint32]int) // entityID -> count
	firstFrameInPolygon := make(map[uint32]int) // entityID -> first frame inside polygon
	lastFrameInPolygon := make(map[uint32]int)  // entityID -> last frame inside polygon
	// Track vehicle associations per entity per frame for movement type
	entityInVehicleFrames := make(map[uint32][]uint32) // entityID -> []vehicleID (one per frame, when in vehicle)

	for chunkIdx := firstChunk; chunkIdx <= lastChunk; chunkIdx++ {
		chunk, err := loadChunk(dataDir, filename, chunkIdx)
		if err != nil {
			// Missing chunks are not fatal; skip gracefully
			continue
		}

		for _, frame := range chunk.Frames {
			fn := frame.FrameNum
			if fn < inFrame || fn > outFrame {
				continue
			}

			for _, state := range frame.Entities {
				eid := state.EntityId
				px := float64(state.PosX)
				py := float64(state.PosY)

				if pointInPolygon(px, py, action.Polygon) {
					frameInPolygonCount[eid]++

					fi := int(fn)
					if prev, ok := firstFrameInPolygon[eid]; !ok || fi < prev {
						firstFrameInPolygon[eid] = fi
					}
					if prev, ok := lastFrameInPolygon[eid]; !ok || fi > prev {
						lastFrameInPolygon[eid] = fi
					}
				}

				// Record vehicle associations for movement type determination
				if state.IsInVehicle && state.VehicleId != 0 {
					entityInVehicleFrames[eid] = append(entityInVehicleFrames[eid], state.VehicleId)
				}
			}
		}
	}

	// Build participating entities set
	captureDelayMs := manifest.CaptureDelayMs
	if captureDelayMs == 0 {
		captureDelayMs = 1000 // fallback: 1 second per frame
	}

	participating := make(map[uint32]bool)
	for eid, count := range frameInPolygonCount {
		if uint32(count)*captureDelayMs >= ActionParticipationThresholdMs {
			participating[eid] = true
		}
	}

	if len(participating) == 0 {
		return nil, nil
	}

	// ---------------------------------------------------------------------------
	// Aggregate per group
	// ---------------------------------------------------------------------------

	type groupStats struct {
		side                string
		unitCount           int
		playerCount         int
		kills               int
		deaths              int
		vehiclesDestroyed   map[string]int
		vehiclesLost        map[string]int
		roundsFired         int
		enteredFrame        *int
		exitedFrame         *int
		primaryMovementType *string
	}

	groups := make(map[string]*groupStats)

	getGroup := func(groupName, side string) *groupStats {
		key := groupName + "|" + side
		gs, ok := groups[key]
		if !ok {
			gs = &groupStats{
				side:              side,
				vehiclesDestroyed: make(map[string]int),
				vehiclesLost:      make(map[string]int),
			}
			groups[key] = gs
		}
		return gs
	}

	// Unit counts and frame bounds
	for eid := range participating {
		ent, ok := entityByID[eid]
		if !ok {
			continue
		}
		gs := getGroup(ent.Group, ent.Side)
		gs.unitCount++
		if ent.IsPlayer {
			gs.playerCount++
		}

		// enteredFrame / exitedFrame
		if fi, ok := firstFrameInPolygon[eid]; ok {
			if gs.enteredFrame == nil || fi < *gs.enteredFrame {
				v := fi
				gs.enteredFrame = &v
			}
		}
		if fi, ok := lastFrameInPolygon[eid]; ok {
			if gs.exitedFrame == nil || fi > *gs.exitedFrame {
				v := fi
				gs.exitedFrame = &v
			}
		}
	}

	// Rounds fired (from manifest FiredFrames on each entity)
	for _, ent := range manifest.Entities {
		if !participating[ent.ID] {
			continue
		}
		gs := getGroup(ent.Group, ent.Side)
		for _, ff := range ent.FramesFired {
			if ff.FrameNum >= inFrame && ff.FrameNum <= outFrame {
				gs.roundsFired++
			}
		}
	}

	// Events
	for _, evt := range manifest.Events {
		if evt.FrameNum < inFrame || evt.FrameNum > outFrame {
			continue
		}
		if evt.Type != "killed" {
			continue
		}

		srcParticipating := participating[evt.SourceID]
		tgtParticipating := participating[evt.TargetID]

		if !srcParticipating && !tgtParticipating {
			continue
		}

		// Kills: source is participating
		if srcParticipating {
			srcEnt, ok := entityByID[evt.SourceID]
			if ok {
				gs := getGroup(srcEnt.Group, srcEnt.Side)
				gs.kills++

				// vehiclesDestroyed: if target is a vehicle
				if tgtEnt, ok := entityByID[evt.TargetID]; ok && tgtEnt.Type == "vehicle" && tgtEnt.VehicleClass != "" {
					gs.vehiclesDestroyed[tgtEnt.VehicleClass]++
				}
			}
		}

		// Deaths: target is participating
		if tgtParticipating {
			tgtEnt, ok := entityByID[evt.TargetID]
			if ok {
				gs := getGroup(tgtEnt.Group, tgtEnt.Side)
				gs.deaths++

				// vehiclesLost: target is a vehicle in this group killed by an enemy
				if tgtEnt.Type == "vehicle" && tgtEnt.VehicleClass != "" {
					if srcParticipating {
						srcEnt, ok := entityByID[evt.SourceID]
						if ok && srcEnt.Side != tgtEnt.Side {
							gs.vehiclesLost[tgtEnt.VehicleClass]++
						}
					} else {
						// source is not participating; only count as lost if it is an enemy
						// (different side) — friendly-fire from outside must not count
						srcEnt, ok := entityByID[evt.SourceID]
						if ok && srcEnt.Side != tgtEnt.Side {
							gs.vehiclesLost[tgtEnt.VehicleClass]++
						}
					}
				}
			}
		}
	}

	// Primary movement type per group
	for eid := range participating {
		ent, ok := entityByID[eid]
		if !ok {
			continue
		}
		vehicleIDs := entityInVehicleFrames[eid]
		if len(vehicleIDs) == 0 {
			continue
		}

		// Check the classes of vehicles this entity rode in
		for _, vid := range vehicleIDs {
			vEnt, ok := entityByID[vid]
			if !ok {
				continue
			}
			movType := classifyVehicleClass(vEnt.VehicleClass)
			if movType == "" {
				continue
			}
			gs := getGroup(ent.Group, ent.Side)
			if gs.primaryMovementType == nil || movementPriority(movType) > movementPriority(*gs.primaryMovementType) {
				v := movType
				gs.primaryMovementType = &v
			}
		}
	}

	// For groups with no vehicle movement detected, default to "foot"
	for _, gs := range groups {
		if gs.primaryMovementType == nil {
			foot := "foot"
			gs.primaryMovementType = &foot
		}
	}

	// Build result
	result := make([]server.ActionStats, 0, len(groups))
	for key, gs := range groups {
		// Only emit groups with at least one participating entity
		if gs.unitCount == 0 {
			continue
		}

		// Extract the group name from the composite key (groupName + "|" + side)
		groupName := key
		if idx := strings.LastIndex(key, "|"); idx >= 0 {
			groupName = key[:idx]
		}

		var vd, vl map[string]int
		if len(gs.vehiclesDestroyed) > 0 {
			vd = gs.vehiclesDestroyed
		}
		if len(gs.vehiclesLost) > 0 {
			vl = gs.vehiclesLost
		}

		result = append(result, server.ActionStats{
			ActionID:            action.ID,
			GroupName:           groupName,
			Side:                gs.side,
			UnitCount:           gs.unitCount,
			PlayerCount:         gs.playerCount,
			Kills:               gs.kills,
			Deaths:              gs.deaths,
			VehiclesDestroyed:   vd,
			VehiclesLost:        vl,
			RoundsFired:         gs.roundsFired,
			EnteredFrame:        gs.enteredFrame,
			ExitedFrame:         gs.exitedFrame,
			PrimaryMovementType: gs.primaryMovementType,
		})
	}

	return result, nil
}

// loadChunk reads a chunk protobuf file from disk.
func loadChunk(dataDir, filename string, chunkIdx uint32) (*pbv1.Chunk, error) {
	path := filepath.Join(dataDir, filename, "chunks", fmt.Sprintf("%04d.pb", chunkIdx))
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open chunk %d: %w", chunkIdx, err)
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("read chunk %d: %w", chunkIdx, err)
	}

	var chunk pbv1.Chunk
	if err := proto.Unmarshal(data, &chunk); err != nil {
		return nil, fmt.Errorf("unmarshal chunk %d: %w", chunkIdx, err)
	}

	return &chunk, nil
}

// pointInPolygon uses the ray-casting algorithm to determine if point (px, py)
// is inside the given polygon. The polygon is a slice of [x, y] coordinate pairs.
func pointInPolygon(px, py float64, polygon [][]float64) bool {
	inside := false
	n := len(polygon)
	j := n - 1
	for i := 0; i < n; i++ {
		xi, yi := polygon[i][0], polygon[i][1]
		xj, yj := polygon[j][0], polygon[j][1]
		if ((yi > py) != (yj > py)) && (px < (xj-xi)*(py-yi)/(yj-yi)+xi) {
			inside = !inside
		}
		j = i
	}
	return inside
}

// classifyVehicleClass maps a VehicleClass string to a movement type:
// "air", "wheeled", or "" (unknown/not classified as special).
func classifyVehicleClass(vc string) string {
	lower := strings.ToLower(vc)
	// Air: helicopters and planes
	if strings.Contains(lower, "heli") || strings.Contains(lower, "helicopter") ||
		strings.Contains(lower, "plane") || strings.Contains(lower, "aircraft") ||
		strings.Contains(lower, "air") {
		return "air"
	}
	// Wheeled: cars, trucks, APCs, etc.
	if strings.Contains(lower, "car") || strings.Contains(lower, "truck") ||
		strings.Contains(lower, "apc") || strings.Contains(lower, "wheeled") ||
		strings.Contains(lower, "ifv") || strings.Contains(lower, "mrap") {
		return "wheeled"
	}
	return ""
}

// movementPriority returns an ordering for movement type precedence.
// Higher priority wins when multiple types are observed in a group.
func movementPriority(t string) int {
	switch t {
	case "air":
		return 2
	case "wheeled":
		return 1
	default:
		return 0
	}
}
