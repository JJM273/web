package conversion

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/OCAP2/web/internal/server"
	"github.com/OCAP2/web/internal/storage"
	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// writeManifest serialises a storage.Manifest to {dir}/{filename}/manifest.pb.
func writeManifest(t *testing.T, dir, filename string, m *storage.Manifest) {
	t.Helper()
	outDir := filepath.Join(dir, filename)
	require.NoError(t, os.MkdirAll(outDir, 0755))

	pbm := &pbv1.Manifest{
		EndFrame:       m.EndFrame,
		ChunkSize:      m.ChunkSize,
		CaptureDelayMs: m.CaptureDelayMs,
		ChunkCount:     m.ChunkCount,
	}
	for _, e := range m.Entities {
		def := &pbv1.EntityDef{
			Id:           e.ID,
			Name:         e.Name,
			GroupName:    e.Group,
			IsPlayer:     e.IsPlayer,
			VehicleClass: e.VehicleClass,
		}
		switch e.Type {
		case "unit":
			def.Type = pbv1.EntityType_ENTITY_TYPE_UNIT
		case "vehicle":
			def.Type = pbv1.EntityType_ENTITY_TYPE_VEHICLE
		}
		switch e.Side {
		case "WEST":
			def.Side = pbv1.Side_SIDE_WEST
		case "EAST":
			def.Side = pbv1.Side_SIDE_EAST
		case "GUER":
			def.Side = pbv1.Side_SIDE_GUER
		}
		for _, ff := range e.FramesFired {
			def.FramesFired = append(def.FramesFired, &pbv1.FiredFrame{
				FrameNum: ff.FrameNum,
			})
		}
		pbm.Entities = append(pbm.Entities, def)
	}
	for _, ev := range m.Events {
		pbm.Events = append(pbm.Events, &pbv1.Event{
			FrameNum: ev.FrameNum,
			Type:     ev.Type,
			SourceId: ev.SourceID,
			TargetId: ev.TargetID,
		})
	}

	data, err := proto.Marshal(pbm)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(outDir, "manifest.pb"), data, 0644))
}

// writeChunk serialises a pbv1.Chunk to {dir}/{filename}/chunks/{NNNN}.pb.
func writeChunk(t *testing.T, dir, filename string, chunk *pbv1.Chunk) {
	t.Helper()
	chunksDir := filepath.Join(dir, filename, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	data, err := proto.Marshal(chunk)
	require.NoError(t, err)
	path := filepath.Join(chunksDir, fmt.Sprintf("%04d.pb", chunk.Index))
	require.NoError(t, os.WriteFile(path, data, 0644))
}

// simpleSquarePolygon returns a 10×10 square with corners at (0,0),(10,0),(10,10),(0,10).
func simpleSquarePolygon() [][]float64 {
	return [][]float64{
		{0, 0}, {10, 0}, {10, 10}, {0, 10},
	}
}

// ---------------------------------------------------------------------------
// Unit tests for pointInPolygon
// ---------------------------------------------------------------------------

func TestPointInPolygon_KnownPoints(t *testing.T) {
	square := simpleSquarePolygon()

	tests := []struct {
		name    string
		px, py  float64
		inside  bool
	}{
		{"centre", 5, 5, true},
		{"top-left corner area", 1, 9, true},
		{"bottom-right corner area", 9, 1, true},
		{"outside left", -1, 5, false},
		{"outside right", 11, 5, false},
		{"outside top", 5, 11, false},
		{"outside bottom", 5, -1, false},
		{"far away", 100, 100, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := pointInPolygon(tc.px, tc.py, square)
			assert.Equal(t, tc.inside, got, "(%v,%v) inside=%v", tc.px, tc.py, tc.inside)
		})
	}
}

func TestPointInPolygon_Triangle(t *testing.T) {
	// Triangle with vertices (0,0), (10,0), (5,10)
	tri := [][]float64{{0, 0}, {10, 0}, {5, 10}}
	assert.True(t, pointInPolygon(5, 5, tri), "centroid should be inside")
	assert.False(t, pointInPolygon(0, 10, tri), "far left-top corner outside")
	assert.False(t, pointInPolygon(10, 10, tri), "far right-top corner outside")
}

