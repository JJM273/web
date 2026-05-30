package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
)

// ActionStatus constants for the actions table.
const (
	ActionStatusPending = "pending"
	ActionStatusReady   = "ready"
	ActionStatusFailed  = "failed"
)

// actionColumns is the canonical SELECT column list for the actions table.
const actionColumns = `id, recording_id, label, color, in_frame, out_frame, polygon, sort_order, status, computed_at`

// Action mirrors a row in the actions table.
type Action struct {
	ID          string        `json:"id"`
	RecordingID int64         `json:"recording_id"`
	Label       string        `json:"label"`
	Color       string        `json:"color"`
	InFrame     int           `json:"in_frame"`
	OutFrame    int           `json:"out_frame"`
	Polygon     [][]float64   `json:"polygon"`
	SortOrder   int           `json:"sort_order"`
	Status      ActionStatus  `json:"status"`
	ComputedAt  *string       `json:"computed_at"`
	Stats       []ActionStats `json:"stats,omitempty"`
}

// ActionStatus is the string type for action computation status.
type ActionStatus = string

// ActionStats mirrors a row in the action_stats table.
type ActionStats struct {
	ID                  int64          `json:"id"`
	ActionID            string         `json:"action_id"`
	GroupName           string         `json:"group_name"`
	Side                string         `json:"side"`
	UnitCount           int            `json:"unit_count"`
	PlayerCount         int            `json:"player_count"`
	Kills               int            `json:"kills"`
	Deaths              int            `json:"deaths"`
	VehiclesDestroyed   map[string]int `json:"vehicles_destroyed"`
	VehiclesLost        map[string]int `json:"vehicles_lost"`
	RoundsFired         int            `json:"rounds_fired"`
	EnteredFrame        *int           `json:"entered_frame"`
	ExitedFrame         *int           `json:"exited_frame"`
	PrimaryMovementType *string        `json:"primary_movement_type"`
}

// RepoAction provides database access for actions and action_stats.
type RepoAction struct {
	db *sql.DB
}

// NewRepoAction creates a RepoAction backed by the provided *sql.DB.
// The caller is responsible for running migrations before calling this.
func NewRepoAction(db *sql.DB) *RepoAction {
	return &RepoAction{db: db}
}

// ---------------------------------------------------------------------------
// JSON marshal helpers
// ---------------------------------------------------------------------------

// marshalPolygon serialises a polygon (slice of coordinate pairs) to JSON.
// Returns "[]" on nil or empty input.
func marshalPolygon(polygon [][]float64) string {
	if len(polygon) == 0 {
		return "[]"
	}
	data, err := json.Marshal(polygon)
	if err != nil {
		return "[]"
	}
	return string(data)
}

// unmarshalPolygon deserialises a JSON polygon string back to [][]float64.
// Returns nil on empty or invalid input.
func unmarshalPolygon(raw string) [][]float64 {
	if raw == "" || raw == "[]" {
		return nil
	}
	var polygon [][]float64
	if err := json.Unmarshal([]byte(raw), &polygon); err != nil {
		slog.Warn("failed to unmarshal polygon", "raw", raw, "error", err)
		return nil
	}
	return polygon
}

// marshalVehicleMap serialises a map[string]int vehicle count map to JSON.
// Returns "{}" on nil input.
func marshalVehicleMap(m map[string]int) string {
	if m == nil {
		return "{}"
	}
	data, err := json.Marshal(m)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// unmarshalVehicleMap deserialises a JSON vehicle map string back to map[string]int.
// Returns nil on empty or "{}" input.
func unmarshalVehicleMap(raw string) map[string]int {
	if raw == "" || raw == "{}" {
		return nil
	}
	var m map[string]int
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		slog.Warn("failed to unmarshal vehicle map", "raw", raw, "error", err)
		return nil
	}
	return m
}

// ---------------------------------------------------------------------------
// RepoAction methods
// ---------------------------------------------------------------------------

