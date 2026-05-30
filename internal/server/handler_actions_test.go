package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-fuego/fuego"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupActionTest(t *testing.T) (*Handler, *Operation, *RepoAction) {
	t.Helper()
	dir := t.TempDir()
	repoOp, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() { repoOp.db.Close() })

	op := &Operation{
		WorldName: "altis", MissionName: "Test Mission",
		MissionDuration: 300, Filename: "test_mission",
		Date: "2026-01-01", Tag: "TvT",
		StorageFormat: "protobuf", ConversionStatus: ConversionStatusCompleted,
	}
	require.NoError(t, repoOp.Store(t.Context(), op))

	repoAction := NewRepoAction(repoOp.DB())
	hdlr := &Handler{
		repoOperation: repoOp,
		repoAction:    repoAction,
		setting:       Setting{Secret: "test-secret", Data: dir},
		jwt:           NewJWTManager("test-secret", time.Hour),
	}
	return hdlr, op, repoAction
}

func makeActionBody(label, color string, inFrame, outFrame int) string {
	return fmt.Sprintf(`{"label":%q,"color":%q,"in_frame":%d,"out_frame":%d,"polygon":[[0,0],[100,0],[100,100],[0,100]]}`,
		label, color, inFrame, outFrame)
}

func TestGetActions_Empty(t *testing.T) {
	hdlr, op, _ := setupActionTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	result, err := hdlr.GetActions(ctx)
	require.NoError(t, err)
	assert.Equal(t, []Action{}, result)
}

func TestGetActions_WithActions(t *testing.T) {
	hdlr, op, repoAction := setupActionTest(t)

	a := Action{
		ID: "test-uuid-1", RecordingID: op.ID,
		Label: "Alpha", Color: "#ff0000",
		InFrame: 0, OutFrame: 100,
		Polygon:   [][]float64{{0, 0}, {100, 0}, {100, 100}},
		SortOrder: 1, Status: ActionStatusPending,
	}
	_, err := repoAction.CreateAction(t.Context(), a)
	require.NoError(t, err)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	result, err := hdlr.GetActions(ctx)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "Alpha", result[0].Label)
	assert.Equal(t, "#ff0000", result[0].Color)
}

func TestGetActions_RecordingNotFound(t *testing.T) {
	hdlr, _, _ := setupActionTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "99999"}

	_, err := hdlr.GetActions(ctx)
	require.Error(t, err)
}

func TestCreateAction_Success(t *testing.T) {
	hdlr, op, _ := setupActionTest(t)

	body := makeActionBody("Bravo", "#00ff00", 50, 200)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	ctx.SetRequest(req)

	result, err := hdlr.CreateAction(ctx)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "Bravo", result.Label)
	assert.Equal(t, "#00ff00", result.Color)
	assert.Equal(t, 50, result.InFrame)
	assert.Equal(t, 200, result.OutFrame)
	assert.Equal(t, ActionStatusPending, result.Status)
	assert.Equal(t, 1, result.SortOrder)
	assert.NotEmpty(t, result.ID)
}

func TestCreateAction_SortOrderIncrement(t *testing.T) {
	hdlr, op, repoAction := setupActionTest(t)

	existing := Action{
		ID: "existing-1", RecordingID: op.ID,
		Label: "First", Color: "#ff0000",
		InFrame: 0, OutFrame: 100,
		Polygon: [][]float64{{0, 0}, {100, 0}, {100, 100}}, SortOrder: 1,
		Status: ActionStatusPending,
	}
	_, err := repoAction.CreateAction(t.Context(), existing)
	require.NoError(t, err)

	body := makeActionBody("Second", "#0000ff", 200, 400)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	ctx.SetRequest(req)

	result, err := hdlr.CreateAction(ctx)
	require.NoError(t, err)
	assert.Equal(t, 2, result.SortOrder)
}

func TestCreateAction_RecordingNotFound(t *testing.T) {
	hdlr, _, _ := setupActionTest(t)

	body := makeActionBody("X", "#fff", 0, 100)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "99999"}
	ctx.SetRequest(req)

	_, err := hdlr.CreateAction(ctx)
	require.Error(t, err)
}

func TestCreateAction_AdminRequired(t *testing.T) {
	hdlr, _, _ := setupActionTest(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/1/actions", nil)
	rec := httptest.NewRecorder()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})
	hdlr.requireAdmin(inner).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestUpdateAction_Success(t *testing.T) {
	hdlr, op, repoAction := setupActionTest(t)

	a := Action{
		ID: "upd-uuid-1", RecordingID: op.ID,
		Label: "Original", Color: "#ff0000",
		InFrame: 0, OutFrame: 100,
		Polygon: [][]float64{{0, 0}, {100, 0}, {100, 100}}, SortOrder: 1,
		Status: ActionStatusReady,
	}
	_, err := repoAction.CreateAction(t.Context(), a)
	require.NoError(t, err)

	body := makeActionBody("Updated", "#aabbcc", 10, 90)
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID), "aid": "upd-uuid-1"}
	ctx.SetRequest(req)

	result, err := hdlr.UpdateAction(ctx)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "Updated", result.Label)
	assert.Equal(t, "#aabbcc", result.Color)
	assert.Equal(t, 10, result.InFrame)
	assert.Equal(t, 90, result.OutFrame)
	assert.Equal(t, ActionStatusPending, result.Status) // reset to pending
	assert.Equal(t, 1, result.SortOrder)               // preserved
}