func TestPointInPolygon_EmptyPolygon(t *testing.T) {
	// Empty polygon should return false for any point
	assert.False(t, pointInPolygon(5, 5, nil))
	assert.False(t, pointInPolygon(5, 5, [][]float64{}))
}

// ---------------------------------------------------------------------------
// Integration-style tests for ComputeActionStats
// ---------------------------------------------------------------------------

// buildTestManifest creates a manifest with two entities (one per group):
//   - Entity 1: unit, WEST, group "Alpha", is player
//   - Entity 2: unit, EAST, group "Bravo"
// captureDelayMs controls how many ms per frame.
func buildTestManifest(captureDelayMs uint32) *storage.Manifest {
	return &storage.Manifest{
		EndFrame:       19,
		ChunkSize:      20,
		CaptureDelayMs: captureDelayMs,
		ChunkCount:     1,
		Entities: []storage.EntityDef{
			{ID: 1, Type: "unit", Name: "Soldier1", Side: "WEST", Group: "Alpha", IsPlayer: true},
			{ID: 2, Type: "unit", Name: "Soldier2", Side: "EAST", Group: "Bravo"},
		},
	}
}

// buildSingleChunk creates a chunk where entity positions alternate inside/outside
// the 10×10 square polygon.
//
// frames 0-9:
//   entity 1 at (5,5)  — inside square
//   entity 2 at (15,15) — outside square
// frames 10-19:
//   entity 1 at (15,15) — outside
//   entity 2 at (5,5)   — inside
func buildChunkAllFrames() *pbv1.Chunk {
	chunk := &pbv1.Chunk{Index: 0, StartFrame: 0, FrameCount: 20}
	for fn := uint32(0); fn < 20; fn++ {
		var states []*pbv1.EntityState
		if fn < 10 {
			states = []*pbv1.EntityState{
				{EntityId: 1, PosX: 5, PosY: 5},
				{EntityId: 2, PosX: 15, PosY: 15},
			}
		} else {
			states = []*pbv1.EntityState{
				{EntityId: 1, PosX: 15, PosY: 15},
				{EntityId: 2, PosX: 5, PosY: 5},
			}
		}
		chunk.Frames = append(chunk.Frames, &pbv1.Frame{
			FrameNum: fn,
			Entities: states,
		})
	}
	return chunk
}

func TestComputeActionStats_BasicParticipation(t *testing.T) {
	dir := t.TempDir()
	const filename = "test_op"

	// 1000 ms per frame → 10 frames × 1000 ms = 10 000 ms > threshold (5 000 ms)
	m := buildTestManifest(1000)
	writeManifest(t, dir, filename, m)
	writeChunk(t, dir, filename, buildChunkAllFrames())

	// Action covers frames 0-9: only entity 1 is inside the polygon
	action := server.Action{
		ID:       "act-1",
		InFrame:  0,
		OutFrame: 9,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)
	require.Len(t, stats, 1, "only Alpha group should have a participant")

	s := stats[0]
	assert.Equal(t, "act-1", s.ActionID)
	assert.Equal(t, "Alpha", s.GroupName)
	assert.Equal(t, "WEST", s.Side)
	assert.Equal(t, 1, s.UnitCount)
	assert.Equal(t, 1, s.PlayerCount)
}

func TestComputeActionStats_ParticipationThreshold(t *testing.T) {
	dir := t.TempDir()
	const filename = "test_threshold"

	// 1000 ms per frame — threshold is 5 000 ms → need 5+ frames
	m := buildTestManifest(1000)
	writeManifest(t, dir, filename, m)

	// Entity 1 inside polygon for exactly 4 frames (below threshold)
	// Entity 2 inside polygon for exactly 6 frames (above threshold)
	chunk := &pbv1.Chunk{Index: 0, StartFrame: 0, FrameCount: 10}
	for fn := uint32(0); fn < 10; fn++ {
		var s1, s2 *pbv1.EntityState
		if fn < 4 { // entity 1: inside first 4 frames
			s1 = &pbv1.EntityState{EntityId: 1, PosX: 5, PosY: 5}
		} else {
			s1 = &pbv1.EntityState{EntityId: 1, PosX: 50, PosY: 50}
		}
		if fn < 6 { // entity 2: inside first 6 frames
			s2 = &pbv1.EntityState{EntityId: 2, PosX: 5, PosY: 5}
		} else {
			s2 = &pbv1.EntityState{EntityId: 2, PosX: 50, PosY: 50}
		}
		chunk.Frames = append(chunk.Frames, &pbv1.Frame{
			FrameNum: fn,
			Entities: []*pbv1.EntityState{s1, s2},
		})
	}
	writeChunk(t, dir, filename, chunk)

	action := server.Action{
		ID:       "act-threshold",
		InFrame:  0,
		OutFrame: 9,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)

	// Entity 1 (Alpha) has 4 frames × 1000 ms = 4 000 ms < 5 000 ms → excluded
	// Entity 2 (Bravo) has 6 frames × 1000 ms = 6 000 ms ≥ 5 000 ms → included
	require.Len(t, stats, 1, "only Bravo should meet the threshold")
	assert.Equal(t, "Bravo", stats[0].GroupName)
}