// CreateAction inserts a new action row and returns the inserted action (with ID set).
func (r *RepoAction) CreateAction(ctx context.Context, action Action) (Action, error) {
	polygonJSON := marshalPolygon(action.Polygon)
	status := action.Status
	if status == "" {
		status = ActionStatusPending
	}

	_, err := r.db.ExecContext(ctx,
		`INSERT INTO actions (id, recording_id, label, color, in_frame, out_frame, polygon, sort_order, status, computed_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		action.ID,
		action.RecordingID,
		action.Label,
		action.Color,
		action.InFrame,
		action.OutFrame,
		polygonJSON,
		action.SortOrder,
		status,
		action.ComputedAt,
	)
	if err != nil {
		return Action{}, err
	}

	action.Status = status
	return action, nil
}

// GetActionsByRecording returns all actions for a recording, each with their stats populated.
func (r *RepoAction) GetActionsByRecording(ctx context.Context, recordingID int64) ([]Action, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+actionColumns+` FROM actions WHERE recording_id = ? ORDER BY sort_order ASC`,
		recordingID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	actions, err := r.scanActions(rows)
	if err != nil {
		return nil, err
	}

	for i := range actions {
		stats, err := r.getStatsByActionID(ctx, actions[i].ID)
		if err != nil {
			return nil, err
		}
		actions[i].Stats = stats
	}

	return actions, nil
}

// GetAction returns a single action by ID with its stats populated.
func (r *RepoAction) GetAction(ctx context.Context, actionID string) (Action, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+actionColumns+` FROM actions WHERE id = ?`,
		actionID,
	)

	action, err := r.scanAction(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return Action{}, ErrNotFound
		}
		return Action{}, err
	}

	stats, err := r.getStatsByActionID(ctx, action.ID)
	if err != nil {
		return Action{}, err
	}
	action.Stats = stats

	return action, nil
}

// UpdateAction updates the editable fields of an action and returns the updated action.
func (r *RepoAction) UpdateAction(ctx context.Context, action Action) (Action, error) {
	polygonJSON := marshalPolygon(action.Polygon)

	result, err := r.db.ExecContext(ctx,
		`UPDATE actions SET label = ?, color = ?, in_frame = ?, out_frame = ?, polygon = ?, sort_order = ?, status = ?, computed_at = ?
		 WHERE id = ?`,
		action.Label,
		action.Color,
		action.InFrame,
		action.OutFrame,
		polygonJSON,
		action.SortOrder,
		action.Status,
		action.ComputedAt,
		action.ID,
	)
	if err != nil {
		return Action{}, err
	}

	n, err := result.RowsAffected()
	if err != nil {
		return Action{}, err
	}
	if n == 0 {
		return Action{}, ErrNotFound
	}

	return r.GetAction(ctx, action.ID)
}

// DeleteAction deletes an action by ID. Stats are removed via ON DELETE CASCADE.
func (r *RepoAction) DeleteAction(ctx context.Context, actionID string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM actions WHERE id = ?`, actionID)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// UpsertActionStats replaces all stats for an action transactionally:
// deletes existing rows then inserts the new set.
func (r *RepoAction) UpsertActionStats(ctx context.Context, actionID string, stats []ActionStats) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM action_stats WHERE action_id = ?`, actionID); err != nil {
		return err
	}

	for _, s := range stats {
		vdJSON := marshalVehicleMap(s.VehiclesDestroyed)
		vlJSON := marshalVehicleMap(s.VehiclesLost)

		if _, err := tx.ExecContext(ctx,
			`INSERT INTO action_stats
				(action_id, group_name, side, unit_count, player_count, kills, deaths,
				 vehicles_destroyed, vehicles_lost, rounds_fired, entered_frame, exited_frame, primary_movement_type)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			actionID,
			s.GroupName,
			s.Side,
			s.UnitCount,
			s.PlayerCount,
			s.Kills,
			s.Deaths,
			vdJSON,
			vlJSON,
			s.RoundsFired,
			s.EnteredFrame,
			s.ExitedFrame,
			s.PrimaryMovementType,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// UpdateActionStatus updates only the status and computed_at fields of an action.
func (r *RepoAction) UpdateActionStatus(ctx context.Context, actionID string, status ActionStatus, computedAt *string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE actions SET status = ?, computed_at = ? WHERE id = ?`,
		status, computedAt, actionID,
	)
	return err
}

// ---------------------------------------------------------------------------
// Internal scan helpers
// ---------------------------------------------------------------------------

// scanActions iterates rows from an actions SELECT and returns a slice of Action.
func (*RepoAction) scanActions(rows *sql.Rows) ([]Action, error) {
	var actions []Action
	for rows.Next() {
		var a Action
		var polygonRaw string
		err := rows.Scan(
			&a.ID,
			&a.RecordingID,
			&a.Label,
			&a.Color,
			&a.InFrame,
			&a.OutFrame,
			&polygonRaw,
			&a.SortOrder,
			&a.Status,
			&a.ComputedAt,
		)
		if err != nil {
			return nil, err
		}
		a.Polygon = unmarshalPolygon(polygonRaw)
		actions = append(actions, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return actions, nil
}

// scanAction scans a single action from a QueryRow result.
func (*RepoAction) scanAction(row *sql.Row) (Action, error) {
	var a Action
	var polygonRaw string
	err := row.Scan(
		&a.ID,
		&a.RecordingID,
		&a.Label,
		&a.Color,
		&a.InFrame,
		&a.OutFrame,
		&polygonRaw,
		&a.SortOrder,
		&a.Status,
		&a.ComputedAt,
	)
	if err != nil {
		return Action{}, err
	}
	a.Polygon = unmarshalPolygon(polygonRaw)
	return a, nil
}

// getStatsByActionID fetches all action_stats rows for the given actionID.
func (r *RepoAction) getStatsByActionID(ctx context.Context, actionID string) ([]ActionStats, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, action_id, group_name, side, unit_count, player_count, kills, deaths,
		        vehicles_destroyed, vehicles_lost, rounds_fired, entered_frame, exited_frame, primary_movement_type
		 FROM action_stats WHERE action_id = ?`,
		actionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []ActionStats
	for rows.Next() {
		var s ActionStats
		var vdRaw, vlRaw string
		err := rows.Scan(
			&s.ID,
			&s.ActionID,
			&s.GroupName,
			&s.Side,
			&s.UnitCount,
			&s.PlayerCount,
			&s.Kills,
			&s.Deaths,
			&vdRaw,
			&vlRaw,
			&s.RoundsFired,
			&s.EnteredFrame,
			&s.ExitedFrame,
			&s.PrimaryMovementType,
		)
		if err != nil {
			return nil, err
		}
		s.VehiclesDestroyed = unmarshalVehicleMap(vdRaw)
		s.VehiclesLost = unmarshalVehicleMap(vlRaw)
		stats = append(stats, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return stats, nil
}
