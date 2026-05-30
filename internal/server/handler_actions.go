package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-fuego/fuego"
	"github.com/google/uuid"
)

// ActionStatsTrigger triggers async action stats computation.
type ActionStatsTrigger interface {
	TriggerActionStats(actionID string, recordingID int64)
}

// actionRequest is the JSON body for POST/PUT action endpoints.
type actionRequest struct {
	Label    string      `json:"label"`
	Color    string      `json:"color"`
	InFrame  int         `json:"in_frame"`
	OutFrame int         `json:"out_frame"`
	Polygon  [][]float64 `json:"polygon"`
}

// GetActions returns all actions for a recording, each with their stats.
func (h *Handler) GetActions(c ContextNoBody) ([]Action, error) {
	ctx := c.Context()
	id, err := strconv.ParseInt(c.PathParam("id"), 10, 64)
	if err != nil {
		return nil, fuego.BadRequestError{Err: err, Detail: err.Error()}
	}

	// Verify the operation exists.
	if _, err := h.repoOperation.GetByID(ctx, c.PathParam("id")); err != nil {
		return nil, fuego.NotFoundError{Err: err, Detail: "recording not found"}
	}

	actions, err := h.repoAction.GetActionsByRecording(ctx, id)
	if err != nil {
		return nil, err
	}
	if actions == nil {
		actions = []Action{}
	}
	return actions, nil
}

// CreateAction creates a new action for a recording and triggers async stats computation.
func (h *Handler) CreateAction(c ContextNoBody) (*Action, error) {
	ctx := c.Context()
	id, err := strconv.ParseInt(c.PathParam("id"), 10, 64)
	if err != nil {
		return nil, fuego.BadRequestError{Err: err, Detail: err.Error()}
	}

	// Verify the operation exists.
	if _, err := h.repoOperation.GetByID(ctx, c.PathParam("id")); err != nil {
		return nil, fuego.NotFoundError{Err: err, Detail: "recording not found"}
	}

	var req actionRequest
	if err := json.NewDecoder(c.Request().Body).Decode(&req); err != nil {
		return nil, fuego.BadRequestError{Err: err, Detail: "invalid JSON body"}
	}
	if req.Label == "" {
		return nil, fuego.BadRequestError{Detail: "label is required"}
	}
	if req.Color == "" {
		return nil, fuego.BadRequestError{Detail: "color is required"}
	}
	if req.InFrame >= req.OutFrame {
		return nil, fuego.BadRequestError{Detail: "in_frame must be less than out_frame"}
	}
	if len(req.Polygon) < 3 {
		return nil, fuego.BadRequestError{Detail: "polygon must have at least 3 vertices"}
	}

	// Determine sort order from existing action count.
	existing, err := h.repoAction.GetActionsByRecording(ctx, id)
	if err != nil {
		return nil, err
	}
	sortOrder := len(existing) + 1

	action := Action{
		ID:          uuid.New().String(),
		RecordingID: id,
		Label:       req.Label,
		Color:       req.Color,
		InFrame:     req.InFrame,
		OutFrame:    req.OutFrame,
		Polygon:     req.Polygon,
		SortOrder:   sortOrder,
		Status:      ActionStatusPending,
	}

	created, err := h.repoAction.CreateAction(ctx, action)
	if err != nil {
		return nil, err
	}

	c.SetStatus(http.StatusCreated)

	// Trigger async stats computation (non-blocking).
	if h.actionStatsTrigger != nil {
		h.actionStatsTrigger.TriggerActionStats(created.ID, id)
	}

	return &created, nil
}

// UpdateAction updates an existing action and re-triggers async stats computation.
func (h *Handler) UpdateAction(c ContextNoBody) (*Action, error) {
	ctx := c.Context()
	id, err := strconv.ParseInt(c.PathParam("id"), 10, 64)
	if err != nil {
		return nil, fuego.BadRequestError{Err: err, Detail: err.Error()}
	}
	aid := c.PathParam("aid")

	// Verify the operation exists.
	if _, err := h.repoOperation.GetByID(ctx, c.PathParam("id")); err != nil {
		return nil, fuego.NotFoundError{Err: err, Detail: "recording not found"}
	}

	// Fetch the existing action to verify it belongs to this recording.
	existing, err := h.repoAction.GetAction(ctx, aid)
	if err != nil {
		return nil, fuego.NotFoundError{Err: err, Detail: "action not found"}
	}
	if existing.RecordingID != id {
		return nil, fuego.NotFoundError{Detail: "action not found for this recording"}
	}

	var req actionRequest
	if err := json.NewDecoder(c.Request().Body).Decode(&req); err != nil {
		return nil, fuego.BadRequestError{Err: err, Detail: "invalid JSON body"}
	}
	if req.Label == "" {
		return nil, fuego.BadRequestError{Detail: "label is required"}
	}
	if req.Color == "" {
		return nil, fuego.BadRequestError{Detail: "color is required"}
	}
	if req.InFrame >= req.OutFrame {
		return nil, fuego.BadRequestError{Detail: "in_frame must be less than out_frame"}
	}
	if len(req.Polygon) < 3 {
		return nil, fuego.BadRequestError{Detail: "polygon must have at least 3 vertices"}
	}

	updated := Action{
		ID:          aid,
		RecordingID: id,
		Label:       req.Label,
		Color:       req.Color,
		InFrame:     req.InFrame,
		OutFrame:    req.OutFrame,
		Polygon:     req.Polygon,
		SortOrder:   existing.SortOrder,
		Status:      ActionStatusPending,
		ComputedAt:  nil,
	}

	result, err := h.repoAction.UpdateAction(ctx, updated)
	if err != nil {
		return nil, err
	}

	// Re-trigger async stats computation (non-blocking).
	if h.actionStatsTrigger != nil {
		h.actionStatsTrigger.TriggerActionStats(aid, id)
	}

	return &result, nil
}

// DeleteAction removes an action and its cascaded stats.
func (h *Handler) DeleteAction(c ContextNoBody) (any, error) {
	ctx := c.Context()
	id, err := strconv.ParseInt(c.PathParam("id"), 10, 64)
	if err != nil {
		return nil, fuego.BadRequestError{Err: err, Detail: err.Error()}
	}
	aid := c.PathParam("aid")

	// Verify the operation exists.
	if _, err := h.repoOperation.GetByID(ctx, c.PathParam("id")); err != nil {
		return nil, fuego.NotFoundError{Err: err, Detail: "recording not found"}
	}

	// Fetch the action to verify it belongs to this recording.
	existing, err := h.repoAction.GetAction(ctx, aid)
	if err != nil {
		return nil, fuego.NotFoundError{Err: err, Detail: "action not found"}
	}
	if existing.RecordingID != id {
		return nil, fuego.NotFoundError{Detail: "action not found for this recording"}
	}

	if err := h.repoAction.DeleteAction(ctx, aid); err != nil {
		return nil, err
	}

	return nil, nil
}