func TestComputeActionStats_KillAndDeathAttribution(t *testing.T) {
	dir := t.TempDir()
	const filename = "test_kills"

	// Both entities are inside the polygon for all 10 frames at 1000ms/frame (10s > threshold)
	m := &storage.Manifest{
		EndFrame:       9,
		ChunkSize:      10,
		CaptureDelayMs: 1000,
		ChunkCount:     1,
		Entities: []storage.EntityDef{
			{ID: 1, Type: "unit", Name: "AlphaUnit", Side: "WEST", Group: "Alpha", IsPlayer: true},
			{ID: 2, Type: "unit", Name: "BravoUnit", Side: "EAST", Group: "Bravo"},
		},
		Events: []storage.Event{
			// Frame 5: entity 1 kills entity 2
			{FrameNum: 5, Type: "killed", SourceID: 1, TargetID: 2},
		},
	}
	writeManifest(t, dir, filename, m)

	chunk := &pbv1.Chunk{Index: 0, StartFrame: 0, FrameCount: 10}
	for fn := uint32(0); fn < 10; fn++ {
		chunk.Frames = append(chunk.Frames, &pbv1.Frame{
			FrameNum: fn,
			Entities: []*pbv1.EntityState{
				{EntityId: 1, PosX: 5, PosY: 5},
				{EntityId: 2, PosX: 5, PosY: 5},
			},
		})
	}
	writeChunk(t, dir, filename, chunk)

	action := server.Action{
		ID:       "act-kills",
		InFrame:  0,
		OutFrame: 9,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)
	require.Len(t, stats, 2)

	// Organise by group name for deterministic assertions
	byGroup := make(map[string]server.ActionStats)
	for _, s := range stats {
		byGroup[s.GroupName] = s
	}

	alpha := byGroup["Alpha"]
	assert.Equal(t, 1, alpha.Kills, "Alpha killed one unit")
	assert.Equal(t, 0, alpha.Deaths, "Alpha had no deaths")

	bravo := byGroup["Bravo"]
	assert.Equal(t, 0, bravo.Kills, "Bravo made no kills")
	assert.Equal(t, 1, bravo.Deaths, "Bravo lost one unit")
}

func TestComputeActionStats_RoundsFired(t *testing.T) {
	dir := t.TempDir()
	const filename = "test_rounds"

	m := &storage.Manifest{
		EndFrame:       9,
		ChunkSize:      10,
		CaptureDelayMs: 1000,
		ChunkCount:     1,
		Entities: []storage.EntityDef{
			{
				ID: 1, Type: "unit", Name: "Shooter", Side: "WEST", Group: "Alpha",
				FramesFired: []storage.FiredFrame{
					{FrameNum: 1},
					{FrameNum: 3},
					{FrameNum: 5},
					{FrameNum: 15}, // outside action window, should not count
				},
			},
		},
	}
	writeManifest(t, dir, filename, m)

	chunk := &pbv1.Chunk{Index: 0, StartFrame: 0, FrameCount: 10}
	for fn := uint32(0); fn < 10; fn++ {
		chunk.Frames = append(chunk.Frames, &pbv1.Frame{
			FrameNum: fn,
			Entities: []*pbv1.EntityState{{EntityId: 1, PosX: 5, PosY: 5}},
		})
	}
	writeChunk(t, dir, filename, chunk)

	action := server.Action{
		ID:       "act-rounds",
		InFrame:  0,
		OutFrame: 9,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)
	require.Len(t, stats, 1)

	assert.Equal(t, 3, stats[0].RoundsFired, "only 3 of 4 fired frames are within action window")
}

