package server

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestRepoAction creates an in-memory SQLite database with migrations applied
// and returns both a RepoOperation (owns the DB) and a RepoAction sharing the same DB.
func newTestRepoAction(t *testing.T) (*RepoOperation, *RepoAction) {
	t.Helper()
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	repoOp, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, repoOp.db.Close()) })
	return repoOp, NewRepoAction(repoOp.db)
}

// insertTestOperation inserts a minimal operation and returns its ID.
func insertTestOperation(t *testing.T, repoOp *RepoOperation) int64 {
	t.Helper()
	ctx := context.Background()
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Test Mission",
		MissionDuration:  3600,
		Filename:         "test_mission",
		Date:             "2026-01-01",
		Tag:              "coop",
		ConversionStatus: "completed",
	}
	require.NoError(t, repoOp.Store(ctx, op))
	return op.ID
}

// ---------------------------------------------------------------------------
// Helper marshal/unmarshal unit tests
// ---------------------------------------------------------------------------

func TestMarshalPolygon(t *testing.T) {
	t.Run("nil returns empty array", func(t *testing.T) {
		assert.Equal(t, "[]", marshalPolygon(nil))
	})
	t.Run("empty returns empty array", func(t *testing.T) {
		assert.Equal(t, "[]", marshalPolygon([][]float64{}))
	})
	t.Run("valid polygon roundtrips", func(t *testing.T) {
		poly := [][]float64{{1.0, 2.0}, {3.0, 4.0}, {5.0, 6.0}}
		raw := marshalPolygon(poly)
		got := unmarshalPolygon(raw)
		assert.Equal(t, poly, got)
	})
}

func TestUnmarshalPolygon(t *testing.T) {
	t.Run("empty string returns nil", func(t *testing.T) {
		assert.Nil(t, unmarshalPolygon(""))
	})
	t.Run("empty array returns nil", func(t *testing.T) {
		assert.Nil(t, unmarshalPolygon("[]"))
	})
	t.Run("invalid JSON returns nil", func(t *testing.T) {
		assert.Nil(t, unmarshalPolygon("not json"))
	})
	t.Run("valid JSON parses correctly", func(t *testing.T) {
		got := unmarshalPolygon(`[[10.5,20.5],[30.5,40.5]]`)
		require.Len(t, got, 2)
		assert.Equal(t, 10.5, got[0][0])
		assert.Equal(t, 40.5, got[1][1])
	})
}

func TestMarshalVehicleMap(t *testing.T) {
	t.Run("nil returns empty object", func(t *testing.T) {
		assert.Equal(t, "{}", marshalVehicleMap(nil))
	})
	t.Run("valid map roundtrips", func(t *testing.T) {
		m := map[string]int{"T-72": 3, "BTR-80": 1}
		raw := marshalVehicleMap(m)
		got := unmarshalVehicleMap(raw)
		assert.Equal(t, m, got)
	})
}

func TestUnmarshalVehicleMap(t *testing.T) {
	t.Run("empty string returns nil", func(t *testing.T) {
		assert.Nil(t, unmarshalVehicleMap(""))
	})
	t.Run("empty object returns nil", func(t *testing.T) {
		assert.Nil(t, unmarshalVehicleMap("{}"))
	})
	t.Run("invalid JSON returns nil", func(t *testing.T) {
		assert.Nil(t, unmarshalVehicleMap("not json"))
	})
	t.Run("valid JSON parses correctly", func(t *testing.T) {
		got := unmarshalVehicleMap(`{"M1A2":2,"HMMWV":5}`)
		require.NotNil(t, got)
		assert.Equal(t, 2, got["M1A2"])
		assert.Equal(t, 5, got["HMMWV"])
	})
}

// ---------------------------------------------------------------------------
// CreateAction
// ---------------------------------------------------------------------------

func TestCreateAction(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID:          "act-001",
		RecordingID: opID,
		Label:       "Assault Phase",
		Color:       "#ff0000",
		InFrame:     100,
		OutFrame:    500,
		Polygon:     [][]float64{{10.0, 20.0}, {30.0, 40.0}},
		SortOrder:   1,
		Status:      ActionStatusPending,
	}

	created, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)
	assert.Equal(t, "act-001", created.ID)
	assert.Equal(t, opID, created.RecordingID)
	assert.Equal(t, "Assault Phase", created.Label)
	assert.Equal(t, ActionStatusPending, created.Status)
}

func TestCreateAction_DefaultsStatusToPending(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID:          "act-defaults",
		RecordingID: opID,
		Label:       "No Status",
		Color:       "#00ff00",
		InFrame:     0,
		OutFrame:    100,
		SortOrder:   1,
		// Status intentionally empty
	}

	created, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)
	assert.Equal(t, ActionStatusPending, created.Status)
}