func TestUpdateAction_Handler_NotFound(t *testing.T) {
	hdlr, op, _ := setupActionTest(t)

	body := makeActionBody("X", "#fff", 0, 100)
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID), "aid": "does-not-exist"}
	ctx.SetRequest(req)

	_, err := hdlr.UpdateAction(ctx)
	require.Error(t, err)
}

func TestUpdateAction_WrongRecording(t *testing.T) {
	hdlr, op, repoAction := setupActionTest(t)

	// Create a second recording.
	op2 := &Operation{
		WorldName: "stratis", MissionName: "Other Mission",
		MissionDuration: 100, Filename: "other_mission",
		Date: "2026-02-01", StorageFormat: "protobuf",
		ConversionStatus: ConversionStatusCompleted,
	}
	require.NoError(t, hdlr.repoOperation.Store(t.Context(), op2))

	a := Action{
		ID: "cross-uuid-1", RecordingID: op2.ID,
		Label: "Other Action", Color: "#0000ff",
		InFrame: 0, OutFrame: 50,
		Polygon: [][]float64{{0, 0}, {10, 0}, {10, 10}}, SortOrder: 1,
		Status: ActionStatusPending,
	}
	_, err := repoAction.CreateAction(t.Context(), a)
	require.NoError(t, err)

	// Try to update op2's action via op's ID — should fail.
	body := makeActionBody("Hacked", "#fff", 0, 50)
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID), "aid": "cross-uuid-1"}
	ctx.SetRequest(req)

	_, err = hdlr.UpdateAction(ctx)
	require.Error(t, err)
}

func TestDeleteAction_Success(t *testing.T) {
	hdlr, op, repoAction := setupActionTest(t)

	a := Action{
		ID: "del-uuid-1", RecordingID: op.ID,
		Label: "To Delete", Color: "#ff0000",
		InFrame: 0, OutFrame: 100,
		Polygon: [][]float64{{0, 0}, {100, 0}, {100, 100}}, SortOrder: 1,
		Status: ActionStatusPending,
	}
	_, err := repoAction.CreateAction(t.Context(), a)
	require.NoError(t, err)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID), "aid": "del-uuid-1"}

	result, err := hdlr.DeleteAction(ctx)
	require.NoError(t, err)
	assert.Nil(t, result)

	// Verify gone.
	_, err = repoAction.GetAction(t.Context(), "del-uuid-1")
	require.ErrorIs(t, err, ErrNotFound)
}

func TestDeleteAction_Handler_NotFound(t *testing.T) {
	hdlr, op, _ := setupActionTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID), "aid": "does-not-exist"}

	_, err := hdlr.DeleteAction(ctx)
	require.Error(t, err)
}

func TestDeleteAction_WrongRecording(t *testing.T) {
	hdlr, op, repoAction := setupActionTest(t)

	op2 := &Operation{
		WorldName: "stratis", MissionName: "Other Mission",
		MissionDuration: 100, Filename: "other_mission",
		Date: "2026-02-01", StorageFormat: "protobuf",
		ConversionStatus: ConversionStatusCompleted,
	}
	require.NoError(t, hdlr.repoOperation.Store(t.Context(), op2))

	a := Action{
		ID: "del-cross-1", RecordingID: op2.ID,
		Label: "Other Action", Color: "#0000ff",
		InFrame: 0, OutFrame: 50,
		Polygon: [][]float64{{0, 0}, {10, 0}, {10, 10}}, SortOrder: 1,
		Status: ActionStatusPending,
	}
	_, err := repoAction.CreateAction(t.Context(), a)
	require.NoError(t, err)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID), "aid": "del-cross-1"}

	_, err = hdlr.DeleteAction(ctx)
	require.Error(t, err)
}

func TestCreateAction_ViewerRoleRejected(t *testing.T) {
	hdlr, _, _ := setupActionTest(t)

	// A valid viewer-role JWT must still be rejected by requireAdmin.
	viewerToken, err := hdlr.jwt.Create("viewer-user", WithRole("viewer"))
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/1/actions", nil)
	req.Header.Set("Authorization", "Bearer "+viewerToken)
	rec := httptest.NewRecorder()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})
	hdlr.requireAdmin(inner).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestCreateAction_InvalidJSON(t *testing.T) {
	hdlr, op, _ := setupActionTest(t)

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	ctx.SetRequest(req)

	_, err := hdlr.CreateAction(ctx)
	require.Error(t, err)
}

func TestGetActions_ResponseIsArray(t *testing.T) {
	hdlr, op, _ := setupActionTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	result, err := hdlr.GetActions(ctx)
	require.NoError(t, err)

	// Must be serializable as a JSON array (not null).
	b, err := json.Marshal(result)
	require.NoError(t, err)
	assert.Equal(t, "[]", string(b))
}