func TestComputeActionStats_NoParticipants(t *testing.T) {
	dir := t.TempDir()
	const filename = "test_no_part"

	// All entities outside polygon for the entire action window
	m := buildTestManifest(1000)
	writeManifest(t, dir, filename, m)

	chunk := &pbv1.Chunk{Index: 0, StartFrame: 0, FrameCount: 10}
	for fn := uint32(0); fn < 10; fn++ {
		chunk.Frames = append(chunk.Frames, &pbv1.Frame{
			FrameNum: fn,
			Entities: []*pbv1.EntityState{
				{EntityId: 1, PosX: 50, PosY: 50},
				{EntityId: 2, PosX: 50, PosY: 50},
			},
		})
	}
	writeChunk(t, dir, filename, chunk)

	action := server.Action{
		ID:       "act-empty",
		InFrame:  0,
		OutFrame: 9,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)
	assert.Nil(t, stats, "no participants → nil result")
}

func TestComputeActionStats_EnteredExitedFrame(t *testing.T) {
	dir := t.TempDir()
	const filename = "test_frames"

	// Entity 1 enters polygon at frame 3, exits at frame 7
	m := &storage.Manifest{
		EndFrame:       9,
		ChunkSize:      10,
		CaptureDelayMs: 1000,
		ChunkCount:     1,
		Entities: []storage.EntityDef{
			{ID: 1, Type: "unit", Name: "Mover", Side: "WEST", Group: "Alpha"},
		},
	}
	writeManifest(t, dir, filename, m)

	chunk := &pbv1.Chunk{Index: 0, StartFrame: 0, FrameCount: 10}
	for fn := uint32(0); fn < 10; fn++ {
		var px float32 = 50 // outside by default
		if fn >= 3 && fn <= 7 {
			px = 5 // inside
		}
		chunk.Frames = append(chunk.Frames, &pbv1.Frame{
			FrameNum: fn,
			Entities: []*pbv1.EntityState{{EntityId: 1, PosX: px, PosY: 5}},
		})
	}
	writeChunk(t, dir, filename, chunk)

	action := server.Action{
		ID:       "act-frames",
		InFrame:  0,
		OutFrame: 9,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)
	require.Len(t, stats, 1)

	s := stats[0]
	require.NotNil(t, s.EnteredFrame)
	require.NotNil(t, s.ExitedFrame)
	assert.Equal(t, 3, *s.EnteredFrame)
	assert.Equal(t, 7, *s.ExitedFrame)
}

func TestComputeActionStats_MultipleChunks(t *testing.T) {
	dir := t.TempDir()
	const filename = "test_multichunk"

	// 3 chunks of 10 frames each (total 30 frames), action spans chunks 0 and 1
	m := &storage.Manifest{
		EndFrame:       29,
		ChunkSize:      10,
		CaptureDelayMs: 1000,
		ChunkCount:     3,
		Entities: []storage.EntityDef{
			{ID: 1, Type: "unit", Name: "CrossChunk", Side: "WEST", Group: "Alpha"},
		},
	}
	writeManifest(t, dir, filename, m)

	for ci := uint32(0); ci < 3; ci++ {
		chunk := &pbv1.Chunk{Index: ci, StartFrame: ci * 10, FrameCount: 10}
		for fn := ci * 10; fn < (ci+1)*10; fn++ {
			var px float32 = 5 // inside polygon for all frames
			chunk.Frames = append(chunk.Frames, &pbv1.Frame{
				FrameNum: fn,
				Entities: []*pbv1.EntityState{{EntityId: 1, PosX: px, PosY: 5}},
			})
		}
		writeChunk(t, dir, filename, chunk)
	}

	// Action covers frames 5–14 (spans chunks 0 and 1)
	action := server.Action{
		ID:       "act-multichunk",
		InFrame:  5,
		OutFrame: 14,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)
	require.Len(t, stats, 1)
	assert.Equal(t, "Alpha", stats[0].GroupName)
	assert.Equal(t, 1, stats[0].UnitCount)
}