func TestCreateAction_DuplicateIDReturnsError(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-dup", RecordingID: opID, Label: "First",
		Color: "#fff", InFrame: 0, OutFrame: 10, SortOrder: 1,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	_, err = repo.CreateAction(ctx, action)
	assert.Error(t, err)
}

// ---------------------------------------------------------------------------
// GetAction
// ---------------------------------------------------------------------------

func TestGetAction(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	poly := [][]float64{{1.0, 2.0}, {3.0, 4.0}}
	action := Action{
		ID: "act-get", RecordingID: opID, Label: "Get Test",
		Color: "#aabbcc", InFrame: 10, OutFrame: 200,
		Polygon: poly, SortOrder: 2, Status: ActionStatusReady,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	got, err := repo.GetAction(ctx, "act-get")
	require.NoError(t, err)
	assert.Equal(t, "act-get", got.ID)
	assert.Equal(t, "Get Test", got.Label)
	assert.Equal(t, ActionStatusReady, got.Status)
	assert.Equal(t, poly, got.Polygon)
	assert.Nil(t, got.ComputedAt)
}

func TestGetAction_NotFound(t *testing.T) {
	_, repo := newTestRepoAction(t)
	ctx := context.Background()

	_, err := repo.GetAction(ctx, "nonexistent")
	assert.ErrorIs(t, err, sql.ErrNoRows)
}

// ---------------------------------------------------------------------------
// GetActionsByRecording
// ---------------------------------------------------------------------------

func TestGetActionsByRecording(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	actions := []Action{
		{ID: "act-r1", RecordingID: opID, Label: "Phase 1", Color: "#f00", InFrame: 0, OutFrame: 100, SortOrder: 1},
		{ID: "act-r2", RecordingID: opID, Label: "Phase 2", Color: "#0f0", InFrame: 100, OutFrame: 200, SortOrder: 2},
		{ID: "act-r3", RecordingID: opID, Label: "Phase 3", Color: "#00f", InFrame: 200, OutFrame: 300, SortOrder: 3},
	}
	for _, a := range actions {
		_, err := repo.CreateAction(ctx, a)
		require.NoError(t, err)
	}

	// Add stats to the first action
	stats := []ActionStats{
		{GroupName: "Alpha Squad", Side: "WEST", UnitCount: 5, PlayerCount: 3, Kills: 2, Deaths: 1, RoundsFired: 150},
	}
	require.NoError(t, repo.UpsertActionStats(ctx, "act-r1", stats))

	result, err := repo.GetActionsByRecording(ctx, opID)
	require.NoError(t, err)
	require.Len(t, result, 3)

	// Should be ordered by sort_order ASC
	assert.Equal(t, "act-r1", result[0].ID)
	assert.Equal(t, "act-r2", result[1].ID)
	assert.Equal(t, "act-r3", result[2].ID)

	// First action should have stats
	require.Len(t, result[0].Stats, 1)
	assert.Equal(t, "Alpha Squad", result[0].Stats[0].GroupName)
	assert.Equal(t, 2, result[0].Stats[0].Kills)

	// Others should have no stats
	assert.Empty(t, result[1].Stats)
	assert.Empty(t, result[2].Stats)
}

func TestGetActionsByRecording_Empty(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	result, err := repo.GetActionsByRecording(ctx, opID)
	require.NoError(t, err)
	assert.Empty(t, result)
}

// ---------------------------------------------------------------------------
// UpdateAction
// ---------------------------------------------------------------------------

func TestUpdateAction(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-upd", RecordingID: opID, Label: "Original",
		Color: "#111", InFrame: 0, OutFrame: 50, SortOrder: 1, Status: ActionStatusPending,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	computed := "2026-05-28T12:00:00Z"
	updated := Action{
		ID:         "act-upd",
		RecordingID: opID,
		Label:      "Updated Label",
		Color:      "#ffffff",
		InFrame:    10,
		OutFrame:   200,
		Polygon:    [][]float64{{5.0, 6.0}},
		SortOrder:  99,
		Status:     ActionStatusReady,
		ComputedAt: &computed,
	}
	got, err := repo.UpdateAction(ctx, updated)
	require.NoError(t, err)
	assert.Equal(t, "Updated Label", got.Label)
	assert.Equal(t, "#ffffff", got.Color)
	assert.Equal(t, 10, got.InFrame)
	assert.Equal(t, 200, got.OutFrame)
	assert.Equal(t, ActionStatusReady, got.Status)
	require.NotNil(t, got.ComputedAt)
	assert.Equal(t, computed, *got.ComputedAt)
	require.Len(t, got.Polygon, 1)
	assert.Equal(t, 5.0, got.Polygon[0][0])
}

// ---------------------------------------------------------------------------
// DeleteAction
// ---------------------------------------------------------------------------

func TestDeleteAction(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-del", RecordingID: opID, Label: "To Delete",
		Color: "#ccc", InFrame: 0, OutFrame: 100, SortOrder: 1,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	err = repo.DeleteAction(ctx, "act-del")
	require.NoError(t, err)

	_, err = repo.GetAction(ctx, "act-del")
	assert.ErrorIs(t, err, sql.ErrNoRows)
}

func TestDeleteAction_CascadesStats(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-cascade", RecordingID: opID, Label: "Cascade Test",
		Color: "#abc", InFrame: 0, OutFrame: 100, SortOrder: 1,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	stats := []ActionStats{
		{GroupName: "Bravo", Side: "EAST", UnitCount: 4, PlayerCount: 2},
		{GroupName: "Charlie", Side: "GUER", UnitCount: 3, PlayerCount: 1},
	}
	require.NoError(t, repo.UpsertActionStats(ctx, "act-cascade", stats))

	// Verify stats exist before deletion
	got, err := repo.GetAction(ctx, "act-cascade")
	require.NoError(t, err)
	require.Len(t, got.Stats, 2)

	// Delete action — stats must cascade
	require.NoError(t, repo.DeleteAction(ctx, "act-cascade"))

	var count int
	err = repoOp.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM action_stats WHERE action_id = 'act-cascade'`).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

func TestDeleteAction_NotFound(t *testing.T) {
	_, repo := newTestRepoAction(t)
	ctx := context.Background()

	err := repo.DeleteAction(ctx, "nonexistent")
	assert.ErrorIs(t, err, ErrNotFound)
}

// ---------------------------------------------------------------------------
// UpsertActionStats
// ---------------------------------------------------------------------------

func TestUpsertActionStats(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-stats", RecordingID: opID, Label: "Stats Test",
		Color: "#abc", InFrame: 0, OutFrame: 100, SortOrder: 1,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	entered := 5
	exited := 95
	pmt := "foot"

	stats := []ActionStats{
		{
			GroupName:           "Alpha",
			Side:                "WEST",
			UnitCount:           10,
			PlayerCount:         5,
			Kills:               3,
			Deaths:              1,
			VehiclesDestroyed:   map[string]int{"T-72": 2},
			VehiclesLost:        map[string]int{"M1A2": 1},
			RoundsFired:         500,
			EnteredFrame:        &entered,
			ExitedFrame:         &exited,
			PrimaryMovementType: &pmt,
		},
	}
	require.NoError(t, repo.UpsertActionStats(ctx, "act-stats", stats))

	got, err := repo.GetAction(ctx, "act-stats")
	require.NoError(t, err)
	require.Len(t, got.Stats, 1)

	s := got.Stats[0]
	assert.Equal(t, "Alpha", s.GroupName)
	assert.Equal(t, "WEST", s.Side)
	assert.Equal(t, 10, s.UnitCount)
	assert.Equal(t, 5, s.PlayerCount)
	assert.Equal(t, 3, s.Kills)
	assert.Equal(t, 1, s.Deaths)
	assert.Equal(t, 500, s.RoundsFired)
	require.NotNil(t, s.EnteredFrame)
	assert.Equal(t, 5, *s.EnteredFrame)
	require.NotNil(t, s.ExitedFrame)
	assert.Equal(t, 95, *s.ExitedFrame)
	require.NotNil(t, s.PrimaryMovementType)
	assert.Equal(t, "foot", *s.PrimaryMovementType)
	require.NotNil(t, s.VehiclesDestroyed)
	assert.Equal(t, 2, s.VehiclesDestroyed["T-72"])
	require.NotNil(t, s.VehiclesLost)
	assert.Equal(t, 1, s.VehiclesLost["M1A2"])
}

func TestUpsertActionStats_Replaces(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-upsert", RecordingID: opID, Label: "Upsert Test",
		Color: "#abc", InFrame: 0, OutFrame: 100, SortOrder: 1,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	// First upsert — 2 rows
	initial := []ActionStats{
		{GroupName: "Alpha", Side: "WEST", UnitCount: 5, PlayerCount: 2},
		{GroupName: "Bravo", Side: "EAST", UnitCount: 3, PlayerCount: 1},
	}
	require.NoError(t, repo.UpsertActionStats(ctx, "act-upsert", initial))

	got, err := repo.GetAction(ctx, "act-upsert")
	require.NoError(t, err)
	require.Len(t, got.Stats, 2)

	// Second upsert — 1 row; must replace the 2 existing rows
	replacement := []ActionStats{
		{GroupName: "Delta", Side: "GUER", UnitCount: 7, PlayerCount: 4},
	}
	require.NoError(t, repo.UpsertActionStats(ctx, "act-upsert", replacement))

	got2, err := repo.GetAction(ctx, "act-upsert")
	require.NoError(t, err)
	require.Len(t, got2.Stats, 1)
	assert.Equal(t, "Delta", got2.Stats[0].GroupName)
}

func TestUpsertActionStats_Empty(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-empty-stats", RecordingID: opID, Label: "Empty Stats",
		Color: "#abc", InFrame: 0, OutFrame: 100, SortOrder: 1,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	// Upsert with some stats then clear
	initial := []ActionStats{
		{GroupName: "Alpha", Side: "WEST", UnitCount: 5, PlayerCount: 2},
	}
	require.NoError(t, repo.UpsertActionStats(ctx, "act-empty-stats", initial))

	// Upsert with empty slice — clears the stats
	require.NoError(t, repo.UpsertActionStats(ctx, "act-empty-stats", []ActionStats{}))

	got, err := repo.GetAction(ctx, "act-empty-stats")
	require.NoError(t, err)
	assert.Empty(t, got.Stats)
}

// ---------------------------------------------------------------------------
// UpdateActionStatus
// ---------------------------------------------------------------------------

func TestUpdateActionStatus(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-status", RecordingID: opID, Label: "Status Test",
		Color: "#abc", InFrame: 0, OutFrame: 100, SortOrder: 1, Status: ActionStatusPending,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	computed := "2026-05-28T10:00:00Z"
	err = repo.UpdateActionStatus(ctx, "act-status", ActionStatusReady, &computed)
	require.NoError(t, err)

	got, err := repo.GetAction(ctx, "act-status")
	require.NoError(t, err)
	assert.Equal(t, ActionStatusReady, got.Status)
	require.NotNil(t, got.ComputedAt)
	assert.Equal(t, computed, *got.ComputedAt)
}

func TestUpdateActionStatus_Failed(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-fail", RecordingID: opID, Label: "Fail Test",
		Color: "#abc", InFrame: 0, OutFrame: 100, SortOrder: 1, Status: ActionStatusPending,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	err = repo.UpdateActionStatus(ctx, "act-fail", ActionStatusFailed, nil)
	require.NoError(t, err)

	got, err := repo.GetAction(ctx, "act-fail")
	require.NoError(t, err)
	assert.Equal(t, ActionStatusFailed, got.Status)
	assert.Nil(t, got.ComputedAt)
}

// ---------------------------------------------------------------------------
// Polygon round-trip through DB
// ---------------------------------------------------------------------------

func TestActionPolygonRoundTrip(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	poly := [][]float64{
		{10.123456, 20.654321},
		{30.999, 40.001},
		{50.5, 60.5},
	}
	action := Action{
		ID: "act-poly", RecordingID: opID, Label: "Polygon Test",
		Color: "#abc", InFrame: 0, OutFrame: 100, Polygon: poly, SortOrder: 1,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	got, err := repo.GetAction(ctx, "act-poly")
	require.NoError(t, err)
	require.Len(t, got.Polygon, 3)
	assert.InDelta(t, 10.123456, got.Polygon[0][0], 1e-6)
	assert.InDelta(t, 20.654321, got.Polygon[0][1], 1e-6)
}

// ---------------------------------------------------------------------------
// VehicleMap nil fields
// ---------------------------------------------------------------------------

func TestActionStats_NilVehicleMaps(t *testing.T) {
	repoOp, repo := newTestRepoAction(t)
	ctx := context.Background()
	opID := insertTestOperation(t, repoOp)

	action := Action{
		ID: "act-veh-nil", RecordingID: opID, Label: "Vehicle Nil Test",
		Color: "#abc", InFrame: 0, OutFrame: 100, SortOrder: 1,
	}
	_, err := repo.CreateAction(ctx, action)
	require.NoError(t, err)

	// Stats with nil vehicle maps
	stats := []ActionStats{
		{GroupName: "Echo", Side: "CIV", UnitCount: 2, PlayerCount: 0,
			VehiclesDestroyed: nil, VehiclesLost: nil},
	}
	require.NoError(t, repo.UpsertActionStats(ctx, "act-veh-nil", stats))

	got, err := repo.GetAction(ctx, "act-veh-nil")
	require.NoError(t, err)
	require.Len(t, got.Stats, 1)
	// nil stored as "{}" and returned as nil
	assert.Nil(t, got.Stats[0].VehiclesDestroyed)
	assert.Nil(t, got.Stats[0].VehiclesLost)
}