func TestComputeActionStats_EventOutsideWindow(t *testing.T) {
	dir := t.TempDir()
	const filename = "test_event_window"

	m := &storage.Manifest{
		EndFrame:       9,
		ChunkSize:      10,
		CaptureDelayMs: 1000,
		ChunkCount:     1,
		Entities: []storage.EntityDef{
			{ID: 1, Type: "unit", Name: "A", Side: "WEST", Group: "Alpha", IsPlayer: true},
			{ID: 2, Type: "unit", Name: "B", Side: "EAST", Group: "Bravo"},
		},
		Events: []storage.Event{
			// This kill event is outside the action window and must not be counted
			{FrameNum: 15, Type: "killed", SourceID: 1, TargetID: 2},
		},
	}
	writeManifest(t, dir, filename, m)

	chunk := &pbv1.Chunk{Index: 0, StartFrame: 0, FrameCount: 10}
	for fn := uint32(0); fn < 10; fn++ {
		chunk.Frames = append(chunk.Frames, &pbv1.Frame{
			FrameNum: fn,
			Entities: []*pbv1.EntityState{
				{EntityId: 1, PosX: 5, PosY: 5},
				{EntityId: 2, PosX: 5, PosY: 5},
			},
		})
	}
	writeChunk(t, dir, filename, chunk)

	action := server.Action{
		ID:       "act-event-window",
		InFrame:  0,
		OutFrame: 9,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)

	byGroup := make(map[string]server.ActionStats)
	for _, s := range stats {
		byGroup[s.GroupName] = s
	}

	assert.Equal(t, 0, byGroup["Alpha"].Kills, "kill event outside window must not count")
	assert.Equal(t, 0, byGroup["Bravo"].Deaths, "death event outside window must not count")
}

func TestComputeActionStats_GroupNameCollision(t *testing.T) {
	// WEST and EAST both have a group named "Alpha". Without the side-keyed map
	// they would be merged into a single entry, corrupting all stats.
	dir := t.TempDir()
	const filename = "test_collision"

	m := &storage.Manifest{
		EndFrame:       9,
		ChunkSize:      10,
		CaptureDelayMs: 1000,
		ChunkCount:     1,
		Entities: []storage.EntityDef{
			// WEST Alpha: 2 units, 1 player
			{ID: 1, Type: "unit", Name: "WestAlpha1", Side: "WEST", Group: "Alpha", IsPlayer: true},
			{ID: 2, Type: "unit", Name: "WestAlpha2", Side: "WEST", Group: "Alpha"},
			// EAST Alpha: 1 unit
			{ID: 3, Type: "unit", Name: "EastAlpha1", Side: "EAST", Group: "Alpha"},
		},
		Events: []storage.Event{
			// Entity 1 (WEST Alpha) kills entity 3 (EAST Alpha)
			{FrameNum: 5, Type: "killed", SourceID: 1, TargetID: 3},
		},
	}
	writeManifest(t, dir, filename, m)

	// All entities inside polygon for all 10 frames (10 000 ms > threshold)
	chunk := &pbv1.Chunk{Index: 0, StartFrame: 0, FrameCount: 10}
	for fn := uint32(0); fn < 10; fn++ {
		chunk.Frames = append(chunk.Frames, &pbv1.Frame{
			FrameNum: fn,
			Entities: []*pbv1.EntityState{
				{EntityId: 1, PosX: 5, PosY: 5},
				{EntityId: 2, PosX: 5, PosY: 5},
				{EntityId: 3, PosX: 5, PosY: 5},
			},
		})
	}
	writeChunk(t, dir, filename, chunk)

	action := server.Action{
		ID:       "act-collision",
		InFrame:  0,
		OutFrame: 9,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)

	// Must produce two separate ActionStats entries — one per side
	require.Len(t, stats, 2, "WEST Alpha and EAST Alpha must be separate entries")

	// Index by side for deterministic assertions
	bySide := make(map[string]server.ActionStats)
	for _, s := range stats {
		assert.Equal(t, "Alpha", s.GroupName, "GroupName should be the plain group name, not the composite key")
		bySide[s.Side] = s
	}

	require.Contains(t, bySide, "WEST", "expected a WEST entry")
	require.Contains(t, bySide, "EAST", "expected an EAST entry")

	west := bySide["WEST"]
	assert.Equal(t, 2, west.UnitCount, "WEST Alpha has 2 units")
	assert.Equal(t, 1, west.PlayerCount, "WEST Alpha has 1 player")
	assert.Equal(t, 1, west.Kills, "WEST Alpha scored 1 kill")
	assert.Equal(t, 0, west.Deaths, "WEST Alpha had no deaths")

	east := bySide["EAST"]
	assert.Equal(t, 1, east.UnitCount, "EAST Alpha has 1 unit")
	assert.Equal(t, 0, east.PlayerCount, "EAST Alpha has no players")
	assert.Equal(t, 0, east.Kills, "EAST Alpha made no kills")
	assert.Equal(t, 1, east.Deaths, "EAST Alpha lost 1 unit")
}

func TestComputeActionStats_MovementType(t *testing.T) {
	// Shared manifest: three units in three groups.
	//   - Entity 1 (Alpha): foot — never in a vehicle
	//   - Entity 2 (Bravo): in a wheeled vehicle (entity 10, VehicleClass "Wheeled_APC")
	//   - Entity 3 (Charlie): in a helicopter (entity 11, VehicleClass "Helicopter")
	//   - Entity 10: wheeled vehicle (VehicleClass "Wheeled_APC")
	//   - Entity 11: helicopter vehicle (VehicleClass "Helicopter")
	dir := t.TempDir()
	const filename = "test_movtype"

	m := &storage.Manifest{
		EndFrame:       9,
		ChunkSize:      10,
		CaptureDelayMs: 1000,
		ChunkCount:     1,
		Entities: []storage.EntityDef{
			{ID: 1, Type: "unit", Name: "FootSoldier", Side: "WEST", Group: "Alpha"},
			{ID: 2, Type: "unit", Name: "WheeledRider", Side: "WEST", Group: "Bravo"},
			{ID: 3, Type: "unit", Name: "AirRider", Side: "WEST", Group: "Charlie"},
			{ID: 10, Type: "vehicle", Name: "APC", Side: "WEST", Group: "Bravo", VehicleClass: "Wheeled_APC"},
			{ID: 11, Type: "vehicle", Name: "Heli", Side: "WEST", Group: "Charlie", VehicleClass: "Helicopter"},
		},
	}
	writeManifest(t, dir, filename, m)

	// All units inside polygon for all 10 frames; entities 2 and 3 are in vehicles.
	chunk := &pbv1.Chunk{Index: 0, StartFrame: 0, FrameCount: 10}
	for fn := uint32(0); fn < 10; fn++ {
		chunk.Frames = append(chunk.Frames, &pbv1.Frame{
			FrameNum: fn,
			Entities: []*pbv1.EntityState{
				{EntityId: 1, PosX: 5, PosY: 5},
				{EntityId: 2, PosX: 5, PosY: 5, IsInVehicle: true, VehicleId: 10},
				{EntityId: 3, PosX: 5, PosY: 5, IsInVehicle: true, VehicleId: 11},
				{EntityId: 10, PosX: 5, PosY: 5},
				{EntityId: 11, PosX: 5, PosY: 5},
			},
		})
	}
	writeChunk(t, dir, filename, chunk)

	action := server.Action{
		ID:       "act-movtype",
		InFrame:  0,
		OutFrame: 9,
		Polygon:  simpleSquarePolygon(),
	}

	engine := storage.NewProtobufEngine(dir)
	stats, err := ComputeActionStats(context.Background(), engine, dir, filename, action)
	require.NoError(t, err)

	byGroup := make(map[string]server.ActionStats)
	for _, s := range stats {
		byGroup[s.GroupName] = s
	}

	// Alpha: no vehicle frames → "foot"
	require.NotNil(t, byGroup["Alpha"].PrimaryMovementType, "Alpha should have a movement type")
	assert.Equal(t, "foot", *byGroup["Alpha"].PrimaryMovementType, "Alpha is foot-mobile")

	// Bravo: wheeled vehicle → "wheeled"
	require.NotNil(t, byGroup["Bravo"].PrimaryMovementType, "Bravo should have a movement type")
	assert.Equal(t, "wheeled", *byGroup["Bravo"].PrimaryMovementType, "Bravo is wheeled")

	// Charlie: helicopter → "air"
	require.NotNil(t, byGroup["Charlie"].PrimaryMovementType, "Charlie should have a movement type")
	assert.Equal(t, "air", *byGroup["Charlie"].PrimaryMovementType, "Charlie is air-mobile")
}
